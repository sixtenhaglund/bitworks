// BITWORKS — drawing, controls and UI.
'use strict';
const { CS, CSH, CM, CN, DX, DY, T, NAMES, PER, SETTINGS, hasPort, World, Sim } = BW;

const cv = document.getElementById('c'), ctx = cv.getContext('2d');
const $ = (id) => document.getElementById(id);
let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = window.devicePixelRatio || 1; W = innerWidth; H = innerHeight;
  cv.width = W * DPR | 0; cv.height = H * DPR | 0; cv.style.width = W + 'px'; cv.style.height = H + 'px';
}
addEventListener('resize', resize); resize();

// ---------------------------------------------------------------- colors
const BG = '#0a0f14';
const LED_COLORS = [[255, 60, 50], [60, 230, 90], [60, 140, 255], [255, 220, 50], [240, 245, 255], [255, 140, 30], [200, 80, 255], [40, 230, 230]];
const LED_NAMES = ['RED', 'GREEN', 'BLUE', 'YELLOW', 'WHITE', 'ORANGE', 'PURPLE', 'CYAN'];
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const COL = {   // [off, on] for each block type
  1: [[92, 60, 38], [255, 196, 64]], 2: [[92, 60, 38], [255, 196, 64]],
  3: [[120, 40, 40], [60, 220, 90]], 4: [[110, 60, 30], [255, 140, 40]],
  5: [[70, 40, 110], [190, 110, 255]], 6: [[200, 60, 60], [200, 60, 60]],
  15: [[34, 70, 70], [60, 190, 170]], 16: [[34, 70, 70], [60, 190, 170]],
  18: [[34, 22, 22], [34, 22, 22]], 19: [[66, 66, 30], [230, 230, 90]],
};
for (let t = 7; t <= 14; t++) COL[t] = [[44, 54, 70], [70, 120, 190]];
function colorOf(t, set, on) {
  if (t === T.LED) { const c = LED_COLORS[set & 7]; return on ? c : [c[0] * 0.22, c[1] * 0.22, c[2] * 0.22]; }
  return COL[t][on ? 1 : 0];
}
const css = (c, a) => a === undefined ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const pack = (c) => ((255 << 24) | ((c[2] | 0) << 16) | ((c[1] | 0) << 8) | (c[0] | 0)) >>> 0;
// pixel colors packed once, so the far-away view is just number copying
const PX = {};
for (let t = 1; t <= 19; t++) for (let set = 0; set < 8; set++) for (let on = 0; on < 2; on++) {
  if (t !== T.LED && set) continue;
  PX[(t << 4) | (set << 1) | on] = pack(colorOf(t, set, on));
}
PX[(T.HEX << 4) | 1] = pack([255, 80, 50]);

const LABEL = { 6: '1', 7: 'NOT', 8: 'AND', 9: 'OR', 10: 'XOR', 11: 'NAND', 12: 'NOR', 13: 'XNOR', 14: 'DIO', 15: 'T', 16: 'D', 19: '♪' };
const DESC = {
  1: 'Carries a signal. Wires that touch become one wire.',
  2: 'Lets two wires cross without touching (left-right and up-down stay separate).',
  3: 'Click it to flip ON/OFF. Powers all 4 sides.',
  4: 'ON only while you hold the mouse on it.',
  5: 'Flips ON and OFF by itself. F = speed.',
  6: 'Always ON.',
  7: 'ON when the input behind it is OFF.',
  8: 'ON when ALL connected inputs are ON. Reads back, left and right.',
  9: 'ON when ANY input is ON.',
  10: 'ON when an ODD number of inputs are ON. Great for adding numbers.',
  11: 'Opposite of AND.', 12: 'Opposite of OR.', 13: 'Opposite of XOR.',
  14: 'Lets the signal go one way only (back to front). Takes 1 tick.',
  15: 'Flips its output every time the input behind it turns ON. Chain them to count!',
  16: 'Memory! When the back (clock) turns ON it saves whatever the sides are.',
  17: 'Lights up when powered. F = color.',
  18: 'Shows a digit 0-F. Top = 1, right = 2, bottom = 4, left = 8.',
  19: 'Beeps while powered. F = note.',
};
function settingText(t, set) {
  if (t === T.CLOCK) return 'flips every ' + PER[set % PER.length] + ' tick' + (PER[set % PER.length] > 1 ? 's' : '');
  if (t === T.LED) return LED_NAMES[set & 7];
  if (t === T.BUZZER) return 'note ' + NOTE_NAMES[set % 12] + (4 + ((set / 12) | 0));
  return '';
}

