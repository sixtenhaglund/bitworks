// BITWORKS — world storage + circuit simulation (no drawing in here, so it can be tested in Node).
(function (root) {
'use strict';

// The map is split into CHUNKS of 64x64 cells. Only chunks that contain something exist,
// so an empty map costs nothing no matter how big it is. Every layer has its own chunks.
const CS = 64, CSH = 6, CM = 63, CN = CS * CS;
const LIM = 1 << 20;                    // map goes from -1,048,576 to +1,048,575 in both directions
const NL = 16;                          // layers 0..15
const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
// sides: 0 up, 1 right, 2 down, 3 left (on the map), 4 = layer below, 5 = layer above
const opp = (s) => (s < 4 ? (s + 2) & 3 : 9 - s);

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
const UPDOWN = 48;   // the two layer sides (4 and 5) as a bitmask

// Which sides send a signal out / read a signal in. d = the direction the block faces.
function outMask(t, d) {
  if (t >= 3 && t <= 6) return 63;               // inputs power every side, and the layers above/below
  if (t >= 7 && t <= 16) return 1 << d;          // gates + flip-flops: out the front
  return 0;
}
function inMask(t, d) {
  const back = 1 << ((d + 2) & 3);
  if (t === T.NOT || t === T.DIODE || t === T.TFF) return back | UPDOWN;
  if ((t >= 8 && t <= 13) || t === T.DFF) return (15 & ~(1 << d)) | UPDOWN;   // back + both sides
  if (t === T.LED || t === T.BUZZER) return 63;
  if (t === T.HEX) return 15;
  return 0;
}
// data = the whole settings byte. A "separate" wire (bit 6 set) only connects on the
// sides switched on in bits 2-5; a normal wire connects everywhere. (Flat sides 0-3 only.)
function hasPort(t, data, s) {
  if (t === T.WIRE) return (data & 64) ? (data >> (2 + s)) & 1 : 1;
  if (t === T.CROSS) return 1;
  const d = data & 3;
  return ((outMask(t, d) | inMask(t, d)) >> s) & 1;
}
// what a link can start at (it sends) / end at (it receives)
const canSend = (t) => t === T.WIRE || (t >= 3 && t <= 16);
const canRecv = (t) => t === T.WIRE || (t >= 7 && t <= 17) || t === T.BUZZER;

function ckey(cx, cy, l) { return ((l * 65536) + (cx + 32768)) * 65536 + (cy + 32768); }

class Chunk {
  constructor(cx, cy, l, key) {
    this.cx = cx; this.cy = cy; this.l = l; this.key = key;
    this.type = new Uint8Array(CN);   // what block
    this.data = new Uint8Array(CN);   // bits 0-1 direction, bits 2-7 setting
    this.st = new Uint8Array(CN);     // live state (on/off, flip-flop memory, hex value)
    this.vert = new Uint8Array(CN);   // bit 0 = touches the layer below, bit 1 = touches the layer above
    this.net = new Int32Array(CN).fill(-1);   // wire -> net number, part -> part number
    this.netV = null;                 // second net for crossings (the up/down one)
    this.count = 0; this.dirty = true;
  }
}

class World {
  constructor() { this.chunks = new Map(); this.links = []; this.ver = 0; }
  ch(cx, cy, l = 0) { return this.chunks.get(ckey(cx, cy, l)); }
  _get(arr, x, y, l) {
    const c = this.chunks.get(ckey(x >> CSH, y >> CSH, l));
    return c ? c[arr][((y & CM) << CSH) | (x & CM)] : 0;
  }
  type(x, y, l = 0) { return this._get('type', x, y, l); }
  data(x, y, l = 0) { return this._get('data', x, y, l); }
  st(x, y, l = 0) { return this._get('st', x, y, l); }
  vert(x, y, l = 0) { return this._get('vert', x, y, l); }
  // returns the old [type, data, st, vert] (+ .links it broke), or null if nothing changed
  set(x, y, t, data, st, l = 0, vert = 3) {
    if (x < -LIM || x >= LIM || y < -LIM || y >= LIM || l < 0 || l >= NL) return null;
    const cx = x >> CSH, cy = y >> CSH, k = ckey(cx, cy, l);
    let c = this.chunks.get(k);
    if (!c) { if (!t) return null; c = new Chunk(cx, cy, l, k); this.chunks.set(k, c); }
    const i = ((y & CM) << CSH) | (x & CM);
    const ot = c.type[i], od = c.data[i], os = c.st[i], ov = c.vert[i];
    if (!t) { data = 0; st = 0; vert = 0; }
    if (ot === t && od === data && os === st && ov === vert) return null;
    if (ot && !t) c.count--; else if (!ot && t) c.count++;
    c.type[i] = t; c.data[i] = data; c.st[i] = st; c.vert[i] = vert;
    c.net[i] = -1; if (c.netV) c.netV[i] = -1;
    c.dirty = true;
    if (!c.count) this.chunks.delete(k);
    this.ver++;
    const old = [ot, od, os, ov];
    if (ot && ot !== t && this.links.length) {   // a block that changed kind loses its links
      const gone = this.unlinkCell(x, y, l);
      if (gone.length) old.links = gone;
    }
    return old;
  }
  // a link is [fromX, fromY, fromLayer, toX, toY, toLayer]
  unlinkCell(x, y, l) {
    const gone = [];
    this.links = this.links.filter((L) => {
      const hit = (L[0] === x && L[1] === y && L[2] === l) || (L[3] === x && L[4] === y && L[5] === l);
      if (hit) gone.push(L);
      return !hit;
    });
    if (gone.length) this.ver++;
    return gone;
  }
  addLink(L) { this.links.push(L); this.ver++; }
  removeLink(L) {
    const i = this.links.indexOf(L);
    if (i < 0) return false;
    this.links.splice(i, 1); this.ver++; return true;
  }
  clear() { this.chunks.clear(); this.links = []; this.ver++; }
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
    this.linkNet = new Int32Array(0); this.linkOk = new Uint8Array(0);
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
      if (s >= 4 && !((c.vert[i] >> (s - 4)) & 1)) return -1;   // this block doesn't touch that layer
      if (t === 1) { const d = c.data[i]; return s < 4 && (d & 64) && !((d >> (2 + s)) & 1) ? -1 : c.net[i]; }
      if (t === 2) return s >= 4 ? -1 : (s & 1) ? c.net[i] : c.netV[i];
      const k = c.net[i];
      return (compOut[k] >= 0 && ((outMask(t, c.data[i] & 3) >> s) & 1)) ? compOut[k] : -1;
    };

    // pass 2: join touching nodes together (union-find).
    // Things only join through wires: two switches side by side (or on top of each other) stay separate.
    const par = new Int32Array(nn);
    for (let i = 0; i < nn; i++) par[i] = i;
    const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
    const union = (a, b) => { a = find(a); b = find(b); if (a !== b) par[a] = b; };
    for (const c of chunks) {
      const ce = w.ch(c.cx + 1, c.cy, c.l), cs = w.ch(c.cx, c.cy + 1, c.l), cu = w.ch(c.cx, c.cy, c.l + 1), ty = c.type;
      for (let i = 0; i < CN; i++) {
        if (!ty[i]) continue;
        const x = i & CM, y = i >> CSH, aw = ty[i] <= 2;
        let a = portNode(c, i, 1);
        if (a >= 0) {
          const b = x < CM ? portNode(c, i + 1, 3) : (ce ? portNode(ce, i - CM, 3) : -1);
          if (b >= 0 && (aw || (x < CM ? ty[i + 1] : ce.type[i - CM]) <= 2)) union(a, b);
        }
        a = portNode(c, i, 2);
        if (a >= 0) {
          const b = y < CM ? portNode(c, i + CS, 0) : (cs ? portNode(cs, x, 0) : -1);
          if (b >= 0 && (aw || (y < CM ? ty[i + CS] : cs.type[x]) <= 2)) union(a, b);
        }
        if (cu) {
          a = portNode(c, i, 5);
          if (a >= 0) {
            const b = portNode(cu, i, 4);
            if (b >= 0 && (aw || cu.type[i] <= 2)) union(a, b);
          }
        }
      }
    }

    // links: each one joins exactly two blocks, any distance apart
    const links = w.links, nL = links.length;
    const linkFrom = new Int32Array(nL).fill(-1), linkOk = new Uint8Array(nL);
    const exK = [], exN = [];   // extra inputs that come from links: part k reads node n
    const cellOf = (x, y, l) => {
      const c = w.ch(x >> CSH, y >> CSH, l);
      return c ? [c, ((y & CM) << CSH) | (x & CM)] : null;
    };
    for (let j = 0; j < nL; j++) {
      const L = links[j], A = cellOf(L[0], L[1], L[2]), B = cellOf(L[3], L[4], L[5]);
      if (!A || !B) continue;
      const ta = A[0].type[A[1]], tb = B[0].type[B[1]];
      if (!ta || !tb) continue;
      const from = ta === 1 ? A[0].net[A[1]] : ta >= 3 ? compOut[A[0].net[A[1]]] : -1;
      if (from < 0) continue;
      if (tb === 1) { union(from, B[0].net[B[1]]); linkOk[j] = 1; }
      else if (canRecv(tb)) { exK.push(B[0].net[B[1]]); exN.push(from); linkOk[j] = 1; }
      linkFrom[j] = from;
    }

    // pass 3: number the groups 0,1,2... -> those are the nets
    const netOf = new Int32Array(nn).fill(-1);
    let nNets = 0;
    for (let n = 0; n < nn; n++) {
      const r = find(n);
      if (netOf[r] < 0) netOf[r] = nNets++;
      netOf[n] = netOf[r];
    }

    // pass 4: what net does each part read on each of its 6 sides?
    const compIn = new Int32Array(nc * 6).fill(-1);
    for (let k = 0; k < nc; k++) {
      const im = inMask(compT[k], compD[k]);
      if (!im) continue;
      const c = compCh[k], i = compI[k];
      const x = c.cx * CS + (i & CM), y = c.cy * CS + (i >> CSH);
      for (let s = 0; s < 6; s++) {
        if (!((im >> s) & 1)) continue;
        let c2, ni;
        if (s < 4) {
          const nx = x + DX[s], ny = y + DY[s];
          c2 = (nx >> CSH) === c.cx && (ny >> CSH) === c.cy ? c : w.ch(nx >> CSH, ny >> CSH, c.l);
          ni = ((ny & CM) << CSH) | (nx & CM);
        } else {
          if (!((c.vert[i] >> (s - 4)) & 1)) continue;
          c2 = w.ch(c.cx, c.cy, c.l + (s === 5 ? 1 : -1)); ni = i;
        }
        if (!c2) continue;
        const node = portNode(c2, ni, opp(s));
        if (node >= 0) compIn[k * 6 + s] = netOf[node];
      }
    }
    // extra (link) inputs, packed per part: exOff[k]..exOff[k+1]
    const exOff = new Int32Array(nc + 1);
    for (const k of exK) exOff[k + 1]++;
    for (let k = 0; k < nc; k++) exOff[k + 1] += exOff[k];
    const exList = new Int32Array(exK.length), exFill = exOff.slice(0, nc);
    for (let j = 0; j < exK.length; j++) exList[exFill[exK[j]]++] = netOf[exN[j]];

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
    const linkNet = new Int32Array(nL);
    for (let j = 0; j < nL; j++) linkNet[j] = linkFrom[j] >= 0 ? netOf[linkFrom[j]] : -1;

    // readers of each net, packed into one array (rdOff[n]..rdOff[n+1]); each part listed once per net
    const rdOff = new Int32Array(nNets + 1);
    const tmp = [];
    const eachInput = (k, cb) => {
      tmp.length = 0;
      for (let s = 0; s < 6; s++) { const n = compIn[k * 6 + s]; if (n >= 0 && !tmp.includes(n)) { tmp.push(n); cb(n); } }
      for (let j = exOff[k]; j < exOff[k + 1]; j++) { const n = exList[j]; if (!tmp.includes(n)) { tmp.push(n); cb(n); } }
    };
    for (let k = 0; k < nc; k++) eachInput(k, (n) => rdOff[n + 1]++);
    for (let n = 0; n < nNets; n++) rdOff[n + 1] += rdOff[n];
    const rdList = new Int32Array(rdOff[nNets]), fill = rdOff.slice(0, nNets);
    for (let k = 0; k < nc; k++) eachInput(k, (n) => { rdList[fill[n]++] = k; });

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
      exOff, exList, rdOff, rdList, ncOff, ncList, netOn, linkNet, linkOk, clocks: Int32Array.from(clocks), buzz,
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
    const b = k * 6, ci = this.compIn, on_ = this.netOn;
    if (t === T.HEX) {
      let v = 0;
      for (let s = 0; s < 4; s++) { const n = ci[b + s]; if (n >= 0 && on_[n]) v |= 1 << s; }
      return v;
    }
    let on = 0, cnt = 0;
    for (let s = 0; s < 6; s++) {
      const n = ci[b + s];
      if (n >= 0) { cnt++; if (on_[n]) on++; }
    }
    const ex = this.exList;
    for (let j = this.exOff[k], e = this.exOff[k + 1]; j < e; j++) { cnt++; if (on_[ex[j]]) on++; }
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
      case T.DFF: {                       // back = clock, everything else = data
        const bn = ci[b + ((this.compD[k] + 2) & 3)];
        const clk = bn >= 0 && on_[bn] ? 1 : 0;
        const data = on - clk > 0 ? 1 : 0;
        let q = st & 1;
        if (clk && !((st >> 1) & 1)) q = data;
        return q | (clk << 1);
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

  partAt(x, y, l = 0) {
    if (this.ver !== this.w.ver) this.compile();
    const c = this.w.ch(x >> CSH, y >> CSH, l);
    if (!c) return -1;
    const i = ((y & CM) << CSH) | (x & CM);
    return c.type[i] >= 3 ? c.net[i] : -1;
  }
  toggle(x, y, l = 0) {
    const k = this.partAt(x, y, l);
    if (k >= 0 && this.compT[k] === T.SWITCH) this.apply(k, this.compSt[k] ^ 1);
  }
  press(x, y, v, l = 0) {
    const k = this.partAt(x, y, l);
    if (k >= 0 && this.compT[k] === T.BUTTON) this.apply(k, v ? 1 : 0);
  }
  netIsOn(n) { return n >= 0 && n < this.nNets && this.netOn[n] > 0; }
}

// ---------------------------------------------------------------------------------------------
// Saving: each chunk becomes runs of [count, type, data, state, layers] bytes, then base64 text.
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
  const buf = new Uint8Array(CN * 5);
  for (const c of w.chunks.values()) {
    let p = 0, i = 0;
    while (i < CN) {
      const t = c.type[i], d = c.data[i], s = c.st[i], v = c.vert[i];
      let run = 1;
      while (i + run < CN && run < 255 && c.type[i + run] === t && c.data[i + run] === d && c.st[i + run] === s && c.vert[i + run] === v) run++;
      buf[p++] = run; buf[p++] = t; buf[p++] = d; buf[p++] = s; buf[p++] = v;
      i += run;
    }
    out.push([c.cx, c.cy, c.l, b64(buf.subarray(0, p))]);
  }
  return out;
}
// old saves (before layers) have [cx, cy, text] with 4 bytes per run
function decodeWorld(w, list, links) {
  w.clear();
  for (const e of list) {
    const old = e.length === 3;
    const cx = e[0], cy = e[1], l = old ? 0 : e[2], b = unb64(old ? e[2] : e[3]), step = old ? 4 : 5;
    const k = ckey(cx, cy, l), c = new Chunk(cx, cy, l, k);
    let i = 0;
    for (let p = 0; p + step - 1 < b.length && i < CN; p += step) {
      for (let r = 0; r < b[p] && i < CN; r++, i++) {
        c.type[i] = b[p + 1]; c.data[i] = b[p + 2]; c.st[i] = b[p + 3];
        c.vert[i] = old ? (b[p + 1] ? 3 : 0) : b[p + 4];
        if (b[p + 1]) c.count++;
      }
    }
    if (c.count) w.chunks.set(k, c);
  }
  w.links = (links || []).filter((L) => Array.isArray(L) && L.length === 6).map((L) => L.slice());
  w.ver++;
}

// The little demo on a brand new map.
function buildDemo(w) {
  const put = (x, y, t, d = 1, set = 0, l = 0) => w.set(x, y, t, d | (set << 2), 0, l);
  const wire = (x0, y0, x1, y1, l = 0) => {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) put(x, y, T.WIRE, 0, 0, l);
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
  // 6. a LINK: the switch powers an LED far away, nothing in between
  put(0, 14, T.SWITCH); put(9, 14, T.LED, 1, 6);
  w.addLink([0, 14, 0, 9, 14, 0]);
  // 7. layers: a switch on layer 1, its wire climbs to layer 2 and lights an LED there
  put(12, 14, T.SWITCH); wire(13, 14, 14, 14); wire(14, 14, 16, 14, 1); put(17, 14, T.LED, 1, 1, 1);
}

// ---------------------------------------------------------------- EXAMPLES (the Examples button)
// Each example is built into a CLIPBOARD (the same thing Ctrl+C makes), so picking one is like pasting it: it
// follows your mouse and you click to put it down. Cells: dx, dy, layer offset, type, data, state, layer-touching.
// Facing: 0 up, 1 right, 2 down, 3 left. LED colors: 0 red 1 green 2 blue 3 yellow 4 white 5 orange 6 purple 7 cyan.
function exampleClip(ex) {
  const cells = [], links = [];
  const api = {
    put(x, y, t, d = 1, set = 0, l = 0, vert = 3) { cells.push(x, y, l, t, d | (set << 2), 0, vert); },
    wire(x0, y0, x1, y1, l = 0) { for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) api.put(x, y, T.WIRE, 0, 0, l); },
    // a SEPARATE wire: only joins on the sides given (0 up 1 right 2 down 3 left)
    sep(x, y, sides, l = 0) { let m = 0; for (const s of sides) m |= 1 << s; cells.push(x, y, l, T.WIRE, 64 | (m << 2), 0, 3); },
    link(x0, y0, x1, y1, l0 = 0, l1 = 0) { links.push([x0, y0, l0, x1, y1, l1]); },
  };
  ex.build(api);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < cells.length; i += 7) { x0 = Math.min(x0, cells[i]); y0 = Math.min(y0, cells[i + 1]); x1 = Math.max(x1, cells[i]); y1 = Math.max(y1, cells[i + 1]); }
  for (let i = 0; i < cells.length; i += 7) { cells[i] -= x0; cells[i + 1] -= y0; }
  for (const L of links) { L[0] -= x0; L[1] -= y0; L[3] -= x0; L[4] -= y0; }
  return { w: x1 - x0 + 1, h: y1 - y0 + 1, cells, links };
}
const SMILEY = ['..XXXXXX..', '.X......X.', 'X..X..X..X', 'X........X', 'X.X....X.X', 'X..XXXX..X', '.X......X.', '..XXXXXX..'];
const EXAMPLES = [
  { name: '1-bit memory', desc: 'A D flip-flop remembers one bit. Set the DATA switch (top), then press WRITE (the button): the light keeps that value, even after you flip the switch again.',
    build(a) { a.put(1, 0, T.SWITCH); a.wire(1, 1, 1, 1); a.put(0, 2, T.BUTTON); a.put(1, 2, T.DFF, 1); a.wire(2, 2, 2, 2); a.put(3, 2, T.LED, 1, 1); } },
  { name: '4-bit memory', desc: 'Four D flip-flops = a 4-bit register. Set the 4 DATA switches, press WRITE (left): all 4 lights store the number at once.',
    build(a) {
      a.put(-1, 0, T.BUTTON);
      for (let x = 0; x <= 10; x++) a.sep(x, 0, (x - 1) % 3 === 0 ? [1, 2, 3] : [1, 3]);   // the WRITE line (only touches the flip-flops)
      for (let b = 0; b < 4; b++) { const x = 1 + 3 * b; a.put(x, 1, T.DFF, 2); a.put(x + 1, 1, T.SWITCH); a.wire(x, 2, x, 2); a.put(x, 3, T.LED, 1, 3); }
    } },
  { name: '4-bit counter', desc: 'A clock ticks T flip-flops that count up in binary (the 4 lights), and LINKS carry the 4 bits to a hex display that shows the number 0-F.',
    build(a) {
      a.put(0, 0, T.CLOCK, 1, 4);
      const side = [[6, 4], [7, 5], [6, 6], [5, 5]];   // the hex display's top, right, bottom, left = 1, 2, 4, 8
      a.put(6, 5, T.HEX);
      for (let b = 0; b < 4; b++) {
        const x = 1 + b * 3;
        a.put(x, 0, T.TFF, 1); a.wire(x + 1, 0, x + 1, 1); a.put(x + 1, 2, T.LED, 1, 2);
        if (b < 3) a.put(x + 2, 0, T.NOT, 1);
        a.wire(side[b][0], side[b][1], side[b][0], side[b][1]);
        a.link(x + 1, 1, side[b][0], side[b][1]);
      }
    } },
  { name: 'Half adder', desc: 'Adds two bits, A + B. XOR gives the SUM (top light), AND gives the CARRY (bottom light). 1 + 1 = 10 in binary: sum off, carry on.',
    build(a) {
      a.put(0, 0, T.SWITCH); a.wire(1, 0, 2, 0); a.put(0, 2, T.SWITCH); a.wire(1, 2, 2, 2);
      a.put(2, 1, T.XOR, 1); a.wire(3, 1, 3, 1); a.put(4, 1, T.LED, 1, 1);
      a.put(2, 5, T.AND, 1); a.wire(3, 5, 3, 5); a.put(4, 5, T.LED, 1, 0);
      a.link(0, 0, 2, 5); a.link(0, 2, 2, 5);   // (links: A and B also go into the AND gate)
    } },
  { name: 'Color mixing screen', desc: 'A screen of red, green and blue LEDs in stripes, like a real monitor. Turn on the R, G, B switches and ZOOM OUT: red + green = yellow, all three = white.',
    build(a) {
      const W = 9, H = 6;
      for (let c = 0; c < 3; c++) a.put(-2, c * 2, T.SWITCH);
      for (let x = 0; x < W; x++) {
        for (let y = 0; y < H; y++) { a.put(x, y, T.LED, 1, x % 3, 0, 2); a.sep(x, y, [0, 2], 1); }   // the LEDs, and a wire under each column (a layer up)
        a.link(-2, (x % 3) * 2, x, 0, 0, 1);   // each color's switch feeds its columns' wires
      }
    } },
  { name: 'LED picture', desc: 'A little screen showing a picture: each lit pixel has an always-ON block on the layer above it. Change the LED colors in the panel to recolor the whole picture.',
    build(a) {
      for (let y = 0; y < SMILEY.length; y++) for (let x = 0; x < SMILEY[y].length; x++) {
        a.put(x, y, T.LED, 1, 3, 0, 2);
        if (SMILEY[y][x] === 'X') a.put(x, y, T.CONST, 1, 0, 1, 1);
      }
    } },
];

const BW = { CS, CSH, CM, CN, LIM, NL, DX, DY, T, NAMES, PER, SETTINGS,
  outMask, inMask, hasPort, canSend, canRecv, World, Sim, encodeWorld, decodeWorld, buildDemo, EXAMPLES, exampleClip };
if (typeof module !== 'undefined' && module.exports) module.exports = BW;
root.BW = BW;
})(typeof window !== 'undefined' ? window : globalThis);
