// Unit tests for the pure character-mapping helpers shared between the GPU
// shader semantics and the CPU-side ASCII text export.  Runs under Node's
// native TypeScript type stripping — no GPU, DOM, or extra dependencies.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DIRECTION_BUCKET_COUNT,
  angleToDirectionBucket,
  applyDirectionOffset,
  charIndexForIntensity,
  dedupeCharset,
  directionIndexOffset,
} from '../src/engine/charMapping.ts';

// ── dedupeCharset ────────────────────────────────────────────────────────────

test('dedupeCharset preserves order and removes duplicates', () => {
  assert.deepEqual(dedupeCharset('@#%?*+;:,. '), ['@', '#', '%', '?', '*', '+', ';', ':', ',', '.', ' ']);
  assert.deepEqual(dedupeCharset('aabbcc'), ['a', 'b', 'c']);
  assert.deepEqual(dedupeCharset('0 1 0'), ['0', ' ', '1']);
  assert.deepEqual(dedupeCharset(''), []);
});

// ── charIndexForIntensity (shader index semantics) ───────────────────────────

test('charIndexForIntensity matches floor(intensity * (charCount - 1))', () => {
  const n = 10;
  for (let i = 0; i <= 100; i++) {
    const intensity = i / 100;
    assert.equal(charIndexForIntensity(intensity, n), Math.floor(intensity * (n - 1)));
  }
});

test('charIndexForIntensity: index 0 is densest, n-1 is sparsest', () => {
  assert.equal(charIndexForIntensity(0, 5), 0);
  assert.equal(charIndexForIntensity(1, 5), 4);
  assert.equal(charIndexForIntensity(0.5, 5), 2); // floor(0.5 * 4)
});

test('charIndexForIntensity clamps out-of-range intensity and degenerate counts', () => {
  assert.equal(charIndexForIntensity(-0.5, 5), 0);
  assert.equal(charIndexForIntensity(1.5, 5), 4);
  assert.equal(charIndexForIntensity(0.9, 1), 0);
  assert.equal(charIndexForIntensity(0.9, 0), 0);
});

// ── angleToDirectionBucket ───────────────────────────────────────────────────

test('angleToDirectionBucket splits [0, PI) into 4 orientation buckets', () => {
  // Encoded angle: g = atan2/(2PI) + 0.5, so 0.5 of the range == PI radians.
  assert.equal(angleToDirectionBucket(0.0), 0);   // 0 rad     → bucket 0
  assert.equal(angleToDirectionBucket(0.1), 0);   // < PI/4
  assert.equal(angleToDirectionBucket(0.125), 1); // PI/4      → bucket 1
  assert.equal(angleToDirectionBucket(0.25), 2);  // PI/2      → bucket 2
  assert.equal(angleToDirectionBucket(0.375), 3); // 3PI/4     → bucket 3
  assert.equal(angleToDirectionBucket(0.49), 3);
});

test('angleToDirectionBucket folds orientation modulo PI (undirected edges)', () => {
  // Angles PI apart must land in the same bucket.
  assert.equal(angleToDirectionBucket(0.5), angleToDirectionBucket(0.0));
  assert.equal(angleToDirectionBucket(0.625), angleToDirectionBucket(0.125));
  assert.equal(angleToDirectionBucket(0.75), angleToDirectionBucket(0.25));
  assert.equal(angleToDirectionBucket(0.875), angleToDirectionBucket(0.375));
  // Encoded angle 1.0 wraps to the same bucket as 0.0.
  assert.equal(angleToDirectionBucket(1.0), angleToDirectionBucket(0.0));
});

// ── directionIndexOffset / applyDirectionOffset ─────────────────────────────

