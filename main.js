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
const BG = '#0b0e13';
const LED_COLORS = [[255, 70, 60], [70, 230, 110], [70, 150, 255], [255, 215, 60], [240, 245, 255], [255, 145, 40], [190, 100, 255], [50, 225, 225]];
const LED_NAMES = ['red', 'green', 'blue', 'yellow', 'white', 'orange', 'purple', 'cyan'];
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const WIRE_OFF = [58, 64, 78], WIRE_ON = [255, 200, 70];
const COL = {   // [off, on] body color of each block type
  1: [WIRE_OFF, WIRE_ON], 2: [WIRE_OFF, WIRE_ON],
  3: [[44, 52, 64], [46, 160, 90]], 4: [[44, 52, 64], [220, 120, 40]],
  5: [[48, 42, 76], [130, 90, 220]], 6: [[46, 160, 90], [46, 160, 90]],
  15: [[26, 46, 50], [24, 120, 112]], 16: [[26, 46, 50], [24, 120, 112]],
  18: [[18, 15, 16], [18, 15, 16]], 19: [[48, 46, 34], [190, 165, 50]],
};
for (let t = 7; t <= 14; t++) COL[t] = [[30, 37, 50], [38, 82, 150]];
// LED setting: bits 0-2 = color, bits 3-5 = brightness step (0 = 100%, 4 = 20%)
const LED_BRIGHT = 5;
const ledBright = (set) => 1 - Math.min(LED_BRIGHT - 1, set >> 3) * 0.2;
function colorOf(t, set, on) {
  if (t === T.LED) {
    const c = LED_COLORS[set & 7], b = on ? ledBright(set) : 0.2;
    return [c[0] * b, c[1] * b, c[2] * b];
  }
  return COL[t][on ? 1 : 0];
}
const css = (c, a) => a === undefined ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const pack = (c) => ((255 << 24) | ((c[2] | 0) << 16) | ((c[1] | 0) << 8) | (c[0] | 0)) >>> 0;
// pixel colors for the zoomed-out map view, packed once
const PX = {};
for (let t = 1; t <= 19; t++) for (let on = 0; on < 2; on++) PX[(t << 4) | on] = pack(colorOf(t, 0, on));
const PXLED = [];   // LEDs get their own table: 8 colors x 5 brightness
for (let set = 0; set < 8 * LED_BRIGHT; set++) for (let on = 0; on < 2; on++) PXLED[(set << 1) | on] = pack(colorOf(T.LED, set, on));
PX[(T.HEX << 4) | 1] = pack([255, 80, 50]);

const LABEL = { 6: '1', 7: 'NOT', 8: 'AND', 9: 'OR', 10: 'XOR', 11: 'NAND', 12: 'NOR', 13: 'XNOR', 14: 'DIO', 15: 'T', 16: 'D', 19: '♪' };
const DESC = {
  1: 'carries a signal. Touching wires join up.',
  2: 'two wires cross here without touching.',
  3: 'click it to flip on and off.',
  4: 'on only while you hold it down.',
  5: 'blinks by itself.',
  6: 'always on.',
  7: 'on when its input is off.',
  8: 'on when all inputs are on.',
  9: 'on when any input is on.',
  10: 'on when an odd number of inputs are on.',
  11: 'opposite of AND.', 12: 'opposite of OR.', 13: 'opposite of XOR.',
  14: 'lets the signal through one way only.',
  15: 'flips every time its input turns on. Chain them to count.',
  16: 'memory: saves the side input when the back turns on.',
  17: 'lights up when powered.',
  18: 'shows a digit 0–F. Top 1, right 2, bottom 4, left 8.',
  19: 'beeps while powered.',
};
function settingText(t, set) {
  if (t === T.CLOCK) { const p = PER[set % PER.length]; return 'every ' + p + ' tick' + (p > 1 ? 's' : ''); }
  if (t === T.LED) return LED_NAMES[set & 7] + (set >> 3 ? ', ' + Math.round(ledBright(set) * 100) + '%' : '');
  if (t === T.BUZZER) return NOTE_NAMES[set % 12] + (4 + ((set / 12) | 0));
  return '';
}