// ---------------------------------------------------------------- drawing one block (big zoom + icons)
// arms = which sides a wire connects to. onV = the up/down signal of a crossing.
function drawBlock(g, t, d, set, st, arms, sx, sy, z, onV) {
  const on = st & 1;
  if (t === T.WIRE || t === T.CROSS) {
    const w = Math.max(1, z * 0.28), o = (z - w) / 2;
    g.fillStyle = css(COL[1][on]);
    if (t === T.WIRE) {
      const cw = Math.max(w, z * 0.36), co = (z - cw) / 2;
      g.fillRect(sx + co, sy + co, cw, cw);
      if (arms & 1) g.fillRect(sx + o, sy, w, o + 0.5);
      if (arms & 2) g.fillRect(sx + o + w - 0.5, sy + o, z - o - w + 0.5, w);
      if (arms & 4) g.fillRect(sx + o, sy + o + w - 0.5, w, z - o - w + 0.5);
      if (arms & 8) g.fillRect(sx, sy + o, o + 0.5, w);
    } else {
      g.fillRect(sx, sy + o, z, w);
      g.fillStyle = BG; g.fillRect(sx + o - w * 0.6, sy + o - w * 0.6, w * 2.2, w * 2.2);
      g.fillStyle = css(COL[1][onV ? 1 : 0]); g.fillRect(sx + o, sy, w, z);
    }
    return;
  }
  const p = Math.max(1, z * 0.07), bs = z - p * 2;
  if (t === T.LED) {
    const c = LED_COLORS[set & 7];
    g.fillStyle = '#121a22'; g.fillRect(sx + p, sy + p, bs, bs);
    if (on && z >= 8) { g.fillStyle = css(c, 0.25); g.fillRect(sx - z * 0.15, sy - z * 0.15, z * 1.3, z * 1.3); }
    g.fillStyle = css(on ? c : [c[0] * 0.2, c[1] * 0.2, c[2] * 0.2]);
    g.beginPath(); g.arc(sx + z / 2, sy + z / 2, z * 0.34, 0, 6.2832); g.fill();
    if (on && z >= 10) { g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.arc(sx + z * 0.42, sy + z * 0.42, z * 0.1, 0, 6.2832); g.fill(); }
    return;
  }
  g.fillStyle = css(colorOf(t, set, on && t !== T.HEX));
  g.fillRect(sx + p, sy + p, bs, bs);
  const cx = sx + z / 2, cy = sy + z / 2;
  if (t === T.SWITCH) {
    g.fillStyle = '#0c1218'; g.fillRect(cx - z * 0.12, sy + z * 0.2, z * 0.24, z * 0.6);
    g.fillStyle = '#e8eef4'; g.fillRect(cx - z * 0.17, on ? sy + z * 0.2 : sy + z * 0.52, z * 0.34, z * 0.28);
    return;
  }
  if (t === T.BUTTON) {
    g.fillStyle = on ? '#ffd9a0' : '#d06a2a';
    g.beginPath(); g.arc(cx, cy, z * (on ? 0.22 : 0.28), 0, 6.2832); g.fill();
    return;
  }
  if (t === T.HEX) {
    if (z >= 8) {
      g.fillStyle = st ? '#ff5032' : '#4a2420';
      g.font = `bold ${z * 0.72 | 0}px Consolas, monospace`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('0123456789ABCDEF'[st & 15], cx, cy + z * 0.04);
    }
    return;
  }
  if (t === T.CLOCK) {
    if (z >= 12) {
      g.strokeStyle = on ? '#fff' : '#b48ae6'; g.lineWidth = Math.max(1, z * 0.06);
      g.beginPath();
      const a = z * 0.28, b = z * 0.14;
      g.moveTo(cx - a, cy + b); g.lineTo(cx - a / 2, cy + b); g.lineTo(cx - a / 2, cy - b); g.lineTo(cx, cy - b);
      g.lineTo(cx, cy + b); g.lineTo(cx + a / 2, cy + b); g.lineTo(cx + a / 2, cy - b); g.lineTo(cx + a, cy - b);
      g.stroke();
    }
    return;
  }
  // gates, flip-flops, always-on, buzzer
  if (t >= 7 && t <= 16 && z >= 6) {   // arrow on the output side
    g.fillStyle = on ? '#ffd060' : '#7d93ab';
    const f = z * 0.16;
    g.beginPath();
    if (d === 0) { g.moveTo(cx, sy + p); g.lineTo(cx - f, sy + p + f); g.lineTo(cx + f, sy + p + f); }
    if (d === 1) { g.moveTo(sx + z - p, cy); g.lineTo(sx + z - p - f, cy - f); g.lineTo(sx + z - p - f, cy + f); }
    if (d === 2) { g.moveTo(cx, sy + z - p); g.lineTo(cx - f, sy + z - p - f); g.lineTo(cx + f, sy + z - p - f); }
    if (d === 3) { g.moveTo(sx + p, cy); g.lineTo(sx + p + f, cy - f); g.lineTo(sx + p + f, cy + f); }
    g.fill();
  }
  const lab = LABEL[t];
  if (lab && z >= 14) {
    g.fillStyle = on ? '#ffffff' : '#a9bdd2';
    const fs = lab.length > 3 ? z * 0.24 : lab.length > 2 ? z * 0.28 : z * 0.4;
    g.font = `bold ${fs | 0}px Consolas, monospace`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(lab, cx, cy + z * 0.02);
  }
}

