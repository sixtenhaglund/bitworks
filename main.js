// BITWORKS — drawing, controls and UI.
'use strict';
const { CS, CSH, CM, CN, NL, DX, DY, T, NAMES, PER, SETTINGS, hasPort, canSend, canRecv, World, Sim } = BW;

const cv = document.getElementById('c'), ctx = cv.getContext('2d');
const $ = (id) => document.getElementById(id);
let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = window.devicePixelRatio || 1; W = innerWidth; H = innerHeight;
  cv.width = W * DPR | 0; cv.height = H * DPR | 0; cv.style.width = W + 'px'; cv.style.height = H + 'px';
}
addEventListener('resize', resize); resize();

// ---------------------------------------------------------------- colors
const css = (c, a) => a === undefined ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const pack = (c) => ((255 << 24) | ((Math.min(255, c[2]) | 0) << 16) | ((Math.min(255, c[1]) | 0) << 8) | (Math.min(255, c[0]) | 0)) >>> 0;
const hexOf = (c) => '#' + c.map((v) => (v | 0).toString(16).padStart(2, '0')).join('');

// GLOBAL SETTINGS (☰ → Settings), kept in this browser: glow strength, how dark the board is, grid, sound volume
const GS_KEY = 'bitworks-settings';
const gset = { glow: 1, dark: 0.7, grid: true, volume: 0.5 };
try { Object.assign(gset, JSON.parse(localStorage.getItem(GS_KEY) || '{}')); } catch (e) { }
function saveSettings() { try { localStorage.setItem(GS_KEY, JSON.stringify(gset)); } catch (e) { } }
// the board: a dark green circuit board (darker or lighter with the setting)
let BGC = [0, 0, 0], BG = '#000';
function updateBoard() {
  const d = gset.dark;
  BGC = [26 - 20 * d, 40 - 31 * d, 35 - 27 * d]; BG = css(BGC);
  spriteCache.clear(); gridPat = null;
}

// LEDs: 8 colors (each one can be changed: the palette is saved with the world)
const LED_DEFAULT = [[255, 70, 60], [70, 230, 110], [70, 150, 255], [255, 215, 60], [240, 245, 255], [255, 145, 40], [190, 100, 255], [50, 225, 225]];
const LED_COLORS = LED_DEFAULT.map((c) => c.slice());
const LED_NAMES = ['red', 'green', 'blue', 'yellow', 'white', 'orange', 'purple', 'cyan'];
const ledName = (i) => LED_COLORS[i].join() === LED_DEFAULT[i].join() ? LED_NAMES[i] : 'color ' + (i + 1);
// LED setting: bits 0-2 = color, bits 3-5 = brightness step. Steps 0-4 are the old 100/80/60/40/20 % (old saves keep
// their look); 5, 6, 7 were added: 10 %, 5 % and 50 %. BRIGHT_ORDER lists them from brightest to darkest.
const LED_BRIGHT = 8;
const LVL = [1, 0.8, 0.6, 0.4, 0.2, 0.1, 0.05, 0.5];
const BRIGHT_ORDER = [0, 1, 2, 7, 3, 4, 5, 6];
const ledBright = (set) => LVL[(set >> 3) & 7];
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
// wires are copper traces: dull copper when off, bright gold when a signal runs through them
const WIRE_OFF = [124, 84, 54], WIRE_ON = [255, 205, 95];
const COL = {   // [off, on] body color of each block type
  1: [WIRE_OFF, WIRE_ON], 2: [WIRE_OFF, WIRE_ON],
  3: [[44, 52, 64], [46, 160, 90]], 4: [[44, 52, 64], [220, 120, 40]],
  5: [[48, 42, 76], [130, 90, 220]], 6: [[46, 160, 90], [46, 160, 90]],
  15: [[30, 44, 48], [24, 120, 112]], 16: [[30, 44, 48], [24, 120, 112]],
  18: [[18, 15, 16], [18, 15, 16]], 19: [[48, 46, 34], [190, 165, 50]],
};
for (let t = 7; t <= 14; t++) COL[t] = [[34, 38, 48], [40, 84, 150]];   // chips: black epoxy, blue-lit when ON
function colorOf(t, set, on) {
  if (t === T.LED) {
    const c = LED_COLORS[set & 7], b = on ? ledBright(set) : 0;
    return on ? [c[0] * b, c[1] * b, c[2] * b] : [c[0] * 0.1 + 10, c[1] * 0.1 + 11, c[2] * 0.1 + 13];
  }
  return COL[t][on ? 1 : 0];
}
// pixel colors for the zoomed-out map view (PX, PXLED) and for the glow (GLOW*), packed once
const PX = {}, PXLED = [], GLOWLED = [];
let GLOWWIRE = 0, GLOWHEX = 0;
function buildPixels() {
  for (let t = 1; t <= 19; t++) for (let on = 0; on < 2; on++) PX[(t << 4) | on] = pack(colorOf(t, 0, on));
  for (let set = 0; set < 8 * LED_BRIGHT; set++) {
    for (let on = 0; on < 2; on++) PXLED[(set << 1) | on] = pack(colorOf(T.LED, set, on));
    GLOWLED[set] = pack(colorOf(T.LED, set, 1));
  }
  PX[(T.HEX << 4) | 1] = pack([255, 80, 50]);
  GLOWWIRE = pack(WIRE_ON.map((v) => v * 0.28)); GLOWHEX = pack([255, 70, 40]);
}
buildPixels();
// change one of the 8 LED colors (every LED using it changes)
function setPalette(i, hex) {
  const n = parseInt(String(hex).slice(1), 16);
  if (!(n >= 0)) return;
  LED_COLORS[i] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  buildPixels(); spriteCache.clear();
  for (const c of world.chunks.values()) c.dirty = true;
  drawIcons(); markSave();
}

const LINK = 100;   // the link tool isn't a block, it gets its own number
const nameOf = (t) => t === LINK ? 'LINK' : NAMES[t];
const LABEL = { 6: '1', 7: 'NOT', 8: 'AND', 9: 'OR', 10: 'XOR', 11: 'NAND', 12: 'NOR', 13: 'XNOR', 14: 'DIO', 15: 'T', 16: 'D', 19: '♪' };
const DESC = {
  1: 'carries a signal. Touching wires join up. Hold Alt for a separate wire.',
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
  [LINK]: 'click a block that sends, then one that receives. Connects only those two, any distance, any layer.',
};
// which layers a block touches: bit 0 = the one below, bit 1 = the one above
const VNAME = ['no other layers', 'layer below only', 'layer above only', 'above + below'];
const VCYCLE = [3, 1, 2, 0];
function settingText(t, set) {
  if (t === T.CLOCK) { const p = PER[set % PER.length]; return 'every ' + p + ' tick' + (p > 1 ? 's' : ''); }
  if (t === T.LED) return ledName(set & 7) + (set >> 3 ? ', ' + Math.round(ledBright(set) * 100) + '%' : '');
  if (t === T.BUZZER) return NOTE_NAMES[set % 12] + (4 + ((set / 12) | 0));
  return '';
}

