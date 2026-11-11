// Pass 2 — Character mapping and glyph atlas compositing.
//
// Every pixel in a character cell renders the same chosen character,
// but reads the correct sub-texel from the glyph atlas for its
// position within the cell.  No CPU text rendering occurs.
//
// Character selection logic:
//   intensity = clamp(mix(cellLuminance, edgeMagnitude, uEdgeWeight) * uContrast, 0, 1)
//   charIndex = floor(intensity * (charCount - 1))
//   if uDirectionWeight > 0:
//     charIndex += directional offset from the edge-angle bucket (g channel)
//
// High-intensity / high-edge cells map to high indices, low-intensity /
// flat cells to low indices.  The charset in GlyphAtlas is pre-sorted
// dense-to-sparse so index 0 is always the densest character.
//
// Direction-aware selection: when uDirectionWeight > 0 the edge orientation
// (Pass 1 g channel, folded modulo PI) is bucketed into 4 directions and
// nudges the character index by a signed, magnitude-scaled offset, so
// different edge orientations favour different characters.  The branch is
// skipped entirely when uDirectionWeight == 0, keeping the output
// bit-identical to pure intensity-based selection.
precision highp float;

uniform sampler2D uSource;     // original media (unused here, reserved for future colour mode)
uniform sampler2D uEdge;       // Pass 1 FBO: .r=magnitude, .g=angle, .b=luminance
uniform sampler2D uAtlas;      // pre-rendered glyph atlas texture
uniform vec2      uCellCount;  // (numCols, numRows) of the character grid
uniform vec2      uAtlasDims;  // (atlasCols, atlasRows) of the glyph atlas grid
uniform float     uEdgeWeight; // [0,1] — 0 = pure luminance, 1 = pure edge
uniform float     uDirectionWeight; // [0,1] — 0 = direction ignored (default)
uniform float     uContrast;   // luminance contrast multiplier
uniform vec3      uFgColor;    // foreground character colour
uniform vec3      uBgColor;    // background colour
uniform float     uCharCount;  // total characters in the atlas

in  vec2 vUv;
out vec4 fragColor;

void main() {
  // Determine which cell this pixel lives in and its position within that cell
  vec2 cellIndex = floor(vUv * uCellCount);
  vec2 cellUv    = (cellIndex + 0.5) / uCellCount; // centre of the cell
  vec2 inCellUv  = fract(vUv * uCellCount);         // [0,1] offset within cell

  // Read edge data sampled at the cell centre (one value per cell, not per pixel)
  vec4  edgeData = texture(uEdge, cellUv);
  float edgeMag  = edgeData.r; // already clamped in Pass 1
  float cellLum  = edgeData.b;

  // Blend luminance and edge magnitude, then apply contrast
  float intensity = mix(cellLum, edgeMag, uEdgeWeight);
  intensity = clamp(intensity * uContrast, 0.0, 1.0);

  // Map intensity to a character index (dense chars at low indices)
  float charIndex = floor(intensity * (uCharCount - 1.0));

  // Direction-aware selection: nudge the index by the edge-orientation
  // bucket.  Mirrors angleToDirectionBucket / applyDirectionOffset in
  // src/engine/charMapping.ts — keep the two in sync.
  if (uDirectionWeight > 0.0) {
    // g encodes atan2(gy,gx)/(2PI)+0.5; orientation is undirected, so fold
    // modulo PI (= 0.5 in the encoding) and split into 4 buckets.
    float t      = fract(edgeData.g * 2.0) * 0.5;      // [0, 0.5)
    float bucket = min(floor(t * 8.0), 3.0);           // 0..3
    float offset = (bucket - 1.5) * uDirectionWeight * edgeMag
                 * (uCharCount - 1.0) / 3.0;
    charIndex = clamp(floor(charIndex + offset), 0.0, uCharCount - 1.0);
  }

  // Locate the glyph cell in the atlas grid
  vec2 atlasCell = vec2(
    mod(charIndex, uAtlasDims.x),
    floor(charIndex / uAtlasDims.x)
  );

  // UV into the atlas at the sub-glyph position for this pixel
  vec2 atlasUv = (atlasCell + inCellUv) / uAtlasDims;

  // Atlas is white-on-black; the red channel gives the glyph mask
  float glyphMask = texture(uAtlas, atlasUv).r;

  // Composite foreground over background using glyph mask as alpha
  vec3 color = mix(uBgColor, uFgColor, glyphMask);
  fragColor  = vec4(color, 1.0);
}
