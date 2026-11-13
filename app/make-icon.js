// Draws the app icon (icon.png 256x256 + icon.ico for Windows): a chip on a green circuit board with glowing lights.
// node make-icon.js   (needs @napi-rs/canvas - it's in the scratchpad canvas folder: NODE_PATH points there)
const fs = require('fs');
const { createCanvas } = require('@napi-rs/canvas');
const S = 256, c = createCanvas(S, S), g = c.getContext('2d');
const round = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
// the board
round(8, 8, 240, 240, 44); const bg = g.createLinearGradient(0, 0, 0, S); bg.addColorStop(0, '#16352a'); bg.addColorStop(1, '#0c1f18'); g.fillStyle = bg; g.fill();
g.strokeStyle = '#2c5a46'; g.lineWidth = 4; g.stroke();
// copper traces out of the chip, glowing gold
g.lineCap = 'round';
const traces = [[128, 60, 128, 24], [86, 128, 34, 128], [170, 128, 222, 128], [128, 196, 128, 232], [100, 70, 100, 40, 60, 40], [156, 186, 156, 214, 200, 214]];
for (const t of traces) {
  for (const [w, col] of [[16, 'rgba(255,200,80,0.18)'], [8, '#d8a63a'], [3, '#ffe39a']]) {
    g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(t[0], t[1]); for (let i = 2; i < t.length; i += 2) g.lineTo(t[i], t[i + 1]); g.stroke();
  }
}
// the chip with its legs
g.fillStyle = '#b9c0c8';
for (let i = 0; i < 4; i++) { const p = 92 + i * 24; g.fillRect(p - 4, 66, 8, 14); g.fillRect(p - 4, 176, 8, 14); g.fillRect(66, p - 4, 14, 8); g.fillRect(176, p - 4, 14, 8); }
round(76, 76, 104, 104, 12); g.fillStyle = '#20252e'; g.fill(); g.strokeStyle = '#3a4250'; g.lineWidth = 3; g.stroke();
// three lights on the chip: red, green, blue, with their glow
for (const [x, col, glow] of [[104, '#ff4a3a', 'rgba(255,70,60,'], [128, '#46ff7a', 'rgba(70,255,120,'], [152, '#4aa8ff', 'rgba(70,160,255,']]) {
  const gr = g.createRadialGradient(x, 128, 2, x, 128, 30); gr.addColorStop(0, glow + '0.8)'); gr.addColorStop(1, glow + '0)');
  g.fillStyle = gr; g.fillRect(x - 30, 98, 60, 60);
  g.fillStyle = col; g.fillRect(x - 8, 120, 16, 16);
}
const png = c.toBuffer('image/png');
fs.writeFileSync('icon.png', png);
// an .ico is a tiny header pointing at the PNG inside it
const head = Buffer.alloc(22);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
head[6] = 0; head[7] = 0; head[8] = 0; head[9] = 0; head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12);
head.writeUInt32LE(png.length, 14); head.writeUInt32LE(22, 18);
fs.writeFileSync('icon.ico', Buffer.concat([head, png]));
console.log('icon.png + icon.ico');