// ---------------------------------------------------------------- drawing one block (zoomed in + dock icons)
function rrect(g, x, y, w, h, r) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h);
}
function circle(g, x, y, r) { g.beginPath(); g.arc(x, y, r, 0, 6.2832); }
function wireLine(g, on, w, z, path) {
  g.lineCap = 'butt';
  if (on && z >= 8) { g.strokeStyle = 'rgba(255,200,70,0.18)'; g.lineWidth = w * 2.6; path(); g.stroke(); }
  g.strokeStyle = css(on ? WIRE_ON : WIRE_OFF); g.lineWidth = w; path(); g.stroke();
}
// arms = which sides a wire connects to. onV = the up/down signal of a crossing.
function drawBlock(g, t, d, set, st, arms, sx, sy, z, onV) {
  const on = st & 1, cx = sx + z / 2, cy = sy + z / 2, w = Math.max(1.5, z * 0.2);
  if (t === T.WIRE) {
    wireLine(g, on, w, z, () => {
      g.beginPath();
      for (let s = 0; s < 4; s++) if ((arms >> s) & 1) { g.moveTo(cx, cy); g.lineTo(cx + DX[s] * z / 2, cy + DY[s] * z / 2); }
    });
    g.fillStyle = css(on ? WIRE_ON : WIRE_OFF);
    circle(g, cx, cy, arms ? w / 2 : w * 0.8); g.fill();
    return;
  }
  if (t === T.CROSS) {
    wireLine(g, on, w, z, () => { g.beginPath(); g.moveTo(sx, cy); g.lineTo(sx + z, cy); });
    g.fillStyle = BG; g.fillRect(cx - w * 1.4, cy - w * 1.4, w * 2.8, w * 2.8);
    wireLine(g, onV, w, z, () => { g.beginPath(); g.moveTo(cx, sy); g.lineTo(cx, sy + z); });
    return;
  }
  const p = z * 0.08, bs = z - p * 2, r = z * 0.2;
  if (t === T.LED) {
    const c = LED_COLORS[set & 7], br = ledBright(set);
    if (on && z >= 8) {
      const gr = g.createRadialGradient(cx, cy, z * 0.1, cx, cy, z * 0.85);
      gr.addColorStop(0, css(c, 0.45 * br * br)); gr.addColorStop(1, css(c, 0));
      g.fillStyle = gr; g.fillRect(sx - z * 0.35, sy - z * 0.35, z * 1.7, z * 1.7);
    }
    g.fillStyle = css(on ? colorOf(T.LED, set, 1) : [c[0] * 0.18 + 10, c[1] * 0.18 + 10, c[2] * 0.18 + 12]);
    circle(g, cx, cy, z * 0.36); g.fill();
    if (z >= 10) { g.fillStyle = on ? `rgba(255,255,255,${0.6 * br})` : 'rgba(255,255,255,0.08)'; circle(g, cx - z * 0.1, cy - z * 0.1, z * 0.09); g.fill(); }
    return;
  }
  // rounded body
  rrect(g, sx + p, sy + p, bs, bs, r);
  g.fillStyle = css(colorOf(t, set, on && t !== T.HEX)); g.fill();
  if (z >= 12) { g.strokeStyle = 'rgba(255,255,255,0.07)'; g.lineWidth = 1; g.stroke(); }

  if (t === T.SWITCH) {   // a little toggle: knob on the right = ON
    const tw = z * 0.5, th = z * 0.26;
    rrect(g, cx - tw / 2, cy - th / 2, tw, th, th / 2); g.fillStyle = 'rgba(0,0,0,0.35)'; g.fill();
    g.fillStyle = '#f2f5f9'; circle(g, cx + (on ? 1 : -1) * (tw / 2 - th / 2), cy, th * 0.4); g.fill();
    return;
  }
  if (t === T.BUTTON) {
    g.fillStyle = on ? '#ffe2b8' : '#e07a35';
    circle(g, cx, cy, z * (on ? 0.19 : 0.24)); g.fill();
    return;
  }
  if (t === T.HEX) {
    if (z >= 8) {
      g.fillStyle = st ? '#ff5a3c' : '#3a2220';
      g.font = `600 ${z * 0.66 | 0}px Consolas, monospace`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('0123456789ABCDEF'[st & 15], cx, cy + z * 0.04);
    }
    return;
  }
  if (t === T.CLOCK) {
    if (z >= 12) {
      g.strokeStyle = on ? '#fff' : '#a98ae0'; g.lineWidth = Math.max(1, z * 0.055); g.lineJoin = 'round';
      const a = z * 0.24, b = z * 0.12;
      g.beginPath();
      g.moveTo(cx - a, cy + b); g.lineTo(cx - a / 2, cy + b); g.lineTo(cx - a / 2, cy - b); g.lineTo(cx, cy - b);
      g.lineTo(cx, cy + b); g.lineTo(cx + a / 2, cy + b); g.lineTo(cx + a / 2, cy - b); g.lineTo(cx + a, cy - b);
      g.stroke();
    }
    return;
  }
  if (t >= 7 && t <= 16 && z >= 6) {   // arrow on the output side
    g.fillStyle = on ? css(WIRE_ON) : '#6b7a90';
    const f = z * 0.13, e = p * 0.5;
    g.beginPath();
    if (d === 0) { g.moveTo(cx, sy + e); g.lineTo(cx - f, sy + e + f); g.lineTo(cx + f, sy + e + f); }
    if (d === 1) { g.moveTo(sx + z - e, cy); g.lineTo(sx + z - e - f, cy - f); g.lineTo(sx + z - e - f, cy + f); }
    if (d === 2) { g.moveTo(cx, sy + z - e); g.lineTo(cx - f, sy + z - e - f); g.lineTo(cx + f, sy + z - e - f); }
    if (d === 3) { g.moveTo(sx + e, cy); g.lineTo(sx + e + f, cy - f); g.lineTo(sx + e + f, cy + f); }
    g.fill();
  }
  const lab = LABEL[t];
  if (lab && z >= 14) {
    g.fillStyle = on ? '#ffffff' : '#9fadc0';
    const fs = lab.length > 3 ? z * 0.22 : lab.length > 2 ? z * 0.26 : z * 0.38;
    g.font = `700 ${fs | 0}px system-ui, 'Segoe UI', sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
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
let sel = null, clip = null, pasting = false, dockHover = 0;
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
// F changes clock speed / LED color / buzzer note, B changes LED brightness
function nextSetting(t, set, dir, bright) {
  if (t === T.LED) {
    if (bright) return (set & 7) | ((((set >> 3) + dir + LED_BRIGHT) % LED_BRIGHT) << 3);
    return (set & ~7) | (((set & 7) + dir + 8) & 7);
  }
  const n = SETTINGS[t];
  return (set + dir + n) % n;
}
function configure(dir, bright) {
  const x = mouse.cx, y = mouse.cy, t = world.type(x, y);
  if (bright && t !== T.LED && tool.t !== T.LED) return;
  if (SETTINGS[t] && (!bright || t === T.LED)) {
    const d = world.data(x, y), set = nextSetting(t, d >> 2, dir, bright);
    beginGroup(); doSet(x, y, t, (d & 3) | (set << 2), world.st(x, y)); endGroup();
    toolSet[t] = set; drawIcons();
    toast(NAMES[t] + ': ' + settingText(t, set));
  } else if (SETTINGS[tool.t]) {
    toolSet[tool.t] = nextSetting(tool.t, toolSet[tool.t] || 0, dir, bright); drawIcons();
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
    px[i] = t === T.LED ? PXLED[(((da[i] >> 2) % (8 * LED_BRIGHT)) << 1) | on] : PX[(t << 4) | on];
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
function wireArms(x, y) {
  let arms = 0;
  for (let s = 0; s < 4; s++) if (portAt(x + DX[s], y + DY[s], (s + 2) & 3)) arms |= 1 << s;
  return arms;
}

function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
  const z = cam.z, ox = W / 2 - cam.x * z, oy = H / 2 - cam.y * z;
  const x0 = Math.floor(cam.x - W / 2 / z), x1 = Math.floor(cam.x + W / 2 / z);
  const y0 = Math.floor(cam.y - H / 2 / z), y1 = Math.floor(cam.y + H / 2 / z);

  // background: dots when close, faint chunk lines when far
  if (showGrid) {
    if (z >= 10) {
      ctx.fillStyle = 'rgba(160,180,210,0.13)';
      const ds = z >= 24 ? 2 : 1;
      for (let y = y0; y <= y1 + 1; y++) {
        const py = Math.round(oy + y * z) - (ds >> 1);
        for (let x = x0; x <= x1 + 1; x++) ctx.fillRect(Math.round(ox + x * z) - (ds >> 1), py, ds, ds);
      }
    } else if (z * CS >= 30) {
      ctx.fillStyle = 'rgba(160,180,210,0.05)';
      for (let x = Math.floor(x0 / CS) * CS; x <= x1 + 1; x += CS) ctx.fillRect(Math.round(ox + x * z), 0, 1, H);
      for (let y = Math.floor(y0 / CS) * CS; y <= y1 + 1; y += CS) ctx.fillRect(0, Math.round(oy + y * z), W, 1);
    }
  }

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
        if (t === 1) drawBlock(ctx, 1, 0, 0, wireOn(c, i), wireArms(x, y), sx, sy, z);
        else if (t === 2) drawBlock(ctx, 2, 0, 0, wireOn(c, i), 0, sx, sy, z, sim.netIsOn(c.netV ? c.netV[i] : -1));
        else drawBlock(ctx, t, c.data[i] & 3, c.data[i] >> 2, c.st[i], 0, sx, sy, z);
      }
    }
  }

  // ghosts + selection
  const hx = mouse.cx, hy = mouse.cy;
  if (pasting && clip && mouse.inside) {
    ctx.globalAlpha = 0.5;
    const c = clip.cells, n = Math.min(c.length, 5 * 40000);
    for (let i = 0; i < n; i += 5) {
      const sx = ox + (hx + c[i]) * z, sy = oy + (hy + c[i + 1]) * z;
      if (sx < -z || sy < -z || sx > W || sy > H) continue;
      if (z >= DETAIL) drawBlock(ctx, c[i + 2], c[i + 3] & 3, c[i + 3] >> 2, 0, c[i + 2] === 1 ? 15 : 0, sx, sy, z);
      else { ctx.fillStyle = css(colorOf(c[i + 2], c[i + 3] >> 2, 0)); ctx.fillRect(sx, sy, Math.max(1, z), Math.max(1, z)); }
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(120,180,255,0.8)'; ctx.setLineDash([6, 4]); ctx.lineWidth = 1;
    ctx.strokeRect(ox + hx * z + 0.5, oy + hy * z + 0.5, clip.w * z, clip.h * z); ctx.setLineDash([]);
  } else if (stroke && stroke.kind === 'line') {
    const [ex, ey] = straightEnd(stroke);
    ctx.fillStyle = stroke.erase ? 'rgba(255,90,80,0.3)' : 'rgba(255,200,70,0.3)';
    ctx.fillRect(ox + Math.min(stroke.ax, ex) * z, oy + Math.min(stroke.ay, ey) * z, (Math.abs(ex - stroke.ax) + 1) * z, (Math.abs(ey - stroke.ay) + 1) * z);
  } else if (mouse.inside && !stroke) {
    const sx = ox + hx * z, sy = oy + hy * z, t = world.type(hx, hy);
    if (!t && z >= DETAIL) {
      ctx.globalAlpha = 0.35;
      drawBlock(ctx, tool.t, tool.d, toolSet[tool.t] || 0, 0, tool.t === 1 ? wireArms(hx, hy) : 0, sx, sy, z);
      ctx.globalAlpha = 1;
    }
    if (z >= 3) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
      rrect(ctx, sx + 0.5, sy + 0.5, z - 1, z - 1, z * 0.2); ctx.stroke();
    }
  }
  if (sel) {
    const [a, b, c, d] = selRect();
    ctx.fillStyle = 'rgba(100,170,255,0.08)'; ctx.strokeStyle = 'rgba(120,180,255,0.8)'; ctx.lineWidth = 1;
    ctx.fillRect(ox + a * z, oy + b * z, (c - a + 1) * z, (d - b + 1) * z);
    ctx.strokeRect(ox + a * z + 0.5, oy + b * z + 0.5, (c - a + 1) * z, (d - b + 1) * z);
  }
}

// ---------------------------------------------------------------- the dock (block picker)
const GROUPS = [
  [T.WIRE, T.CROSS],
  [T.SWITCH, T.BUTTON, T.CLOCK, T.CONST],
  [T.NOT, T.AND, T.OR, T.XOR, T.NAND, T.NOR, T.XNOR, T.DIODE],
  [T.TFF, T.DFF],
  [T.LED, T.HEX, T.BUZZER],
];
const HOTKEYS = [T.WIRE, T.CROSS, T.SWITCH, T.BUTTON, T.CLOCK, T.NOT, T.AND, T.OR, T.XOR, T.LED];   // keys 1..9, 0
const slots = {};
GROUPS.forEach((types, gi) => {
  if (gi) { const s = document.createElement('div'); s.className = 'sep'; $('dock').appendChild(s); }
  for (const t of types) {
    const s = document.createElement('div'); s.className = 'slot';
    const c = document.createElement('canvas'); c.width = c.height = 68; s.appendChild(c);
    const hk = HOTKEYS.indexOf(t);
    if (hk >= 0) { const k = document.createElement('span'); k.className = 'key'; k.textContent = (hk + 1) % 10; s.appendChild(k); }
    s.onclick = () => selectTool(t);
    s.onmouseenter = () => { dockHover = t; };
    s.onmouseleave = () => { dockHover = 0; };
    $('dock').appendChild(s);
    slots[t] = { el: s, g: c.getContext('2d') };
  }
});
function drawIcons() {
  for (const t in slots) {
    const g = slots[t].g, tt = +t;
    g.clearRect(0, 0, 68, 68);
    const st = tt === T.LED || tt === T.CLOCK || tt === T.BUZZER ? 1 : tt === T.HEX ? 10 : 0;
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
  ensureAudio(); hideHelp(); $('menu').classList.remove('show');
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
addEventListener('mouseup', () => {
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
  if (k === 'f1' || k === '?') { e.preventDefault(); toggleHelp(); return; }
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
  else if (k === 'f') configure(e.shiftKey ? -1 : 1, false);
  else if (k === 'b') configure(e.shiftKey ? -1 : 1, true);
  else if (k === 'q') {
    const t = world.type(mouse.cx, mouse.cy);
    if (t) { const d = world.data(mouse.cx, mouse.cy); tool.d = d & 3; if (SETTINGS[t]) toolSet[t] = d >> 2; selectTool(t); }
  }
  else if (k === 'delete' || k === 'backspace') { if (sel) { deleteSel(); sel = null; } }
  else if (k === 'escape') { sel = null; pasting = false; hideHelp(); $('menu').classList.remove('show'); }
  else if (k === 'h') { cam.x = 0; cam.y = 0; }
  else if (k === 'g') showGrid = !showGrid;
  else if (k === 'm') { muted = !muted; for (let n = 0; n < 24; n++) setVoice(n); toast(muted ? 'Buzzers muted' : 'Buzzers on'); }
  else if (/^[0-9]$/.test(k)) selectTool(HOTKEYS[(+k + 9) % 10]);
});
addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

// ---------------------------------------------------------------- panels + menu
function setRunning(v) { running = v; $('bRun').textContent = v ? '❚❚' : '▶'; $('bRun').classList.toggle('paused', !v); }
function setSpeed(i) {
  speedI = Math.max(0, Math.min(SPEEDS.length - 1, i));
  $('speed').textContent = SPEEDS[speedI] === Infinity ? 'MAX' : SPEEDS[speedI] + '/s';
}
$('bRun').onclick = () => setRunning(!running);
$('bSlow').onclick = () => setSpeed(speedI - 1);
$('bFast').onclick = () => setSpeed(speedI + 1);
$('bMenu').onclick = () => $('menu').classList.toggle('show');
$('bHelp').onclick = () => { $('menu').classList.remove('show'); toggleHelp(); };
$('help').onclick = hideHelp;
$('bNew').onclick = () => {
  $('menu').classList.remove('show');
  if (!confirm('Start a new empty world? Your current world will be gone (export it first if you want to keep it).')) return;
  world.clear(); undoStack.length = 0; redoStack.length = 0; cam.x = 0; cam.y = 0; save();
};
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
  catch (e) { toast('Could not autosave (world too big?) — use Export'); }
  saveDue = 0;
}
addEventListener('beforeunload', save);
$('bExport').onclick = () => {
  $('menu').classList.remove('show');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([saveText()], { type: 'application/json' }));
  a.download = 'world.bitworks'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('bImport').onclick = () => { $('menu').classList.remove('show'); $('file').click(); };
$('file').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try { loadText(await f.text()); save(); toast('Loaded ' + f.name); } catch (err) { toast('That file did not work'); }
  e.target.value = '';
};

let loaded = false;
try { const s = localStorage.getItem(SAVE_KEY); if (s) { loadText(s); loaded = true; } } catch (e) { }
if (!loaded) { BW.buildDemo(world); $('help').classList.add('show'); }
setSpeed(speedI); setRunning(true); drawIcons();

// ---------------------------------------------------------------- the hint line above the dock
function hintText() {
  if (pasting) return '<b>Pasting</b> — click to place · R rotates · Esc cancels';
  if (sel && !stroke) return '<b>Selected</b> — Ctrl C copy · Ctrl X cut · Del delete · Esc cancel';
  let t, set;
  if (dockHover) { t = dockHover; set = toolSet[t] || 0; }
  else if (mouse.inside && world.type(mouse.cx, mouse.cy)) { t = world.type(mouse.cx, mouse.cy); set = world.data(mouse.cx, mouse.cy) >> 2; }
  else { t = tool.t; set = toolSet[t] || 0; }
  const s = settingText(t, set);
  let h = `<b>${NAMES[t][0] + NAMES[t].slice(1).toLowerCase()}</b>${s ? ' (' + s + ')' : ''} — ${DESC[t]}`;
  if (t === T.LED) h += ' · F color · B brightness';
  else if (SETTINGS[t]) h += ' · F to change';
  return h;
}

// ---------------------------------------------------------------- main loop
let last = performance.now(), tickBank = 0, tpsCount = 0, tpsShown = 0, tpsTimer = 0, saveTimer = 0, lastHint = '';
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
  if (tpsTimer >= 1) {
    tpsShown = Math.round(tpsCount / tpsTimer); tpsCount = 0; tpsTimer = 0;
    if ($('menu').classList.contains('show'))
      $('stats').innerHTML = `${tpsShown} ticks/s · tick ${sim.tick}<br>${sim.nComp} parts · ${sim.nNets} wires · ${world.chunks.size} chunks`;
  }

  render();

  $('coords').textContent = `${mouse.cx}, ${mouse.cy}`;
  const h = hintText();
  if (h !== lastHint) { $('hint').innerHTML = h; lastHint = h; }

  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').style.opacity = 0; }
  if (saveDue) { saveDue -= dt; if (saveDue <= 0) save(); }
  saveTimer += dt;
  if (saveTimer > 30) { saveTimer = 0; save(); }   // also keeps switch/memory states
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
