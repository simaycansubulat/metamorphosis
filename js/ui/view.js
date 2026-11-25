/* ---------------------------------------------------------------------------
 * view.js — looking at the daemon's body, and offering it attention.
 *
 *   click / tap            (dormant) wake the daemon where you touched
 *   drag                   turn around the board · scroll / pinch: closer
 *   press & hold still     offer attention at a point: nearby loci respond
 *                          and nearby pieces grow faster
 *   T (or "above")         look straight down, as in the flat version
 *   1-5                    preset views: 1 orbit · 2 above · 3 low · 4 side ·
 *                          5 close up on a piece (again: another piece)
 *   C (or "cuts")          the camera cuts between the presets on its own
 *
 * Nobody builds: the pieces are grown by the daemon (growth.js).
 * Left alone, the view turns very slowly around the body.
 * ------------------------------------------------------------------------- */
(function (RUIN) {
  'use strict';

  const SHOTS = { 1: 'orbit', 2: 'above', 3: 'low', 4: 'side', 5: 'close' };

  class View {
    constructor({ daemon, renderer, growth, ui, canvas, clock }) {
      this.daemon = daemon;
      this.scene = renderer.scene;
      this.growth = growth;
      this.ui = ui;
      this.canvas = canvas;
      this.clock = clock;
      this.pointers = new Map();
      this.press = null;
      this.viewEl = document.getElementById('btn-view');
      this.cutsEl = document.getElementById('btn-cuts');
      this.bind();
    }

    pick(ev) { return this.scene.pick(ev.clientX, ev.clientY, this.canvas.getBoundingClientRect()); }

    bind() {
      const cv = this.canvas, d = this.daemon, A = RUIN.BOARD_ASPECT;
      const world = (p) => ({ x: p[0] + A / 2, y: p[2] + 0.5 });

      cv.addEventListener('pointerdown', (ev) => {
        this.ui.wake();
        if (d.state === 'dormant') {
          const hit = this.pick(ev);
          this.ui.begin(hit ? world(hit.point) : undefined);
          return;
        }
        cv.setPointerCapture(ev.pointerId);
        this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        if (this.pointers.size === 2) {
          const [a, b] = [...this.pointers.values()];
          this.pinch = Math.hypot(a.x - b.x, a.y - b.y);
          if (this.press) this.press.moved = true;
          return;
        }
        this.press = { x: ev.clientX, y: ev.clientY, t: 0, moved: false, ev };
      });

      cv.addEventListener('pointermove', (ev) => {
        const prev = this.pointers.get(ev.pointerId);
        if (!prev) return;
        if (this.pointers.size === 2) {
          prev.x = ev.clientX; prev.y = ev.clientY;
          const [a, b] = [...this.pointers.values()];
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          if (this.pinch) { this.setAuto(false); this.scene.zoom(this.pinch / Math.max(1, dist)); }
          this.pinch = dist;
          return;
        }
        const dx = ev.clientX - prev.x, dy = ev.clientY - prev.y;
        prev.x = ev.clientX; prev.y = ev.clientY;
        const p = this.press;
        if (!p) return;
        p.ev = ev;
        if (!p.moved && !p.holding && Math.hypot(ev.clientX - p.x, ev.clientY - p.y) > 6) p.moved = true;
        if (p.moved) { this.setAuto(false); this.scene.orbit(-dx * 0.006, dy * 0.005); this.sync(); }
      });

      const up = (ev) => {
        this.pointers.delete(ev.pointerId);
        if (this.pointers.size < 2) this.pinch = null;
        if (this.pointers.size === 0) this.press = null;
      };
      cv.addEventListener('pointerup', up);
      cv.addEventListener('pointercancel', up);
      cv.addEventListener('contextmenu', (ev) => ev.preventDefault());
      cv.addEventListener('wheel', (ev) => { ev.preventDefault(); this.setAuto(false); this.scene.zoom(Math.exp(ev.deltaY * 0.0012)); }, { passive: false });

      window.addEventListener('keydown', (ev) => {
        if (ev.target instanceof HTMLInputElement || ev.ctrlKey || ev.metaKey || ev.altKey) return;
        if (ev.key === 't' || ev.key === 'T') { this.toggleTop(); this.ui.wake(); }
        else if (ev.key === 'v' || ev.key === 'V') { this.scene.touch = !this.scene.touch; document.body.classList.toggle('is-touch', this.scene.touch); }
        else if (ev.key === 'c' || ev.key === 'C') { this.setAuto(!this.scene.auto); this.ui.wake(); }
        else if (SHOTS[ev.key]) { this.setAuto(false); this.scene.setShot(SHOTS[ev.key]); this.sync(); this.ui.wake(); }
      });
      this.viewEl?.addEventListener('click', () => this.toggleTop());
      this.cutsEl?.addEventListener('click', () => this.setAuto(!this.scene.auto));
    }

    toggleTop() {
      this.setAuto(false);
      this.scene.toggleTop();
      this.sync();
    }

    setAuto(on) {
      if (this.scene.auto === on) return;
      this.scene.setAuto(on);
      this.sync();
    }

    sync() {
      this.viewEl?.setAttribute('aria-pressed', String(this.scene.top));
      this.cutsEl?.setAttribute('aria-pressed', String(this.scene.auto));
    }

    /** called every frame: a press held still is attention at that point */
    update(dt) {
      const p = this.press;
      if (this.scene.auto) this.sync();
      if (!p || p.moved || this.daemon.state !== 'session') return;
      p.t += dt;
      if (p.t < 0.25) return;
      p.holding = true;
      if (this.clock.held) return;
      const hit = this.pick(p.ev);
      if (!hit) return;
      const A = RUIN.BOARD_ASPECT;
      this.daemon.stimulate(hit.point[0] + A / 2, hit.point[2] + 0.5, 0.9 * dt * 4);
      this.growth.attend(hit.point[0], hit.point[2], dt);
    }
  }

  RUIN.View = View;
})((window.RUIN = window.RUIN || {}));