// ---------------------------------------------------------------- world + state
const world = new World();
const sim = new Sim(world);
const cam = { x: 9, y: 5, z: 36 };
const tool = { t: T.WIRE, d: 1 };
const toolSet = { 5: 4, 17: 0, 19: 0 };
const SPEEDS = [1, 2, 5, 10, 20, 40, 60, 120, 250, 500, 1000, 2500, 5000, 10000, Infinity];
let speedI = 4, running = true, showGrid = true;
let sel = null, clip = null, pasting = false;
const mouse = { x: 0, y: 0, cx: 0, cy: 0, inside: false };
let stroke = null;
const keys = {};

function cellAtScreen(sx, sy) {
  return [Math.floor(cam.x + (sx - W / 2) / cam.z), Math.floor(cam.y + (sy - H / 2) / cam.z)];
}

// ---------------------------------------------------------------- undo
const undoStack = [], redoStack = [];
let group = null;
function beginGroup() { group = []; }
function endGroup() {
  if (group && group.length) { undoStack.push(group); if (undoStack.length > 300) undoStack.shift(); redoStack.length = 0; markSave(); }
  group = null;
}
function doSet(x, y, t, data, st) {
  const old = world.set(x, y, t, data, st);
  if (old && group) group.push(x, y, old[0], old[1], old[2], t, t ? data : 0, t ? st : 0);
  return old;
}
function undo() {
  const g = undoStack.pop(); if (!g) return;
  for (let i = g.length - 8; i >= 0; i -= 8) world.set(g[i], g[i + 1], g[i + 2], g[i + 3], g[i + 4]);
  redoStack.push(g); markSave(); toast('Undo');
}
function redo() {
  const g = redoStack.pop(); if (!g) return;
  for (let i = 0; i < g.length; i += 8) world.set(g[i], g[i + 1], g[i + 5], g[i + 6], g[i + 7]);
  undoStack.push(g); markSave(); toast('Redo');
}

