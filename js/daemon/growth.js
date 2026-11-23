/* ---------------------------------------------------------------------------
 * growth.js — the daemon grows its own body.
 *
 * At the start of every session the daemon unfolds a different composition of
 * PIECES out of its intention (the will's target height-map): spires, stacks,
 * crosses, twin posts, arches spanning two places, low slabs and knots.
 * Nobody places them. They rise out of the surface one after another, the
 * upper ones only once what carries them has grown.
 *
 * It is not perfect: a few STRAY pieces grow where it does not want matter.
 * The will reads them as excess (they irritate), and after a while the daemon
 * takes them back into the surface. Holding attention near a piece makes it
 * grow faster.
 *
 * The body is reported to the will as the same 8 × 5 height map it thinks in,
 * so alignment, insistence and accord follow the growth: lack stains gather
 * where it has not grown yet, and it settles as the form completes.
 *
 * Pure logic: positions are in the 3D board frame (X = x − A/2, Z = y − 0.5).
 * ------------------------------------------------------------------------- */
(function (RUIN) {
  'use strict';

  const LEVEL = 0.06;               // one level of the will, in world height
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (t) => t * t * (3 - 2 * t);

  class Growth {
    constructor({ daemon, aspect }) {
      this.daemon = daemon;
      this.A = aspect;
      this.pieces = [];
      this.version = 0;
      this.t = 0;
      this.reportT = 0;
      daemon.on('session:start', ({ seed }) => this.generate(seed));
      daemon.on('session:end', () => { for (const p of this.pieces) if (!p.leaving) { p.leaving = true; p.leaveAt = this.t + Math.random() * 4; p.leaveDur = 4 + Math.random() * 3; } });
      daemon.on('dormant', () => { this.pieces = []; this.version++; });
    }

    /* ---- the plan ----------------------------------------------------------------- */
    generate(seed) {
      const W = RUIN.will, A = this.A, will = this.daemon.will;
      const rng = new RUIN.Random((seed ^ 0xb10c5) >>> 0);
      const T = will.T;
      const cell = (i, j) => { const w = W.cellToWorld(i, j, A); return [w.x - A / 2, w.y - 0.5]; };
      const pieces = [];
      let id = 0;
      const add = (o) => {
        const p = {
          id: id++, kind: o.kind, size: o.size, pos: o.pos, yaw: o.yaw ?? rng.float(0, Math.PI),
          start: o.start, dur: o.dur ?? 5 + o.size[1] * 22 + rng.float(0, 3),
          stray: !!o.stray, seed: rng.int(1, 1e9), g: 0, boost: 0, grown: false,
        };
        if (o.stray) { p.leaveAt = p.start + p.dur + rng.float(30, 60); p.leaveDur = rng.float(6, 10); }
        pieces.push(p);
        return p;
      };
      const after = (p) => p.start + p.dur * 0.92;
      const jit = (v, a) => v + rng.float(-a, a);

      // the cells it wants, highest first (ties shuffled → different every session)
      const cells = [];
      for (let j = 0; j < W.ROWS; j++) for (let i = 0; i < W.COLS; i++) if (T[j * W.COLS + i] > 0.5) cells.push({ i, j, h: T[j * W.COLS + i], r: rng.next() });
      cells.sort((a, b) => b.h - a.h || a.r - b.r);
      const used = new Set();
      const key = (i, j) => j * W.COLS + i;

      let clock = 1.5;
      for (const c of cells) {
        if (used.has(key(c.i, c.j))) continue;
        used.add(key(c.i, c.j));
        const [cx, cz] = cell(c.i, c.j);
        const x = jit(cx, 0.03), z = jit(cz, 0.03);
        const H = c.h * LEVEL;
        const t0 = clock + rng.float(0, 1.5);
        clock += rng.float(2.2, 4.5);

        // an arch toward a neighbour of similar height
        const nb = [[1, 0], [0, 1], [-1, 0], [0, -1]].map(([di, dj]) => ({ i: c.i + di, j: c.j + dj }))
          .filter((n) => n.i >= 0 && n.j >= 0 && n.i < W.COLS && n.j < W.ROWS && !used.has(key(n.i, n.j)) && T[key(n.i, n.j)] >= 1.5 && Math.abs(T[key(n.i, n.j)] - c.h) <= 1.5);
        if (c.h >= 1.5 && nb.length && rng.chance(0.45)) {
          const n = rng.pick(nb);
          used.add(key(n.i, n.j));
          const [nx0, nz0] = cell(n.i, n.j);
          const bx = jit(nx0, 0.02), bz = jit(nz0, 0.02);
          const lt = rng.float(0.03, 0.045);
          const ph = Math.max(0.07, Math.min(c.h, T[key(n.i, n.j)]) * LEVEL - lt);
          const w = rng.float(0.04, 0.06);
          const p1 = add({ kind: 'post', size: [w, ph, w * rng.float(0.7, 1)], pos: [x, 0, z], start: t0 });
          const p2 = add({ kind: 'post', size: [w, ph * rng.float(0.92, 1.0), w * rng.float(0.7, 1)], pos: [bx, 0, bz], start: t0 + rng.float(0.5, 2) });
          const len = Math.hypot(bx - x, bz - z) + w * 1.6;
          const lin = add({ kind: 'slab', size: [len, lt, rng.float(0.05, 0.07)], pos: [(x + bx) / 2, Math.min(p1.size[1], p2.size[1]), (z + bz) / 2], yaw: -Math.atan2(bz - z, bx - x), start: Math.max(after(p1), after(p2)) });
          if (rng.chance(0.45)) add({ kind: 'shard', size: [0.04, rng.float(0.06, 0.12), 0.035], pos: [jit((x + bx) / 2, 0.03), lin.pos[1] + lt, jit((z + bz) / 2, 0.01)], start: after(lin) });
          continue;
        }

        if (c.h >= 2.5) {
          const variant = rng.pick(['spire', 'stack', 'cross', 'twin', 'stack']);
          const w = rng.float(0.045, 0.07);
          if (variant === 'spire') {
            add({ kind: 'shard', size: [w * 1.2, H, w], pos: [x, 0, z], start: t0 });
          } else if (variant === 'stack') {
            const h1 = H * rng.float(0.45, 0.6), st = rng.float(0.03, 0.04);
            const a = add({ kind: 'post', size: [w, h1, w * 0.85], pos: [x, 0, z], start: t0 });
            const b = add({ kind: 'slab', size: [rng.float(0.13, 0.2), st, rng.float(0.05, 0.07)], pos: [x, h1, z], start: after(a) });
            add({ kind: rng.chance(0.5) ? 'shard' : 'post', size: [w * 0.85, Math.max(0.04, H - h1 - st), w * 0.75], pos: [jit(x, 0.015), h1 + st, jit(z, 0.015)], start: after(b) });
          } else if (variant === 'cross') {
            const a = add({ kind: 'post', size: [w, H, w * 0.8], pos: [x, 0, z], start: t0 });
            add({ kind: 'slab', size: [rng.float(0.14, 0.2), rng.float(0.03, 0.04), w * 1.1], pos: [x, H * rng.float(0.5, 0.7), z], start: t0 + a.dur * 0.7 });
          } else {
            const yaw = rng.float(0, Math.PI), ox = Math.cos(yaw) * 0.04, oz = Math.sin(yaw) * 0.04;
            add({ kind: 'post', size: [w * 0.85, H, w * 0.75], pos: [x - ox, 0, z - oz], start: t0 });
            add({ kind: rng.chance(0.5) ? 'shard' : 'post', size: [w * 0.75, H * rng.float(0.55, 0.8), w * 0.7], pos: [x + ox, 0, z + oz], start: t0 + rng.float(1, 3) });
          }
          continue;
        }

        const variant = rng.pick(['slab', 'knot', 'small-arch', 'slab', 'shard']);
        if (variant === 'small-arch' && H >= 0.08) {
          const yaw = rng.float(0, Math.PI), ox = Math.cos(yaw) * 0.05, oz = -Math.sin(yaw) * 0.05, lt = 0.028;
          const a = add({ kind: 'post', size: [0.035, H - lt, 0.03], pos: [x - ox, 0, z - oz], start: t0 });
          const b = add({ kind: 'post', size: [0.035, H - lt, 0.03], pos: [x + ox, 0, z + oz], start: t0 + 0.8 });
          add({ kind: 'slab', size: [0.15, lt, 0.045], pos: [x, H - lt, z], yaw, start: Math.max(after(a), after(b)) });
        } else if (variant === 'slab') {
          const n = Math.max(1, Math.round(H / 0.045));
          let y = 0, prev = null;
          const th = H / n;
          for (let k = 0; k < n; k++) {
            prev = add({ kind: 'slab', size: [rng.float(0.12, 0.18), th, rng.float(0.05, 0.08)], pos: [jit(x, 0.01), y, jit(z, 0.01)], start: prev ? after(prev) : t0 });
            y += th;
          }
        } else if (variant === 'shard') {
          add({ kind: 'shard', size: [rng.float(0.05, 0.08), Math.max(0.05, H), rng.float(0.04, 0.06)], pos: [x, 0, z], start: t0 });
        } else {
          add({ kind: 'knot', size: [rng.float(0.07, 0.1), Math.max(0.045, H), rng.float(0.06, 0.09)], pos: [x, 0, z], start: t0 });
        }
      }

      // strays: where it does not want matter, a few pieces grow anyway
      const empty = [];
      for (let j = 0; j < W.ROWS; j++) for (let i = 0; i < W.COLS; i++) if (T[key(i, j)] < 0.5) empty.push({ i, j });
      const ns = Math.min(empty.length, rng.int(2, 4));
      for (let k = 0; k < ns; k++) {
        const e = empty.splice(rng.int(0, empty.length - 1), 1)[0];
        const [ex, ez] = cell(e.i, e.j);
        add({ kind: rng.pick(['knot', 'shard', 'post']), size: [rng.float(0.045, 0.08), rng.float(0.06, 0.16), rng.float(0.04, 0.07)], pos: [jit(ex, 0.03), 0, jit(ez, 0.03)], start: rng.float(4, 18), stray: true });
      }

      this.pieces = pieces;
      this.t = 0;
      this.reportT = 0;
      this.version++;
    }

    /* ---- time ----------------------------------------------------------------------- */
    /** attention offered at a point on the board: nearby pieces grow faster */
    attend(x, z, amount) {
      for (const p of this.pieces) {
        const d = Math.hypot(p.pos[0] - x, p.pos[2] - z);
        p.boost += amount * 2.5 * Math.exp(-(d * d) / 0.02);
      }
    }

    update(dt) {
      if (!this.pieces.length || dt <= 0) return;
      this.t += dt;
      const d = this.daemon;
      for (let k = this.pieces.length - 1; k >= 0; k--) {
        const p = this.pieces[k];
        const local = this.t + p.boost;
        let g = smooth(clamp((local - p.start) / p.dur, 0, 1));
        if (p.leaveAt != null && this.t > p.leaveAt) {
          const out = smooth(clamp((this.t - p.leaveAt) / p.leaveDur, 0, 1));
          g = Math.min(g, 1 - out);
          if (!p.leftReported && d.state === 'session') { p.leftReported = true; this.report(p, -1); }
          if (out >= 1) { this.pieces.splice(k, 1); this.version++; continue; }
        }
        p.g = g;
        if (!p.grown && g > 0.985) { p.grown = true; if (d.state === 'session') this.report(p, +1); }
      }
      this.reportT -= dt;
      if (this.reportT <= 0) { this.reportT = 0.5; this.report(null, 0); }
    }

    /* ---- the body, as the will sees it ------------------------------------------------- */
    bounds(p) {
      const g = p.g, s = 0.35 + 0.65 * g;
      const c = Math.abs(Math.cos(p.yaw)), sn = Math.abs(Math.sin(p.yaw));
      const hx = (c * p.size[0] + sn * p.size[2]) * 0.5 * s * 0.85;
      const hz = (sn * p.size[0] + c * p.size[2]) * 0.5 * s * 0.85;
      return { x0: p.pos[0] - hx, x1: p.pos[0] + hx, z0: p.pos[2] - hz, z1: p.pos[2] + hz, y0: p.pos[1], y1: p.pos[1] + p.size[1] * g };
    }

    heights() {
      const W = RUIN.will, A = this.A, H = new Float32Array(W.N);
      const R = W.rect(A), cw = (R.x1 - R.x0) / W.COLS, ch = (R.y1 - R.y0) / W.ROWS;
      for (const p of this.pieces) {
        if (p.g < 0.02) continue;
        const b = this.bounds(p);
        const lvl = b.y1 / LEVEL;
        for (let j = 0; j < W.ROWS; j++) for (let i = 0; i < W.COLS; i++) {
          const x0 = R.x0 + i * cw - A / 2, z0 = R.y0 + j * ch - 0.5;
          const ox = Math.min(x0 + cw, b.x1) - Math.max(x0, b.x0), oz = Math.min(z0 + ch, b.z1) - Math.max(z0, b.z0);
          if (ox <= 0 || oz <= 0) continue;
          const cover = Math.min(1, (ox * oz) / (0.35 * cw * ch));
          const c = j * W.COLS + i;
          H[c] = Math.max(H[c], Math.min(W.MAXH, lvl * (0.55 + 0.45 * cover)));
        }
      }
      return H;
    }

    report(p, delta) {
      if (this.daemon.state !== 'session') return;
      const H = this.heights();
      let at = null;
      if (p) {
        const W = RUIN.will, g = W.worldToGrid(p.pos[0] + this.A / 2, p.pos[2] + 0.5, this.A);
        const i = clamp(Math.floor(g.gx), 0, W.COLS - 1), j = clamp(Math.floor(g.gy), 0, W.ROWS - 1);
        at = { i, j, delta, height: H[j * W.COLS + i] };
      }
      this.daemon.setModel(H, this.pieces.filter((q) => q.g > 0.5).length, at);
    }
  }

  RUIN.Growth = Growth;
  RUIN.growth = { LEVEL };
})((window.RUIN = window.RUIN || {}));