// ---------------------------------------------------------------- drawing one block (zoomed in + dock icons)
function rrect(g, x, y, w, h, r) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h);
}
function circle(g, x, y, r) { g.beginPath(); g.arc(x, y, r, 0, 6.2832); }
// a copper trace: a dark edge under it, a soft glow round it when a signal runs through, a thin shine along its middle
function wireLine(g, on, w, z, path) {
  g.lineCap = 'butt';
  if (z >= 8) { g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = w * 1.5; path(); g.stroke(); }
  if (on && z >= 8) { g.strokeStyle = 'rgba(255,205,95,0.2)'; g.lineWidth = w * 2.4; path(); g.stroke(); }
  g.strokeStyle = css(on ? WIRE_ON : WIRE_OFF); g.lineWidth = w; path(); g.stroke();
  if (z >= 14) { g.strokeStyle = on ? 'rgba(255,255,225,0.55)' : 'rgba(255,215,170,0.16)'; g.lineWidth = Math.max(1, w * 0.25); path(); g.stroke(); }
}
// light from above: a little lighter at the top edge, a little darker at the bottom (on the current path)
function bevel(g, y, h) {
  const gr = g.createLinearGradient(0, y, 0, y + h);
  gr.addColorStop(0, 'rgba(255,255,255,0.13)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.02)'); gr.addColorStop(1, 'rgba(0,0,0,0.22)');
  g.fillStyle = gr; g.fill();
}
// a chip's metal legs: one sticking out on every side it connects through (gold on the output side when it's ON)
function pins(g, t, d, on, sx, sy, z, p) {
  const len = p + z * 0.05, wd = z * 0.16;
  for (let s = 0; s < 4; s++) {
    if (!hasPort(t, d, s)) continue;
    g.fillStyle = s === d && on ? css(WIRE_ON) : '#9aa3b2';
    if (s === 0) g.fillRect(sx + z / 2 - wd / 2, sy, wd, len);
    else if (s === 2) g.fillRect(sx + z / 2 - wd / 2, sy + z - len, wd, len);
    else if (s === 1) g.fillRect(sx + z - len, sy + z / 2 - wd / 2, len, wd);
    else g.fillRect(sx, sy + z / 2 - wd / 2, len, wd);
  }
}
// arms = which sides a wire connects to. onV = the up/down signal of a crossing.
function drawBlock(g, t, d, set, st, arms, sx, sy, z, onV) {
  const on = st & 1, cx = sx + z / 2, cy = sy + z / 2, w = Math.max(1.5, z * 0.2);
  if (t === LINK) {   // dock icon: a free curved line between two dots
    g.lineCap = 'round'; g.strokeStyle = css(WIRE_ON); g.lineWidth = z * 0.08;
    g.beginPath(); g.moveTo(sx + z * 0.22, sy + z * 0.72); g.quadraticCurveTo(sx + z * 0.3, sy + z * 0.2, sx + z * 0.78, sy + z * 0.28); g.stroke();
    g.fillStyle = '#d6dde8'; circle(g, sx + z * 0.22, sy + z * 0.72, z * 0.09); g.fill(); circle(g, sx + z * 0.78, sy + z * 0.28, z * 0.09); g.fill();
    return;
  }
  if (t === T.WIRE) {
    wireLine(g, on, w, z, () => {
      g.beginPath();
      for (let s = 0; s < 4; s++) if ((arms >> s) & 1) { g.moveTo(cx, cy); g.lineTo(cx + DX[s] * z / 2, cy + DY[s] * z / 2); }
    });
    if (arms !== 5 && arms !== 10) {   // a solder pad at corners, junctions and ends (not along straight runs)
      g.fillStyle = css(on ? WIRE_ON : WIRE_OFF);
      circle(g, cx, cy, arms ? w * 0.62 : w * 0.85); g.fill();
    }
    return;
  }
  if (t === T.CROSS) {
    wireLine(g, on, w, z, () => { g.beginPath(); g.moveTo(sx, cy); g.lineTo(sx + z, cy); });
    g.fillStyle = BG; g.fillRect(cx - w * 1.4, cy - w * 1.4, w * 2.8, w * 2.8);
    wireLine(g, onV, w, z, () => { g.beginPath(); g.moveTo(cx, sy); g.lineTo(cx, sy + z); });
    return;
  }
  const p = z * 0.08, bs = z - p * 2, r = z * 0.16;
  if (t === T.LED) {
    if (on) {   // LIT: fills its whole cell, so lit LEDs next to each other make one smooth screen (the glow is added later)
      g.fillStyle = css(colorOf(T.LED, set, 1)); g.fillRect(sx, sy, z, z);
      return;
    }
    // OFF: a dark glass window, faintly tinted with its color
    const q = z * 0.06;
    rrect(g, sx + q, sy + q, z - 2 * q, z - 2 * q, z * 0.14);
    g.fillStyle = css(colorOf(T.LED, set, 0)); g.fill();
    if (z >= 10) { bevel(g, sy, z); g.strokeStyle = 'rgba(255,255,255,0.06)'; g.lineWidth = 1; g.stroke(); }
    return;
  }
  const chip = t >= 7 && t <= 16;
  if (chip && z >= 10) pins(g, t, d, on, sx, sy, z, p);
  // the body, lit from above
  rrect(g, sx + p, sy + p, bs, bs, r);
  g.fillStyle = css(colorOf(t, set, on && t !== T.HEX)); g.fill();
  if (z >= 10) bevel(g, sy + p, bs);
  if (z >= 12) { rrect(g, sx + p, sy + p, bs, bs, r); g.strokeStyle = 'rgba(255,255,255,0.07)'; g.lineWidth = 1; g.stroke(); }
  if (chip && z >= 20) { g.fillStyle = 'rgba(255,255,255,0.12)'; circle(g, sx + p + z * 0.12, sy + p + z * 0.12, z * 0.035); g.fill(); }   // pin-1 dot

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
// little arrows in the corner: this block connects to the layer above (top) / below (bottom)
function drawLayerMarks(g, up, down, sx, sy, z) {
  const f = z * 0.1, x = sx + z * 0.86;
  g.fillStyle = 'rgba(140,200,255,0.9)';
  if (up) { g.beginPath(); g.moveTo(x, sy + z * 0.08); g.lineTo(x - f, sy + z * 0.08 + f); g.lineTo(x + f, sy + z * 0.08 + f); g.fill(); }
  if (down) { g.beginPath(); g.moveTo(x, sy + z * 0.92); g.lineTo(x - f, sy + z * 0.92 - f); g.lineTo(x + f, sy + z * 0.92 - f); g.fill(); }
}

// ---------------------------------------------------------------- world + state
const world = new World();
const sim = new Sim(world);
const cam = { x: 9, y: 7, z: 34 };
const tool = { t: T.WIRE, d: 1 };
const toolSet = { 5: 4, 17: 0, 19: 0 };
let toolVert = 3, layer = 0, xray = false;   // xray = see through all layers
const SPEEDS = [1, 2, 5, 10, 20, 40, 60, 120, 250, 500, 1000, 2500, 5000, 10000, Infinity];
let speedI = 4, running = true;
let insp = null;   // the inspector panel edits: null = the next block you place, {x, y, l} = one placed block (I)
let sel = null, clip = null, pasting = false, dockHover = 0, linkFrom = null;
const mouse = { x: 0, y: 0, cx: 0, cy: 0, inside: false };
let stroke = null;
const keys = {};

function cellAtScreen(sx, sy) {
  return [Math.floor(cam.x + (sx - W / 2) / cam.z), Math.floor(cam.y + (sy - H / 2) / cam.z)];
}
const typeAt = (x, y, l = layer) => world.type(x, y, l);

// ---------------------------------------------------------------- undo
// A group is one action (one drag, one paste...). Each step in it is
//   {k:'c'} a block changed, {k:'L+'} a link was made, {k:'L-'} a link was removed.
const undoStack = [], redoStack = [];
let group = null;
function beginGroup() { group = []; }
function endGroup() {
  if (group && group.length) { undoStack.push(group); if (undoStack.length > 300) undoStack.shift(); redoStack.length = 0; markSave(); }
  group = null;
}
function doSet(x, y, l, t, data, st, vert) {
  const old = world.set(x, y, t, data, st, l, vert);
  if (old && group) {
    group.push({ k: 'c', x, y, l, o: old, n: t ? [t, data, st, vert] : [0, 0, 0, 0] });
    if (old.links) for (const L of old.links) group.push({ k: 'L-', L });
  }
  return old;
}
function addLinkU(L) { world.addLink(L); if (group) group.push({ k: 'L+', L }); }
function removeLinkU(L) { if (world.removeLink(L) && group) group.push({ k: 'L-', L }); }
function undo() {
  const g = undoStack.pop(); if (!g) return;
  for (let i = g.length - 1; i >= 0; i--) {
    const o = g[i];
    if (o.k === 'c') world.set(o.x, o.y, o.o[0], o.o[1], o.o[2], o.l, o.o[3]);
    else if (o.k === 'L+') world.removeLink(o.L);
  }
  for (const o of g) if (o.k === 'L-') world.addLink(o.L);   // put links back after their blocks are back
  redoStack.push(g); markSave(); toast('Undo');
}
function redo() {
  const g = redoStack.pop(); if (!g) return;
  for (const o of g) {
    if (o.k === 'c') world.set(o.x, o.y, o.n[0], o.n[1], o.n[2], o.l, o.n[3]);
    else if (o.k === 'L+') world.addLink(o.L);
    else world.removeLink(o.L);
  }
  undoStack.push(g); markSave(); toast('Redo');
}

// ---------------------------------------------------------------- editing
const toolData = () => tool.d | ((toolSet[tool.t] || 0) << 2);
function placeAt(x, y, firstClick) {
  const t = typeAt(x, y);
  if (!t) { doSet(x, y, layer, tool.t, toolData(), 0, toolVert); return; }
  if (!firstClick) return;          // dragging never destroys things
  if (t === tool.t) {               // clicking the same kind of block rotates it
    if (t === T.WIRE || t === T.CROSS) return;
    const d = world.data(x, y, layer);
    doSet(x, y, layer, t, (d & ~3) | (((d & 3) + 1) & 3), world.st(x, y, layer), world.vert(x, y, layer));
  } else doSet(x, y, layer, tool.t, toolData(), 0, toolVert);
}
function eraseAt(x, y) { doSet(x, y, layer, 0, 0, 0, 0); }
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

// ---- separate wires (hold Alt): each wire only connects to the cells you dragged through
const SEP = 64;
function sepPlace(x, y) {   // returns true if a new wire was placed
  if (typeAt(x, y)) return false;
  doSet(x, y, layer, T.WIRE, SEP, 0, toolVert); return true;
}
function sepOpen(x, y, s) {   // let a separate wire connect on side s
  if (typeAt(x, y) !== T.WIRE) return;
  const d = world.data(x, y, layer);
  if (d & SEP) doSet(x, y, layer, T.WIRE, d | (1 << (2 + s)), world.st(x, y, layer), world.vert(x, y, layer));
}
function sideTo(ax, ay, bx, by) { return bx > ax ? 1 : bx < ax ? 3 : by > ay ? 2 : 0; }
function path4(x0, y0, x1, y1, fn) {   // like lineCells but never steps diagonally
  let n = 0;
  while ((x0 !== x1 || y0 !== y1) && n++ < 100000) {
    const ax = x0, ay = y0;
    if (Math.abs(x1 - x0) >= Math.abs(y1 - y0)) x0 += Math.sign(x1 - x0); else y0 += Math.sign(y1 - y0);
    fn(ax, ay, x0, y0);
  }
}
function sepStep(st, ax, ay, bx, by) {   // the drag moved one cell, from a to b
  const s = sideTo(ax, ay, bx, by);
  st.lastFresh = sepPlace(bx, by);
  if (!st.moved && st.fresh) sepOpen(ax, ay, (s + 2) & 3);   // the start also connects straight back
  st.moved = true;
  sepOpen(ax, ay, s); sepOpen(bx, by, (s + 2) & 3);
  st.lastDir = s;
}
function sepFinish(st, x, y) {
  if (!st.moved) { if (st.fresh) doSet(x, y, layer, T.WIRE, 0, 0, toolVert); return; }   // just a click: normal wire
  if (st.lastFresh) sepOpen(x, y, st.lastDir);                                          // the end connects straight ahead
}

// ---- links
function linkClick(x, y) {
  const t = typeAt(x, y);
  if (!linkFrom) {
    if (!t) return;
    if (!canSend(t)) { toast(nameOf(t) + " can't send a signal — start the link at a wire, input or gate"); return; }
    linkFrom = [x, y, layer];
    return;
  }
  if (!t) { linkFrom = null; return; }   // clicking empty space cancels
  if (linkFrom[0] === x && linkFrom[1] === y && linkFrom[2] === layer) { linkFrom = null; return; }
  if (!canRecv(t)) { toast(nameOf(t) + " can't receive a signal"); return; }
  beginGroup(); addLinkU([linkFrom[0], linkFrom[1], linkFrom[2], x, y, layer]); endGroup();
  linkFrom = null;
}
function linkNearMouse() {   // the link closest to the mouse (within 8 px) on this layer
  const z = cam.z, ox = W / 2 - cam.x * z, oy = H / 2 - cam.y * z;
  let best = null, bd = 8;
  for (const L of world.links) {
    if (L[2] !== layer && L[5] !== layer) continue;
    const ax = ox + (L[0] + 0.5) * z, ay = oy + (L[1] + 0.5) * z, bx = ox + (L[3] + 0.5) * z, by = oy + (L[4] + 0.5) * z;
    const vx = bx - ax, vy = by - ay, len = vx * vx + vy * vy;
    const u = len ? Math.max(0, Math.min(1, ((mouse.x - ax) * vx + (mouse.y - ay) * vy) / len)) : 0;
    const d = Math.hypot(ax + vx * u - mouse.x, ay + vy * u - mouse.y);
    if (d < bd) { bd = d; best = L; }
  }
  return best;
}

// visit every non-empty cell inside a rectangle on one layer (skips empty chunks entirely)
function forCells(l, x0, y0, x1, y1, fn) {
  for (let cy = y0 >> CSH; cy <= y1 >> CSH; cy++) for (let cx = x0 >> CSH; cx <= x1 >> CSH; cx++) {
    const c = world.ch(cx, cy, l); if (!c) continue;
    const lx0 = Math.max(0, x0 - cx * CS), lx1 = Math.min(CM, x1 - cx * CS);
    const ly0 = Math.max(0, y0 - cy * CS), ly1 = Math.min(CM, y1 - cy * CS);
    for (let ly = ly0; ly <= ly1; ly++) for (let lx = lx0; lx <= lx1; lx++) {
      const i = (ly << CSH) | lx;
      if (c.type[i]) fn(cx * CS + lx, cy * CS + ly, c.type[i], c.data[i], c.st[i], c.vert[i]);
    }
  }
}
function selRect() {
  return [Math.min(sel.x0, sel.x1), Math.min(sel.y0, sel.y1), Math.max(sel.x0, sel.x1), Math.max(sel.y0, sel.y1)];
}
const inRect = (x, y, r) => x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];
// copying takes ALL layers inside the box, so multi-layer builds copy in one go
function copySel() {
  if (!sel) return false;
  const r = selRect(), [x0, y0, x1, y1] = r, cells = [], links = [];
  for (let l = 0; l < NL; l++) forCells(l, x0, y0, x1, y1, (x, y, t, d, s, v) => cells.push(x - x0, y - y0, l - layer, t, d, s, v));
  for (const L of world.links) if (inRect(L[0], L[1], r) && inRect(L[3], L[4], r))
    links.push([L[0] - x0, L[1] - y0, L[2] - layer, L[3] - x0, L[4] - y0, L[5] - layer]);
  clip = { w: x1 - x0 + 1, h: y1 - y0 + 1, cells, links };
  toast('Copied ' + cells.length / 7 + ' blocks' + (links.length ? ' + ' + links.length + ' links' : ''));
  return true;
}
function deleteSel() {
  if (!sel) return;
  const [x0, y0, x1, y1] = selRect(), list = [];
  for (let l = 0; l < NL; l++) forCells(l, x0, y0, x1, y1, (x, y) => list.push(x, y, l));
  beginGroup();
  for (let i = 0; i < list.length; i += 3) doSet(list[i], list[i + 1], list[i + 2], 0, 0, 0, 0);
  endGroup();
}
function rotateClip() {
  const c = clip.cells, h = clip.h;
  for (let i = 0; i < c.length; i += 7) {
    const dx = c[i], dy = c[i + 1];
    c[i] = h - 1 - dy; c[i + 1] = dx;
    if (c[i + 3] === T.WIRE) {   // separate wire: turn its allowed sides too
      const m = (c[i + 4] >> 2) & 15;
      c[i + 4] = (c[i + 4] & SEP) | ((((m << 1) | (m >> 3)) & 15) << 2);
    } else c[i + 4] = (c[i + 4] & ~3) | (((c[i + 4] & 3) + 1) & 3);
  }
  for (const L of clip.links) {
    const a = [h - 1 - L[1], L[0]], b = [h - 1 - L[4], L[3]];
    L[0] = a[0]; L[1] = a[1]; L[3] = b[0]; L[4] = b[1];
  }
  const w = clip.w; clip.w = clip.h; clip.h = w;
}
function pasteAt(x, y) {
  beginGroup();
  const c = clip.cells;
  for (let i = 0; i < c.length; i += 7) {
    const l = layer + c[i + 2];
    if (l >= 0 && l < NL) doSet(x + c[i], y + c[i + 1], l, c[i + 3], c[i + 4], c[i + 5], c[i + 6]);
  }
  for (const L of clip.links) {
    const la = layer + L[2], lb = layer + L[5];
    if (la >= 0 && la < NL && lb >= 0 && lb < NL) addLinkU([x + L[0], y + L[1], la, x + L[3], y + L[4], lb]);
  }
  endGroup();
}
// F: change clock speed / LED color / buzzer note,  B: LED brightness
function nextSetting(t, set, dir, bright) {
  if (t === T.LED) {
    if (bright) {   // B = one step darker, Shift+B = one step brighter
      const i = BRIGHT_ORDER.indexOf((set >> 3) & 7);
      return (set & 7) | (BRIGHT_ORDER[(i + dir + 8) % 8] << 3);
    }
    return (set & ~7) | (((set & 7) + dir + 8) & 7);
  }
  const n = SETTINGS[t];
  return (set + dir + n) % n;
}
function configure(dir, bright) {
  const x = mouse.cx, y = mouse.cy, t = typeAt(x, y);
  if (bright && t !== T.LED && tool.t !== T.LED) return;
  if (SETTINGS[t] && (!bright || t === T.LED)) {
    const d = world.data(x, y, layer), set = nextSetting(t, d >> 2, dir, bright);
    beginGroup(); doSet(x, y, layer, t, (d & 3) | (set << 2), world.st(x, y, layer), world.vert(x, y, layer)); endGroup();
    toolSet[t] = set; drawIcons();
    toast(nameOf(t) + ': ' + settingText(t, set));
  } else if (SETTINGS[tool.t]) {
    toolSet[tool.t] = nextSetting(tool.t, toolSet[tool.t] || 0, dir, bright); drawIcons();
    toast(nameOf(tool.t) + ': ' + settingText(tool.t, toolSet[tool.t]));
  }
}
// V: which layers the block under the mouse (or the next one you place) touches
function cycleVert() {
  const x = mouse.cx, y = mouse.cy, t = mouse.inside ? typeAt(x, y) : 0;
  if (t) {
    const v = VCYCLE[(VCYCLE.indexOf(world.vert(x, y, layer)) + 1) % 4];
    beginGroup(); doSet(x, y, layer, t, world.data(x, y, layer), world.st(x, y, layer), v); endGroup();
    toolVert = v;
    toast(nameOf(t) + ' touches: ' + VNAME[v]);
  } else {
    toolVert = VCYCLE[(VCYCLE.indexOf(toolVert) + 1) % 4];
    toast('New blocks touch: ' + VNAME[toolVert]);
  }
}
function pickBlock() {   // middle-click / P: grab the block under the mouse
  const t = typeAt(mouse.cx, mouse.cy);
  if (!t) return;
  const d = world.data(mouse.cx, mouse.cy, layer);
  tool.d = d & 3; toolVert = world.vert(mouse.cx, mouse.cy, layer); insp = null;
  if (SETTINGS[t]) toolSet[t] = d >> 2;
  selectTool(t);
}
function setLayer(l) {
  layer = Math.max(0, Math.min(NL - 1, l));
  $('layerNum').textContent = layer + 1;
  $('bUp').disabled = layer === NL - 1; $('bDown').disabled = layer === 0;
}