// ---------------------------------------------------------------- editing
const toolData = () => tool.d | ((toolSet[tool.t] || 0) << 2);
function placeAt(x, y, firstClick) {
  const t = world.type(x, y);
  if (!t) { doSet(x, y, tool.t, toolData(), 0); return; }
  if (!firstClick) return;          // dragging never destroys things
  if (t === tool.t) {               // clicking the same kind of block rotates it
    const d = world.data(x, y);
    doSet(x, y, t, (d & ~3) | (((d & 3) + 1) & 3), world.st(x, y));
  } else doSet(x, y, tool.t, toolData(), 0);
}
function eraseAt(x, y) { doSet(x, y, 0, 0, 0); }
function lineCells(x0, y0, x1, y1, fn) {   // every cell between two points, no gaps
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (let n = 0; n < 100000; n++) {
    fn(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
}
function straightEnd(s) {   // shift-line snaps to horizontal or vertical
  return Math.abs(s.bx - s.ax) >= Math.abs(s.by - s.ay) ? [s.bx, s.ay] : [s.ax, s.by];
}

// visit every non-empty cell inside a rectangle (skips empty chunks entirely)
function forCells(x0, y0, x1, y1, fn) {
  for (let cy = y0 >> CSH; cy <= y1 >> CSH; cy++) for (let cx = x0 >> CSH; cx <= x1 >> CSH; cx++) {
    const c = world.ch(cx, cy); if (!c) continue;
    const lx0 = Math.max(0, x0 - cx * CS), lx1 = Math.min(CM, x1 - cx * CS);
    const ly0 = Math.max(0, y0 - cy * CS), ly1 = Math.min(CM, y1 - cy * CS);
    for (let ly = ly0; ly <= ly1; ly++) for (let lx = lx0; lx <= lx1; lx++) {
      const i = (ly << CSH) | lx;
      if (c.type[i]) fn(cx * CS + lx, cy * CS + ly, c.type[i], c.data[i], c.st[i]);
    }
  }
}
function selRect() {
  return [Math.min(sel.x0, sel.x1), Math.min(sel.y0, sel.y1), Math.max(sel.x0, sel.x1), Math.max(sel.y0, sel.y1)];
}
function copySel() {
  if (!sel) return false;
  const [x0, y0, x1, y1] = selRect(), cells = [];
  forCells(x0, y0, x1, y1, (x, y, t, d, s) => cells.push(x - x0, y - y0, t, d, s));
  clip = { w: x1 - x0 + 1, h: y1 - y0 + 1, cells };
  toast('Copied ' + cells.length / 5 + ' blocks');
  return true;
}
function deleteSel() {
  if (!sel) return;
  const [x0, y0, x1, y1] = selRect(), list = [];
  forCells(x0, y0, x1, y1, (x, y) => list.push(x, y));
  beginGroup();
  for (let i = 0; i < list.length; i += 2) eraseAt(list[i], list[i + 1]);
  endGroup();
}
function rotateClip() {
  const c = clip.cells;
  for (let i = 0; i < c.length; i += 5) {
    const dx = c[i], dy = c[i + 1];
    c[i] = clip.h - 1 - dy; c[i + 1] = dx;
    c[i + 3] = (c[i + 3] & ~3) | (((c[i + 3] & 3) + 1) & 3);
  }
  const w = clip.w; clip.w = clip.h; clip.h = w;
}
function pasteAt(x, y) {
  beginGroup();
  const c = clip.cells;
  for (let i = 0; i < c.length; i += 5) doSet(x + c[i], y + c[i + 1], c[i + 2], c[i + 3], c[i + 4]);
  endGroup();
}
function configure(dir) {   // F: change clock speed / LED color / buzzer note
  const x = mouse.cx, y = mouse.cy, t = world.type(x, y);
  if (SETTINGS[t]) {
    const d = world.data(x, y), n = SETTINGS[t], set = ((d >> 2) + dir + n) % n;
    beginGroup(); doSet(x, y, t, (d & 3) | (set << 2), world.st(x, y)); endGroup();
    toolSet[t] = set; drawIcons();
    toast(NAMES[t] + ': ' + settingText(t, set));
  } else if (SETTINGS[tool.t]) {
    const n = SETTINGS[tool.t];
    toolSet[tool.t] = ((toolSet[tool.t] || 0) + dir + n) % n; drawIcons();
    toast(NAMES[tool.t] + ': ' + settingText(tool.t, toolSet[tool.t]));
  }
}

// ---------------------------------------------------------------- sound (buzzers)
let AC = null, master = null, muted = false;
const voices = [], buzzCount = new Int32Array(24);
function ensureAudio() {
  if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain(); master.gain.value = 0.12; master.connect(AC.destination);
    for (let n = 0; n < 24; n++) {
      const o = AC.createOscillator(), g = AC.createGain();
      o.type = 'square'; o.frequency.value = 261.63 * Math.pow(2, n / 12);
      g.gain.value = 0; o.connect(g); g.connect(master); o.start();
      voices.push(g);
    }
    for (let n = 0; n < 24; n++) setVoice(n);
  } catch (e) { AC = null; }
}
function setVoice(n) {
  if (!AC) return;
  voices[n].gain.setTargetAtTime(buzzCount[n] > 0 && !muted ? 0.5 : 0, AC.currentTime, 0.005);
}
sim.onBuzz = (n, d) => { buzzCount[n] += d; setVoice(n); };
sim.onBuzzReset = (b) => { for (let n = 0; n < 24; n++) { buzzCount[n] = b[n]; setVoice(n); } };

// ---------------------------------------------------------------- rendering
function paintChunk(c) {
  if (!c.canvas) {
    c.canvas = document.createElement('canvas'); c.canvas.width = c.canvas.height = CS;
    c.g = c.canvas.getContext('2d'); c.img = c.g.createImageData(CS, CS); c.px = new Uint32Array(c.img.data.buffer);
  }
  const px = c.px, ty = c.type, da = c.data, st = c.st, net = c.net, nOn = sim.netOn, nn = sim.nNets;
  for (let i = 0; i < CN; i++) {
    const t = ty[i];
    if (!t) { px[i] = 0; continue; }
    let on;
    if (t === 1) { const n = net[i]; on = n >= 0 && n < nn && nOn[n] > 0 ? 1 : 0; }
    else if (t === 2) { const a = net[i], b = c.netV[i]; on = (a >= 0 && a < nn && nOn[a] > 0) || (b >= 0 && b < nn && nOn[b] > 0) ? 1 : 0; }
    else on = t === T.HEX ? (st[i] ? 1 : 0) : st[i] & 1;
    px[i] = PX[(t << 4) | (t === T.LED ? ((da[i] >> 2) & 7) << 1 : 0) | on];
  }
  c.g.putImageData(c.img, 0, 0);
  c.dirty = false;
}

const DETAIL = 10;   // pixels per cell where we switch from "map view" to drawn blocks
function wireOn(c, i) { const n = c.net[i]; return n >= 0 && n < sim.nNets && sim.netOn[n] > 0 ? 1 : 0; }
function portAt(x, y, s) {   // does the cell at x,y have a connection on side s?
  const c = world.ch(x >> CSH, y >> CSH); if (!c) return 0;
  const i = ((y & CM) << CSH) | (x & CM), t = c.type[i];
  return t ? hasPort(t, c.data[i] & 3, s) : 0;
}

function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
  const z = cam.z, ox = W / 2 - cam.x * z, oy = H / 2 - cam.y * z;
  const x0 = Math.floor(cam.x - W / 2 / z), x1 = Math.floor(cam.x + W / 2 / z);
  const y0 = Math.floor(cam.y - H / 2 / z), y1 = Math.floor(cam.y + H / 2 / z);

  // grid
  if (showGrid && z >= 5) {
    ctx.fillStyle = 'rgba(120,160,200,0.06)';
    for (let x = x0; x <= x1 + 1; x++) ctx.fillRect(Math.round(ox + x * z), 0, 1, H);
    for (let y = y0; y <= y1 + 1; y++) ctx.fillRect(0, Math.round(oy + y * z), W, 1);
  }
  if (showGrid && z * CS >= 40) {
    ctx.fillStyle = 'rgba(120,160,200,0.10)';
    for (let x = Math.floor(x0 / CS) * CS; x <= x1 + 1; x += CS) ctx.fillRect(Math.round(ox + x * z), 0, 1, H);
    for (let y = Math.floor(y0 / CS) * CS; y <= y1 + 1; y += CS) ctx.fillRect(0, Math.round(oy + y * z), W, 1);
  }
  // origin marker
  ctx.strokeStyle = 'rgba(255,192,64,0.25)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(ox - 8, oy); ctx.lineTo(ox + 8, oy); ctx.moveTo(ox, oy - 8); ctx.lineTo(ox, oy + 8); ctx.stroke();

  const cx0 = x0 >> CSH, cx1 = x1 >> CSH, cy0 = y0 >> CSH, cy1 = y1 >> CSH;
  const visChunks = [];
  if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) < world.chunks.size) {
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) { const c = world.ch(cx, cy); if (c) visChunks.push(c); }
  } else {
    for (const c of world.chunks.values()) if (c.cx >= cx0 && c.cx <= cx1 && c.cy >= cy0 && c.cy <= cy1) visChunks.push(c);
  }

  if (z < DETAIL) {
    // MAP VIEW: every chunk is a tiny 64x64 picture, one pixel per block, stretched up
    ctx.imageSmoothingEnabled = false;
    for (const c of visChunks) {
      if (c.dirty || !c.canvas) paintChunk(c);
      const sx = Math.round(ox + c.cx * CS * z), sy = Math.round(oy + c.cy * CS * z);
      const ex = Math.round(ox + (c.cx + 1) * CS * z), ey = Math.round(oy + (c.cy + 1) * CS * z);
      ctx.drawImage(c.canvas, sx, sy, Math.max(1, ex - sx), Math.max(1, ey - sy));
    }
  } else {
    // BLOCK VIEW: draw every visible block properly
    for (const c of visChunks) {
      const bx = c.cx * CS, by = c.cy * CS;
      const lx0 = Math.max(0, x0 - bx), lx1 = Math.min(CM, x1 - bx), ly0 = Math.max(0, y0 - by), ly1 = Math.min(CM, y1 - by);
      for (let ly = ly0; ly <= ly1; ly++) for (let lx = lx0; lx <= lx1; lx++) {
        const i = (ly << CSH) | lx, t = c.type[i];
        if (!t) continue;
        const x = bx + lx, y = by + ly, sx = ox + x * z, sy = oy + y * z;
        if (t === 1) {
          let arms = 0;
          for (let s = 0; s < 4; s++) if (portAt(x + DX[s], y + DY[s], (s + 2) & 3)) arms |= 1 << s;
          drawBlock(ctx, 1, 0, 0, wireOn(c, i), arms, sx, sy, z);
        } else if (t === 2) {
          const b = c.netV ? c.netV[i] : -1;
          drawBlock(ctx, 2, 0, 0, wireOn(c, i), 0, sx, sy, z, sim.netIsOn(b));
        } else drawBlock(ctx, t, c.data[i] & 3, c.data[i] >> 2, c.st[i], 0, sx, sy, z);
      }
    }
  }

  // ghosts + selection
  const hx = mouse.cx, hy = mouse.cy;
  if (pasting && clip && mouse.inside) {
    ctx.globalAlpha = 0.55;
    const c = clip.cells, n = Math.min(c.length, 5 * 40000);
    for (let i = 0; i < n; i += 5) {
      const sx = ox + (hx + c[i]) * z, sy = oy + (hy + c[i + 1]) * z;
      if (sx < -z || sy < -z || sx > W || sy > H) continue;
      if (z >= DETAIL) drawBlock(ctx, c[i + 2], c[i + 3] & 3, c[i + 3] >> 2, 0, c[i + 2] === 1 ? 15 : 0, sx, sy, z);
      else { ctx.fillStyle = css(colorOf(c[i + 2], c[i + 3] >> 2, 0)); ctx.fillRect(sx, sy, Math.max(1, z), Math.max(1, z)); }
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#8fc4ff'; ctx.setLineDash([5, 4]);
    ctx.strokeRect(ox + hx * z + 0.5, oy + hy * z + 0.5, clip.w * z, clip.h * z); ctx.setLineDash([]);
  } else if (stroke && stroke.kind === 'line') {
    const [ex, ey] = straightEnd(stroke);
    ctx.globalAlpha = 0.5; ctx.fillStyle = '#ffc040';
    ctx.fillRect(ox + Math.min(stroke.ax, ex) * z, oy + Math.min(stroke.ay, ey) * z, (Math.abs(ex - stroke.ax) + 1) * z, (Math.abs(ey - stroke.ay) + 1) * z);
    ctx.globalAlpha = 1;
  } else if (mouse.inside && !stroke) {
    const sx = ox + hx * z, sy = oy + hy * z, t = world.type(hx, hy);
    if (!t && z >= DETAIL) {
      ctx.globalAlpha = 0.4;
      drawBlock(ctx, tool.t, tool.d, toolSet[tool.t] || 0, 0, tool.t === 1 ? 10 : 0, sx, sy, z);
      ctx.globalAlpha = 1;
    }
    if (z >= 3) { ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1; ctx.strokeRect(sx + 0.5, sy + 0.5, z - 1, z - 1); }
  }
  if (sel) {
    const [a, b, c, d] = selRect();
    ctx.fillStyle = 'rgba(100,170,255,0.10)'; ctx.strokeStyle = '#6aaaff'; ctx.lineWidth = 1;
    ctx.fillRect(ox + a * z, oy + b * z, (c - a + 1) * z, (d - b + 1) * z);
    ctx.strokeRect(ox + a * z + 0.5, oy + b * z + 0.5, (c - a + 1) * z, (d - b + 1) * z);
  }
}

