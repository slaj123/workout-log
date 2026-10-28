// Draws the Workouts home-screen icon (a chalk plate on deep sea)
// as PNGs with no dependencies, 4x4 supersampled, written with Node's zlib.
// Output goes to public/.
// Run: node scripts/make-icons.mjs   (only needed when the icon changes)
import fs from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";

const BG = [0x0e, 0x5e, 0x5a];
const CHALK = [0xf3, 0xf0, 0xe8];
const RING = [0xd9, 0xd4, 0xc7];
const HOLE = [0x0e, 0x5e, 0x5a];
const SIGNAL = [0xe2, 0x55, 0x2b];

// A weight plate seen face-on: chalk disc, a darker inner ring, the bore,
// and one signal-orange tick at the rim (the "new best" mark).
function colorAt(x, y, maskable) {
  const k = maskable ? 0.74 : 1;
  x = 0.5 + (x - 0.5) / k;
  y = 0.5 + (y - 0.5) / k;
  const r = Math.hypot(x - 0.5, y - 0.5);
  if (r > 0.31) return BG;
  if (r > 0.255 && Math.abs(x - 0.5) < 0.03 && y < 0.5) return SIGNAL;
  if (r > 0.29) return RING;
  if (r > 0.17 && r < 0.19) return RING;
  if (r < 0.065) return HOLE;
  return CHALK;
}

function png(size, maskable) {
  const SS = 4;
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 3 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const c = colorAt((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size, maskable);
        r += c[0]; g += c[1]; b += c[2];
      }
      const o = py * (size * 3 + 1) + 1 + px * 3;
      raw[o] = r / (SS * SS); raw[o + 1] = g / (SS * SS); raw[o + 2] = b / (SS * SS);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const out = "public";
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "apple-touch-icon.png"), png(180, false));
fs.writeFileSync(path.join(out, "icon-192.png"), png(192, false));
fs.writeFileSync(path.join(out, "icon-512.png"), png(512, false));
fs.writeFileSync(path.join(out, "icon-maskable-512.png"), png(512, true));
console.log("icons written to public/");
