// Pure character-mapping helpers shared by the GPU shader semantics
// (ascii.frag.glsl) and the CPU-side ASCII text export.  Kept free of DOM,
// WebGL, and third-party imports so it can be unit-tested under Node's
// native TypeScript type stripping.
//
// INDEX SEMANTICS (single source of truth):
//   - The charset is sorted dense-to-sparse; index 0 is the densest glyph.
//   - The atlas is built from the DEDUPLICATED charset, so all index math
//     uses the deduplicated character count.
//   - Intensity → index:  floor(clamp(intensity, 0, 1) * (charCount - 1))
//     exactly as in ascii.frag.glsl.

/** Deduplicate a charset while preserving order (mirrors GlyphAtlas). */
export function dedupeCharset(charset: string): string[] {
  return [...new Set([...charset])];
}

/**
 * Map a [0,1] intensity to a character index, matching the GLSL:
 *   charIndex = floor(intensity * (uCharCount - 1.0))
 * Index 0 = densest character, charCount - 1 = sparsest.
 */
export function charIndexForIntensity(intensity: number, charCount: number): number {
  if (charCount <= 1) return 0;
  const t = Math.min(1, Math.max(0, intensity));
  return Math.min(charCount - 1, Math.floor(t * (charCount - 1)));
}

/** Number of orientation buckets used for direction-aware selection. */
export const DIRECTION_BUCKET_COUNT = 4;

/**
 * Bucket an encoded edge angle into one of `bucketCount` orientation buckets.
 *
 * `angle01` is the EdgeFBO g-channel encoding produced by edge.frag.glsl:
 *   g = atan2(gy, gx) / (2π) + 0.5        → [0, 1]
 * Edge orientation is undirected, so the angle is folded modulo π, which is
 * 0.5 in this encoding.  Bucket 0 ≈ horizontal, 1 ≈ diagonal, 2 ≈ vertical,
 * 3 ≈ anti-diagonal.  Mirrors the GLSL in ascii.frag.glsl.
 */
export function angleToDirectionBucket(
  angle01: number,
  bucketCount: number = DIRECTION_BUCKET_COUNT,
): number {
  const t = ((angle01 % 0.5) + 0.5) % 0.5; // [0, 0.5)
  return Math.min(bucketCount - 1, Math.floor(t * 2 * bucketCount));
}

/**
 * Signed character-index offset for a direction bucket.  Buckets are centred
 * around zero so that, at full weight and full edge magnitude, the extreme
 * buckets shift the index by ±(charCount - 1) / 2.  Mirrors ascii.frag.glsl.
 */
export function directionIndexOffset(
  bucket: number,
  directionWeight: number,
  edgeMagnitude: number,
  charCount: number,
  bucketCount: number = DIRECTION_BUCKET_COUNT,
): number {
  if (charCount <= 1 || bucketCount <= 1) return 0;
  const centered = bucket - (bucketCount - 1) / 2;
  return (centered * directionWeight * edgeMagnitude * (charCount - 1)) / (bucketCount - 1);
}

/**
 * Combine a base intensity-derived index with the directional offset and
 * clamp to [0, charCount - 1].  A directionWeight of 0 returns the base
 * index untouched (bit-identical to direction-unaware selection).
 */
export function applyDirectionOffset(
  baseIndex: number,
  bucket: number,
  directionWeight: number,
  edgeMagnitude: number,
  charCount: number,
  bucketCount: number = DIRECTION_BUCKET_COUNT,
): number {
  if (directionWeight <= 0) return baseIndex;
  const shifted =
    baseIndex +
    directionIndexOffset(bucket, directionWeight, edgeMagnitude, charCount, bucketCount);
  return Math.min(charCount - 1, Math.max(0, Math.floor(shifted)));
}
