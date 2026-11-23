/* ---------------------------------------------------------------------------
 * cameras.js: two webcams watch a real construction (Jenga blocks) and the
 * daemon reads it instead of growing its own body.
 *
 *   TOP camera   looks down on the building area: which of the 8 × 5 cells
 *                hold matter (difference from a picture of the empty area)
 *   SIDE camera  looks at the front edge: how tall each of the 8 columns is
 *                (measured against one standing block)
 *
 * Each cell's height = occupied (top) × its column's height (side). Without a
 * side camera every occupied cell counts as one standing block. A change is
 * only reported once the picture has been still for a moment, so a hand
 * reaching in does not count.
 *
 * Setup (W or "cams"):
 *   1. choose the two cameras
 *   2. top: "corners", then click the 4 corners of the building area:
 *      back-left, back-right, front-right, front-left (front = the side camera's side)
 *   3. side: "base", then click the front edge's left end, its right end,
 *      and the top of one block standing upright on the left end
 *   4. clear the area, press "empty" on each camera (the reference picture)
 *   5. tick "live": the daemon now reads what you build
 * The calibration is remembered in this browser.
 * ------------------------------------------------------------------------- */
(function (RUIN) {
  'use strict';

  const W = () => RUIN.will;
  const SW = 160, SH = 120;          // analysis resolution
  const BLOCK_LEVELS = 2.5;          // one standing Jenga block, in the will's levels
  const STILL = 0.9;                 // seconds the picture must be still before it counts
  const STORE = 'ruin.cams';

  // the laptop's own camera is never chosen on its own: only added webcams
  const BUILT_IN = /true vision|integrated|built-?in|facetime|internal|front|rear|ir|infrared/i;

  const load = () => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; } };
  const save = (o) => { try { localStorage.setItem(STORE, JSON.stringify(o)); } catch (e) { /* private window */ } };

  class Cam {
    constructor(role, cfg) {
      this.role = role;
      this.deviceId = cfg.deviceId || '';
      this.points = cfg.points || [];
      this.video = document.createElement('video');
      this.video.muted = true; this.video.playsInline = true;
      this.work = document.createElement('canvas');
      this.work.width = SW; this.work.height = SH;
      this.wctx = this.work.getContext('2d', { willReadFrequently: true });
      this.bg = null;
      this.frame = null;
      this.stream = null;
      this.picking = 0;              // clicks still expected while calibrating
    }
    get need() { return this.role === 'top' ? 4 : 3; }
    get calibrated() { return this.points.length === this.need; }
    get live() { return !!this.stream && this.video.readyState >= 2; }

    async open(id) {
      this.close();
      this.deviceId = id;
      this.bg = null;
      if (!id) return;
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: id }, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      this.video.srcObject = this.stream;
      await this.video.play().catch(() => {});
    }
    close() {
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
      this.video.srcObject = null;
    }
    grab() {
      if (!this.live) return null;
      this.wctx.drawImage(this.video, 0, 0, SW, SH);
      this.frame = this.wctx.getImageData(0, 0, SW, SH).data;
      return this.frame;
    }
    capture() { if (this.grab()) this.bg = Uint8ClampedArray.from(this.frame); }

    /** does the picture differ from the empty reference at (u, v) in 0..1? */
    changed(u, v, thr) {
      const x = Math.round(u * (SW - 1)), y = Math.round(v * (SH - 1));
      if (x < 0 || y < 0 || x >= SW || y >= SH) return false;
      const k = (y * SW + x) * 4, f = this.frame, b = this.bg;
      return Math.abs(f[k] - b[k]) + Math.abs(f[k + 1] - b[k + 1]) + Math.abs(f[k + 2] - b[k + 2]) > thr;
    }
  }

  class Cameras {
    constructor({ daemon, growth }) {
      this.daemon = daemon;
      this.growth = growth;
      const cfg = load();
      this.sens = cfg.sens ?? 0.5;
      this.cams = { top: new Cam('top', cfg.top || {}), side: new Cam('side', cfg.side || {}) };
      this.occ = new Float32Array(40);
      this.cols = new Float32Array(8);
      this.raw = null;
      this.committed = new Float32Array(40);
      this.stillT = 0;
      this.tick = 0;
      this.isLive = false;
      this.build();
      daemon.on('session:start', () => setTimeout(() => { if (this.isLive) this.push(null); }, 0));
    }

    get thr() { return 30 + (1 - this.sens) * 90; }

    /* ---- the panel ---------------------------------------------------------- */
    build() {
      const el = document.createElement('div');
      el.className = 'cams';
      el.hidden = true;
      el.innerHTML = `
        <div class="cams__head"><span>cameras</span>
          <label><input type="checkbox" data-live> live</label>
          <button type="button" data-close title="close (w)">×</button></div>
        ${['top', 'side'].map((r) => `
        <div class="cams__slot" data-role="${r}">
          <div class="cams__row"><b>${r}</b><select data-dev></select></div>
          <canvas width="320" height="240"></canvas>
          <div class="cams__row">
            <button type="button" data-cal>${r === 'top' ? 'corners' : 'base'}</button>
            <button type="button" data-empty>empty</button>
            <span data-hint></span></div>
        </div>`).join('')}
        <div class="cams__row"><span>sensitivity</span><input type="range" min="0" max="1" step="0.01" data-sens></div>
        <p class="cams__status" data-status></p>`;
      document.body.appendChild(el);
      this.el = el;
      const q = (s, root = el) => root.querySelector(s);
      this.statusEl = q('[data-status]');
      this.liveEl = q('[data-live]');
      q('[data-close]').addEventListener('click', () => this.toggle(false));
      this.liveEl.addEventListener('change', () => this.setLive(this.liveEl.checked));
      const sens = q('[data-sens]');
      sens.value = this.sens;
      sens.addEventListener('input', () => { this.sens = +sens.value; this.store(); });

      for (const slot of el.querySelectorAll('.cams__slot')) {
        const cam = this.cams[slot.dataset.role];
        cam.view = q('canvas', slot);
        cam.vctx = cam.view.getContext('2d');
        cam.select = q('[data-dev]', slot);
        cam.hint = q('[data-hint]', slot);
        cam.select.addEventListener('change', () => this.use(cam, cam.select.value));
        q('[data-cal]', slot).addEventListener('click', () => { cam.points = []; cam.picking = cam.need; this.store(); });
        q('[data-empty]', slot).addEventListener('click', () => { cam.capture(); this.status(cam.bg ? `${cam.role}: empty picture taken` : `${cam.role}: no picture yet`); });
        cam.view.addEventListener('pointerdown', (ev) => {
          if (!cam.picking) return;
          const r = cam.view.getBoundingClientRect();
          cam.points.push([(ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height]);
          cam.picking--;
          this.store();
        });
      }

      window.addEventListener('keydown', (ev) => {
        if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLSelectElement || ev.ctrlKey || ev.metaKey || ev.altKey) return;
        if (ev.key === 'w' || ev.key === 'W') this.toggle();
      });
      document.getElementById('btn-cams')?.addEventListener('click', () => this.toggle());
    }

    store() {
      const c = this.cams;
      save({ sens: this.sens, top: { deviceId: c.top.deviceId, points: c.top.points }, side: { deviceId: c.side.deviceId, points: c.side.points } });
    }

    status(t) { this.statusEl.textContent = t; }

    async toggle(on = this.el.hidden) {
      this.el.hidden = !on;
      document.getElementById('btn-cams')?.setAttribute('aria-pressed', String(on || this.isLive));
      if (on && !this.listed) await this.list();
    }

    async list() {
      if (!navigator.mediaDevices?.getUserMedia) { this.status('this browser cannot reach cameras here (open it over https or as a local file in Chrome/Edge)'); return; }
      try {
        // labels are only visible after permission was granted once
        const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        probe.getTracks().forEach((t) => t.stop());
      } catch (e) { this.status('camera permission refused: ' + e.name); return; }
      const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      const ext = devs.filter((d) => !BUILT_IN.test(d.label));
      this.listed = true;
      const taken = new Set();
      for (const cam of Object.values(this.cams)) {
        cam.select.innerHTML = '<option value="">— none —</option>' + devs.map((d, k) => `<option value="${d.deviceId}">${(d.label || 'camera ' + (k + 1)).replace(/</g, '') + (BUILT_IN.test(d.label) ? ' (laptop)' : '')}</option>`).join('');
        // keep a remembered webcam; otherwise take the next added webcam (never the laptop's)
        if (!ext.some((d) => d.deviceId === cam.deviceId) || taken.has(cam.deviceId)) cam.deviceId = (ext.find((d) => !taken.has(d.deviceId)) || {}).deviceId || '';
        taken.add(cam.deviceId);
        cam.select.value = cam.deviceId;
        if (cam.deviceId) await this.use(cam, cam.deviceId);
      }
      this.status(!ext.length ? 'no added webcam found, only the laptop camera; check the webcam drivers'
        : ext.length < 2 ? '1 webcam found (top); plug in a second one for the side' : `${ext.length} webcams found: top and side chosen`);
    }

    async use(cam, id) {
      try { await cam.open(id); this.status(id ? `${cam.role}: on; clear the area and press "empty"` : `${cam.role}: off`); }
      catch (e) { this.status(`${cam.role}: could not open (${e.name}); two cameras on one USB hub sometimes refuse`); cam.deviceId = ''; cam.select.value = ''; }
      this.store();
    }

    setLive(on) {
      const top = this.cams.top;
      if (on && !(top.live && top.calibrated && top.bg)) {
        this.liveEl.checked = false;
        this.status('the top camera needs corners and an empty picture first');
        return;
      }
      this.isLive = on;
      this.liveEl.checked = on;
      this.growth.setLive(on);
      document.body.classList.toggle('is-cams', on);
      document.getElementById('btn-cams')?.setAttribute('aria-pressed', String(on || !this.el.hidden));
      if (on) { this.committed = new Float32Array(W().N); this.raw = null; this.status('live: build, then take your hands away'); }
      else this.status('live off: the daemon grows its own body again');
    }

    /* ---- reading the construction ------------------------------------------------ */
    readTop(cam) {
      const { COLS, ROWS } = W(), P = cam.points, thr = this.thr;
      const map = (u, v) => [0, 1].map((a) => (1 - u) * (1 - v) * P[0][a] + u * (1 - v) * P[1][a] + u * v * P[2][a] + (1 - u) * v * P[3][a]);
      const S = 6;
      for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
        let hit = 0;
        for (let b = 0; b < S; b++) for (let a = 0; a < S; a++) {
          const [x, y] = map((i + 0.15 + 0.7 * a / (S - 1)) / COLS, (j + 0.15 + 0.7 * b / (S - 1)) / ROWS);
          if (cam.changed(x, y, thr)) hit++;
        }
        this.occ[j * COLS + i] = hit / (S * S);
      }
    }

    readSide(cam) {
      const { COLS, MAXH } = W(), [L, R, U] = cam.points, thr = this.thr;
      const up = [U[0] - L[0], U[1] - L[1]];                 // one standing block
      const top = MAXH / BLOCK_LEVELS + 0.3, step = 0.04;
      for (let i = 0; i < COLS; i++) {
        let h = 0, gap = 0;
        for (let k = 0.06; k <= top; k += step) {
          let hit = 0;
          for (let a = 0; a < 5; a++) {
            const u = (i + 0.15 + 0.7 * a / 4) / COLS;
            const bx = L[0] + (R[0] - L[0]) * u, by = L[1] + (R[1] - L[1]) * u;
            if (cam.changed(bx + up[0] * k, by + up[1] * k, thr)) hit++;
          }
          if (hit >= 2) { h = k; gap = 0; } else if ((gap += step) > 0.2) break;
        }
        this.cols[i] = Math.min(MAXH, h * BLOCK_LEVELS);
      }
    }

    heights() {
      const { COLS, N } = W(), H = new Float32Array(N);
      const side = this.cams.side, useSide = side.live && side.calibrated && side.bg;
      for (let c = 0; c < N; c++) {
        if (this.occ[c] < 0.22) continue;
        const h = useSide ? this.cols[c % COLS] : BLOCK_LEVELS;
        H[c] = Math.round(Math.max(0.5, h) * 2) / 2;          // half levels: steady
      }
      return H;
    }

    push(at) {
      const H = this.committed;
      let count = 0;
      for (const v of H) if (v > 0) count++;
      if (this.daemon.state === 'session') { this.growth.mirror(H); this.daemon.setModel(H, count, at); }
      else this.growth.liveH = Float32Array.from(H);
    }

    update(dt) {
      const top = this.cams.top, side = this.cams.side;
      if (this.el.hidden && !this.isLive) return;
      this.tick -= dt;
      if (this.tick > 0) return;
      this.tick = 0.12;
      for (const cam of [top, side]) cam.grab();
      if (top.frame && top.bg && top.calibrated) this.readTop(top);
      if (side.frame && side.bg && side.calibrated) this.readSide(side);
      if (!this.el.hidden) this.draw();
      if (!this.isLive || !top.frame) return;

      // only a still picture counts: a hand passing through is ignored
      const H = this.heights();
      const same = this.raw && H.every((v, c) => Math.abs(v - this.raw[c]) < 0.5);
      this.raw = H;
      this.stillT = same ? this.stillT + 0.12 : 0;
      if (this.stillT < STILL) return;
      let best = -1, bd = 0;
      for (let c = 0; c < H.length; c++) { const d = Math.abs(H[c] - this.committed[c]); if (d > bd) { bd = d; best = c; } }
      if (best < 0 || bd < 0.5) return;
      const { COLS } = W(), delta = Math.sign(H[best] - this.committed[best]);
      this.committed = Float32Array.from(H);
      this.push({ i: best % COLS, j: (best / COLS) | 0, delta, height: H[best] });
      this.status(`seen: ${H.filter((v) => v > 0).length} cells built`);
    }

    /* ---- what the cameras see, for setting up -------------------------------------- */
    draw() {
      const { COLS, ROWS } = W();
      for (const cam of Object.values(this.cams)) {
        const g = cam.vctx, w = cam.view.width, h = cam.view.height;
        g.fillStyle = '#d9cfbd'; g.fillRect(0, 0, w, h);
        if (cam.live) g.drawImage(cam.video, 0, 0, w, h);
        const P = cam.points.map(([x, y]) => [x * w, y * h]);
        g.lineWidth = 1.5; g.strokeStyle = '#b0301e'; g.fillStyle = '#b0301e';
        P.forEach(([x, y], k) => { g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); g.fillText(String(k + 1), x + 6, y - 6); });
        if (cam.role === 'top' && cam.calibrated) {
          const map = (u, v) => [0, 1].map((a) => (1 - u) * (1 - v) * P[0][a] + u * (1 - v) * P[1][a] + u * v * P[2][a] + (1 - u) * v * P[3][a]);
          for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
            const o = this.occ[j * COLS + i];
            const q = [map(i / COLS, j / ROWS), map((i + 1) / COLS, j / ROWS), map((i + 1) / COLS, (j + 1) / ROWS), map(i / COLS, (j + 1) / ROWS)];
            g.beginPath(); q.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath();
            if (cam.bg && o >= 0.22) { g.fillStyle = 'rgba(176,48,30,0.45)'; g.fill(); }
            g.strokeStyle = 'rgba(176,48,30,0.5)'; g.stroke();
          }
        }
        if (cam.role === 'side' && cam.calibrated) {
          const [L, R, U] = P, up = [U[0] - L[0], U[1] - L[1]];
          g.beginPath(); g.moveTo(L[0], L[1]); g.lineTo(R[0], R[1]); g.stroke();
          for (let i = 0; i < COLS; i++) {
            const u = (i + 0.5) / COLS, bx = L[0] + (R[0] - L[0]) * u, by = L[1] + (R[1] - L[1]) * u, k = this.cols[i] / BLOCK_LEVELS;
            g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + up[0] * k, by + up[1] * k);
            g.lineWidth = 5; g.strokeStyle = 'rgba(176,48,30,0.6)'; g.stroke(); g.lineWidth = 1.5;
          }
        }
        cam.hint.textContent = cam.picking
          ? (cam.role === 'top' ? ['back-left', 'back-right', 'front-right', 'front-left'] : ['front edge, left end', 'front edge, right end', 'top of one standing block on the left end'])[cam.need - cam.picking]
          : !cam.live ? '' : !cam.calibrated ? 'not calibrated' : !cam.bg ? 'press empty' : 'ready';
      }
    }
  }

  RUIN.Cameras = Cameras;
})((window.RUIN = window.RUIN || {}));
