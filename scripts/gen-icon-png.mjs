// Renders the 1024px master icon: a macOS-style squircle with a teal→orange
// gradient and a shuriken glyph knocked out of it.
//
// Usage: node scripts/gen-icon-png.mjs out.png

import zlib from 'node:zlib';
import { writeFileSync } from 'node:fs';

const S = 1024;   // output size
const SS = 3;     // supersampling factor per axis

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const cTop = hex('#00d6a4');   // teal
const cBot = hex('#0b7fa8');   // deep blue
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];

// macOS squircle: |x|^n + |y|^n <= 1 with n≈5
const nExp = 5;
const margin = 0.10;
const inner = 1 - margin;

function inSquircle(nx, ny) {
  const x = nx / inner;
  const y = ny / inner;
  return Math.pow(Math.abs(x), nExp) + Math.pow(Math.abs(y), nExp) <= 1;
}

// Shuriken: four blades, each a quarter turn of the same wedge. A point is in
// the glyph when its polar angle sits inside a blade and its radius is under
// the blade's tapering profile.
const R_OUT = 0.62;
const R_HOLE = 0.115;

function inShuriken(nx, ny) {
  const r = Math.hypot(nx, ny);
  if (r > R_OUT) return false;
  if (r < R_HOLE) return false;

  let a = Math.atan2(ny, nx);
  const quarter = Math.PI / 2;
  // Fold into a single blade's [0, 90°) sector.
  a = ((a % quarter) + quarter) % quarter;

  // Blade profile: full width at the hub, tapering to a point at the tip.
  const t = (r - R_HOLE) / (R_OUT - R_HOLE);
  const width = quarter * (1 - t) * 0.92;
  return a <= width;
}

const buf = Buffer.alloc(S * S * 4);

for (let py = 0; py < S; py++) {
  for (let px = 0; px < S; px++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const fx = (px + (sx + 0.5) / SS) / S;
        const fy = (py + (sy + 0.5) / SS) / S;
        const nx = fx * 2 - 1;
        const ny = fy * 2 - 1;
        if (!inSquircle(nx, ny)) continue;

        const t = Math.min(1, Math.max(0, fx * 0.4 + fy * 0.6));
        let col = mix(cTop, cBot, t);

        // Subtle sheen along the top edge.
        const sheen = Math.max(0, 0.2 * (1 - fy * 1.7));
        col = col.map((c) => Math.min(255, c + sheen * 110));

        if (inShuriken(nx, ny)) col = [255, 255, 255];

        r += col[0]; g += col[1]; b += col[2]; a += 255;
      }
    }
    const samples = SS * SS;
    const idx = (py * S + px) * 4;
    buf[idx] = Math.round(r / samples);
    buf[idx + 1] = Math.round(g / samples);
    buf[idx + 2] = Math.round(b / samples);
    buf[idx + 3] = Math.round(a / samples);
  }
}

// --- PNG encode (truecolor + alpha, filter 0) -------------------------------

function crc32(bytes) {
  let c = ~0;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8;
ihdr[9] = 6; // RGBA

const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  buf.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
}
const idat = zlib.deflateSync(raw, { level: 9 });
const png = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);

const out = process.argv[2] || 'icon-1024.png';
writeFileSync(out, png);
console.log('wrote', out, png.length, 'bytes');
