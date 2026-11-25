/* ---------------------------------------------------------------------------
 * life.js — after the ruin has become ground, its matter wants to know what
 * it is like to be human. It cannot talk. It only has its stones, its weight
 * and the ground, so it tries what makes us human with its body:
 *
 *   VULNERABILITY  a being stacks its stones into an upright body, wobbles,
 *                  falls, lies there trembling, and slowly gets up again.
 *                  A sudden, fast movement near it makes it flinch and shrink.
 *   ATTACHMENT     beings that meet stay bonded: they return to each other and
 *                  breathe together side by side; apart too long, one goes
 *                  searching. One being attaches to the human: it follows the
 *                  cursor, and when the human stops, it waits where they were
 *                  and leaves a mark there that does not fade.
 *   IMPERFECTION   it stumbles while walking, hesitates, copies the human's
 *                  path a little wrong, echoes their taps but misses one, and
 *                  loses the rhythm while dancing.
 *   MORTALITY      it gets tired and sleeps, sinking a little into the ground;
 *                  its traces fade, slowly.
 *   and it plays: it walks, paints strokes of pigment, dances in rings; while it
 *   rests its stones beat like a heart.
 *
 * Everything it does stays on the ground (a canvas laid on the board, see
 * Scene.syncMarks), so the ground keeps its history.
 * ------------------------------------------------------------------------- */