// ---------------------------------------------------------------- palette bar
const GROUPS = [
  ['WIRING', [T.WIRE, T.CROSS]],
  ['INPUT', [T.SWITCH, T.BUTTON, T.CLOCK, T.CONST]],
  ['LOGIC', [T.NOT, T.AND, T.OR, T.XOR, T.NAND, T.NOR, T.XNOR, T.DIODE]],
  ['MEMORY', [T.TFF, T.DFF]],
  ['OUTPUT', [T.LED, T.HEX, T.BUZZER]],
];
const HOTKEYS = [T.WIRE, T.CROSS, T.SWITCH, T.BUTTON, T.CLOCK, T.NOT, T.AND, T.OR, T.XOR, T.LED];   // keys 1..9, 0
const slots = {};
for (const [name, types] of GROUPS) {
  const g = document.createElement('div'); g.className = 'grp';
  g.innerHTML = `<div class="lbl">${name}</div><div class="row"></div>`;
  for (const t of types) {
    const s = document.createElement('div'); s.className = 'slot'; s.title = NAMES[t] + ' — ' + DESC[t];
    const c = document.createElement('canvas'); c.width = c.height = 68; s.appendChild(c);
    const hk = HOTKEYS.indexOf(t);
    if (hk >= 0) { const k = document.createElement('span'); k.className = 'key'; k.textContent = (hk + 1) % 10; s.appendChild(k); }
    s.onclick = () => selectTool(t);
    g.querySelector('.row').appendChild(s);
    slots[t] = { el: s, g: c.getContext('2d') };
  }
  $('bar').appendChild(g);
}
function drawIcons() {
  for (const t in slots) {
    const g = slots[t].g, tt = +t;
    g.clearRect(0, 0, 68, 68);
    const st = tt === T.LED || tt === T.SWITCH || tt === T.CLOCK || tt === T.BUZZER ? 1 : tt === T.HEX ? 10 : 0;
    drawBlock(g, tt, tt === tool.t ? tool.d : 1, toolSet[tt] || 0, st, 10, 0, 0, 68, 0);
  }
}
function selectTool(t) {
  tool.t = t;
  for (const k in slots) slots[k].el.classList.toggle('sel', +k === t);
  pasting = false; drawIcons();
}
selectTool(T.WIRE);