// ---------------------------------------------------------------- sound (buzzers)
let AC = null, master = null, muted = false;
const voices = [], buzzCount = new Int32Array(24);
function ensureAudio() {
  if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain(); master.gain.value = 0.24 * gset.volume; master.connect(AC.destination);
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
// Every chunk keeps two small pictures ("atlases", 96x64), redrawn only when something in it changed:
//  - canvas: what the blocks look like from far away (the map view)
//  - lcanvas: only the LIGHT - lit LEDs, lit hex displays and (faintly) powered wires - for the glow
// Each atlas holds the chunk at 64x64 (one pixel per block) on the left, and shrunk versions on the right
// (32, 16, 8, 4, 2, 1 pixels across). Far away, the shrunk version that fits the zoom is drawn.
// SHRINKING MIXES LIGHT LIKE REAL LIGHT (Sixten: "it didn't blend into white"): the light of the blocks that become one
// pixel is ADDED - its color is the sum of their colors (red + green + blue LEDs = white, red + green = yellow) and its
// brightness how bright they are on average. Like the tiny red, green and blue dots of a real screen.
const MIP_OFF = [0, 4096, 5120, 5376, 5440, 5456, 5460], MIP_N = 5461;
const mip = { lr: new Float32Array(MIP_N), lg: new Float32Array(MIP_N), lb: new Float32Array(MIP_N), ps: new Float32Array(MIP_N), pm: new Float32Array(MIP_N),
  br: new Float32Array(MIP_N), bg: new Float32Array(MIP_N), bb: new Float32Array(MIP_N), oc: new Float32Array(MIP_N), nl: new Float32Array(MIP_N) };
// where shrink level k sits in an atlas: x, y, size
const mipRect = (k) => k === 0 ? [0, 0, 64] : [64, 64 - 2 * (64 >> k), 64 >> k];
const AW = 96;
const rgba = (r, g, b, a) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
function paintChunk(c) {
  if (!c.canvas) {
    c.canvas = document.createElement('canvas'); c.canvas.width = AW; c.canvas.height = CS;
    c.g = c.canvas.getContext('2d'); c.img = c.g.createImageData(AW, CS); c.px = new Uint32Array(c.img.data.buffer);
    c.lcanvas = document.createElement('canvas'); c.lcanvas.width = AW; c.lcanvas.height = CS;
    c.lg = c.lcanvas.getContext('2d'); c.limg = c.lg.createImageData(AW, CS); c.lpx = new Uint32Array(c.limg.data.buffer);
    c.lit = 0;
  }
  const px = c.px, lp = c.lpx, ty = c.type, da = c.data, st = c.st, net = c.net, nOn = sim.netOn, nn = sim.nNets;
  const { lr, lg, lb, ps, pm, br, bg, bb, oc, nl } = mip;
  let lit = 0;
  // full size: one pixel per block
  for (let i = 0; i < CN; i++) {
    const t = ty[i], a = ((i >> CSH) * AW) + (i & CM);
    lr[i] = lg[i] = lb[i] = ps[i] = pm[i] = br[i] = bg[i] = bb[i] = oc[i] = nl[i] = 0;
    if (!t) { px[a] = 0; lp[a] = 0; continue; }
    let on;
    if (t === 1) { const n = net[i]; on = n >= 0 && n < nn && nOn[n] > 0 ? 1 : 0; }
    else if (t === 2) { const x = net[i], y = c.netV[i]; on = (x >= 0 && x < nn && nOn[x] > 0) || (y >= 0 && y < nn && nOn[y] > 0) ? 1 : 0; }
    else on = t === T.HEX ? (st[i] ? 1 : 0) : st[i] & 1;
    let p, l;
    if (t === T.LED) { const s = (da[i] >> 2) % (8 * LED_BRIGHT); p = PXLED[(s << 1) | on]; l = on ? GLOWLED[s] : 0; }
    else { p = PX[(t << 4) | on]; l = !on ? 0 : t <= 2 ? GLOWWIRE : t === T.HEX ? GLOWHEX : 0; }
    px[a] = p; lp[a] = l; oc[i] = 1;
    if (l && t !== 1 && t !== 2) {   // a light: counts as emitted light (wires only glow, they don't light the far view)
      lr[i] = (l & 255) / 255; lg[i] = ((l >> 8) & 255) / 255; lb[i] = ((l >> 16) & 255) / 255;
      ps[i] = pm[i] = Math.max(lr[i], lg[i], lb[i]); nl[i] = 1;
    } else { br[i] = (p & 255) / 255; bg[i] = ((p >> 8) & 255) / 255; bb[i] = ((p >> 16) & 255) / 255; }
    if (l) lit++;
  }
  // the shrunk versions: each pixel = 2x2 pixels of the level before
  for (let k = 1; k <= 6; k++) {
    const s = 64 >> k, o = MIP_OFF[k], po = MIP_OFF[k - 1], ps2 = s * 2, [ax, ay] = mipRect(k), cells = 1 << (2 * k);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const j = o + y * s + x, a = po + (2 * y) * ps2 + 2 * x, b = a + 1, cc = a + ps2, d = cc + 1;
      const ocS = oc[j] = oc[a] + oc[b] + oc[cc] + oc[d];
      const R = lr[j] = lr[a] + lr[b] + lr[cc] + lr[d], G = lg[j] = lg[a] + lg[b] + lg[cc] + lg[d], B = lb[j] = lb[a] + lb[b] + lb[cc] + lb[d];
      const P = ps[j] = ps[a] + ps[b] + ps[cc] + ps[d], PM = pm[j] = Math.max(pm[a], pm[b], pm[cc], pm[d]);
      const BR = br[j] = br[a] + br[b] + br[cc] + br[d], BG = bg[j] = bg[a] + bg[b] + bg[cc] + bg[d], BB = bb[j] = bb[a] + bb[b] + bb[cc] + bb[d];
      const NL = nl[j] = nl[a] + nl[b] + nl[cc] + nl[d];
      const at = (ay + y) * AW + ax + x;
      if (!ocS) { px[at] = 0; lp[at] = 0; continue; }
      const m = Math.max(R, G, B);
      // the light's color = its added-up color, scaled so its strongest part is full.
      // How bright: the light ADDS UP (lights covering a quarter of the pixel already make it fully bright - like stars,
      // a few small lights are still clearly seen from far) but never brighter than the lights themselves are set to.
      const hr = m > 0 ? R / m : 0, hg = m > 0 ? G / m : 0, hb = m > 0 ? B / m : 0;
      const bright = NL > 0 ? Math.min(P / NL, 4 * P / cells) : 0;
      // (premultiplied: the blocks' own colors, spread over the whole pixel, plus the light)
      const qr = Math.min(1, BR / cells + hr * bright), qg = Math.min(1, BG / cells + hg * bright), qb = Math.min(1, BB / cells + hb * bright);
      const al = Math.min(1, Math.max(ocS / cells, qr, qg, qb));
      px[at] = rgba(qr / al * 255 | 0, qg / al * 255 | 0, qb / al * 255 | 0, al * 255 + 0.5 | 0);
      lp[at] = PM > 0 ? rgba(hr * PM * 255 | 0, hg * PM * 255 | 0, hb * PM * 255 | 0, 255) : 0;   // (for the glow: as bright as its brightest light)
    }
  }
  c.g.putImageData(c.img, 0, 0);
  if (lit || c.lit) c.lg.putImageData(c.limg, 0, 0);
  c.lit = lit;
  c.dirty = false;
}
// (a busy circuit makes most chunks change every tick: at most ~4 ms of REPAINTING per frame - the rest waits a
// frame. Only the time spent repainting counts, and the first one each frame always goes, so nothing ever gets stuck.)
let paintSpent = 0, paintedThisFrame = 0;
function freshen(c) {
  if (c.canvas && !c.dirty) return;
  if (c.canvas && paintedThisFrame > 0 && paintSpent > 4) return;
  const t0 = performance.now();
  paintChunk(c);
  paintSpent += performance.now() - t0; paintedThisFrame++;
}

