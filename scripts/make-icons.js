/**
 * Tạo icon PWA tạm (chữ "FS" trắng trên nền xanh FoodSave) bằng Node thuần, không cần thư viện ảnh:
 *   node scripts/make-icons.js
 * Ghi: icons/icon-192.png, icons/icon-512.png, icons/maskable-512.png, icons/apple-touch-icon-180.png
 * Khi có logo vuông chính thức, thay các tệp này bằng logo (giữ đúng tên và kích thước).
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const GREEN = [0, 108, 77];   // #006C4D
const WHITE = [255, 255, 255];

// Phông 5x7 cho chữ F và S
const GLYPH = {
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"]
};

const crcTable = (() => { const t = []; for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function png(size, { rounded, letterScale }) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const radius = rounded ? size * 0.22 : 0;
  // vị trí chữ: 2 chữ rộng 5 ô, cách 1 ô => 11 ô ngang, 7 ô dọc
  const cell = Math.floor((size * letterScale) / 11);
  const textW = cell * 11, textH = cell * 7;
  const x0 = Math.floor((size - textW) / 2), y0 = Math.floor((size - textH) / 2);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x += 1) {
      let inside = true;
      if (rounded) {
        const dx = Math.max(radius - x, 0, x - (size - 1 - radius));
        const dy = Math.max(radius - y, 0, y - (size - 1 - radius));
        inside = dx * dx + dy * dy <= radius * radius;
      }
      let colour = GREEN;
      const tx = x - x0, ty = y - y0;
      if (tx >= 0 && ty >= 0 && tx < textW && ty < textH) {
        const col = Math.floor(tx / cell), row = Math.floor(ty / cell);
        const glyph = col < 5 ? GLYPH.F : col >= 6 ? GLYPH.S : null;
        const gc = col < 5 ? col : col - 6;
        if (glyph && glyph[row][gc] === "1") colour = WHITE;
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = colour[0]; raw[o + 1] = colour[1]; raw[o + 2] = colour[2]; raw[o + 3] = inside ? 255 : 0;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4);
  header[8] = 8; header[9] = 6; header[10] = 0; header[11] = 0; header[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const out = path.join(__dirname, "..", "icons");
fs.mkdirSync(out, { recursive: true });
const files = [
  ["icon-192.png", 192, { rounded: true, letterScale: 0.62 }],
  ["icon-512.png", 512, { rounded: true, letterScale: 0.62 }],
  // maskable: nền tràn hết, chữ nằm trong vùng an toàn (80% giữa)
  ["maskable-512.png", 512, { rounded: false, letterScale: 0.5 }],
  ["apple-touch-icon-180.png", 180, { rounded: false, letterScale: 0.6 }]
];
for (const [name, size, opts] of files) {
  fs.writeFileSync(path.join(out, name), png(size, opts));
  console.log("Đã tạo icons/" + name);
}
