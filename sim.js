// BITWORKS — world storage + circuit simulation (no drawing in here, so it can be tested in Node).
(function (root) {
'use strict';

// The map is split into CHUNKS of 64x64 cells. Only chunks that contain something exist,
// so an empty map costs nothing no matter how big it is.
const CS = 64, CSH = 6, CM = 63, CN = CS * CS;
const LIM = 1 << 20;                    // map goes from -1,048,576 to +1,048,575 in both directions
const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];   // sides: 0 up, 1 right, 2 down, 3 left

const T = {
  EMPTY: 0, WIRE: 1, CROSS: 2,
  SWITCH: 3, BUTTON: 4, CLOCK: 5, CONST: 6,
  NOT: 7, AND: 8, OR: 9, XOR: 10, NAND: 11, NOR: 12, XNOR: 13, DIODE: 14,
  TFF: 15, DFF: 16,
  LED: 17, HEX: 18, BUZZER: 19,
};
const NAMES = ['', 'WIRE', 'CROSSING', 'SWITCH', 'BUTTON', 'CLOCK', 'ALWAYS ON',
  'NOT', 'AND', 'OR', 'XOR', 'NAND', 'NOR', 'XNOR', 'DIODE', 'T FLIP-FLOP', 'D FLIP-FLOP',
  'LED', 'HEX DISPLAY', 'BUZZER'];
// clock: ticks between flips
const PER = [1, 2, 3, 5, 8, 10, 15, 20, 30, 50, 100];
const SETTINGS = { 5: PER.length, 17: 8, 19: 24 };   // how many settings clock / LED / buzzer have

// Which sides send a signal out / read a signal in. d = the direction the block faces.
function outMask(t, d) {
  if (t >= 3 && t <= 6) return 15;               // inputs power every side
  if (t >= 7 && t <= 16) return 1 << d;          // gates + flip-flops: out the front
  return 0;
}
function inMask(t, d) {
  const back = 1 << ((d + 2) & 3);
  if (t === T.NOT || t === T.DIODE || t === T.TFF) return back;
  if ((t >= 8 && t <= 13) || t === T.DFF) return 15 & ~(1 << d);   // back + both sides
  if (t >= 17) return 15;
  return 0;
}
function hasPort(t, d, s) {
  if (t === T.WIRE || t === T.CROSS) return 1;
  return ((outMask(t, d) | inMask(t, d)) >> s) & 1;
}

function ckey(cx, cy) { return (cx + 32768) * 65536 + (cy + 32768); }

class Chunk {
  constructor(cx, cy, key) {
    this.cx = cx; this.cy = cy; this.key = key;
    this.type = new Uint8Array(CN);   // what block
    this.data = new Uint8Array(CN);   // bits 0-1 direction, bits 2-7 setting
    this.st = new Uint8Array(CN);     // live state (on/off, flip-flop memory, hex value)
    this.net = new Int32Array(CN).fill(-1);   // wire -> net number, part -> part number
    this.netV = null;                 // second net for crossings (the up/down one)
    this.count = 0; this.dirty = true;
  }
}

class World {
  constructor() { this.chunks = new Map(); this.ver = 0; }
  ch(cx, cy) { return this.chunks.get(ckey(cx, cy)); }
  type(x, y) {
    const c = this.chunks.get(ckey(x >> CSH, y >> CSH));
    return c ? c.type[((y & CM) << CSH) | (x & CM)] : 0;
  }
  data(x, y) {
    const c = this.chunks.get(ckey(x >> CSH, y >> CSH));
    return c ? c.data[((y & CM) << CSH) | (x & CM)] : 0;
  }
  st(x, y) {
    const c = this.chunks.get(ckey(x >> CSH, y >> CSH));
    return c ? c.st[((y & CM) << CSH) | (x & CM)] : 0;
  }
  // returns the old [type, data, st], or null if nothing changed
  set(x, y, t, data, st) {
    if (x < -LIM || x >= LIM || y < -LIM || y >= LIM) return null;
    const cx = x >> CSH, cy = y >> CSH, k = ckey(cx, cy);
    let c = this.chunks.get(k);
    if (!c) { if (!t) return null; c = new Chunk(cx, cy, k); this.chunks.set(k, c); }
    const i = ((y & CM) << CSH) | (x & CM);
    const ot = c.type[i], od = c.data[i], os = c.st[i];
    if (!t) { data = 0; st = 0; }
    if (ot === t && od === data && os === st) return null;
    if (ot && !t) c.count--; else if (!ot && t) c.count++;
    c.type[i] = t; c.data[i] = data; c.st[i] = st;
    c.net[i] = -1; if (c.netV) c.netV[i] = -1;
    c.dirty = true;
    if (!c.count) this.chunks.delete(k);
    this.ver++;
    return [ot, od, os];
  }
  clear() { this.chunks.clear(); this.ver++; }
}

// ---------------------------------------------------------------------------------------------
// The simulation. "compile" turns the blocks into a graph:
//   NET  = a group of connected wires (one on/off value for the whole group)
//   PART = every block that isn't a wire (gates, switches, LEDs...)
// Then each tick only the parts whose input nets CHANGED get recalculated (event-driven),
// so a giant computer that is sitting still costs almost nothing.
class Sim {
  constructor(world) {
    this.w = world; this.ver = -1; this.tick = 0;
    this.nNets = 0; this.nComp = 0; this.netOn = new Int32Array(0);
    this.onBuzz = null; this.onBuzzReset = null;
    this.compileMs = 0;
  }

  compile() {
    const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
    const w = this.w;
    const chunks = [...w.chunks.values()];
    let total = 0;
    for (const c of chunks) total += c.count;

    const compT = new Uint8Array(total), compD = new Uint8Array(total), compSet = new Uint8Array(total);
    const compCh = new Array(total), compI = new Uint16Array(total), compSt = new Uint8Array(total);
    const compOut = new Int32Array(total);
    let nn = 0, nc = 0;

    // pass 1: give every wire (and every part output) a node number
    for (let ci = 0; ci < chunks.length; ci++) {
      const c = chunks[ci], ty = c.type, net = c.net;
      c.ci = ci; c.dirty = true;
      for (let i = 0; i < CN; i++) {
        const t = ty[i];
        if (!t) continue;
        if (t === 1) net[i] = nn++;
        else if (t === 2) {
          if (!c.netV) c.netV = new Int32Array(CN).fill(-1);
          net[i] = nn++; c.netV[i] = nn++;
        } else {
          const d = c.data[i] & 3;
          compT[nc] = t; compD[nc] = d; compSet[nc] = c.data[i] >> 2;
          compCh[nc] = c; compI[nc] = i; compSt[nc] = c.st[i];
          compOut[nc] = outMask(t, d) ? nn++ : -1;
          net[i] = nc++;
        }
      }
    }

    // which node does cell i of chunk c offer on side s? (-1 = none)
    const portNode = (c, i, s) => {
      const t = c.type[i];
      if (!t) return -1;
      if (t === 1) return c.net[i];
      if (t === 2) return (s & 1) ? c.net[i] : c.netV[i];
      const k = c.net[i];
      return (compOut[k] >= 0 && ((outMask(t, c.data[i] & 3) >> s) & 1)) ? compOut[k] : -1;
    };

    // pass 2: join touching nodes together (union-find)
    const par = new Int32Array(nn);
    for (let i = 0; i < nn; i++) par[i] = i;
    const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
    const union = (a, b) => { a = find(a); b = find(b); if (a !== b) par[a] = b; };
    for (const c of chunks) {
      const ce = w.ch(c.cx + 1, c.cy), cs = w.ch(c.cx, c.cy + 1), ty = c.type;
      for (let i = 0; i < CN; i++) {
        if (!ty[i]) continue;
        const x = i & CM, y = i >> CSH;
        let a = portNode(c, i, 1);
        if (a >= 0) {
          const b = x < CM ? portNode(c, i + 1, 3) : (ce ? portNode(ce, i - CM, 3) : -1);
          if (b >= 0) union(a, b);
        }
        a = portNode(c, i, 2);
        if (a >= 0) {
          const b = y < CM ? portNode(c, i + CS, 0) : (cs ? portNode(cs, x, 0) : -1);
          if (b >= 0) union(a, b);
        }
      }
    }

    // pass 3: number the groups 0,1,2... -> those are the nets
    const netOf = new Int32Array(nn).fill(-1);
    let nNets = 0;
    for (let n = 0; n < nn; n++) {
      const r = find(n);
      if (netOf[r] < 0) netOf[r] = nNets++;
      netOf[n] = netOf[r];
    }

    // pass 4: what net does each part read on each side?
    const compIn = new Int32Array(nc * 4).fill(-1);
    for (let k = 0; k < nc; k++) {
      const im = inMask(compT[k], compD[k]);
      if (!im) continue;
      const c = compCh[k], i = compI[k];
      const x = c.cx * CS + (i & CM), y = c.cy * CS + (i >> CSH);
      for (let s = 0; s < 4; s++) {
        if (!((im >> s) & 1)) continue;
        const nx = x + DX[s], ny = y + DY[s];
        const c2 = (nx >> CSH) === c.cx && (ny >> CSH) === c.cy ? c : w.ch(nx >> CSH, ny >> CSH);
        if (!c2) continue;
        const node = portNode(c2, ((ny & CM) << CSH) | (nx & CM), (s + 2) & 3);
        if (node >= 0) compIn[k * 4 + s] = netOf[node];
      }
    }

    // pass 5: rewrite wire cells to their net numbers (the renderer uses these)
    for (const c of chunks) {
      const ty = c.type, net = c.net, nv = c.netV;
      for (let i = 0; i < CN; i++) {
        const t = ty[i];
        if (t === 1) net[i] = netOf[net[i]];
        else if (t === 2) { net[i] = netOf[net[i]]; nv[i] = netOf[nv[i]]; }
      }
    }
    for (let k = 0; k < nc; k++) if (compOut[k] >= 0) compOut[k] = netOf[compOut[k]];

    // readers of each net, packed into one array (rdOff[n]..rdOff[n+1])
    const rdOff = new Int32Array(nNets + 1);
    const dup = (k, s, n) => { for (let q = 0; q < s; q++) if (compIn[k * 4 + q] === n) return true; return false; };
    for (let k = 0; k < nc; k++) for (let s = 0; s < 4; s++) {
      const n = compIn[k * 4 + s];
      if (n >= 0 && !dup(k, s, n)) rdOff[n + 1]++;
    }
    for (let n = 0; n < nNets; n++) rdOff[n + 1] += rdOff[n];
    const rdList = new Int32Array(rdOff[nNets]), fill = rdOff.slice(0, nNets);
    for (let k = 0; k < nc; k++) for (let s = 0; s < 4; s++) {
      const n = compIn[k * 4 + s];
      if (n >= 0 && !dup(k, s, n)) rdList[fill[n]++] = k;
    }

    // which chunks each net passes through (so we only repaint those when it changes)
    const last = new Int32Array(nNets).fill(-1), ncOff = new Int32Array(nNets + 1);
    const walk = (cb) => {
      last.fill(-1);
      for (let ci = 0; ci < chunks.length; ci++) {
        const c = chunks[ci], ty = c.type;
        for (let i = 0; i < CN; i++) {
          const t = ty[i];
          if (t !== 1 && t !== 2) continue;
          let n = c.net[i];
          if (last[n] !== ci) { last[n] = ci; cb(n, ci); }
          if (t === 2) { n = c.netV[i]; if (last[n] !== ci) { last[n] = ci; cb(n, ci); } }
        }
      }
    };
    walk((n) => ncOff[n + 1]++);
    for (let n = 0; n < nNets; n++) ncOff[n + 1] += ncOff[n];
    const ncList = new Int32Array(ncOff[nNets]), nfill = ncOff.slice(0, nNets);
    walk((n, ci) => { ncList[nfill[n]++] = ci; });

    // starting values: keep the old states so editing doesn't reset a running computer
    const netOn = new Int32Array(nNets);
    const clocks = [];
    const buzz = new Int32Array(24);
    for (let k = 0; k < nc; k++) {
      if (compOut[k] >= 0 && (compSt[k] & 1)) netOn[compOut[k]]++;
      if (compT[k] === T.CLOCK) clocks.push(k);
      if (compT[k] === T.BUZZER && (compSt[k] & 1)) buzz[compSet[k] % 24]++;
    }

    Object.assign(this, {
      chunkArr: chunks, nNets, nComp: nc, compT, compD, compSet, compCh, compI, compSt, compOut, compIn,
      rdOff, rdList, ncOff, ncList, netOn, clocks: Int32Array.from(clocks), buzz,
      q: new Int32Array(nc), q2: new Int32Array(nc), qLen: 0, inQ: new Uint8Array(nc),
    });
    // everything gets checked once after a rebuild
    for (let k = 0; k < nc; k++) { this.q[k] = k; this.inQ[k] = 1; }
    this.qLen = nc;
    this.ver = w.ver;
    if (this.onBuzzReset) this.onBuzzReset(buzz);
    this.compileMs = (typeof performance !== 'undefined' ? performance : Date).now() - t0;
  }

  // work out what part k should be now
  eval(k) {
    const t = this.compT[k], st = this.compSt[k];
    if (t <= T.CLOCK) return st;          // switch / button / clock: changed from outside
    if (t === T.CONST) return 1;
    const b = k * 4, ci = this.compIn, on_ = this.netOn;
    let on = 0, cnt = 0;
    for (let s = 0; s < 4; s++) {
      const n = ci[b + s];
      if (n >= 0) { cnt++; if (on_[n]) on++; }
    }
    switch (t) {
      case T.NOT: case T.NOR: return on ? 0 : 1;
      case T.AND: return cnt && on === cnt ? 1 : 0;
      case T.NAND: return cnt && on === cnt ? 0 : 1;
      case T.OR: case T.DIODE: case T.LED: case T.BUZZER: return on ? 1 : 0;
      case T.XOR: return on & 1;
      case T.XNOR: return (on & 1) ^ 1;
      case T.TFF: {                       // flips on the moment the input turns on
        const inp = on ? 1 : 0, prev = (st >> 1) & 1;
        let q = st & 1;
        if (inp && !prev) q ^= 1;
        return q | (inp << 1);
      }
      case T.DFF: {                       // back = clock, sides = data
        const bn = ci[b + ((this.compD[k] + 2) & 3)];
        const clk = bn >= 0 && on_[bn] ? 1 : 0;
        const data = on - clk > 0 ? 1 : 0;
        let q = st & 1;
        if (clk && !((st >> 1) & 1)) q = data;
        return q | (clk << 1);
      }
      case T.HEX: {
        let v = 0;
        for (let s = 0; s < 4; s++) { const n = ci[b + s]; if (n >= 0 && on_[n]) v |= 1 << s; }
        return v;
      }
    }
    return st;
  }

  apply(k, v) {
    const o = this.compSt[k];
    if (o === v) return;
    this.compSt[k] = v;
    const c = this.compCh[k];
    c.st[this.compI[k]] = v; c.dirty = true;
    if ((o ^ v) & 1) {
      const out = this.compOut[k];
      if (out >= 0) {
        const before = this.netOn[out];
        this.netOn[out] += (v & 1) ? 1 : -1;
        if ((before === 0) !== (this.netOn[out] === 0)) this.netChanged(out);
      }
      if (this.compT[k] === T.BUZZER && this.onBuzz) this.onBuzz(this.compSet[k] % 24, (v & 1) ? 1 : -1);
    }
  }

  netChanged(n) {
    const rl = this.rdList, inQ = this.inQ, q = this.q;
    for (let j = this.rdOff[n], e = this.rdOff[n + 1]; j < e; j++) {
      const r = rl[j];
      if (!inQ[r]) { inQ[r] = 1; q[this.qLen++] = r; }
    }
    const ca = this.chunkArr, nl = this.ncList;
    for (let j = this.ncOff[n], e = this.ncOff[n + 1]; j < e; j++) ca[nl[j]].dirty = true;
  }

  step() {
    if (this.ver !== this.w.ver) this.compile();
    const tick = ++this.tick;
    // 1. work out every change first (using the OLD values)...
    const cur = this.q, len = this.qLen;
    this.q = this.q2; this.q2 = cur; this.qLen = 0;
    const chK = this._chK || (this._chK = []), chV = this._chV || (this._chV = []);
    let nch = 0;
    for (let j = 0; j < len; j++) {
      const k = cur[j];
      this.inQ[k] = 0;
      const v = this.eval(k);
      if (v !== this.compSt[k]) { chK[nch] = k; chV[nch] = v; nch++; }
    }
    const cl = this.clocks;
    for (let j = 0; j < cl.length; j++) {
      const k = cl[j];
      if (tick % PER[this.compSet[k] % PER.length] === 0) { chK[nch] = k; chV[nch] = this.compSt[k] ^ 1; nch++; }
    }
    // 2. ...then apply them all at once. That's what makes every gate take exactly 1 tick.
    for (let j = 0; j < nch; j++) this.apply(chK[j], chV[j]);
    return nch;
  }

  partAt(x, y) {
    if (this.ver !== this.w.ver) this.compile();
    const c = this.w.ch(x >> CSH, y >> CSH);
    if (!c) return -1;
    const i = ((y & CM) << CSH) | (x & CM);
    return c.type[i] >= 3 ? c.net[i] : -1;
  }
  toggle(x, y) {
    const k = this.partAt(x, y);
    if (k >= 0 && this.compT[k] === T.SWITCH) this.apply(k, this.compSt[k] ^ 1);
  }
  press(x, y, v) {
    const k = this.partAt(x, y);
    if (k >= 0 && this.compT[k] === T.BUTTON) this.apply(k, v ? 1 : 0);
  }
  netIsOn(n) { return n >= 0 && n < this.nNets && this.netOn[n] > 0; }
}

// ---------------------------------------------------------------------------------------------
// Saving: each chunk becomes runs of [count, type, data, state] bytes, then base64 text.
function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return typeof btoa !== 'undefined' ? btoa(s) : Buffer.from(s, 'binary').toString('base64');
}
function unb64(str) {
  const s = typeof atob !== 'undefined' ? atob(str) : Buffer.from(str, 'base64').toString('binary');
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}
function encodeWorld(w) {
  const out = [];
  const buf = new Uint8Array(CN * 4);
  for (const c of w.chunks.values()) {
    let p = 0, i = 0;
    while (i < CN) {
      const t = c.type[i], d = c.data[i], s = c.st[i];
      let run = 1;
      while (i + run < CN && run < 255 && c.type[i + run] === t && c.data[i + run] === d && c.st[i + run] === s) run++;
      buf[p++] = run; buf[p++] = t; buf[p++] = d; buf[p++] = s;
      i += run;
    }
    out.push([c.cx, c.cy, b64(buf.subarray(0, p))]);
  }
  return out;
}
function decodeWorld(w, list) {
  w.clear();
  for (const [cx, cy, str] of list) {
    const b = unb64(str);
    const k = ckey(cx, cy), c = new Chunk(cx, cy, k);
    let i = 0;
    for (let p = 0; p + 3 < b.length && i < CN; p += 4) {
      for (let r = 0; r < b[p] && i < CN; r++, i++) {
        c.type[i] = b[p + 1]; c.data[i] = b[p + 2]; c.st[i] = b[p + 3];
        if (b[p + 1]) c.count++;
      }
    }
    if (c.count) w.chunks.set(k, c);
  }
  w.ver++;
}