// ---------------------------------------------------------------- mouse
cv.addEventListener('contextmenu', (e) => e.preventDefault());
cv.addEventListener('mousedown', (e) => {
  ensureAudio(); hideHelp();
  const [x, y] = cellAtScreen(e.offsetX, e.offsetY);
  mouse.cx = x; mouse.cy = y;
  if (e.button === 1) { e.preventDefault(); stroke = { kind: 'pan', sx: e.clientX, sy: e.clientY }; return; }
  if (pasting && clip) {
    if (e.button === 0) pasteAt(x, y); else { pasting = false; }
    return;
  }
  if (e.button === 0) {
    if (e.ctrlKey || e.metaKey) { sel = { x0: x, y0: y, x1: x, y1: y }; stroke = { kind: 'select' }; return; }
    const t = world.type(x, y);
    if (t === T.SWITCH) { sim.toggle(x, y); markSave(); return; }
    if (t === T.BUTTON) { sim.press(x, y, 1); stroke = { kind: 'button', x, y }; return; }
    sel = null;
    beginGroup();
    if (e.shiftKey) { stroke = { kind: 'line', ax: x, ay: y, bx: x, by: y, erase: false }; return; }
    placeAt(x, y, true);
    stroke = { kind: 'place', lx: x, ly: y };
  } else if (e.button === 2) {
    sel = null;
    beginGroup();
    if (e.shiftKey) { stroke = { kind: 'line', ax: x, ay: y, bx: x, by: y, erase: true }; return; }
    eraseAt(x, y);
    stroke = { kind: 'erase', lx: x, ly: y };
  }
});
addEventListener('mousemove', (e) => {
  const r = cv.getBoundingClientRect();
  mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
  mouse.inside = e.target === cv;
  const [x, y] = cellAtScreen(mouse.x, mouse.y);
  mouse.cx = x; mouse.cy = y;
  if (!stroke) return;
  if (stroke.kind === 'pan') {
    cam.x -= (e.clientX - stroke.sx) / cam.z; cam.y -= (e.clientY - stroke.sy) / cam.z;
    stroke.sx = e.clientX; stroke.sy = e.clientY;
  } else if (stroke.kind === 'place' || stroke.kind === 'erase') {
    if (x !== stroke.lx || y !== stroke.ly) {
      lineCells(stroke.lx, stroke.ly, x, y, stroke.kind === 'place' ? (a, b) => placeAt(a, b, false) : eraseAt);
      stroke.lx = x; stroke.ly = y;
    }
  } else if (stroke.kind === 'line') { stroke.bx = x; stroke.by = y; }
  else if (stroke.kind === 'select') { sel.x1 = x; sel.y1 = y; }
});
addEventListener('mouseup', (e) => {
  if (!stroke) return;
  if (stroke.kind === 'button') sim.press(stroke.x, stroke.y, 0);
  if (stroke.kind === 'line') {
    const [ex, ey] = straightEnd(stroke);
    lineCells(stroke.ax, stroke.ay, ex, ey, stroke.erase ? eraseAt : (a, b) => placeAt(a, b, false));
  }
  endGroup();
  stroke = null;
});
cv.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
  const wx = cam.x + (mx - W / 2) / cam.z, wy = cam.y + (my - H / 2) / cam.z;
  cam.z = Math.min(96, Math.max(0.02, cam.z * Math.pow(1.0015, -e.deltaY)));
  cam.x = wx - (mx - W / 2) / cam.z; cam.y = wy - (my - H / 2) / cam.z;   // keep the point under the mouse still
}, { passive: false });
cv.addEventListener('mouseleave', () => { mouse.inside = false; });

