/* ---------------------------------------------------------------------------
 * will.js — what the daemon wants to become.
 *
 * At the start of a session the daemon fixes a MORPHOLOGICAL INTENTION:
 * a target height-map on the construction grid (COLS × ROWS cells, each
 * 0..MAXH stacked pieces). It is never shown as a blueprint; the visual
 * language is biased toward it (see daemon.js / organism.js / mind.js).
 *
 * The participant reports the physical model on the same grid (Model).
 * The Will evaluates the model against its intention:
 *   - an ALIGNMENT degree 0..1 (blurred cell comparison + shape features,
 *     so near-misses and "the right idea in the wrong place" count partly)
 *   - a spatial ERROR map: lack (it wants matter here) / excess (it rejects
 *     matter here) / harmony (agreement)
 *   - INSISTENCE: how strongly it pushes, from misalignment and from
 *     urgency (rises when nothing improves, falls when things improve)
 *
 * It negotiates but keeps its will: deviations the participant maintains
 * for a long time are partly absorbed (bounded by its plasticity), and
 * demands that are long refused soften slightly. The intention never
 * becomes the participant's construction.
 *
 * Pure logic, no rendering, no DOM: can be swapped for a smarter agent.
 * ------------------------------------------------------------------------- */
(function (RUIN) {
  'use strict';

  const COLS = 8, ROWS = 5, MAXH = 5, N = COLS * ROWS;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const ease = (rate, dt) => 1 - Math.exp(-rate * dt);
  const at = (i, j) => j * COLS + i;
  const inside = (i, j) => i >= 0 && j >= 0 && i < COLS && j < ROWS;

  /* ------------------------------------------------------- archetypes */
  // Each builds a target height-map and declares how it prefers to express
  // itself: which forms, which gestures, how dense, how aligned.
  function rasterLine(T, x0, y0, x1, y1, h) {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.3) + 1;
    for (let k = 0; k <= n; k++) {
      const i = Math.round(x0 + ((x1 - x0) * k) / n), j = Math.round(y0 + ((y1 - y0) * k) / n);
      if (inside(i, j)) T[at(i, j)] = Math.max(T[at(i, j)], h);
    }
  }

  const ARCHETYPES = {
    radial: {
      build(rng) {
        const T = new Float32Array(N);
        const cx = rng.float(2.8, 4.2), cy = rng.float(1.7, 2.3), R = rng.float(1.6, 2.0);
        const k = rng.int(3, 5), rot = rng.float(0, Math.PI * 2);
        for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
          const dx = i - cx, dy = (j - cy) * 1.15, d = Math.hypot(dx, dy);
          const a = Math.atan2(dy, dx) - rot;
          const spoke = Math.abs(Math.sin((a * k) / 2)) < 0.3;
          let h = 0;
          if (d < 0.75) h = 3;
          else if (Math.abs(d - R) < 0.55) h = spoke ? 2 : 1;
          else if (d < R && spoke) h = 1;
          T[at(i, j)] = h;
        }
        return T;
      },
      expression: {
        characters: { pool: 1.5, cell: 1.3, blot: 0.6, spray: 0.4, string: 0.5 },
        gestures: { realign: 1.4, link: 1.4, insist: 0.9, migrate: 0.6, sever: 0.6 },
        tension: 0.62, coherence: 0.3,
      },
    },
    tower: {
      build(rng) {
        const T = new Float32Array(N);
        const px = rng.int(2, 5), py = rng.int(1, 3);
        const twin = rng.chance(0.5);
        const qx = clamp(px + rng.sign() * rng.int(2, 3), 0, COLS - 1), qy = clamp(py + rng.int(-1, 1), 0, ROWS - 1);
        for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
          let h = Math.round(5 * Math.exp(-((i - px) ** 2 + (j - py) ** 2) / 0.75));
          if (twin) h = Math.max(h, Math.round(2.6 * Math.exp(-((i - qx) ** 2 + (j - qy) ** 2) / 0.45)));
          T[at(i, j)] = h;
        }
        return T;
      },
      expression: {
        characters: { blot: 1.7, pool: 1.0, cell: 0.4, spray: 0.4, string: 0.3 },
        gestures: { insist: 1.7, converge: 1.6, release: 0.5, reach: 0.5, sever: 0.7 },
        tension: 0.86, coherence: 0.7,
      },
    },
    branching: {
      build(rng) {
        const T = new Float32Array(N);
        const fromLeft = rng.chance(0.5);
        const x0 = fromLeft ? 0 : COLS - 1, y0 = rng.int(1, 3);
        const dir = fromLeft ? 1 : -1;
        const jx = x0 + dir * rng.int(2, 3), jy = y0 + rng.int(-1, 1) * 0.5;
        rasterLine(T, x0, y0, jx, jy, 2);
        const arms = rng.int(2, 3);
        for (let a = 0; a < arms; a++) {
          const ang = (a - (arms - 1) / 2) * rng.float(0.7, 1.0);
          const len = rng.float(2.5, 3.8);
          const ex = jx + dir * Math.cos(ang) * len, ey = jy + Math.sin(ang) * len * 1.1;
          rasterLine(T, jx, jy, ex, ey, 1);
          if (rng.chance(0.5)) rasterLine(T, (jx + ex) / 2, (jy + ey) / 2, (jx + ex) / 2 + dir * 1.2, (jy + ey) / 2 + rng.sign() * 1.2, 1);
        }
        const ji = clamp(Math.round(jx), 0, COLS - 1), jj = clamp(Math.round(jy), 0, ROWS - 1);
        T[at(ji, jj)] = 3;
        return T;
      },
      expression: {
        characters: { string: 1.7, spray: 0.9, blot: 0.5, cell: 0.3, pool: 0.4 },
        gestures: { reach: 1.7, link: 1.4, divide: 1.2, converge: 0.6, insist: 0.8 },
        tension: 0.5, coherence: 0.55,
      },
    },
    nucleus: {
      build(rng) {
        const T = new Float32Array(N);
        const cx = rng.float(2.5, 4.5), cy = rng.float(1.5, 2.5);
        for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
          const d = Math.hypot((i - cx) / 1.15, (j - cy) / 0.85);
          if (d < 0.6) T[at(i, j)] = 4; else if (d < 1.25) T[at(i, j)] = 3;
        }
        const n = rng.int(4, 6);
        for (let k = 0, tries = 0; k < n && tries < 200; tries++) {
          const i = rng.int(0, COLS - 1), j = rng.int(0, ROWS - 1);
          if (Math.hypot(i - cx, j - cy) < 2.4 || T[at(i, j)] > 0) continue;
          T[at(i, j)] = 1; k++;
        }
        return T;
      },
      expression: {
        characters: { blot: 1.4, spray: 1.3, cell: 0.6, pool: 0.5, string: 0.4 },
        gestures: { converge: 1.4, reach: 1.2, release: 0.9, divide: 0.8, insist: 1.0 },
        tension: 0.72, coherence: 0.45,
      },
    },
    constellation: {
      build(rng) {
        const T = new Float32Array(N);
        const centres = [];
        for (let tries = 0; centres.length < 3 && tries < 200; tries++) {
          const c = { x: rng.float(0.5, COLS - 1.5), y: rng.float(0.5, ROWS - 1.5) };
          if (centres.every((o) => Math.hypot(o.x - c.x, o.y - c.y) > 2.6)) centres.push(c);
        }
        centres.forEach((c, k) => {
          const peak = k === 0 ? 3 : rng.int(1, 2);
          const size = k === 0 ? 3 : rng.int(1, 3);
          T[at(Math.round(c.x), Math.round(c.y))] = peak;
          for (let s = 1; s < size; s++) {
            const i = Math.round(c.x) + rng.int(-1, 1), j = Math.round(c.y) + rng.int(-1, 1);
            if (inside(i, j)) T[at(i, j)] = Math.max(T[at(i, j)], Math.max(1, peak - 1));
          }
        });
        return T;
      },
      expression: {
        characters: { spray: 1.4, pool: 1.1, string: 0.8, blot: 0.6, cell: 0.6 },
        gestures: { migrate: 1.4, sever: 1.2, divide: 1.0, link: 0.7, converge: 0.6 },
        tension: 0.48, coherence: 0.4,
      },
    },
  };

  /* -------------------------------------------------------------- grid math */
  const K_C = 1, K_O = 0.35, K_D = 0.15, K_SUM = K_C + 4 * K_O + 4 * K_D;
  function blur(G) {
    const out = new Float32Array(N);
    for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
      let s = G[at(i, j)] * K_C;
      for (const [di, dj, w] of [[1, 0, K_O], [-1, 0, K_O], [0, 1, K_O], [0, -1, K_O], [1, 1, K_D], [1, -1, K_D], [-1, 1, K_D], [-1, -1, K_D]]) {
        if (inside(i + di, j + dj)) s += G[at(i + di, j + dj)] * w;
      }
      out[at(i, j)] = s / K_SUM;
    }
    return out;
  }

  function components(G) {
    const seen = new Uint8Array(N);
    let n = 0;
    for (let c = 0; c < N; c++) {
      if (G[c] <= 0.5 || seen[c]) continue;
      n++;
      const stack = [c]; seen[c] = 1;
      while (stack.length) {
        const k = stack.pop(), i = k % COLS, j = (k / COLS) | 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = i + di, nj = j + dj;
          if (!inside(ni, nj)) continue;
          const m = at(ni, nj);
          if (G[m] > 0.5 && !seen[m]) { seen[m] = 1; stack.push(m); }
        }
      }
    }
    return n;
  }

  function features(G) {
    let M = 0, cx = 0, cy = 0, peak = 0, count = 0;
    for (let c = 0; c < N; c++) {
      const h = G[c];
      if (h <= 0) continue;
      M += h; cx += (c % COLS) * h; cy += ((c / COLS) | 0) * h;
      peak = Math.max(peak, h); count++;
    }
    if (M <= 0) return { M: 0, cx: COLS / 2, cy: ROWS / 2, spread: 0, peak: 0, count: 0, comps: 0 };
    cx /= M; cy /= M;
    let s = 0;
    for (let c = 0; c < N; c++) if (G[c] > 0) s += G[c] * ((c % COLS - cx) ** 2 + (((c / COLS) | 0) - cy) ** 2);
    return { M, cx, cy, spread: Math.sqrt(s / M), peak, count, comps: components(G) };
  }

  /** Compare a reported model B with a target T. */
  function evaluate(B, T) {
    const bB = blur(B), bT = blur(T);
    const fB = features(B), fT = features(T);
    const lack = new Float32Array(N), excess = new Float32Array(N), harmony = new Float32Array(N);
    let diff = 0, tot = 0;
    for (let c = 0; c < N; c++) {
      const e = bB[c] - bT[c];
      diff += Math.abs(e); tot += bB[c] + bT[c];
      lack[c] = Math.max(0, -e); excess[c] = Math.max(0, e);
      if (B[c] > 0 && T[c] > 0.25) harmony[c] = 1 - Math.min(1, Math.abs(B[c] - T[c]) / 2.5);
    }
    if (fB.M === 0) {
      return { alignment: 0, raw: 0, precision: 1, cellwise: 0, shape: 0, engaged: false, lack, excess, harmony, fB, fT };
    }
    const cellwise = 1 - diff / (tot || 1);
    const sims = {
      mass: Math.min(fB.M, fT.M) / Math.max(fB.M, fT.M),
      centroid: 1 - Math.min(1, Math.hypot(fB.cx - fT.cx, fB.cy - fT.cy) / 3),
      spread: 1 - Math.min(1, Math.abs(fB.spread - fT.spread) / Math.max(fT.spread, 0.6)),
      height: 1 - Math.min(1, Math.abs(fB.peak - fT.peak) / MAXH),
      parts: 1 - Math.min(1, Math.abs(fB.comps - fT.comps) / Math.max(fT.comps, 1)),
    };
    const shape = sims.mass * 0.2 + sims.centroid * 0.2 + sims.spread * 0.2 + sims.height * 0.25 + sims.parts * 0.15;
    // calibrated: an unrelated arrangement of the same amount of pieces scores
    // ~0.5 raw, so the useful range is stretched from there to a perfect match
    const raw = 0.6 * cellwise + 0.4 * shape;
    const alignment = Math.pow(clamp((raw - 0.5) / 0.5, 0, 1), 0.85);
    // precision: how much of what was built is matter it wants (a neighbour of a
    // wanted cell counts half) -> distinguishes "unfinished" from "wrong"
    let matched = 0;
    for (let c = 0; c < N; c++) {
      if (!B[c]) continue;
      const i = c % COLS, j = (c / COLS) | 0;
      let nb = 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (inside(i + di, j + dj)) nb = Math.max(nb, T[at(i + di, j + dj)]);
      matched += Math.min(B[c], Math.max(T[c], nb * 0.5));
    }
    const precision = matched / fB.M;
    return { alignment, raw, precision, cellwise, shape, sims, engaged: true, lack, excess, harmony, fB, fT };
  }

  /* ----------------------------------------------------------------- Model */
  /** The participant's report of the physical construction. */
  class Model {
    constructor() { this.h = new Float32Array(N); this.version = 0; }
    get(i, j) { return this.h[at(i, j)]; }
    add(i, j, n = 1) {
      if (!inside(i, j)) return 0;
      const c = at(i, j), before = this.h[c];
      this.h[c] = clamp(before + n, 0, MAXH);
      if (this.h[c] !== before) this.version++;
      return this.h[c] - before;
    }
    clear() { this.h.fill(0); this.version++; }
    get pieces() { let s = 0; for (const v of this.h) s += v; return s; }
  }

  /* ------------------------------------------------------------------ Will */
  class Will {
    constructor(rng, archetype = null) {
      this.rng = rng;
      const names = Object.keys(ARCHETYPES);
      this.archetype = archetype && ARCHETYPES[archetype] ? archetype : rng.pick(names);
      this.def = ARCHETYPES[this.archetype];
      this.T = this.def.build(rng);
      this.Teff = Float32Array.from(this.T);   // after negotiation
      this.plasticity = rng.float(0.15, 0.35); // how far it can be persuaded
      this.persist = new Float32Array(N);      // how long a deviation has been held
      this.refused = new Float32Array(N);      // how long a demand has been ignored
      this.model = null;
      this.result = evaluate(new Float32Array(N), this.Teff);
      this.alignment = 0;   // smoothed
      this.trendRef = 0; this.trendT = 0; this.improving = 0;
      this.urgency = 0.3;
      this.insistence = 0.25;
      this.accord = false; this.accordT = 0;
      this.lackS = new Float32Array(N); this.excessS = new Float32Array(N); this.harmonyS = new Float32Array(N);
      this.flash = new Float32Array(N);
      this.impulseT = 3;
      this.dirty = true;
      this.listeners = [];
    }

    get engaged() { return this.result.engaged; }
    get target() { return this.Teff; }

    attach(model) { this.model = model; this.dirty = true; }

    reevaluate() {
      const prev = this.result.alignment;
      this.result = evaluate(this.model ? this.model.h : new Float32Array(N), this.Teff);
      this.dirty = false;
      return this.result.alignment - prev;
    }

    /** Normalised desire at a grid position (bilinear, 0..1). */
    desireGrid(gx, gy) {
      const x = clamp(gx - 0.5, 0, COLS - 1), y = clamp(gy - 0.5, 0, ROWS - 1);
      const i0 = Math.floor(x), j0 = Math.floor(y), i1 = Math.min(i0 + 1, COLS - 1), j1 = Math.min(j0 + 1, ROWS - 1);
      const fx = x - i0, fy = y - j0;
      const v = (this.Teff[at(i0, j0)] * (1 - fx) + this.Teff[at(i1, j0)] * fx) * (1 - fy) +
                (this.Teff[at(i0, j1)] * (1 - fx) + this.Teff[at(i1, j1)] * fx) * fy;
      return v / MAXH;
    }

    /** The cells it most wants to talk about, strongest first. */
    focus(k = 3) {
      const r = this.result, list = [];
      for (let c = 0; c < N; c++) {
        const l = r.lack[c], e = r.excess[c];
        if (Math.max(l, e) > 0.08) list.push({ i: c % COLS, j: (c / COLS) | 0, kind: l > e ? 'lack' : 'excess', amount: Math.max(l, e) });
      }
      list.sort((a, b) => b.amount - a.amount);
      return list.slice(0, k);
    }

    /** Called often. Returns an impulse {i,j,kind,strength} when it insists. */
    update(dt) {
      if (this.dirty || (this.model && this.model.version !== this._seen)) {
        this._seen = this.model ? this.model.version : 0;
        this.reevaluate();
      }
      const r = this.result;
      this.alignment += (r.alignment - this.alignment) * ease(1.5, dt);

      // trend over a sliding window → urgency
      this.trendT += dt;
      if (this.trendT > 4) {
        this.improving = (r.raw || 0) - this.trendRef;
        this.trendRef = r.raw || 0; this.trendT = 0;
      }
      if (r.engaged) {
        if (this.improving > 0.01 || r.alignment > 0.8) this.urgency -= dt * 0.08;
        else if (r.alignment < 0.75) this.urgency += dt * 0.025;
      } else this.urgency += (0.3 - this.urgency) * ease(0.2, dt);
      this.urgency = clamp(this.urgency, 0, 1);

      const target = r.engaged
        ? clamp((0.6 * (1 - r.precision) + 0.4 * Math.pow(1 - r.alignment, 0.85) * 1.2) * (0.65 + 0.6 * this.urgency) * 1.3, 0, 1)
        : 0.22; // before any piece: it only expresses, gently
      this.insistence += (target - this.insistence) * ease(0.6, dt);

      this.negotiate(dt);

      // spatial signal maps (smoothed) + flashes
      const k = r.engaged ? 0.6 + 0.8 * this.insistence : 0;
      for (let c = 0; c < N; c++) {
        this.lackS[c] += (Math.min(1, r.lack[c] * 1.4) * k - this.lackS[c]) * ease(0.9, dt);
        this.excessS[c] += (Math.min(1, r.excess[c] * 1.6) * k - this.excessS[c]) * ease(0.9, dt);
        this.harmonyS[c] += (r.harmony[c] * (0.5 + 0.5 * this.alignment) - this.harmonyS[c]) * ease(0.5, dt);
        this.flash[c] *= Math.exp(-dt * 2.2);
      }

      // accord: sustained agreement
      if (r.engaged && this.alignment > 0.82) {
        this.accordT += dt;
        if (!this.accord && this.accordT > 6) { this.accord = true; this.emit('accord', { alignment: this.alignment }); }
      } else {
        this.accordT = 0;
        if (this.accord && this.alignment < 0.7) { this.accord = false; this.emit('discord', { alignment: this.alignment }); }
      }

      // insistent impulses: irregular, faster and sharper when misaligned
      this.impulseT -= dt;
      if (this.impulseT <= 0) {
        const interval = (r.engaged ? 5.5 - 4.9 * this.insistence : 6.5) * this.rng.float(0.65, 1.45);
        this.impulseT = this.accord ? interval * 2.2 : interval;
        return this.makeImpulse();
      }
      return null;
    }

    makeImpulse() {
      const r = this.result;
      if (r.engaged) {
        const f = this.focus(3);
        if (!f.length) return null;
        const pick = this.rng.weighted(f, (x) => x.amount * x.amount);
        const c = at(pick.i, pick.j);
        this.flash[c] = 1;
        return { i: pick.i, j: pick.j, kind: pick.kind, strength: clamp(0.35 + 0.65 * this.insistence, 0, 1), engaged: true };
      }
      // not engaged yet: it points at what it wants, softly
      const cells = [];
      for (let c = 0; c < N; c++) if (this.Teff[c] > 0) cells.push(c);
      if (!cells.length) return null;
      const c = this.rng.weighted(cells, (x) => this.Teff[x] ** 1.5);
      return { i: c % COLS, j: (c / COLS) | 0, kind: 'want', strength: 0.25 + 0.1 * (this.Teff[c] / MAXH), engaged: false };
    }

    /** Bounded concessions: it can be persuaded a little, never converted. */
    negotiate(dt) {
      if (!this.model || !this.result.engaged) return;
      const B = this.model.h;
      let changed = false;
      for (let c = 0; c < N; c++) {
        const i = c % COLS, j = (c / COLS) | 0;
        const deviation = B[c] > 0 && this.T[c] === 0;
        this.persist[c] = deviation ? this.persist[c] + dt : Math.max(0, this.persist[c] - dt * 2);
        const refusing = this.T[c] > 0 && B[c] === 0 && this.result.engaged;
        this.refused[c] = refusing ? this.refused[c] + dt : Math.max(0, this.refused[c] - dt * 2);

        let goal = this.T[c];
        if (this.persist[c] > 18) {
          // neighbours of its own intention are easier to accept than far deviations
          let near = false;
          for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (inside(i + di, j + dj) && this.T[at(i + di, j + dj)] > 0) near = true;
          goal = B[c] * this.plasticity * (near ? 1 : 0.35);
        } else if (this.refused[c] > 40) {
          goal = this.T[c] * (1 - this.plasticity * 0.6);
        }
        const next = this.Teff[c] + (goal - this.Teff[c]) * ease(0.04, dt);
        if (Math.abs(next - this.Teff[c]) > 1e-4) changed = true;
        this.Teff[c] = next;
      }
      if (changed) {
        this._negT = (this._negT || 0) + dt;
        if (this._negT > 1) { this._negT = 0; this.reevaluate(); }
      }
    }

    on(fn) { this.listeners.push(fn); }
    emit(type, data) { for (const fn of this.listeners) fn(type, data); }

    /** RGBA bytes for the renderer: lack, excess, harmony, lack-flash. */
    texture(out) {
      for (let c = 0; c < N; c++) {
        const lackFlash = this.result.lack[c] > this.result.excess[c] ? this.flash[c] : 0;
        const exFlash = this.result.excess[c] >= this.result.lack[c] ? this.flash[c] : 0;
        out[c * 4] = Math.round(clamp(this.lackS[c], 0, 1) * 255);
        out[c * 4 + 1] = Math.round(clamp(this.excessS[c] + exFlash * 0.5, 0, 1) * 255);
        out[c * 4 + 2] = Math.round(clamp(this.harmonyS[c], 0, 1) * 255);
        out[c * 4 + 3] = Math.round(clamp(lackFlash, 0, 1) * 255);
      }
      return out;
    }
  }

  /* ------------------------------------------------------- surface mapping */
  // The grid covers the whole surface (minus a margin): the surface is a
  // top-down view of the construction site.
  const MARGIN = 0.06;
  const rect = (aspect) => ({ x0: MARGIN, y0: MARGIN, x1: aspect - MARGIN, y1: 1 - MARGIN });
  function cellToWorld(i, j, aspect) {
    const r = rect(aspect);
    return { x: r.x0 + ((i + 0.5) / COLS) * (r.x1 - r.x0), y: r.y0 + ((j + 0.5) / ROWS) * (r.y1 - r.y0) };
  }
  function worldToGrid(x, y, aspect) {
    const r = rect(aspect);
    return { gx: ((x - r.x0) / (r.x1 - r.x0)) * COLS, gy: ((y - r.y0) / (r.y1 - r.y0)) * ROWS };
  }

  RUIN.will = { Will, Model, ARCHETYPES, COLS, ROWS, MAXH, N, evaluate, blur, features, rect, cellToWorld, worldToGrid };
})((window.RUIN = window.RUIN || {}));