// The little demo on a brand new map.
function buildDemo(w) {
  const put = (x, y, t, d = 1, set = 0) => w.set(x, y, t, d | (set << 2), 0);
  const wire = (x0, y0, x1, y1) => {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) put(x, y, T.WIRE);
  };
  // 1. switch -> NOT -> LED  (and a second LED straight from the switch)
  put(0, 0, T.SWITCH); wire(1, 0, 2, 0); put(3, 0, T.NOT, 1); wire(4, 0, 4, 0); put(5, 0, T.LED, 1, 0);
  wire(2, 1, 2, 1); put(2, 2, T.LED, 1, 1);
  // 2. clock -> LED
  put(0, 5, T.CLOCK, 1, 4); wire(1, 5, 3, 5); put(4, 5, T.LED, 1, 3);
  // 3. a 4-bit counter: clock -> T flip-flops, NOT gates in between make it count UP
  put(0, 9, T.CLOCK, 1, 4);
  for (let b = 0; b < 4; b++) {
    const x = 1 + b * 3;
    put(x, 9, T.TFF, 1);
    wire(x + 1, 9, x + 1, 10);
    put(x + 1, 11, T.LED, 1, 2);
    if (b < 3) put(x + 2, 9, T.NOT, 1);
  }
  // 4. hex display with a switch on each side (top=1 right=2 bottom=4 left=8)
  put(16, 1, T.HEX); put(16, 0, T.SWITCH); put(17, 1, T.SWITCH); put(16, 2, T.SWITCH); put(15, 1, T.SWITCH);
  // 5. two wires crossing without touching
  put(15, 5, T.SWITCH); wire(16, 5, 16, 5); put(17, 5, T.CROSS); wire(18, 5, 18, 5); put(19, 5, T.LED, 1, 4);
  put(17, 3, T.SWITCH); wire(17, 4, 17, 4); wire(17, 6, 17, 6); put(17, 7, T.LED, 1, 5);
}

const BW = { CS, CSH, CM, CN, LIM, DX, DY, T, NAMES, PER, SETTINGS,
  outMask, inMask, hasPort, World, Sim, encodeWorld, decodeWorld, buildDemo };
if (typeof module !== 'undefined' && module.exports) module.exports = BW;
root.BW = BW;
})(typeof window !== 'undefined' ? window : globalThis);