const DETAIL = 10;   // pixels per cell where we switch from "map view" to drawn blocks
function wireOn(c, i) { const n = c.net[i]; return n >= 0 && n < sim.nNets && sim.netOn[n] > 0 ? 1 : 0; }
function portAt(x, y, l, s) {   // does the cell at x,y have a connection on side s?
  const c = world.ch(x >> CSH, y >> CSH, l); if (!c) return 0;
  const i = ((y & CM) << CSH) | (x & CM), t = c.type[i];
  return t ? hasPort(t, c.data[i], s) : 0;
}
function wireArms(x, y, l, data) {
  let arms = 0;
  for (let s = 0; s < 4; s++) if (hasPort(T.WIRE, data, s) && portAt(x + DX[s], y + DY[s], l, (s + 2) & 3)) arms |= 1 << s;
  return arms;
}
// (the same, faster: neighbours inside the same chunk are read straight from it)
const NOFF = [-CS, 1, CS, -1];
function wireArmsIn(c, i, lx, ly, x, y, l, data) {
  if (lx === 0 || ly === 0 || lx === CM || ly === CM) return wireArms(x, y, l, data);
  let arms = 0;
  for (let s = 0; s < 4; s++) {
    if (!hasPort(T.WIRE, data, s)) continue;
    const j = i + NOFF[s], t = c.type[j];
    if (t && hasPort(t, c.data[j], (s + 2) & 3)) arms |= 1 << s;
  }
  return arms;
}
function visibleChunks(l, cx0, cy0, cx1, cy1) {
  const out = [];
  if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) < world.chunks.size) {
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) { const c = world.ch(cx, cy, l); if (c) out.push(c); }
  } else {
    for (const c of world.chunks.values()) if (c.l === l && c.cx >= cx0 && c.cx <= cx1 && c.cy >= cy0 && c.cy <= cy1) out.push(c);
  }
  return out;
}

