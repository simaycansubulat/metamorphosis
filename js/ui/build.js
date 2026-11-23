/* ---------------------------------------------------------------------------
 * build.js — building on the daemon's surface, in three dimensions.
 *
 * The participant answers with wooden pieces (Jenga proportions 3 : 1 : 0.6),
 * laid flat, on edge or standing. Pieces snap to a half-cell grid over the
 * construction area, fall until they rest on whatever lies beneath them
 * (so two posts and a lintel make an arch), and fall again when the piece
 * under them is lifted.
 *
 *   click                 set the piece down where the ghost shows it
 *   right-click / "lift"  lift the piece under the pointer
 *   drag                  turn around the board · scroll / pinch: closer
 *   press & hold still    offer attention at a point (the old touch)
 *   R / shift+R           turn the next piece · 1–6 choose how it lies
 *   T                     look from above (the old, flat view) and back
 *   Z                     lift the last piece set down
 *
 * The construction is reported to the daemon as the same 8 × 5 height map
 * its will thinks in: the will itself is unchanged.
 * ------------------------------------------------------------------------- */
(function (RUIN) {
  'use strict';

  const W = RUIN.will;
  const A = RUIN.BOARD_ASPECT;
  const M = 0.06;
  const CELL = (1 - 2 * M) / W.ROWS;
  const S = CELL / 2;                     // the sub-grid: half a cell
  const SX = W.COLS * 2, SZ = W.ROWS * 2;
  const X0 = M - A / 2, Z0 = M - 0.5;     // corner of the construction area in 3D
  const LEVEL = 0.6 * S;                  // one flat piece = one level of the will
  const MAX_PIECES = RUIN.scene.MAXB;
  const MAX_TOP = 0.9;
  const EPS = 1e-4;

  const SHAPES = [
    { key: 'flat-x', label: 'flat, across', s: [3, 0.6, 1] },
    { key: 'flat-z', label: 'flat, in depth', s: [1, 0.6, 3] },
    { key: 'edge-x', label: 'on edge, across', s: [3, 1, 0.6] },
    { key: 'edge-z', label: 'on edge, in depth', s: [0.6, 1, 3] },
    { key: 'stand-a', label: 'standing', s: [1, 3, 0.6] },
    { key: 'stand-b', label: 'standing, turned', s: [0.6, 3, 1] },
  ];

  const overlap = (a, b) =>
    a.c[0] - a.h[0] < b.c[0] + b.h[0] - EPS && b.c[0] - b.h[0] < a.c[0] + a.h[0] - EPS &&
    a.c[2] - a.h[2] < b.c[2] + b.h[2] - EPS && b.c[2] - b.h[2] < a.c[2] + a.h[2] - EPS;
  const top = (b) => b.c[1] + b.h[1];

  /** an isometric drawing of a piece, for the buttons */
  function icon(s) {
    const k = 7, cx = 0.866, P = (x, y, z) => [(x - z) * cx * k, ((x + z) * 0.5 - y) * k];
    const [a, b, c] = s;
    const pts = {
      t: [P(0, b, 0), P(a, b, 0), P(a, b, c), P(0, b, c)],
      f: [P(0, 0, c), P(a, 0, c), P(a, b, c), P(0, b, c)],
      r: [P(a, 0, 0), P(a, 0, c), P(a, b, c), P(a, b, 0)],
    };
    const all = [].concat(pts.t, pts.f, pts.r);
    const minx = Math.min(...all.map((p) => p[0])), maxx = Math.max(...all.map((p) => p[0]));
    const miny = Math.min(...all.map((p) => p[1])), maxy = Math.max(...all.map((p) => p[1]));
    const poly = (L, cls) => `<polygon class="${cls}" points="${L.map((p) => `${(p[0] - minx + 2).toFixed(1)},${(p[1] - miny + 2).toFixed(1)}`).join(' ')}"/>`;
    return `<svg viewBox="0 0 ${(maxx - minx + 4).toFixed(1)} ${(maxy - miny + 4).toFixed(1)}" aria-hidden="true">${poly(pts.f, 'f')}${poly(pts.r, 'r')}${poly(pts.t, 't')}</svg>`;
  }

  class Build {
    constructor({ daemon, renderer, ui, canvas, root, clock }) {
      this.daemon = daemon;
      this.renderer = renderer;
      this.scene = renderer.scene;
      this.ui = ui;
      this.canvas = canvas;
      this.root = root;
      this.clock = clock;
      this.blocks = [];
      this.shape = 0;
      this.lift = false;
      this.pointers = new Map();
      this.press = null;
      this.hoverEv = null;

      this.shapesEl = root.querySelector('.site__shapes');
      this.countEl = root.querySelector('.site__count');
      this.modeEl = root.querySelector('.site__mode');
      this.viewEl = root.querySelector('.site__view');
      this.clearEl = root.querySelector('.site__clear');
      this.shapeButtons = SHAPES.map((sh, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'site__shape';
        b.title = `${sh.label} (${i + 1})`;
        b.setAttribute('aria-label', sh.label);
        b.innerHTML = icon(sh.s);
        b.addEventListener('click', () => this.setShape(i));
        this.shapesEl.appendChild(b);
        return b;
      });
      this.setShape(0);
      this.bind();
      this.render();
    }

    setShape(i) {
      this.shape = (i + SHAPES.length) % SHAPES.length;
      this.shapeButtons.forEach((b, k) => b.setAttribute('aria-pressed', String(k === this.shape)));
      this.refreshGhost();
    }

    /* ---- geometry ---------------------------------------------------------------- */
    half(shape) { const s = SHAPES[shape].s; return [s[0] * S / 2, s[1] * S / 2, s[2] * S / 2]; }

    snapAxis(v, origin, n, h) {
      const k = Math.floor((v - origin) / S);
      const c = origin + (Math.max(0, Math.min(n - 1, k)) + 0.5) * S;
      return Math.max(origin + h, Math.min(origin + n * S - h, c));
    }

    /** resting height for a footprint: on top of whatever lies beneath */
    restOn(cand, list = this.blocks) {
      let y = 0;
      for (const b of list) if (b !== cand && overlap(cand, b)) y = Math.max(y, top(b));
      return y;
    }

    /** where the next piece would go, for a pick under the pointer */
    candidate(hit) {
      if (!hit) return null;
      const h = this.half(this.shape);
      let p = hit.point.slice();
      const side = hit.kind === 'block' && hit.normal[1] === 0;
      if (side) p = [p[0] + hit.normal[0] * 0.01, p[1], p[2] + hit.normal[2] * 0.01];
      const cand = { c: [this.snapAxis(p[0], X0, SX, h[0]), 0, this.snapAxis(p[2], Z0, SZ, h[2])], h };
      if (side) {
        // step away from the touched piece until the footprints part
        const other = this.blocks[hit.index];
        for (let k = 0; k < 3 && overlap(cand, other); k++) {
          cand.c[0] = this.snapAxis(cand.c[0] + hit.normal[0] * S, X0, SX, h[0]);
          cand.c[2] = this.snapAxis(cand.c[2] + hit.normal[2] * S, Z0, SZ, h[2]);
        }
      }
      cand.c[1] = this.restOn(cand) + h[1];
      cand.valid = this.blocks.length < MAX_PIECES && top(cand) <= MAX_TOP;
      return cand;
    }

    /** after a piece is lifted, what rested on it falls */
    settle() {
      const sorted = this.blocks.slice().sort((a, b) => (a.c[1] - a.h[1]) - (b.c[1] - b.h[1]));
      const done = [];
      for (const b of sorted) {
        const y = this.restOn(b, done) + b.h[1];
        if (y < b.c[1] - EPS) b.drop = Math.min(1, b.drop + 0.6);
        b.c[1] = y;
        done.push(b);
      }
    }

    /** the construction, as the will sees it: an 8 × 5 height map */
    heights() {
      const sub = new Float32Array(SX * SZ);
      for (const b of this.blocks) {
        const t = top(b) / LEVEL;
        for (let k = 0; k < SZ; k++) for (let i = 0; i < SX; i++) {
          const x0 = X0 + i * S, z0 = Z0 + k * S;
          const ox = Math.min(x0 + S, b.c[0] + b.h[0]) - Math.max(x0, b.c[0] - b.h[0]);
          const oz = Math.min(z0 + S, b.c[2] + b.h[2]) - Math.max(z0, b.c[2] - b.h[2]);
          if (ox > 0 && oz > 0 && ox * oz > 0.2 * S * S) sub[k * SX + i] = Math.max(sub[k * SX + i], t);
        }
      }
      const H = new Float32Array(W.N);
      for (let j = 0; j < W.ROWS; j++) for (let i = 0; i < W.COLS; i++) {
        let mx = 0, sum = 0;
        for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++) {
          const v = sub[(j * 2 + dj) * SX + i * 2 + di];
          mx = Math.max(mx, v); sum += v;
        }
        H[j * W.COLS + i] = Math.min(W.MAXH, 0.6 * mx + 0.4 * (sum / 4));
      }
      return H;
    }

    cellOf(c) {
      const g = W.worldToGrid(c[0] + A / 2, c[2] + 0.5, A);
      return { i: Math.max(0, Math.min(W.COLS - 1, Math.floor(g.gx))), j: Math.max(0, Math.min(W.ROWS - 1, Math.floor(g.gy))) };
    }

    report(changed, delta) {
      const H = this.heights();
      let at = null;
      if (changed) {
        const { i, j } = this.cellOf(changed.c);
        at = { i, j, delta, height: H[j * W.COLS + i] };
      }
      this.daemon.setModel(H, this.blocks.length, at);
      this.scene.setBlocks(this.blocks);
      this.render();
    }

    /* ---- actions ------------------------------------------------------------------ */
    place(cand) {
      if (this.daemon.state !== 'session' || !cand || !cand.valid) return;
      const b = { c: cand.c.slice(), h: cand.h.slice(), seed: Math.random() * 10, born: performance.now() / 1000, drop: 1 };
      this.blocks.push(b);
      this.report(b, +1);
    }

    remove(index) {
      if (this.daemon.state !== 'session' || index == null || index < 0) return;
      const [b] = this.blocks.splice(index, 1);
      this.settle();
      this.report(b, -1);
    }

    clearAll(tell = true) {
      this.blocks = [];
      this.scene.setBlocks(this.blocks);
      if (tell) this.daemon.clearModel();
      this.render();
    }

    /* ---- pointer -------------------------------------------------------------------- */
    pick(ev) { return this.scene.pick(ev.clientX, ev.clientY, this.canvas.getBoundingClientRect()); }

    refreshGhost() {
      const ev = this.hoverEv;
      const r = this.renderer;
      this.scene.liftIndex = -1;
      if (!ev || this.daemon.state !== 'session' || this.press?.moved || this.press?.holding) {
        this.scene.ghost = null; r.hover = null; return;
      }
      const hit = this.pick(ev);
      if (this.lift || ev.shiftKey) {
        this.scene.ghost = null;
        this.scene.liftIndex = hit && hit.kind === 'block' ? hit.index : -1;
        r.hover = hit ? this.cellOf(hit.point) : null;
        return;
      }
      const cand = this.candidate(hit);
      this.scene.ghost = cand;
      r.hover = cand ? this.cellOf(cand.c) : null;
    }

    worldOf(p) { return { x: p[0] + A / 2, y: p[2] + 0.5 }; }

    bind() {
      const cv = this.canvas, d = this.daemon;

      cv.addEventListener('pointerdown', (ev) => {
        this.ui.wake();
        if (d.state === 'dormant') {
          const hit = this.pick(ev);
          this.ui.begin(hit ? this.worldOf(hit.point) : undefined);
          return;
        }
        cv.setPointerCapture(ev.pointerId);
        this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        if (this.pointers.size === 2) { // pinch
          const [a, b] = [...this.pointers.values()];
          this.pinch = Math.hypot(a.x - b.x, a.y - b.y);
          if (this.press) this.press.moved = true;
          return;
        }
        this.press = { x: ev.clientX, y: ev.clientY, t: 0, button: ev.button, moved: false, holding: false, ev, type: ev.pointerType };
      });

      cv.addEventListener('pointermove', (ev) => {
        const prev = this.pointers.get(ev.pointerId);
        if (prev) {
          if (this.pointers.size === 2) {
            prev.x = ev.clientX; prev.y = ev.clientY;
            const [a, b] = [...this.pointers.values()];
            const dist = Math.hypot(a.x - b.x, a.y - b.y);
            if (this.pinch) this.scene.zoom(this.pinch / Math.max(1, dist));
            this.pinch = dist;
            return;
          }
          const dx = ev.clientX - prev.x, dy = ev.clientY - prev.y;
          prev.x = ev.clientX; prev.y = ev.clientY;
          const p = this.press;
          if (p && !p.holding && !p.moved && Math.hypot(ev.clientX - p.x, ev.clientY - p.y) > 6) p.moved = true;
          if (p && p.moved) this.scene.orbit(-dx * 0.006, dy * 0.005);
          if (p && p.holding) p.ev = ev;
        }
        if (ev.pointerType === 'mouse' || this.press) { this.hoverEv = ev; this.refreshGhost(); }
      });

      const up = (ev, cancel) => {
        this.pointers.delete(ev.pointerId);
        if (this.pointers.size < 2) this.pinch = null;
        const p = this.press;
        if (!p || this.pointers.size > 0) return;
        this.press = null;
        if (cancel || p.moved || p.holding || d.state !== 'session') { this.refreshGhost(); return; }
        const hit = this.pick(ev);
        const lifting = p.button === 2 || this.lift || ev.shiftKey;
        if (lifting) { if (hit && hit.kind === 'block') this.remove(hit.index); }
        else this.place(this.candidate(hit));
        this.hoverEv = ev.pointerType === 'mouse' ? ev : null;
        this.refreshGhost();
      };
      cv.addEventListener('pointerup', (ev) => up(ev, false));
      cv.addEventListener('pointercancel', (ev) => up(ev, true));
      cv.addEventListener('pointerleave', (ev) => { if (!this.press) { this.hoverEv = null; this.refreshGhost(); } });
      cv.addEventListener('contextmenu', (ev) => ev.preventDefault());
      cv.addEventListener('wheel', (ev) => {
        ev.preventDefault();
        this.scene.zoom(Math.exp(ev.deltaY * 0.0012));
      }, { passive: false });

      window.addEventListener('keydown', (ev) => {
        if (ev.target instanceof HTMLInputElement) return;
        if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
        const k = ev.key;
        if (k === 'r' || k === 'R') this.setShape(this.shape + (ev.shiftKey ? -1 : 1));
        else if (k >= '1' && k <= '6') this.setShape(+k - 1);
        else if (k === 't' || k === 'T') this.toggleTop();
        else if ((k === 'z' || k === 'Z') && this.blocks.length) this.remove(this.blocks.length - 1);
        else if (k === 'Shift') this.refreshGhost();
        else return;
        this.ui.wake();
      });
      window.addEventListener('keyup', (ev) => { if (ev.key === 'Shift') this.refreshGhost(); });

      this.modeEl.addEventListener('click', () => {
        this.lift = !this.lift;
        this.modeEl.setAttribute('aria-pressed', String(this.lift));
        this.root.classList.toggle('is-lifting', this.lift);
        document.body.classList.toggle('is-lifting', this.lift);
      });
      this.viewEl.addEventListener('click', () => this.toggleTop());
      this.clearEl.addEventListener('click', () => {
        if (!this.clearEl.classList.contains('is-armed')) {
          this.clearEl.classList.add('is-armed');
          this.clearEl.textContent = 'clear?';
          clearTimeout(this._arm);
          this._arm = setTimeout(() => { this.clearEl.classList.remove('is-armed'); this.clearEl.textContent = 'clear'; }, 3000);
          return;
        }
        clearTimeout(this._arm);
        this.clearEl.classList.remove('is-armed'); this.clearEl.textContent = 'clear';
        this.clearAll(true);
      });

      d.on('session:start', () => this.clearAll(false));
      d.on('dormant', () => this.clearAll(false));
      d.on('session:end', () => { this.scene.ghost = null; this.render(); });
    }

    toggleTop() {
      this.scene.toggleTop();
      this.viewEl.setAttribute('aria-pressed', String(this.scene.top));
    }

    /** called every frame: press & hold still → attention at that point */
    update(dt) {
      const p = this.press;
      if (!p || p.moved || this.daemon.state !== 'session') return;
      p.t += dt;
      if (!p.holding && p.t > 0.32 && p.button === 0) { p.holding = true; this.refreshGhost(); }
      if (p.holding && !this.clock.held) {
        const hit = this.pick(p.ev);
        if (hit) { const w = this.worldOf(hit.point); this.daemon.stimulate(w.x, w.y, 0.9 * dt * 4); }
      }
    }

    render() {
      const n = this.daemon.state === 'session' ? this.blocks.length : 0;
      this.countEl.textContent = `${n} ${n === 1 ? 'piece' : 'pieces'}`;
    }
  }

  RUIN.Build = Build;
})((window.RUIN = window.RUIN || {}));
