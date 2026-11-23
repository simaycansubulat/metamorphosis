/* ---------------------------------------------------------------------------
 * growth.js — the daemon grows its own body.
 *
 * At the start of every session the daemon unfolds a different composition of
 * PIECES out of its intention (the will's target height-map), built like the
 * workshop models: towers of criss-crossed tiers, frames, arches spanning two
 * places, crosses, T-posts and low criss-cross piles of elongated pieces.
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

  const LEVEL = 0.1;                // one level of the will, in world height
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
    // The body is built the way the workshop models were: elongated pieces
    // (about 3 : 1 : 0.6, like Jenga blocks, but grown, so never regular),
    // standing as posts, laid across as beams, crossed in layers. From the
    // intention it chooses towers of criss-crossed tiers, frames, arches
    // between two places, crosses, T-posts and low criss-cross piles.
    generate(seed) {
      const W = RUIN.will, A = this.A, will = this.daemon.will;
      const rng = new RUIN.Random((seed ^ 0xb10c5) >>> 0);
      const T = will.T;
      const cell = (i, j) => { const w = W.cellToWorld(i, j, A); return [w.x - A / 2, w.y - 0.5]; };
      const key = (i, j) => j * W.COLS + i;
      const pieces = [];
      let id = 0;

      const L = rng.float(0.23, 0.27), B = L / 3, Th = L * 0.2;   // this session's piece
      const v = () => rng.float(0.9, 1.1);                        // no two alike

      const add = (o) => {
        const p = {
          id: id++, kind: o.kind || 'beam', size: o.size, pos: o.pos, yaw: o.yaw + rng.float(-0.07, 0.07),
          start: o.start, dur: o.dur ?? 2.2 + o.size[1] * 9 + rng.float(0, 1.2),
          stray: !!o.stray, seed: rng.int(1, 1e9), g: 0, boost: 0, grown: false,
        };
        if (o.stray) { p.leaveAt = p.start + p.dur + rng.float(30, 60); p.leaveDur = rng.float(6, 10); }
        pieces.push(p);
        return p;
      };
      const after = (p) => p.start + p.dur * 0.9;
      const jit = (x, a) => x + rng.float(-a, a);
      // local frame of a structure turned by yaw (matches the shader's rotation)
      const at = (x, z, yaw, u, w) => [x + Math.cos(yaw) * u + Math.sin(yaw) * w, z - Math.sin(yaw) * u + Math.cos(yaw) * w];

      // the three ways a piece can lie
      const post = (x, z, y, yaw, t) => { const k = v(); return add({ size: [B * k, L * v(), Th * k], pos: [x, y, z], yaw, start: t }); };
      const beam = (x, z, y, yaw, t) => { const k = v(); return add({ size: [L * v(), Th * k, B * k], pos: [x, y, z], yaw, start: t }); };
      const edge = (x, z, y, yaw, t) => { const k = v(); return add({ size: [L * v(), B * k, Th * k], pos: [x, y, z], yaw, start: t }); };
      const top = (p) => p.pos[1] + p.size[1];

      /** posts and a beam across them; returns the height reached and the time */
      const tier = (x, z, y, yaw, t, four) => {
        const s = L * 0.36;
        const ps = [];
        for (const sgn of [-1, 1]) {
          const [px, pz] = at(x, z, yaw, sgn * s, 0);
          ps.push(post(px, pz, y, yaw + Math.PI / 2, t + rng.float(0, 0.6)));
          if (four) { const [qx, qz] = at(x, z, yaw, sgn * s, L * 0.32); ps.push(post(qx, qz, y, yaw + Math.PI / 2, t + rng.float(0, 0.8))); }
        }
        const yb = Math.min(...ps.map(top));
        const t1 = Math.max(...ps.map(after));
        const b1 = beam(x, z, yb, yaw, t1);
        let last = b1;
        if (four) { const [bx, bz] = at(x, z, yaw, 0, L * 0.32); last = beam(bx, bz, yb, yaw, t1 + 0.4); }
        return { y: top(b1), t: after(last) };
      };

      const cells = [];
      for (let j = 0; j < W.ROWS; j++) for (let i = 0; i < W.COLS; i++) if (T[key(i, j)] > 0.5) cells.push({ i, j, h: T[key(i, j)], r: rng.next() });
      cells.sort((a, b) => b.h - a.h || a.r - b.r);
      const used = new Set();
      let clock = 0.3, forms = 0;

      for (const c of cells) {
        if (used.has(key(c.i, c.j))) continue;
        used.add(key(c.i, c.j));
        const [cx, cz] = cell(c.i, c.j);
        const x = jit(cx, 0.025), z = jit(cz, 0.025);
        const yaw = rng.pick([0, Math.PI / 2]) + rng.float(-0.25, 0.25);
        const t0 = clock + rng.float(0, 0.6);
        clock += rng.float(0.8, 1.6);
        forms++;

        // an arch toward a neighbour that also wants height
        const nb = [[1, 0], [0, 1], [-1, 0], [0, -1]].map(([di, dj]) => ({ i: c.i + di, j: c.j + dj }))
          .filter((n) => n.i >= 0 && n.j >= 0 && n.i < W.COLS && n.j < W.ROWS && !used.has(key(n.i, n.j)) && T[key(n.i, n.j)] >= 2.5);
        if (c.h >= 2.5 && nb.length && rng.chance(0.4)) {
          const n = rng.pick(nb);
          used.add(key(n.i, n.j));
          const [nx0, nz0] = cell(n.i, n.j);
          const ay = -Math.atan2(nz0 - cz, nx0 - cx);
          const mx = (x + nx0) / 2, mz = (z + nz0) / 2;
          const half = Math.min(L * 0.42, Math.hypot(nx0 - x, nz0 - z) / 2);
          const [ax, az] = at(mx, mz, ay, -half, 0), [bx, bz] = at(mx, mz, ay, half, 0);
          const p1 = post(ax, az, 0, ay + Math.PI / 2, t0), p2 = post(bx, bz, 0, ay + Math.PI / 2, t0 + 0.5);
          const lin = beam(mx, mz, Math.min(top(p1), top(p2)), ay, Math.max(after(p1), after(p2)));
          if (rng.chance(0.55)) post(jit(mx, 0.02), jit(mz, 0.02), top(lin), ay, after(lin));
          continue;
        }

        if (c.h >= 4) {                                     // a tower of criss-crossed tiers
          const tiers = c.h >= 4.6 ? 2 : rng.int(1, 2);
          let y = 0, t = t0, a = yaw;
          for (let k = 0; k < tiers; k++) { const r = tier(x, z, y, a, t, k === 0 && rng.chance(0.45)); y = r.y; t = r.t; a += Math.PI / 2 + rng.float(-0.15, 0.15); }
          if (rng.chance(0.6)) post(jit(x, 0.015), jit(z, 0.015), y, a, t);
        } else if (c.h >= 2.5) {
          const variant = rng.pick(['frame', 'cross', 'T', 'twin', 'frame']);
          if (variant === 'frame') {
            const r = tier(x, z, 0, yaw, t0, false);
            const b = beam(x, z, r.y, yaw + Math.PI / 2, r.t);
            if (rng.chance(0.5)) edge(x, z, top(b), yaw, after(b));
          } else if (variant === 'cross') {
            const p = post(x, z, 0, yaw, t0);
            beam(x, z, top(p) * rng.float(0.5, 0.68), yaw + Math.PI / 2, t0 + p.dur * 0.7);
          } else if (variant === 'T') {
            const p = post(x, z, 0, yaw, t0);
            const b = beam(x, z, top(p), yaw + rng.float(-0.3, 0.3), after(p));
            if (rng.chance(0.4)) { const [ex, ez] = at(x, z, yaw, L * 0.3, 0); post(ex, ez, top(b), yaw, after(b)); }
          } else {
            const [ax, az] = at(x, z, yaw, -B * 0.8, 0), [bx, bz] = at(x, z, yaw, B * 0.8, 0);
            const p1 = post(ax, az, 0, yaw, t0);
            post(bx, bz, 0, yaw + 0.2, t0 + 1);
            edge(x, z, top(p1), yaw + Math.PI / 2, after(p1));
          }
        } else {                                            // low: a criss-cross pile
          const layers = c.h >= 1.5 ? 2 : 1;
          let y = 0, t = t0, a = yaw;
          for (let k = 0; k < layers; k++) {
            const [ax, az] = at(x, z, a, 0, -B * 0.75), [bx, bz] = at(x, z, a, 0, B * 0.75);
            const b1 = beam(ax, az, y, a, t), b2 = beam(bx, bz, y, a, t + 0.5);
            y = Math.min(top(b1), top(b2)); t = Math.max(after(b1), after(b2)); a += Math.PI / 2;
          }
          if (rng.chance(0.35)) post(jit(x, 0.02), jit(z, 0.02), y, a, t);
        }
      }

      // never too sparse: lying pieces beside what grows
      const grounded = pieces.filter((p) => p.pos[1] === 0);
      while (forms < 9 && grounded.length) {
        const host = rng.pick(grounded);
        const a = rng.float(0, Math.PI * 2), r = rng.float(0.12, 0.18);
        beam(host.pos[0] + Math.cos(a) * r, host.pos[2] + Math.sin(a) * r, 0, rng.float(0, Math.PI), rng.float(1, Math.max(2, clock)));
        forms++;
      }

      // strays: where it does not want matter, a few pieces grow anyway
      const empty = [];
      for (let j = 0; j < W.ROWS; j++) for (let i = 0; i < W.COLS; i++) if (T[key(i, j)] < 0.5) empty.push({ i, j });
      const ns = Math.min(empty.length, rng.int(1, 3));
      for (let k = 0; k < ns; k++) {
        const e = empty.splice(rng.int(0, empty.length - 1), 1)[0];
        const [ex, ez] = cell(e.i, e.j);
        const standing = rng.chance(0.5), k2 = v();
        add({ size: standing ? [B * k2, L * v(), Th * k2] : [L * v(), Th * k2, B * k2], pos: [jit(ex, 0.03), 0, jit(ez, 0.03)], yaw: rng.float(0, Math.PI), start: rng.float(3, 12), stray: true });
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
          const cover = Math.min(1, (ox * oz) / (0.3 * cw * ch));
          const c = j * W.COLS + i;
          H[c] = Math.max(H[c], Math.min(W.MAXH, lvl * cover));
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