// SPRITES: each different-looking block (kind, facing, setting, on/off, which arms a wire has...) is drawn ONCE into a
// small picture at the current zoom, and then just stamped onto the screen - one call per block instead of ~13.
// The pictures are thrown away when the zoom (or the colors) change.
const spriteCache = new Map();
let spriteZ = 0;
function sprite(key, t, d, set, st, arms, onV, z) {
  const px = Math.max(1, Math.round(z * DPR));
  if (px !== spriteZ) { spriteCache.clear(); spriteZ = px; }
  let s = spriteCache.get(key);
  if (!s) {
    if (spriteCache.size > 3000) spriteCache.clear();
    s = document.createElement('canvas'); s.width = s.height = px;
    const g = s.getContext('2d');
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawBlock(g, t, d, set, st, arms, 0, 0, px / DPR, onV);
    spriteCache.set(key, s);
  }
  return s;
}

function drawLayer(l, z, ox, oy, x0, y0, x1, y1, main) {
  const chunks = visibleChunks(l, x0 >> CSH, y0 >> CSH, x1 >> CSH, y1 >> CSH);
  if (z < DETAIL) {
    // MAP VIEW: every chunk is a tiny picture, one pixel per block, stretched up. Zoomed out so far that several blocks
    // share one screen pixel, the shrunk version that fits is used instead (its lights already added together).
    // (one level coarser than the screen's pixels, drawn smoothly: neighbouring lights mix more the further out you go)
    const k = z >= 1 ? 0 : Math.min(6, Math.floor(Math.log2(1 / z)) + 1), [rx, ry, rs] = mipRect(k);
    ctx.imageSmoothingEnabled = k > 0;
    for (const c of chunks) {
      freshen(c);
      const sx = Math.round(ox + c.cx * CS * z), sy = Math.round(oy + c.cy * CS * z);
      const ex = Math.round(ox + (c.cx + 1) * CS * z), ey = Math.round(oy + (c.cy + 1) * CS * z);
      ctx.drawImage(c.canvas, rx, ry, rs, rs, sx, sy, Math.max(1, ex - sx), Math.max(1, ey - sy));
    }
    return chunks;
  }
  // BLOCK VIEW: every visible block stamped from its sprite
  ctx.imageSmoothingEnabled = true;
  for (const c of chunks) {
    if (main) freshen(c);   // (keeps its glow picture up to date)
    const bx = c.cx * CS, by = c.cy * CS;
    const cA = main && z >= 16 ? world.ch(c.cx, c.cy, l + 1) : null, cB = main && z >= 16 ? world.ch(c.cx, c.cy, l - 1) : null;
    const lx0 = Math.max(0, x0 - bx), lx1 = Math.min(CM, x1 - bx), ly0 = Math.max(0, y0 - by), ly1 = Math.min(CM, y1 - by);
    const ty = c.type, da = c.data;
    for (let ly = ly0; ly <= ly1; ly++) for (let lx = lx0; lx <= lx1; lx++) {
      const i = (ly << CSH) | lx, t = ty[i];
      if (!t) continue;
      const x = bx + lx, y = by + ly, sx = ox + x * z, sy = oy + y * z;
      let spr;
      if (t === 1) {
        const on = wireOn(c, i), arms = wireArmsIn(c, i, lx, ly, x, y, l, da[i]);
        spr = sprite(1 | (on << 13) | (arms << 17), 1, 0, 0, on, arms, 0, z);
      } else if (t === 2) {
        const on = wireOn(c, i), onV = sim.netIsOn(c.netV ? c.netV[i] : -1) ? 1 : 0;
        spr = sprite(2 | (on << 13) | (onV << 21), 2, 0, 0, on, 0, onV, z);
      } else {
        const d = t === T.LED ? 0 : da[i] & 3, set = da[i] >> 2, s = t === T.HEX ? c.st[i] & 15 : c.st[i] & 1;
        spr = sprite(t | (d << 5) | (set << 7) | (s << 13), t, d, set, s, 0, 0, z);
      }
      ctx.drawImage(spr, sx, sy, z, z);
      if (cA || cB) {
        const v = c.vert[i];
        const up = cA && (v & 2) && cA.type[i] && (cA.vert[i] & 1), down = cB && (v & 1) && cB.type[i] && (cB.vert[i] & 2);
        if (up || down) drawLayerMarks(ctx, up, down, sx, sy, z);
      }
    }
  }
  return chunks;
}