(function (RUIN) {
  'use strict';

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (t) => t * t * (3 - 2 * t);
  const TAU = Math.PI * 2;
  const INKS = [[118, 42, 28], [150, 104, 52], [44, 38, 32], [92, 98, 58]];   // oxide, ochre, ink, moss
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  class Life {
    constructor({ growth, daemon, aspect }) {
      this.growth = growth;
      this.daemon = daemon;
      this.A = aspect;
      const c = document.createElement('canvas');
      c.width = 2048; c.height = Math.round(2048 / aspect);
      this.canvas = c;
      this.ctx = c.getContext('2d');
      this.k = c.width / aspect;               // canvas pixels per world unit
      this.version = 0;
      this.memory = document.createElement('canvas');   // marks that never fade
      this.memory.width = c.width; this.memory.height = c.height;
      this.mctx = this.memory.getContext('2d');
      this.rng = new RUIN.Random(7);
      this.reset(7);
      growth.onLand = (x, z, r) => this.grit(x, z, r);
      growth.onAttend = (x, z, dt) => { this.attn = { x, z, t: this.growth.t }; this.guide(x, z, dt || 0.016); };
      daemon.on('session:start', ({ seed }) => this.reset(seed));
      daemon.on('dormant', () => this.reset(1));
    }

    reset(seed) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.mctx.clearRect(0, 0, this.memory.width, this.memory.height);
      this.beings = [];
      this.on = false;
      this.attn = null;
      this.trail = [];             // where the human's cursor has been on the ground
      this.taps = [];              // the human's taps, waiting to be echoed
      this.fadeT = 0;
      this.rng = new RUIN.Random(((seed || 1) ^ 0x11fe) >>> 0);
      this.version++;
    }

    /* ---- the human ------------------------------------------------------------------ */
    /** the cursor over the ground (world x, z), from main.js */
    pointer(x, z) {
      const t = this.growth.t, tr = this.trail, last = tr[tr.length - 1];
      if (last && t - last.t < 0.05) return;
      const speed = last ? Math.hypot(x - last.x, z - last.z) / Math.max(0.016, t - last.t) : 0;
      tr.push({ x, z, t, speed });
      while (tr.length && t - tr[0].t > 8) tr.shift();
      if (this.on && speed > 1.2) this.startle(x, z);
    }

    tap(x, z) {
      if (!this.on) return;
      this.taps.push({ x, z, t: this.growth.t });
      if (this.taps.length > 9) this.taps.shift();
    }

    pointerAt(ago) {
      const tr = this.trail, t = this.growth.t - ago;
      for (let i = tr.length - 1; i >= 0; i--) if (tr[i].t <= t) return tr[i];
      return tr[0] || null;
    }

    pointerActive() {
      const last = this.trail[this.trail.length - 1];
      if (!last) return false;
      const moved = this.trail.filter((p) => this.growth.t - p.t < 2.5);
      return this.growth.t - last.t < 2.5 && moved.length > 3;
    }

    /* ---- the ground's memory ----------------------------------------------------- */
    px(x, z) { return [(x / this.A + 0.5) * this.canvas.width, (0.5 - z) * this.canvas.height]; }

    /** where a stone of the ruin broke, its grit becomes ground */
    grit(x, z, r) {
      this.flash = Math.max(this.flash || 0, 0.6);
      const c = this.ctx, [X, Y] = this.px(x, z), R = Math.max(6, r * this.k * 0.9), rng = this.rng;
      for (let k = 0; k < 4; k++) {
        const ox = rng.float(-R, R) * 0.6, oy = rng.float(-R, R) * 0.6, rr = R * rng.float(0.5, 1.1);
        const g = c.createRadialGradient(X + ox, Y + oy, 0, X + ox, Y + oy, rr);
        const tone = rng.float(0, 1);
        const col = `${Math.round(120 + 40 * tone)},${Math.round(110 + 34 * tone)},${Math.round(92 + 26 * tone)}`;
        g.addColorStop(0, `rgba(${col},0.32)`);
        g.addColorStop(1, `rgba(${col},0)`);
        c.fillStyle = g;
        c.beginPath(); c.arc(X + ox, Y + oy, rr, 0, TAU); c.fill();
      }
      c.fillStyle = 'rgba(70,62,52,0.5)';
      for (let k = 0; k < 14; k++) { c.beginPath(); c.arc(X + rng.float(-R, R), Y + rng.float(-R, R), rng.float(0.6, 2), 0, TAU); c.fill(); }
      this.version++;
    }

    /** a footprint: the stone's base pressed into the ground; a stumble smears it */
    footprint(p, smear = 0) {
      const c = this.ctx, [X, Y] = this.px(p.pos[0], p.pos[2]), rng = this.rng;
      const w = p.size[0] * this.k * 0.42, l = p.size[2] * this.k * 0.42;
      c.save();
      c.translate(X, Y); c.rotate(-p.yaw);
      c.fillStyle = `rgba(52,42,34,${0.42 + smear * 0.2})`;
      c.beginPath(); c.ellipse(smear * w * 0.6, 0, Math.max(2, w * (1 + smear)), Math.max(2, l), 0, 0, TAU); c.fill();
      c.fillStyle = 'rgba(52,42,34,0.22)';
      c.beginPath(); c.ellipse(0, 0, Math.max(3, w * 1.35), Math.max(3, l * 1.35), 0, 0, TAU); c.fill();
      c.restore();
      c.fillStyle = 'rgba(60,50,40,0.55)';
      for (let k = 0; k < 6 + smear * 10; k++) { c.beginPath(); c.arc(X + rng.float(-w, w) * 1.6, Y + rng.float(-l, l) * 1.6, rng.float(0.5, 1.5), 0, TAU); c.fill(); }
      this.version++;
    }

    stroke(x0, z0, x1, z1, w, ink, a) {
      const c = this.ctx, [X0, Y0] = this.px(x0, z0), [X1, Y1] = this.px(x1, z1);
      c.strokeStyle = `rgba(${ink[0]},${ink[1]},${ink[2]},${a})`;
      c.lineWidth = Math.max(1, w * this.k);
      c.lineCap = 'round';
      c.beginPath(); c.moveTo(X0, Y0); c.lineTo(X1, Y1); c.stroke();
      c.lineWidth = 1;
      c.strokeStyle = `rgba(${ink[0] * 0.7 | 0},${ink[1] * 0.7 | 0},${ink[2] * 0.7 | 0},${a * 0.8})`;
      const nx = -(Y1 - Y0), ny = X1 - X0, l = Math.hypot(nx, ny) || 1;
      for (let k = 0; k < 3; k++) {
        const o = (this.rng.next() - 0.5) * w * this.k * 0.9;
        c.beginPath(); c.moveTo(X0 + nx / l * o, Y0 + ny / l * o); c.lineTo(X1 + nx / l * o, Y1 + ny / l * o); c.stroke();
      }
      this.version++;
    }

    dot(x, z, r, ink, a, ctx = this.ctx) {
      const [X, Y] = this.px(x, z);
      ctx.fillStyle = `rgba(${ink[0]},${ink[1]},${ink[2]},${a})`;
      ctx.beginPath(); ctx.arc(X, Y, Math.max(1, r * this.k), 0, TAU); ctx.fill();
      this.version++;
    }

    /** a place it will not forget: a ring of dots that never fades */
    remember(x, z, ink) {
      this.flash = 1;
      const n = 14 + this.rng.int(0, 8), R = 0.035 + this.rng.float(0, 0.015);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU + this.rng.float(-0.12, 0.12), r = R * this.rng.float(0.85, 1.15);
        this.dot(x + Math.cos(a) * r, z + Math.sin(a) * r, 0.0028, ink, 0.7, this.mctx);
      }
      this.dot(x, z, 0.004, ink, 0.8, this.mctx);
    }

    /* ---- the beings ----------------------------------------------------------------- */
    wake() {
      const groups = new Map();
      for (const p of this.growth.pieces) {
        if (p.stray || p.ruinOnly || p.leaving || p.grp == null || p.grp < 0) continue;
        if (!groups.has(p.grp)) groups.set(p.grp, []);
        groups.get(p.grp).push(p);
      }
      const rng = this.rng;
      this.beings = [...groups.values()].map((pieces, i) => {
        for (const p of pieces) { p.baseY = p.pos[1]; p.baseYaw = p.yaw; p.lift = 0; p.ph = rng.float(0, TAU); }
        const c = this.center(pieces);
        for (const p of pieces) p.rel = [p.pos[0] - c[0], p.pos[2] - c[1]];
        return { id: i, pieces, mode: 'breathe', T: -rng.float(0, 3) - i * 0.4, dur: rng.float(2, 4), rng: rng.fork(), ink: rng.pick(INKS),
          energy: rng.float(0.7, 1), bond: null, apart: 0, heart: rng.float(0.9, 1.25) };
      });
      this.on = true;
    }

    center(ps) {
      let x = 0, z = 0;
      for (const p of ps) { x += p.pos[0]; z += p.pos[2]; }
      return [x / ps.length, z / ps.length];
    }

    bound(x, z) { return [clamp(x, -this.A / 2 + 0.12, this.A / 2 - 0.12), clamp(z, -0.38, 0.38)]; }

    nearest(pt, filter = () => true) {
      let best = null, bd = 1e9;
      for (const b of this.beings) {
        if (!b.pieces.length || !filter(b)) continue;
        const d = dist(this.center(b.pieces), pt);
        if (d < bd) { bd = d; best = b; }
      }
      return best;
    }

    choose(b) {
      const rng = b.rng, c = this.center(b.pieces), t = this.growth.t;
      b.T = 0;
      for (const p of b.pieces) p.shake = 0;
      // tired: it sleeps
      if (b.energy < 0.22) { b.mode = 'sleep'; b.dur = rng.float(6, 10); return; }
      // the human moves: the one nearest to them follows (it attaches)
      if (this.pointerActive() && !this.beings.some((o) => o.mode === 'mirror' || o.mode === 'wait')) {
        const last = this.trail[this.trail.length - 1];
        if (this.nearest([last.x, last.z]) === b) { b.mode = 'mirror'; b.dur = 40; b.printed = c; b.err = [rng.float(-0.03, 0.03), rng.float(-0.03, 0.03)]; return; }
      }
      // a human holds attention somewhere: go there, then dance around it
      const a = this.attn;
      if (a && t - a.t < 6 && !this.beings.some((o) => o !== b && o.lesson === a)) { b.lesson = a; return this.startWalk(b, [a.x, a.z], 'dance'); }
      b.lesson = null;
      // attachment: it goes back to the one it is bonded to; apart too long, it searches
      if (b.bond && b.bond.pieces.length) {
        const oc = this.center(b.bond.pieces), d = dist(c, oc);
        if (d > 0.16 && (b.apart > 12 || rng.chance(0.45))) {
          const dir = [(c[0] - oc[0]) / d, (c[1] - oc[1]) / d];
          return this.startWalk(b, this.bound(oc[0] + dir[0] * 0.09, oc[1] + dir[1] * 0.09), 'together', b.apart > 12 ? 'search' : null);
        }
        if (d <= 0.16 && rng.chance(0.4)) return this.startTogether(b);
      } else if (t > 8 && rng.chance(0.12)) {
        // meeting another: both walk toward each other, and stay bonded
        const o = this.nearest(c, (x) => x !== b && !x.bond && x.mode !== 'mirror' && x.mode !== 'sleep');
        if (o) {
          const oc = this.center(o.pieces), m = [(c[0] + oc[0]) / 2, (c[1] + oc[1]) / 2], d = dist(c, oc) || 1;
          const dir = [(c[0] - oc[0]) / d, (c[1] - oc[1]) / d];
          b.bond = o; o.bond = b;
          this.startWalk(b, this.bound(m[0] + dir[0] * 0.045, m[1] + dir[1] * 0.045), 'together');
          this.startWalk(o, this.bound(m[0] - dir[0] * 0.045, m[1] - dir[1] * 0.045), 'together');
          o.T = 0;
          return;
        }
      }
      b.energy -= 0.1;
      const r = rng.next();
      if (r < 0.22) {
        const ang = rng.float(0, TAU), d = rng.float(0.1, 0.28);
        return this.startWalk(b, this.bound(c[0] + Math.cos(ang) * d, c[1] + Math.sin(ang) * d), rng.chance(0.3) ? 'dance' : null);
      }
      if (r < 0.45 && b.pieces.length > 1) return this.startStand(b);
      if (r < 0.62) return this.startPaint(b);
      if (r < 0.8) return this.startDance(b, c);
      b.energy += 0.1;
      b.mode = 'breathe'; b.dur = rng.float(3, 5);
    }

    startWalk(b, target, then, how = null) {
      b.mode = 'walk'; b.target = target; b.then = then; b.how = how; b.dur = 16; b.beat = -1; b.pause = 0;
      for (const p of b.pieces) p.step = null;
    }

    startPaint(b) {
      const rng = b.rng;
      b.mode = 'paint'; b.dur = rng.float(5, 8);
      b.brush = b.pieces.reduce((a, p) => (p.size[1] > a.size[1] ? p : a), b.pieces[0]);
      b.heading = rng.float(0, TAU); b.turn = rng.float(-1.2, 1.2);
      b.ink = rng.pick(INKS);
      b.last = [b.brush.pos[0], b.brush.pos[2]];
    }

    startDance(b, c) {
      const rng = b.rng;
      b.mode = 'dance'; b.dur = rng.float(6, 9); b.c = c; b.beat = -1;
      b.spinDir = rng.pick([-1, 1]); b.period = rng.float(0.45, 0.65);
      b.pieces.forEach((p, k) => {
        const dx = p.pos[0] - c[0], dz = p.pos[2] - c[1];
        p.orbitR = Math.max(0.035, Math.hypot(dx, dz)) * rng.float(1.1, 1.5);
        p.orbitA = Math.atan2(dz, dx) || (k / b.pieces.length) * TAU;
        p.from = [p.pos[0], p.pos[2]];
      });
    }

    /** it tries to stand up like a body: its stones stacked into one upright figure */
    startStand(b) {
      const rng = b.rng, c = this.center(b.pieces);
      b.mode = 'stand'; b.c = c; b.dur = rng.float(4.5, 7); b.fallDir = rng.float(0, TAU); b.fell = false;
      const order = [...b.pieces].sort((p, q) => q.size[0] * q.size[2] - p.size[0] * p.size[2]);
      let y = 0;
      order.forEach((p, k) => {
        p.from = [p.pos[0], p.pos[2]];
        p.stackY = y; p.stackK = k;
        y += p.size[1] * 0.88;
      });
      b.height = y;
    }

    startTogether(b) {
      b.mode = 'together'; b.dur = b.rng.float(7, 11); b.apart = 0;
      for (const p of b.pieces) p.from = [p.pos[0], p.pos[2]];
    }

    /** something moved fast near it: it flinches and shrinks back */
    startle(x, z) {
      for (const b of this.beings) {
        if (!b.pieces.length || b.mode === 'flinch' || b.mode === 'mirror') continue;
        const c = this.center(b.pieces), d = dist(c, [x, z]);
        if (d > 0.14) continue;
        const k = d || 1;
        b.mode = 'flinch'; b.T = 0; b.dur = 1.6; this.flash = Math.max(this.flash || 0, 0.7);
        b.away = [(c[0] - x) / k, (c[1] - z) / k];
        for (const p of b.pieces) { p.from = [p.pos[0], p.pos[2]]; p.shake = 0.7; }
      }
    }

    update(dt) {
      const G = this.growth;
      if (this.daemon.state !== 'session' || G.live || G.game) return;   // a game is played instead
      if (!this.on) {
        if (G.lifeAt != null && G.t > G.lifeAt) this.wake();
        else return;
      }
      if (dt <= 0) return;
      // the ground forgets, very slowly; what it remembers is laid back on top
      this.fadeT += dt;
      if (this.fadeT > 0.5) {
        this.fadeT = 0;
        const c = this.ctx;
        c.globalCompositeOperation = 'destination-out';
        c.fillStyle = 'rgba(0,0,0,0.006)';
        c.fillRect(0, 0, this.canvas.width, this.canvas.height);
        c.globalCompositeOperation = 'source-over';
        c.drawImage(this.memory, 0, 0);
        this.version++;
      }
      this.echo();
      for (const b of this.beings) {
        b.pieces = b.pieces.filter((p) => !p.leaving && G.pieces.includes(p));
        if (!b.pieces.length) continue;
        // which human thing it is exploring right now (shown as its colour and pattern)
        const th = this.themeOf(b);
        if (th !== b.shown) { b.ti = (b.ti || 0) - dt * 2.5; if (b.ti <= 0) { b.shown = th; b.ti = 0; } }
        else b.ti = Math.min(1, (b.ti || 0) + dt * 1.2);
        b.care = Math.max(0, (b.care || 0) - dt * 0.5);
        b.T += dt;
        if (b.bond) b.apart = dist(this.center(b.pieces), this.center(b.bond.pieces.length ? b.bond.pieces : b.pieces)) > 0.2 ? b.apart + dt : 0;
        if (b.T < 0) { this.breathe(b, dt); continue; }
        switch (b.mode) {
          case 'walk': this.walk(b, dt); break;
          case 'paint': this.paint(b, dt); break;
          case 'dance': this.dance(b, dt); break;
          case 'stand': this.stand(b, dt); break;
          case 'fallen': this.fallen(b, dt); break;
          case 'together': this.together(b, dt); break;
          case 'mirror': this.mirror(b, dt); break;
          case 'wait': this.breathe(b, dt, 1.3); break;
          case 'flinch': this.flinch(b, dt); break;
          case 'hop': this.hop(b, dt); break;
          case 'sleep': this.sleep(b, dt); break;
          default: this.breathe(b, dt);
        }
        if (b.T > b.dur) {
          if (b.mode === 'walk' && b.then === 'dance') { this.startDance(b, b.target); b.T = 0; }
          else if (b.mode === 'walk' && b.then === 'together') this.startTogether(b), b.T = 0;
          else if (b.mode === 'stand') { b.mode = 'fallen'; b.T = 0; b.dur = b.rng.float(2.5, 4); }
          else if (b.mode === 'fallen') { b.energy -= 0.15; this.startWalk(b, this.center(b.pieces), null); b.slow = true; b.T = 0; }
          else if (b.mode === 'sleep') { b.energy = 1; this.choose(b); }
          else this.choose(b);
        }
        for (const p of b.pieces) p.pos[1] = p.baseY + p.lift;
      }
      this.beings = this.beings.filter((b) => b.pieces.length);
    }

    /** resting: its stones beat like a heart, lub-dub (calmer when it waits for you) */
    breathe(b, dt, calm = 1) {
      const t = this.growth.t, P = b.heart * calm, ph = (t / P) % 1;
      const beat = Math.exp(-Math.pow((ph - 0.1) / 0.05, 2)) + 0.6 * Math.exp(-Math.pow((ph - 0.3) / 0.05, 2));
      for (const p of b.pieces) {
        const want = 0.0035 * beat + 0.0015 * Math.sin(t * 0.9 + p.ph);
        p.lift += (want - p.lift) * Math.min(1, dt * 14);
        p.yaw += (p.baseYaw - p.yaw) * Math.min(1, dt * 0.5);
      }
    }

    /** two legs: the stones step in turns toward the target; sometimes it stumbles or hesitates */
    walk(b, dt) {
      const P = b.slow || b.how === 'search' ? 0.85 : 0.55;
      if (b.pause > 0) { b.pause -= dt; this.breathe(b, dt); if (b.how === 'search') for (const p of b.pieces) p.yaw += Math.sin(this.growth.t * 2 + p.ph) * dt * 0.6; return; }
      b.wt = (b.wt || 0) + dt;
      const beat = Math.floor(b.wt / P), s = (b.wt / P) % 1, rng = b.rng;
      let d = 0;
      for (const p of b.pieces) d = Math.max(d, dist([b.target[0] + p.rel[0], b.target[1] + p.rel[1]], [p.pos[0], p.pos[2]]));
      if (beat !== b.beat) {
        b.beat = beat;
        // hesitation: it stops, unsure, before going on
        if (beat > 1 && rng.chance(b.how === 'search' ? 0.18 : 0.06)) { b.pause = rng.float(0.6, 1.6); return; }
        b.pieces.forEach((p, k) => {
          if (k % 2 !== beat % 2 && b.pieces.length > 1) return;
          const want = [b.target[0] + p.rel[0], b.target[1] + p.rel[1]];
          let vx = want[0] - p.pos[0], vz = want[1] - p.pos[2];
          const l = Math.hypot(vx, vz);
          if (l < 0.004) { p.step = null; return; }
          const stumble = rng.chance(0.07);
          const stepL = Math.min(l, stumble ? 0.02 : 0.045);
          vx *= stepL / l; vz *= stepL / l;
          if (stumble) { vx += rng.float(-0.012, 0.012); vz += rng.float(-0.012, 0.012); }
          p.step = { from: [p.pos[0], p.pos[2]], to: [p.pos[0] + vx, p.pos[2] + vz], yaw0: p.yaw,
            yaw1: p.baseYaw + Math.sin(beat * 1.3 + p.ph) * 0.35 + (stumble ? rng.float(-0.6, 0.6) : 0), stumble };
        });
      }
      for (const p of b.pieces) {
        const st = p.step;
        if (!st) { p.lift *= 0.8; continue; }
        const e = smooth(clamp(s / 0.8, 0, 1));
        p.pos[0] = st.from[0] + (st.to[0] - st.from[0]) * e;
        p.pos[2] = st.from[1] + (st.to[1] - st.from[1]) * e;
        p.yaw = st.yaw0 + (st.yaw1 - st.yaw0) * e;
        p.lift = Math.sin(Math.PI * clamp(s / 0.8, 0, 1)) * (st.stumble ? 0.005 : 0.014);
        p.shake = st.stumble ? 0.5 * (1 - e) : 0;
        if (s >= 0.8 && !st.landed) { st.landed = true; p.lift = 0; this.footprint(p, st.stumble ? 1 : 0); }
      }
      if (d < 0.012) { b.T = Math.max(b.T, b.dur); b.slow = false; b.wt = 0; }
      if (b.T > b.dur) b.wt = 0;
    }

    /** one stone becomes a brush: it drags pigment over the ground in a flowing curve */
    paint(b, dt) {
      const br = b.brush, rng = b.rng, t = this.growth.t;
      if (!br || !b.pieces.includes(br)) return this.choose(b);
      b.turn += (rng.next() - 0.5) * dt * 3;
      b.turn = clamp(b.turn, -1.6, 1.6);
      b.heading += b.turn * dt;
      const [bx, bz] = this.bound(br.pos[0], br.pos[2]);
      if (bx !== br.pos[0] || bz !== br.pos[2]) b.heading = Math.atan2(-br.pos[2], -br.pos[0]) + rng.float(-0.5, 0.5);
      // it lifts its brush now and then: the stroke breaks
      const lifted = Math.sin(t * 1.7 + b.id) > 0.85;
      const v = 0.06 * (0.6 + 0.4 * Math.sin(t * 2.1));
      const nx = br.pos[0] + Math.cos(b.heading) * v * dt, nz = br.pos[2] + Math.sin(b.heading) * v * dt;
      const w = Math.min(br.size[0], br.size[2]) * (0.5 + 0.35 * Math.sin(t * 3.3));
      if (!lifted) this.stroke(b.last[0], b.last[1], nx, nz, w, b.ink, 0.16);
      br.pos[0] = nx; br.pos[2] = nz;
      br.yaw += dt * 0.8;
      br.lift = lifted ? 0.008 : 0;
      b.last = [nx, nz];
      for (const p of b.pieces) {
        if (p === br) continue;
        const wx = nx + p.rel[0] * 1.3, wz = nz + p.rel[1] * 1.3;
        const ox = p.pos[0], oz = p.pos[2];
        p.pos[0] += (wx - p.pos[0]) * Math.min(1, dt * 0.9);
        p.pos[2] += (wz - p.pos[2]) * Math.min(1, dt * 0.9);
        p.lift *= 0.9;
        this.stroke(ox, oz, p.pos[0], p.pos[2], Math.min(p.size[0], p.size[2]) * 0.2, b.ink, 0.05);
      }
    }

    /** they circle a centre, turning, lifting on the beat; now and then they lose the rhythm */
    dance(b, dt) {
      const P = b.period;
      b.dt2 = (b.dt2 || 0) + dt * (Math.sin(this.growth.t * 0.9 + b.id) > 0.8 ? 1.6 : 1);   // out of rhythm
      const beat = Math.floor(b.dt2 / P), s = (b.dt2 / P) % 1;
      const enter = smooth(clamp(b.T / 1.2, 0, 1));
      const landed = beat !== b.beat;
      b.beat = beat;
      b.pieces.forEach((p, k) => {
        p.orbitA += dt * b.spinDir * (0.9 + 0.25 * Math.sin(b.T * 0.7)) * (k % 2 ? 1 : 1.15);
        const r = p.orbitR * (1 + 0.15 * Math.sin(b.T * 1.3 + k));
        const tx = b.c[0] + Math.cos(p.orbitA) * r, tz = b.c[1] + Math.sin(p.orbitA) * r;
        p.pos[0] = p.from[0] + (tx - p.from[0]) * enter;
        p.pos[2] = p.from[1] + (tz - p.from[1]) * enter;
        if (enter >= 1) p.from = [p.pos[0], p.pos[2]];
        const mine = (beat + k) % 2 === 0;
        p.lift = mine ? Math.sin(Math.PI * s) * 0.012 * enter : p.lift * 0.85;
        p.yaw += dt * b.spinDir * 1.6;
        if (landed && !mine && enter > 0.5) this.dot(p.pos[0], p.pos[2], Math.min(p.size[0], p.size[2]) * 0.22, b.ink, 0.38);
      });
      if (b.T > b.dur) b.dt2 = 0;
    }

    /** standing up: gather, stack, wobble ever more, and fall */
    stand(b, dt) {
      const T = b.T, fallAt = b.dur - 0.9;
      const gather = smooth(clamp(T / 1.1, 0, 1));
      const wob = clamp((T - 1.6) / (fallAt - 1.6), 0, 1);
      const sway = Math.sin(T * (3 + wob * 4)) * (0.002 + 0.01 * wob * wob);
      const fx = Math.cos(b.fallDir), fz = Math.sin(b.fallDir);
      b.pieces.forEach((p) => {
        const rise = smooth(clamp((T - 0.8 - p.stackK * 0.35) / 0.6, 0, 1));
        const lean = sway * (p.stackY / Math.max(0.05, b.height)) * 3;
        let x = p.from[0] + (b.c[0] - p.from[0]) * gather + fx * lean, z = p.from[1] + (b.c[1] - p.from[1]) * gather + fz * lean;
        let y = p.stackY * rise;
        if (T > fallAt) {
          // it falls: the higher a stone was, the further it lands
          const f = clamp((T - fallAt) / 0.45, 0, 1);
          const reach = (p.stackY + p.size[1] * 0.5) * 1.1;
          x += fx * reach * f; z += fz * reach * f;
          y = p.stackY * (1 - f * f);
          p.yaw += dt * 3 * (p.stackK % 2 ? 1 : -1) * (1 - f);
          if (f >= 1 && !p.landed) { p.landed = true; this.footprint(p, 1); this.flash = Math.max(this.flash || 0, 0.9); }
        } else p.landed = false;
        p.pos[0] = x; p.pos[2] = z;
        p.lift = y;
        p.shake = wob * 0.4;
      });
    }

    /** fallen: it lies there, trembling a little */
    fallen(b, dt) {
      for (const p of b.pieces) { p.lift *= 0.8; p.shake = 0.25 * (1 - b.T / b.dur); }
    }

    /** with the one it is bonded to: breathing in the same rhythm, leaning in */
    together(b, dt) {
      const o = b.bond, t = this.growth.t;
      if (!o || !o.pieces.length) return this.choose(b);
      const oc = this.center(o.pieces), c = this.center(b.pieces), d = dist(c, oc) || 1;
      const lean = 0.006 * (0.5 + 0.5 * Math.sin(t * 0.8));
      const ph = (t / 1.1) % 1, beat = Math.exp(-Math.pow((ph - 0.1) / 0.05, 2)) + 0.6 * Math.exp(-Math.pow((ph - 0.3) / 0.05, 2));
      b.pieces.forEach((p) => {
        p.pos[0] += ((p.from[0] + (oc[0] - c[0]) / d * lean) - p.pos[0]) * Math.min(1, dt * 2);
        p.pos[2] += ((p.from[1] + (oc[1] - c[1]) / d * lean) - p.pos[2]) * Math.min(1, dt * 2);
        p.lift += (0.004 * beat - p.lift) * Math.min(1, dt * 14);
      });
      if (b.rng.chance(dt * 0.8)) {
        const m = [(c[0] + oc[0]) / 2 + b.rng.float(-0.01, 0.01), (c[1] + oc[1]) / 2 + b.rng.float(-0.01, 0.01)];
        this.dot(m[0], m[1], 0.0025, b.ink, 0.45);
      }
    }

    /** it follows the human: late, and a little wrong; when they stop, it waits there */
    mirror(b, dt) {
      const at = this.pointerAt(1.1);
      if (!at || !this.pointerActive()) {
        const last = this.trail[this.trail.length - 1];
        if (last) this.remember(last.x, last.z, b.ink);
        b.mode = 'wait'; b.T = 0; b.dur = b.rng.float(7, 11);
        return;
      }
      b.err[0] += (b.rng.next() - 0.5) * dt * 0.04; b.err[1] += (b.rng.next() - 0.5) * dt * 0.04;
      b.err[0] = clamp(b.err[0], -0.04, 0.04); b.err[1] = clamp(b.err[1], -0.04, 0.04);
      const [tx, tz] = this.bound(at.x + b.err[0], at.z + b.err[1]);
      const c = this.center(b.pieces);
      b.pieces.forEach((p) => {
        p.pos[0] += (tx + p.rel[0] - p.pos[0]) * Math.min(1, dt * 1.6);
        p.pos[2] += (tz + p.rel[1] - p.pos[2]) * Math.min(1, dt * 1.6);
        p.lift = Math.abs(Math.sin(this.growth.t * 6 + p.ph)) * 0.006;
      });
      if (dist(c, b.printed) > 0.045) { b.printed = c; for (const p of b.pieces) this.footprint(p); }
      b.T = Math.min(b.T, 1);
    }

    /** startled: it pulls back, trembling, then settles */
    flinch(b, dt) {
      const f = smooth(clamp(b.T / 0.35, 0, 1));
      b.pieces.forEach((p) => {
        p.pos[0] = p.from[0] + b.away[0] * 0.06 * f;
        p.pos[2] = p.from[1] + b.away[1] * 0.06 * f;
        p.lift = -0.004 * f;
        p.shake = 0.8 * (1 - b.T / b.dur);
      });
    }

    /** the human tapped a rhythm: the nearest being answers it with hops (and may miss one) */
    echo() {
      const taps = this.taps, t = this.growth.t;
      if (!taps.length || t - taps[taps.length - 1].t < 0.9) return;
      const last = taps[taps.length - 1];
      const b = this.nearest([last.x, last.z], (x) => x.mode !== 'sleep');
      if (b) {
        let times = taps.map((q) => q.t - taps[0].t);
        if (times.length > 2 && b.rng.chance(0.3)) times.splice(b.rng.int(1, times.length - 1), 1);   // imperfect
        b.mode = 'hop'; b.T = 0; b.hops = times.map((x) => x * b.rng.float(0.92, 1.1) + 0.5); b.dur = b.hops[b.hops.length - 1] + 0.9; b.hopDone = -1;
      }
      this.taps = [];
    }

    hop(b, dt) {
      let lift = 0;
      b.hops.forEach((h, i) => {
        const s = (b.T - h) / 0.32;
        if (s > 0 && s < 1) lift = Math.sin(Math.PI * s) * 0.018;
        if (s >= 1 && i > b.hopDone) { b.hopDone = i; const c = this.center(b.pieces); this.dot(c[0], c[1], 0.004, b.ink, 0.6); this.flash = Math.max(this.flash || 0, 0.45); }
      });
      for (const p of b.pieces) p.lift = lift;
    }

    /** tired: it sinks a little into the ground and sleeps */
    sleep(b, dt) {
      const t = this.growth.t, s = smooth(clamp(b.T / 1.5, 0, 1)) * (1 - smooth(clamp((b.T - b.dur + 1.5) / 1.5, 0, 1)));
      for (const p of b.pieces) p.lift += (-0.01 * s + 0.0015 * Math.sin(t * 0.5 + p.ph) - p.lift) * Math.min(1, dt * 3);
    }
  }

  /* ---- the five human things it explores, and how a player can guide it ----------- */
  // 0 nothing · 1 attachment (purple) · 2 vulnerability (light blue) · 3 intimacy (red)
  // 4 curiosity (green) · 5 imperfection (yellow)
  Life.prototype.themeOf = function (b) {
    switch (b.mode) {
      case 'mirror': case 'wait': return 1;
      case 'stand': case 'fallen': case 'flinch': case 'sleep': return 2;
      case 'together': case 'hop': return 3;
      case 'paint': case 'dance': return b.lesson ? 4 : 5;
      case 'walk': return b.slow ? 2 : b.then === 'together' || b.how === 'search' ? 1 : 4;
      default: return 0;
    }
  };

  /** what the scene needs to draw the themes: beings and the threads between them */
  Life.prototype.info = function () {
    const beings = [], links = [];
    if (!this.on) return { beings, links };
    for (const b of this.beings) {
      if (!b.pieces.length || !b.shown) continue;
      const c = this.center(b.pieces);
      let h = 0, r = 0;
      for (const p of b.pieces) { h = Math.max(h, p.pos[1] + p.size[1] * p.g); r = Math.max(r, Math.hypot(p.pos[0] - c[0], p.pos[2] - c[1]) + p.size[0]); }
      const learned = Math.min(0.6, ((b.learned && b.learned[b.shown]) || 0) * 0.15);
      beings.push({ c: [c[0], h * 0.45, c[1]], r: 0.07 + r, theme: b.shown, i: b.ti * (0.8 + learned) });
    }
    const seen = new Set();
    for (const b of this.beings) {
      if (!b.pieces.length) continue;
      if (b.bond && b.bond.pieces.length && !seen.has(b.bond)) {
        seen.add(b);
        const a = this.center(b.pieces), o = this.center(b.bond.pieces);
        const close = b.mode === 'together' || b.bond.mode === 'together';
        links.push({ a: [a[0], 0.02, a[1]], b: [o[0], 0.02, o[1]], theme: close ? 3 : 1 });
      }
      if (b.mode === 'mirror' || b.mode === 'wait') {
        const last = this.trail[this.trail.length - 1];
        if (last) { const a = this.center(b.pieces); links.push({ a: [a[0], 0.02, a[1]], b: [last.x, 0.0, last.z], theme: 1 }); }
      }
    }
    return { beings: beings.slice(0, 12), links: links.slice(0, 8) };
  };

  /** a player holds attention near a being: it answers according to what it is exploring */
  Life.prototype.guide = function (x, z, dt) {
    if (!this.on) return;
    const b = this.nearest([x, z]);
    if (!b) return;
    const c = this.center(b.pieces);
    if (Math.hypot(c[0] - x, c[1] - z) > 0.2) return;
    b.care = (b.care || 0) + dt * 1.5;
    if (b.care < 1.2) return;
    b.care = 0;
    const th = b.shown;
    b.learned = b.learned || {};
    b.learned[th] = (b.learned[th] || 0) + 1;
    this.flash = Math.max(this.flash || 0, 0.5);
    if (th === 2) {
      // vulnerability: a calm presence helps it up, steadies it
      if (b.mode === 'fallen' || b.mode === 'flinch' || b.mode === 'sleep') { b.T = b.dur; }
      else if (b.mode === 'stand') b.dur += 2.5;
      for (const p of b.pieces) p.shake = 0;
    } else if (th === 1) {
      // attachment: it stays with you, and remembers the place
      const [tx, tz] = this.bound(x, z);
      this.startWalk(b, [tx, tz], null); b.T = 0;
      this.remember(tx, tz, [120, 70, 190]);
    } else if (th === 3) {
      // intimacy: it brings the one it is bonded to, and they rest together where you are
      const o = b.bond;
      if (o && o.pieces.length) {
        const [tx, tz] = this.bound(x, z);
        this.startWalk(b, [tx - 0.04, tz], 'together'); b.T = 0;
        this.startWalk(o, [tx + 0.04, tz], 'together'); o.T = 0;
      } else this.startTogether(b);
    } else if (th === 4) {
      // curiosity: it goes to what you show it
      b.lesson = this.attn;
      this.startWalk(b, this.bound(x, z), 'dance'); b.T = 0;
    } else if (th === 5) {
      // imperfection: it tries again
      if (b.mode === 'paint') this.startPaint(b); else this.startDance(b, c);
      b.T = 0;
    }
  };

  RUIN.Life = Life;
})((window.RUIN = window.RUIN || {}));