test('directionIndexOffset is centred and symmetric across buckets', () => {
  const n = 21;
  const o0 = directionIndexOffset(0, 1, 1, n);
  const o3 = directionIndexOffset(3, 1, 1, n);
  assert.equal(o0, -o3);
  // Full weight + full magnitude: extreme buckets shift by ±(n-1)/2.
  assert.equal(o0, -(n - 1) / 2);
  assert.equal(o3, (n - 1) / 2);
  // Weight or magnitude of zero → no offset.
  assert.equal(directionIndexOffset(3, 0, 1, n), 0);
  assert.equal(directionIndexOffset(3, 1, 0, n), 0);
});

test('applyDirectionOffset: weight 0 returns the base index untouched', () => {
  const n = 10;
  for (let base = 0; base < n; base++) {
    for (let bucket = 0; bucket < DIRECTION_BUCKET_COUNT; bucket++) {
      assert.equal(applyDirectionOffset(base, bucket, 0, 1, n), base);
    }
  }
});

test('applyDirectionOffset shifts by direction and clamps to valid range', () => {
  const n = 11; // (n-1)/3 per centered-bucket step at full weight/magnitude
  // Bucket 3 pushes up, bucket 0 pushes down.
  assert.ok(applyDirectionOffset(5, 3, 1, 1, n) > 5);
  assert.ok(applyDirectionOffset(5, 0, 1, 1, n) < 5);
  // Different buckets pick different characters for the same intensity.
  const picks = [0, 1, 2, 3].map((b) => applyDirectionOffset(5, b, 1, 1, n));
  assert.ok(new Set(picks).size > 1);
  // Clamping at both ends.
  assert.equal(applyDirectionOffset(0, 0, 1, 1, n), 0);
  assert.equal(applyDirectionOffset(n - 1, 3, 1, 1, n), n - 1);
});

// ── Synthetic luminance grid → exported text (export/shader consistency) ────

test('synthetic 2x2 luminance grid maps through shader index semantics', () => {
  // Simulate generateAsciiText's per-cell mapping on a synthetic 2x2 grid of
  // cell luminances, using a charset with a duplicate to prove the deduped
  // count (4, not 5) drives the index math — matching uCharCount on the GPU.
  const charset = '@#.. '; // deduped → ['@', '#', '.', ' '], charCount = 4
  const chars = dedupeCharset(charset);
  const n = chars.length;
  assert.equal(n, 4);

  // Cell luminances chosen to hit exact bucket boundaries:
  //   floor(lum * 3): 0 → 0, 1/3 → 1, 2/3 → 2, 1 → 3
  const grid = [
    [0, 1 / 3],
    [2 / 3, 1],
  ];

  const lines = grid.map((row) =>
    row.map((lum) => chars[charIndexForIntensity(lum, n)]).join(''),
  );

  assert.deepEqual(lines, ['@#', '. ']);
});

test('synthetic 4x4 grid: direction weight 0 is identical to no direction pass', () => {
  const chars = dedupeCharset('@#MW&8B%$XoahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,"^`. ');
  const n = chars.length;

  // Synthetic 4x4 grid of (luminance, encodedAngle, edgeMagnitude) cells.
  const cells: Array<Array<[number, number, number]>> = [];
  for (let r = 0; r < 4; r++) {
    const row: Array<[number, number, number]> = [];
    for (let c = 0; c < 4; c++) {
      row.push([(r * 4 + c) / 15, (r * 4 + c) / 16, ((r + c) % 3) / 2]);
    }
    cells.push(row);
  }

  for (const row of cells) {
    for (const [lum, angle, mag] of row) {
      const base = charIndexForIntensity(lum, n);
      const bucket = angleToDirectionBucket(angle);
      // directionWeight = 0 → identical to the legacy intensity-only path.
      assert.equal(applyDirectionOffset(base, bucket, 0, mag, n), base);
      // directionWeight > 0 → stays a valid index into the deduped charset.
      const shifted = applyDirectionOffset(base, bucket, 0.8, mag, n);
      assert.ok(shifted >= 0 && shifted < n);
      assert.equal(chars[shifted].length, 1);
    }
  }
});