// ---------------------------------------------------------------- keyboard
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
  keys[k] = true;
  if (k === 'f1' || (k === '?' )) { e.preventDefault(); toggleHelp(); return; }
  if (ctrl) {
    if (k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (k === 'y') { e.preventDefault(); redo(); }
    else if (k === 'c') { e.preventDefault(); copySel(); }
    else if (k === 'x') { e.preventDefault(); if (copySel()) { deleteSel(); sel = null; } }
    else if (k === 'v') { e.preventDefault(); if (clip) { pasting = true; sel = null; } else toast('Nothing copied yet — Ctrl+drag to select'); }
    else if (k === 's') { e.preventDefault(); save(); toast('Saved'); }
    return;
  }
  if (k === ' ') { e.preventDefault(); setRunning(!running); }
  else if (k === '.') { setRunning(false); sim.step(); }
  else if (k === '[' || k === '-') setSpeed(speedI - 1);
  else if (k === ']' || k === '=' || k === '+') setSpeed(speedI + 1);
  else if (k === 'r') {
    if (pasting && clip) { rotateClip(); if (e.shiftKey) { rotateClip(); rotateClip(); } }
    else { tool.d = (tool.d + (e.shiftKey ? 3 : 1)) & 3; drawIcons(); }
  }
  else if (k === 'f') configure(e.shiftKey ? -1 : 1);
  else if (k === 'q') {
    const t = world.type(mouse.cx, mouse.cy);
    if (t) { const d = world.data(mouse.cx, mouse.cy); tool.d = d & 3; if (SETTINGS[t]) toolSet[t] = d >> 2; selectTool(t); }
  }
  else if (k === 'delete' || k === 'backspace') { if (sel) { deleteSel(); sel = null; } }
  else if (k === 'escape') { sel = null; pasting = false; hideHelp(); }
  else if (k === 'h') { cam.x = 0; cam.y = 0; }
  else if (k === 'g') showGrid = !showGrid;
  else if (k === 'm') { muted = !muted; for (let n = 0; n < 24; n++) setVoice(n); toast(muted ? 'Buzzers muted' : 'Buzzers on'); }
  else if (/^[0-9]$/.test(k)) selectTool(HOTKEYS[(+k + 9) % 10]);
});
addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

// ---------------------------------------------------------------- top bar
function setRunning(v) { running = v; $('bRun').textContent = v ? '❚❚ PAUSE' : '▶ RUN'; $('bRun').classList.toggle('on', !v); }
function setSpeed(i) {
  speedI = Math.max(0, Math.min(SPEEDS.length - 1, i));
  $('speed').textContent = SPEEDS[speedI] === Infinity ? 'MAX' : SPEEDS[speedI] + ' t/s';
}
$('bRun').onclick = () => setRunning(!running);
$('bStep').onclick = () => { setRunning(false); sim.step(); };
$('bSlow').onclick = () => setSpeed(speedI - 1);
$('bFast').onclick = () => setSpeed(speedI + 1);
$('bHelp').onclick = toggleHelp;
$('help').onclick = hideHelp;
function toggleHelp() { $('help').classList.toggle('show'); }
function hideHelp() { $('help').classList.remove('show'); }
let toastT = 0;
function toast(msg) { const el = $('toast'); el.textContent = msg; el.style.opacity = 1; toastT = 1.6; }

