/**
 * Icone dell'app (PWA) disegnate in codice: una "B" fatta di blocchi su fondo scuro.
 * Scrive i PNG in client/public/icons. Uso: node scripts/icons.mjs
 * Nessuna dipendenza: il PNG è codificato a mano (zlib di Node + CRC32).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'client', 'public', 'icons');

const BACKGROUND_TOP = [0x1c, 0x23, 0x33];
const BACKGROUND_BOTTOM = [0x0d, 0x10, 0x17];
const BLOCK = [0xff, 0xb2, 0x38];
const BLOCK_LIGHT = [0xff, 0xd8, 0x8a];
const BLOCK_DARK = [0xc9, 0x7c, 0x12];

/** La lettera B su una griglia 5 × 7. */
const LETTER = ['XXXX.', 'X...X', 'X...X', 'XXXX.', 'X...X', 'X...X', 'XXXX.'];

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit per canale
  header[9] = 6; // RGBA
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    rows[y * (size * 4 + 1)] = 0; // nessun filtro
    rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** @param content frazione del lato occupata dalla lettera (le icone "maskable" ne vogliono meno). */
function drawIcon(size, content) {
  const rgba = Buffer.alloc(size * size * 4);
  const set = (x, y, color) => {
    const i = (y * size + x) * 4;
    rgba[i] = color[0];
    rgba[i + 1] = color[1];
    rgba[i + 2] = color[2];
    rgba[i + 3] = 255;
  };
  for (let y = 0; y < size; y++) {
    const t = y / (size - 1);
    const color = BACKGROUND_TOP.map((c, i) => Math.round(c + (BACKGROUND_BOTTOM[i] - c) * t));
    for (let x = 0; x < size; x++) set(x, y, color);
  }
  const cell = Math.floor((size * content) / LETTER.length);
  const gap = Math.max(1, Math.round(cell * 0.08));
  const bevel = Math.max(1, Math.round(cell * 0.14));
  const left = Math.round((size - cell * 5) / 2);
  const top = Math.round((size - cell * LETTER.length) / 2);
  LETTER.forEach((row, gy) => {
    [...row].forEach((mark, gx) => {
      if (mark !== 'X') return;
      const x0 = left + gx * cell + gap;
      const y0 = top + gy * cell + gap;
      const s = cell - gap * 2;
      for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
          // Blocchetto con luce in alto a sinistra e ombra in basso a destra.
          const color = x < bevel || y < bevel ? BLOCK_LIGHT : x >= s - bevel || y >= s - bevel ? BLOCK_DARK : BLOCK;
          set(x0 + x, y0 + y, color);
        }
      }
    });
  });
  return encodePng(size, rgba);
}

mkdirSync(OUT, { recursive: true });
const icons = [
  ['icon-192.png', 192, 0.62],
  ['icon-512.png', 512, 0.62],
  // Android ritaglia le icone "maskable" in un cerchio: la lettera sta nel 50% centrale.
  ['maskable-512.png', 512, 0.5],
  ['apple-touch-icon.png', 180, 0.6],
  ['favicon-32.png', 32, 0.75],
];
for (const [name, size, content] of icons) {
  writeFileSync(join(OUT, name), drawIcon(size, content));
  console.log(`${name} ${size}×${size}`);
}