// THE GLOW. Every visible chunk's light picture is drawn into one small canvas (half the screen's size), and that is
// added onto the screen twice, blurred - a tight glow and a wide soft one. 'lighter' ADDS light, like real light:
// red and green LEDs next to each other glow yellow where they meet, and a block of lit LEDs reads as one bright screen.
// MEDIUM ZOOM: the mixed light (2x2 blocks added together) is ADDED over the blocks - more of it the further out you
// are (none from 16 px per block up). Lights of one color stay that color; red, green and blue side by side go white.
function drawLightMix(chunks, z, ox, oy) {
  if (!chunks || z >= 16 || z < 1) return;
  const a = Math.min(0.85, (16 - z) / 15 * 0.85), [rx, ry, rs] = mipRect(1);
  let any = false;
  for (const c of chunks) if (c.lit) { any = true; break; }
  if (!any) return;
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a; ctx.imageSmoothingEnabled = true;
  for (const c of chunks) if (c.lit) ctx.drawImage(c.lcanvas, rx, ry, rs, rs, ox + c.cx * CS * z, oy + c.cy * CS * z, CS * z, CS * z);
  ctx.restore();
}
let glowC = null, glowG = null, FILTER_OK = null;
function drawGlow(chunks, z, ox, oy) {
  if (gset.glow <= 0 || !chunks) return;
  let any = false;
  for (const c of chunks) if (c.lit) { any = true; break; }
  if (!any) return;
  const S = 0.5, gw = Math.max(1, Math.ceil(W * S)), gh = Math.max(1, Math.ceil(H * S));
  if (!glowC || glowC.width !== gw || glowC.height !== gh) {
    glowC = document.createElement('canvas'); glowC.width = gw; glowC.height = gh; glowG = glowC.getContext('2d');
  }
  glowG.setTransform(1, 0, 0, 1, 0, 0); glowG.clearRect(0, 0, gw, gh);
  glowG.imageSmoothingEnabled = true;
  // (the glow comes from the lights mixed 2x2 - or more, far out: where red, green and blue glows meet, it's white)
  const [rx, ry, rs] = mipRect(z >= 1 ? 1 : Math.max(1, Math.min(6, Math.floor(Math.log2(1 / z)) + 1)));
  for (const c of chunks) if (c.lit) glowG.drawImage(c.lcanvas, rx, ry, rs, rs, (ox + c.cx * CS * z) * S, (oy + c.cy * CS * z) * S, CS * z * S, CS * z * S);
  if (FILTER_OK === null) { ctx.filter = 'blur(2px)'; FILTER_OK = ctx.filter === 'blur(2px)'; ctx.filter = 'none'; }
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.imageSmoothingEnabled = true;
  const k = Math.min(2, gset.glow);
  if (FILTER_OK) {
    ctx.filter = 'blur(' + Math.min(24, Math.max(1.5, z * 0.4)).toFixed(1) + 'px)';
    ctx.globalAlpha = Math.min(1, 0.28 * k); ctx.drawImage(glowC, 0, 0, W, H);
    ctx.filter = 'blur(' + Math.min(80, Math.max(4, z * 1.5)).toFixed(1) + 'px)';
    ctx.globalAlpha = Math.min(1, 0.42 * k); ctx.drawImage(glowC, 0, 0, W, H);
  } else {   // (no blur filter in this browser: the small picture stretched up is soft enough)
    ctx.globalAlpha = Math.min(1, 0.5 * k); ctx.drawImage(glowC, 0, 0, W, H);
  }
  ctx.restore();
}
function drawLinks(z, ox, oy) {
  const links = world.links, fresh = sim.ver === world.ver;
  const w = Math.max(1.5, z * 0.12);
  ctx.lineCap = 'round';
  for (let j = 0; j < links.length; j++) {
    const L = links[j];
    const mine = L[2] === layer || L[5] === layer;
    if (!mine && !xray) continue;
    ctx.globalAlpha = mine ? 1 : 0.35;
    const ax = ox + (L[0] + 0.5) * z, ay = oy + (L[1] + 0.5) * z, bx = ox + (L[3] + 0.5) * z, by = oy + (L[4] + 0.5) * z;
    if (Math.max(ax, bx) < -20 || Math.min(ax, bx) > W + 20 || Math.max(ay, by) < -20 || Math.min(ay, by) > H + 20) continue;
    const on = fresh && sim.netIsOn(sim.linkNet[j]), bad = fresh && !sim.linkOk[j];
    const other = L[2] !== L[5];   // goes to another layer: dashed
    if (other) ctx.setLineDash([w * 3, w * 2]);
    if (on && z >= 6) { ctx.strokeStyle = 'rgba(255,200,70,0.2)'; ctx.lineWidth = w * 3; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); }
    ctx.strokeStyle = bad ? '#e0504a' : on ? css(WIRE_ON) : '#7d8aa0'; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    ctx.setLineDash([]);
    if (z >= 6) {   // a ring where it starts, a dot where it ends
      ctx.fillStyle = ctx.strokeStyle;
      circle(ctx, bx, by, w * 1.3); ctx.fill();
      ctx.lineWidth = Math.max(1, w * 0.6); circle(ctx, ax, ay, w * 1.4); ctx.stroke();
      if (other && z >= 14) {   // say which layer the far end is on
        const fx = L[2] === layer ? bx : ax, fy = L[2] === layer ? by : ay, fl = L[2] === layer ? L[5] : L[2];
        ctx.font = `600 ${Math.max(10, z * 0.28) | 0}px system-ui, sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        ctx.fillStyle = '#8cc8ff'; ctx.fillText('L' + (fl + 1), fx + z * 0.3, fy - z * 0.25);
      }
    }
  }
  ctx.globalAlpha = 1;
}
function setXray(v) {
  xray = v; $('bXray').classList.toggle('on', v);
  toast(v ? 'X-ray on: seeing through all layers' : 'X-ray off');
}

// the board's pattern: a little round pad at every cell corner (like the holes on a prototyping board), one picture
// repeated over the whole screen (one call - it used to be one tiny square per cell)
let gridPat = null;
function gridPattern() {
  if (gridPat) return gridPat;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(170,215,195,0.15)';
  for (const [x, y] of [[0, 0], [64, 0], [0, 64], [64, 64]]) { circle(g, x, y, 4.5); g.fill(); }
  gridPat = ctx.createPattern(c, 'repeat');
  return gridPat;
}
function render() {
  paintSpent = 0; paintedThisFrame = 0;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
  const z = cam.z, ox = W / 2 - cam.x * z, oy = H / 2 - cam.y * z;
  const x0 = Math.floor(cam.x - W / 2 / z), x1 = Math.floor(cam.x + W / 2 / z);
  const y0 = Math.floor(cam.y - H / 2 / z), y1 = Math.floor(cam.y + H / 2 / z);

  // background: dots when close, faint chunk lines when far
  if (gset.grid) {
    const pat = z >= 10 && typeof DOMMatrix !== 'undefined' ? gridPattern() : null;
    if (pat && pat.setTransform) {
      pat.setTransform(new DOMMatrix().translate(ox, oy).scale(z / 64));
      ctx.fillStyle = pat; ctx.fillRect(0, 0, W, H);
    } else if (z >= 10) {
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

  // X-ray: every other layer see-through (fainter the further away), else just the one below
  if (xray) {
    for (let l = 0; l < NL; l++) {
      if (l === layer) continue;
      ctx.globalAlpha = Math.max(0.1, 0.45 - 0.07 * Math.abs(l - layer));
      drawLayer(l, z, ox, oy, x0, y0, x1, y1, false);
    }
    ctx.globalAlpha = 1;
  } else if (layer > 0) { ctx.globalAlpha = 0.18; drawLayer(layer - 1, z, ox, oy, x0, y0, x1, y1, false); ctx.globalAlpha = 1; }
  const shown = drawLayer(layer, z, ox, oy, x0, y0, x1, y1, true);
  drawLightMix(shown, z, ox, oy);
  drawGlow(shown, z, ox, oy);
  drawLinks(z, ox, oy);
  if (insp && insp.l === layer) {   // the block the inspector is editing
    ctx.strokeStyle = 'rgba(120,220,255,0.95)'; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
    ctx.strokeRect(ox + insp.x * z - 1, oy + insp.y * z - 1, z + 2, z + 2); ctx.setLineDash([]);
  }

  // ghosts + selection
  const hx = mouse.cx, hy = mouse.cy;
  if (linkFrom) {   // a link waiting for its second block
    const ax = ox + (linkFrom[0] + 0.5) * z, ay = oy + (linkFrom[1] + 0.5) * z;
    ctx.strokeStyle = 'rgba(255,200,70,0.7)'; ctx.lineWidth = Math.max(1.5, z * 0.1); ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(mouse.x, mouse.y); ctx.stroke(); ctx.setLineDash([]);
  }
  if (pasting && clip && mouse.inside) {
    ctx.globalAlpha = 0.5;
    const c = clip.cells, n = Math.min(c.length, 7 * 40000);
    for (let i = 0; i < n; i += 7) {
      if (c[i + 2] !== 0) continue;   // ghost shows the blocks for this layer
      const sx = ox + (hx + c[i]) * z, sy = oy + (hy + c[i + 1]) * z;
      if (sx < -z || sy < -z || sx > W || sy > H) continue;
      if (z >= DETAIL) drawBlock(ctx, c[i + 3], c[i + 4] & 3, c[i + 4] >> 2, 0, c[i + 3] === 1 ? 15 : 0, sx, sy, z);
      else { ctx.fillStyle = css(colorOf(c[i + 3], c[i + 4] >> 2, 0)); ctx.fillRect(sx, sy, Math.max(1, z), Math.max(1, z)); }
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(120,180,255,0.8)'; ctx.setLineDash([6, 4]); ctx.lineWidth = 1;
    ctx.strokeRect(ox + hx * z + 0.5, oy + hy * z + 0.5, clip.w * z, clip.h * z); ctx.setLineDash([]);
  } else if (stroke && stroke.kind === 'line') {
    const [ex, ey] = straightEnd(stroke);
    ctx.fillStyle = stroke.erase ? 'rgba(255,90,80,0.3)' : 'rgba(255,200,70,0.3)';
    ctx.fillRect(ox + Math.min(stroke.ax, ex) * z, oy + Math.min(stroke.ay, ey) * z, (Math.abs(ex - stroke.ax) + 1) * z, (Math.abs(ey - stroke.ay) + 1) * z);
  } else if (mouse.inside && !stroke) {
    const sx = ox + hx * z, sy = oy + hy * z, t = typeAt(hx, hy);
    if (!t && z >= DETAIL && tool.t !== LINK) {
      ctx.globalAlpha = 0.35;
      drawBlock(ctx, tool.t, tool.d, toolSet[tool.t] || 0, 0, tool.t === 1 ? wireArms(hx, hy, layer, keys.alt ? SEP : 0) : 0, sx, sy, z);
      ctx.globalAlpha = 1;
    }
    if (z >= 3) {
      ctx.strokeStyle = tool.t === LINK && t ? 'rgba(255,200,70,0.8)' : 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
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
  [T.WIRE, T.CROSS, LINK],
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
    if (t === LINK) { const k = document.createElement('span'); k.className = 'key'; k.textContent = 'L'; s.appendChild(k); }
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
  tool.t = t; linkFrom = null;
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
  if (e.button === 1) { e.preventDefault(); stroke = { kind: 'pan', sx: e.clientX, sy: e.clientY, moved: 0 }; return; }
  if (pasting && clip) {
    if (e.button === 0) pasteAt(x, y); else { pasting = false; }
    return;
  }
  if (e.button === 0) {
    if (e.ctrlKey || e.metaKey) { sel = { x0: x, y0: y, x1: x, y1: y }; stroke = { kind: 'select' }; return; }
    if (tool.t === LINK) { sel = null; linkClick(x, y); return; }   // with the link tool, clicks make links
    const t = typeAt(x, y);
    if (t === T.SWITCH) { sim.toggle(x, y, layer); markSave(); return; }
    if (t === T.BUTTON) { sim.press(x, y, 1, layer); stroke = { kind: 'button', x, y, l: layer }; return; }
    sel = null;
    beginGroup();
    const sep = e.altKey && tool.t === T.WIRE;
    if (e.shiftKey) { stroke = { kind: 'line', ax: x, ay: y, bx: x, by: y, erase: false, sep }; return; }
    if (sep) { e.preventDefault(); stroke = { kind: 'place', lx: x, ly: y, sep, fresh: sepPlace(x, y), moved: false }; return; }
    placeAt(x, y, true);
    stroke = { kind: 'place', lx: x, ly: y };
  } else if (e.button === 2) {
    sel = null;
    if (linkFrom) { linkFrom = null; return; }
    if (tool.t === LINK) {   // with the link tool, right-click removes a link first
      const L = linkNearMouse();
      if (L) { beginGroup(); removeLinkU(L); endGroup(); return; }
    }
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
    stroke.moved += Math.abs(e.clientX - stroke.sx) + Math.abs(e.clientY - stroke.sy);
    cam.x -= (e.clientX - stroke.sx) / cam.z; cam.y -= (e.clientY - stroke.sy) / cam.z;
    stroke.sx = e.clientX; stroke.sy = e.clientY;
  } else if (stroke.kind === 'place' || stroke.kind === 'erase') {
    if ((x !== stroke.lx || y !== stroke.ly) && stroke.sep) {
      path4(stroke.lx, stroke.ly, x, y, (ax, ay, bx, by) => sepStep(stroke, ax, ay, bx, by));
      stroke.lx = x; stroke.ly = y;
    } else if (x !== stroke.lx || y !== stroke.ly) {
      lineCells(stroke.lx, stroke.ly, x, y, stroke.kind === 'place' ? (a, b) => placeAt(a, b, false) : eraseAt);
      stroke.lx = x; stroke.ly = y;
    }
  } else if (stroke.kind === 'line') { stroke.bx = x; stroke.by = y; }
  else if (stroke.kind === 'select') { sel.x1 = x; sel.y1 = y; }
});
addEventListener('mouseup', () => {
  if (!stroke) return;
  if (stroke.kind === 'pan' && stroke.moved < 4) pickBlock();   // middle-click without dragging = pick
  if (stroke.kind === 'button') sim.press(stroke.x, stroke.y, 0, stroke.l);
  if (stroke.kind === 'line') {
    const [ex, ey] = straightEnd(stroke);
    if (stroke.sep) {
      const st = { fresh: sepPlace(stroke.ax, stroke.ay), moved: false };
      path4(stroke.ax, stroke.ay, ex, ey, (ax, ay, bx, by) => sepStep(st, ax, ay, bx, by));
      sepFinish(st, ex, ey);
    } else lineCells(stroke.ax, stroke.ay, ex, ey, stroke.erase ? eraseAt : (a, b) => placeAt(a, b, false));
  }
  if (stroke.kind === 'place' && stroke.sep) sepFinish(stroke, stroke.lx, stroke.ly);
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
  if (k === 'alt') { e.preventDefault(); return; }
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
  else if (k === 'v') cycleVert();
  else if (k === 'e' || k === 'pageup') setLayer(layer + 1);
  else if (k === 'q' || k === 'pagedown') setLayer(layer - 1);
  else if (k === 'p') pickBlock();
  else if (k === 'x') setXray(!xray);
  else if (k === 'l') selectTool(LINK);
  else if (k === 'delete' || k === 'backspace') { if (sel) { deleteSel(); sel = null; } }
  else if (k === 'escape') { sel = null; pasting = false; linkFrom = null; insp = null; hideHelp(); $('menu').classList.remove('show'); }
  else if (k === 'h') { cam.x = 0; cam.y = 0; }
  else if (k === 'g') { gset.grid = !gset.grid; saveSettings(); syncSettingsUI(); }
  else if (k === 'i') inspectAt();
  else if (k === 'm') { muted = !muted; for (let n = 0; n < 24; n++) setVoice(n); toast(muted ? 'Buzzers muted' : 'Buzzers on'); }
  else if (/^[0-9]$/.test(k)) selectTool(HOTKEYS[(+k + 9) % 10]);
});
addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; if (e.key === 'Alt') e.preventDefault(); });
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
$('bUp').onclick = () => setLayer(layer + 1);
$('bDown').onclick = () => setLayer(layer - 1);
$('bXray').onclick = () => setXray(!xray);
$('bMenu').onclick = () => $('menu').classList.toggle('show');
$('bHelp').onclick = () => { $('menu').classList.remove('show'); toggleHelp(); };
$('help').onclick = hideHelp;
$('bNew').onclick = () => {
  $('menu').classList.remove('show');
  if (!confirm('Start a new empty world? Your current world will be gone (export it first if you want to keep it).')) return;
  world.clear(); undoStack.length = 0; redoStack.length = 0; cam.x = 0; cam.y = 0; setLayer(0); save();
};
function toggleHelp() { $('help').classList.toggle('show'); }
function hideHelp() { $('help').classList.remove('show'); }
let toastT = 0;
function toast(msg) { const el = $('toast'); el.textContent = msg; el.style.opacity = 1; toastT = 1.8; }

// ---------------------------------------------------------------- saving
const SAVE_KEY = 'bitworks-save-v1';
let saveDue = 0;
function markSave() { if (!saveDue) saveDue = 2; }
function saveText() {
  return JSON.stringify({ v: 2, cam, layer, tool, toolSet, toolVert, speedI, tick: sim.tick, chunks: BW.encodeWorld(world), links: world.links, pal: LED_COLORS.map(hexOf) });
}
function loadText(txt) {
  const s = JSON.parse(txt);
  BW.decodeWorld(world, s.chunks || [], s.links);
  if (s.cam) Object.assign(cam, s.cam);
  if (s.toolSet) Object.assign(toolSet, s.toolSet);
  if (s.toolVert !== undefined) toolVert = s.toolVert & 3;
  if (s.tool) { tool.d = s.tool.d & 3; selectTool(s.tool.t || 1); }
  if (s.speedI !== undefined) setSpeed(s.speedI);
  if (Array.isArray(s.pal)) s.pal.forEach((h, i) => { if (i < 8) setPalette(i, h); });
  setLayer(s.layer || 0);
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
setSpeed(speedI); setRunning(true); setLayer(layer); updateBoard(); syncSettingsUI(); drawIcons();

// ---------------------------------------------------------------- the inspector (panel on the right)
// It shows the settings of the NEXT block you'll place - or, after pressing I over a placed block, of THAT block
// (outlined in blue): LED color + brightness, clock speed, buzzer note, which way it faces, which layers it touches.
// Every change is one undo step. The 8 LED colors can each be changed to any color (saved with the world).
const pretty = (s) => s[0] + s.slice(1).toLowerCase();
const HAS_DIR = (t) => t >= 7 && t <= 16;
let inspSig = '';
function inspState() {
  if (insp) {
    const t = world.type(insp.x, insp.y, insp.l);
    if (t) {
      const d = world.data(insp.x, insp.y, insp.l);
      return { t, d: d & 3, set: d >> 2, v: world.vert(insp.x, insp.y, insp.l), block: true };
    }
    insp = null;   // (the block is gone)
  }
  return { t: tool.t, d: tool.d, set: toolSet[tool.t] || 0, v: toolVert, block: false };
}
function inspectAt() {
  const t = mouse.inside ? typeAt(mouse.cx, mouse.cy) : 0;
  if (!t) { insp = null; toast('Inspector: new blocks'); return; }
  insp = { x: mouse.cx, y: mouse.cy, l: layer };
  toast('Editing this ' + pretty(NAMES[t]) + ' (Esc to stop)');
}
const sigOf = (s) => [s.t, s.d, s.set, s.v, s.block, insp && insp.x, insp && insp.y, insp && insp.l, LED_COLORS.join()].join('|');
function buildInspector() {
  const s = inspState(), el = $('insp'), sig = sigOf(s);
  if (sig === inspSig) return;
  inspSig = sig;
  if (s.t === LINK) { el.style.display = 'none'; return; }
  el.style.display = '';
  let h = '<div class="ih">' + (s.block ? 'THIS BLOCK<button data-act="close" title="Stop editing it (Esc)">✕</button>' : 'NEW BLOCKS') + '</div>';
  h += '<div class="in">' + pretty(NAMES[s.t]) + '</div>';
  if (s.t === T.LED) {
    h += '<div class="il">COLOR</div><div class="sw">';
    for (let i = 0; i < 8; i++) h += `<button data-act="color" data-v="${i}" class="${(s.set & 7) === i ? 'on' : ''}" style="background:${hexOf(LED_COLORS[i])}" title="${ledName(i)}"></button>`;
    h += `</div><label class="ip">change this color <input type="color" data-act="pal" value="${hexOf(LED_COLORS[s.set & 7])}"></label>`;
    const bi = 7 - BRIGHT_ORDER.indexOf((s.set >> 3) & 7);   // the slider: left = darkest
    h += `<div class="il">BRIGHTNESS <span>${Math.round(ledBright(s.set) * 100)}%</span></div><input type="range" min="0" max="7" data-act="bright" value="${bi}">`;
  }
  if (s.t === T.CLOCK) {
    const p = s.set % PER.length;
    h += `<div class="il">SPEED <span>${settingText(T.CLOCK, p)}</span></div><input type="range" min="0" max="${PER.length - 1}" data-act="clock" value="${p}">`;
  }
  if (s.t === T.BUZZER) h += `<div class="il">NOTE <span>${settingText(T.BUZZER, s.set)}</span></div><input type="range" min="0" max="23" data-act="note" value="${s.set % 24}">`;
  if (HAS_DIR(s.t)) {
    h += '<div class="il">FACING</div><div class="seg">';
    for (let d = 0; d < 4; d++) h += `<button data-act="dir" data-v="${d}" class="${s.d === d ? 'on' : ''}">${'↑→↓←'[d]}</button>`;
    h += '</div>';
  }
  if (s.t !== T.CROSS && s.t !== T.HEX) {
    h += '<div class="il">TOUCHES LAYERS</div><div class="seg">';
    for (const [v, n] of [[3, 'both'], [1, 'below'], [2, 'above'], [0, 'none']]) h += `<button data-act="vert" data-v="${v}" class="${s.v === v ? 'on' : ''}">${n}</button>`;
    h += '</div>';
  }
  if (!s.block) h += '<div class="if">Press <b>I</b> over a placed block to edit it</div>';
  el.innerHTML = h;
}
function inspApply(act, val) {
  if (act === 'close') { insp = null; return; }
  const s = inspState();
  let d = s.d, set = s.set, v = s.v;
  if (act === 'pal') { setPalette(set & 7, val); inspSig = sigOf(inspState()); return; }
  if (act === 'color') set = (set & ~7) | val;
  else if (act === 'bright') set = (set & 7) | (BRIGHT_ORDER[7 - val] << 3);
  else if (act === 'clock' || act === 'note') set = val;
  else if (act === 'dir') d = val;
  else if (act === 'vert') v = val;
  else return;
  if (s.block) {
    const old = world.data(insp.x, insp.y, insp.l);
    beginGroup();
    doSet(insp.x, insp.y, insp.l, s.t, act === 'vert' ? old : (d & 3) | (set << 2), world.st(insp.x, insp.y, insp.l), v);
    endGroup();
  } else {
    tool.d = d; toolVert = v;
    if (SETTINGS[s.t]) toolSet[s.t] = set;
    drawIcons();
  }
}
function inspLabel(input) {   // a slider moved: just update the number above it (rebuilding would stop the drag)
  const lab = input.previousElementSibling && input.previousElementSibling.querySelector && input.previousElementSibling.querySelector('span');
  const s = inspState();
  if (lab) lab.textContent = input.dataset.act === 'bright' ? Math.round(ledBright(s.set) * 100) + '%' : settingText(s.t, s.set);
}
$('insp').onclick = (e) => {
  const a = e.target.dataset && e.target.dataset.act;
  if (a && e.target.tagName === 'BUTTON') inspApply(a, +e.target.dataset.v);
};
$('insp').oninput = (e) => {
  const a = e.target.dataset && e.target.dataset.act;
  if (!a) return;
  inspApply(a, a === 'pal' ? e.target.value : +e.target.value);
  if (a !== 'pal') { inspLabel(e.target); inspSig = sigOf(inspState()); }
};
// (let go of a slider: give the keyboard back to the game, so WASD and the hotkeys work again)
$('insp').onchange = (e) => { if (e.target.blur) e.target.blur(); };

// ---------------------------------------------------------------- global settings (☰ → Settings)
function syncSettingsUI() {
  const box = $('gset');
  const inputs = box.querySelectorAll ? box.querySelectorAll('input') : [];
  for (const el of inputs) {
    const k = el.dataset.g;
    if (k === 'grid') el.checked = gset.grid;
    else el.value = Math.round(gset[k] * 100);
  }
}
$('bSettings').onclick = () => $('gset').classList.toggle('show');
$('gset').oninput = (e) => {
  const k = e.target.dataset && e.target.dataset.g;
  if (!k) return;
  if (k === 'grid') gset.grid = e.target.checked;
  else gset[k] = +e.target.value / 100;
  if (k === 'dark') updateBoard();
  if (k === 'volume' && master) master.gain.value = 0.24 * gset.volume;
  saveSettings();
};
$('gset').onchange = (e) => { if (e.target.blur) e.target.blur(); };

// ---------------------------------------------------------------- the hint line above the dock
function hintText() {
  if (pasting) return '<b>Pasting</b> (all layers) — click to place · R rotates · Esc cancels';
  if (linkFrom) return '<b>Link</b> — now click the block that should receive it (switch layers with Q/E) · Esc cancels';
  if (sel && !stroke) return '<b>Selected</b> (all layers) — Ctrl C copy · Ctrl X cut · Del delete · Esc cancel';
  if (keys.alt && tool.t === T.WIRE) return '<b>Separate wire</b> — only connects to the cells you drag through';
  let t, set, v = toolVert, placed = false;
  if (dockHover) { t = dockHover; set = toolSet[t] || 0; }
  else if (mouse.inside && typeAt(mouse.cx, mouse.cy) && tool.t !== LINK) {
    t = typeAt(mouse.cx, mouse.cy); set = world.data(mouse.cx, mouse.cy, layer) >> 2; v = world.vert(mouse.cx, mouse.cy, layer); placed = true;
  } else { t = tool.t; set = toolSet[t] || 0; }
  if (t === LINK) return '<b>Link</b> — ' + DESC[LINK] + ' Right-click a link to remove it.';
  const s = settingText(t, set);
  let h = `<b>${NAMES[t][0] + NAMES[t].slice(1).toLowerCase()}</b>${s ? ' (' + s + ')' : ''} — ${DESC[t]}`;
  if (t === T.LED) h += ' · F color · B brightness';
  else if (SETTINGS[t]) h += ' · F to change';
  if (placed) h += ' · I to edit';
  if (placed || v !== 3) h += ` · touches ${VNAME[v]} (V)`;
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
      $('stats').innerHTML = `${tpsShown} ticks/s · tick ${sim.tick}<br>${sim.nComp} parts · ${sim.nNets} wires · ${world.links.length} links<br>${world.chunks.size} chunks`;
  }

  render();

  $('coords').textContent = `${mouse.cx}, ${mouse.cy}`;
  buildInspector();
  const h = hintText();
  if (h !== lastHint) { $('hint').innerHTML = h; lastHint = h; }

  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').style.opacity = 0; }
  if (saveDue) { saveDue -= dt; if (saveDue <= 0) save(); }
  saveTimer += dt;
  if (saveTimer > 30) { saveTimer = 0; save(); }   // also keeps switch/memory states
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