// ---------------------------------------------------------------- saving
const SAVE_KEY = 'bitworks-save-v1';
let saveDue = 0;
function markSave() { if (!saveDue) saveDue = 2; }
function saveText() {
  return JSON.stringify({ v: 1, cam, tool, toolSet, speedI, tick: sim.tick, chunks: BW.encodeWorld(world) });
}
function loadText(txt) {
  const s = JSON.parse(txt);
  BW.decodeWorld(world, s.chunks || []);
  if (s.cam) Object.assign(cam, s.cam);
  if (s.toolSet) Object.assign(toolSet, s.toolSet);
  if (s.tool) { tool.d = s.tool.d & 3; selectTool(s.tool.t || 1); }
  if (s.speedI !== undefined) setSpeed(s.speedI);
  undoStack.length = 0; redoStack.length = 0;
}
function save() {
  try { localStorage.setItem(SAVE_KEY, saveText()); }
  catch (e) { toast('Could not autosave (world too big?) — use EXPORT'); }
  saveDue = 0;
}
addEventListener('beforeunload', save);
$('bExport').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([saveText()], { type: 'application/json' }));
  a.download = 'world.bitworks'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('bImport').onclick = () => $('file').click();
$('file').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try { loadText(await f.text()); save(); toast('Loaded ' + f.name); } catch (err) { toast('That file did not work'); }
  e.target.value = '';
};

let loaded = false;
try { const s = localStorage.getItem(SAVE_KEY); if (s) { loadText(s); loaded = true; } } catch (e) { }
if (!loaded) { BW.buildDemo(world); $('help').classList.add('show'); }
setSpeed(speedI); setRunning(true); drawIcons();

// ---------------------------------------------------------------- main loop
let last = performance.now(), tickBank = 0, tpsCount = 0, tpsShown = 0, tpsTimer = 0, saveTimer = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;

  // moving the camera with keys
  const sp = (keys.shift ? 2400 : 700) / cam.z * dt;
  if (keys.w || keys.arrowup) cam.y -= sp;
  if (keys.s || keys.arrowdown) cam.y += sp;
  if (keys.a || keys.arrowleft) cam.x -= sp;
  if (keys.d || keys.arrowright) cam.x += sp;
  const LIM = BW.LIM; cam.x = Math.max(-LIM, Math.min(LIM, cam.x)); cam.y = Math.max(-LIM, Math.min(LIM, cam.y));

  // rebuild the circuit graph after edits (but not every frame while you're dragging)
  if (sim.ver !== world.ver && (!stroke || now - (sim.lastCompile || 0) > 250)) { sim.compile(); sim.lastCompile = now; }

  // run ticks, but never use more than ~12 ms per frame so the game stays smooth
  if (running && sim.ver === world.ver) {
    const tps = SPEEDS[speedI], t0 = performance.now();
    if (tps === Infinity) {
      while (performance.now() - t0 < 12) for (let i = 0; i < 50; i++) { sim.step(); tpsCount++; }
    } else {
      tickBank = Math.min(tickBank + tps * dt, tps * 0.25 + 1);
      let n = 0;
      while (tickBank >= 1) {
        sim.step(); tickBank--; tpsCount++;
        if ((++n & 31) === 0 && performance.now() - t0 > 12) { tickBank = 0; break; }
      }
    }
  }
  tpsTimer += dt;
  if (tpsTimer >= 1) { tpsShown = Math.round(tpsCount / tpsTimer); tpsCount = 0; tpsTimer = 0; }

  render();

  // HUD
  $('status').textContent = `${running ? 'RUNNING' : 'PAUSED'} · ${tpsShown} t/s · tick ${sim.tick} · ${sim.nComp} parts · ${sim.nNets} wires`;
  $('coords').textContent = `X ${mouse.cx}  Y ${mouse.cy}  ·  zoom ${cam.z >= 1 ? cam.z.toFixed(1) : (1 / cam.z).toFixed(1) + ':1'}`;
  const ht = world.type(mouse.cx, mouse.cy);
  const show = mouse.inside && ht ? ht : tool.t;
  const hset = mouse.inside && ht ? world.data(mouse.cx, mouse.cy) >> 2 : (toolSet[tool.t] || 0);
  const extra = settingText(show, hset);
  $('info').innerHTML = (mouse.inside && ht ? '' : '<span class="dim">placing:</span> ') + `<b>${NAMES[show]}</b>` +
    (extra ? ` <span class="dim">· ${extra}</span>` : '') + `<br>${DESC[show]}` +
    (pasting ? '<br><span class="dim">PASTING — click to place, R rotates, Esc cancels</span>' : '');

  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').style.opacity = 0; }
  if (saveDue) { saveDue -= dt; if (saveDue <= 0) save(); }
  saveTimer += dt;
  if (saveTimer > 30) { saveTimer = 0; save(); }   // also keeps switch/memory states
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
