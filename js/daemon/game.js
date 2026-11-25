/* ---------------------------------------------------------------------------
 * game.js — the ruin, in the future, explores one human thing per game.
 *
 * After its history (the short wall, the palace, the fire, the ruin built of
 * the palace's stones, the fall), the ruin becomes ground. Then it tries to
 * understand one human thing. It cannot talk, so it shows the players a form
 * to BUILD together, with real blocks (Jenga-like: 15 x 5 x 3 cm), on the
 * table in front of the screen. The screen is the daemon's guide: the next
 * piece glows where it goes; the players place a real block there and tap
 * (or press Enter / →) for the next one. ← or Backspace takes one back.
 * When the form is complete, it comes alive in its own way.
 *
 * Each game is one expression, with its own colour and its own buildable form,
 * and the form makes the players behave that way while they build it:
 *
 *   attachment    purple       a circular tower: every block bridges two blocks
 *                              below, laid by other players, so each player's
 *                              pieces hold the others' (a puzzle of six sides)
 *   vulnerability light blue   a tall, thin, precarious stack of cantilevers:
 *                              everyone has to be gentle; it may fall
 *   intimacy      red          a tight bundle: blocks standing pressed together
 *                              on a tiny footprint, so the players' hands and
 *                              bodies have to come close
 *   curiosity     matrix green a path that branches out over the table into new
 *                              directions, a block standing at each tip, looking
 *   imperfection  yellow       a wall built wrong on purpose: offsets, gaps, a
 *                              block standing where it should lie, nothing aligned
 *
 * Choose the game with ?game=attachment (etc.) or press G; otherwise each
 * new session takes the next one. ?players=3 sets how many play (+ / −); the
 * dots show whose turn it is. The block size is BLOCK below (world units:
 * the board is about 1.6 x 1).
 * ------------------------------------------------------------------------- */
(function (RUIN) {
  'use strict';

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const TAU = Math.PI * 2;
  const BLOCK = { L: 0.15, W: 0.05, H: 0.03 };
  const { L, W, H } = BLOCK;
  const FLAT = [L, H, W];        // lying flat, long side along its direction
  const UP = [W, L, H];          // standing upright
  const EDGE = [L, W, H];        // lying on its long edge

  // a direction in the ground plane → the yaw that turns a block's long side along it
  const yawOf = (dx, dz) => -Math.atan2(dz, dx);

  const GAMES = ['attachment', 'vulnerability', 'intimacy', 'curiosity', 'imperfection'];
  const COLOURS = {
    attachment: [0.68, 0.4, 1.0],
    vulnerability: [0.55, 0.86, 1.0],
    intimacy: [1.0, 0.2, 0.26],
    curiosity: [0.0, 1.0, 0.25],
    imperfection: [1.0, 0.84, 0.2],
  };
  const HEX = { attachment: '#ad66ff', vulnerability: '#8cdcff', intimacy: '#ff3342', curiosity: '#00ff41', imperfection: '#ffd633' };

  /* ---- the forms ------------------------------------------------------------------- */
  const PLANS = {
    /** a hexagonal ring tower, log-cabin style: even courses lie on edges 0, 2, 4,
     *  odd courses on 1, 3, 5; each block's ends rest on the ends of two blocks below */
    attachment() {
      const s = 0.12, ap = s * Math.cos(Math.PI / 6), out = [];
      for (let c = 0; c < 7; c++) {                     // 21 blocks
        for (let e = c % 2; e < 6; e += 2) {
          const phi = (e + 0.5) * (Math.PI / 3);
          const x = ap * Math.cos(phi), z = ap * Math.sin(phi);
          out.push({ size: FLAT, pos: [x, c * H, z], yaw: yawOf(-Math.sin(phi), Math.cos(phi)), a: phi });
        }
      }
      return out;
    },

    /** a twisting fan of cantilevers: each block turned a little further and pushed out
     *  over the edge of the one below, balanced on less and less; one stands at the top */
    vulnerability(rng) {
      const out = [], turn = rng.pick([-1, 1]) * rng.float(0.42, 0.55);
      let a = rng.float(0, TAU), y = 0;
      for (let i = 0; i < 15; i++) {
        const reach = 0.012 + i * 0.0028;                 // further out the higher it gets
        const dx = Math.cos(a), dz = Math.sin(a);
        out.push({ size: FLAT, pos: [dx * reach, y, dz * reach], yaw: yawOf(dx, dz) });
        y += H; a += turn;
      }
      const dx = Math.cos(a - turn), dz = Math.sin(a - turn), r = 0.012 + 14 * 0.0028 + L * 0.4;
      out.push({ size: UP, pos: [dx * r, y, dz * r], yaw: yawOf(dx, dz) });
      return out;                                          // 16 blocks
    },

    /** a tight bundle: nine blocks standing pressed together, bound by blocks lying
     *  across them, four more standing on top, one to close it; built from the middle out */
    intimacy() {
      const out = [], g = 0.003;
      const xs = [0, -(W + g), W + g], zs = [0, -(H + g), H + g];
      const ring = [[0, 0], [1, 0], [2, 0], [0, 1], [0, 2], [1, 1], [2, 2], [1, 2], [2, 1]];
      for (const [i, j] of ring) out.push({ size: UP, pos: [xs[i], 0, zs[j]], yaw: 0 });
      out.push({ size: FLAT, pos: [0, L, -0.026], yaw: 0 });
      out.push({ size: FLAT, pos: [0, L, 0.026], yaw: 0 });
      out.push({ size: FLAT, pos: [-0.026, L + H, 0], yaw: Math.PI / 2 });
      out.push({ size: FLAT, pos: [0.026, L + H, 0], yaw: Math.PI / 2 });
      for (const [x, z] of [[-0.0265, -0.017], [0.0265, -0.017], [-0.0265, 0.017], [0.0265, 0.017]]) out.push({ size: UP, pos: [x, L + 2 * H, z], yaw: 0 });
      out.push({ size: FLAT, pos: [0, 2 * L + 2 * H, 0], yaw: Math.PI / 4 });
      return out;
    },

    /** a path branching out over the table, grown outward step by step; a block stands at each tip */
    curiosity(rng) {
      const branches = [];
      const a0 = rng.float(0, TAU);
      for (let k = 0; k < 3; k++) branches.push({ x: 0, z: 0, a: a0 + k * TAU / 3 + rng.float(-0.3, 0.3), n: rng.int(4, 6), done: 0 });
      const out = [];
      const inside = (x, z) => Math.abs(x) < 0.62 && Math.abs(z) < 0.4;
      for (let step = 0; step < 8 && out.length < 19; step++) {
        for (const b of [...branches]) {
          if (b.done >= b.n) continue;
          let a = b.a + rng.float(-0.45, 0.45);
          let nx = b.x + Math.cos(a) * (L + 0.004), nz = b.z + Math.sin(a) * (L + 0.004);
          if (!inside(nx, nz)) { a += Math.PI * 0.6; nx = b.x + Math.cos(a) * (L + 0.004); nz = b.z + Math.sin(a) * (L + 0.004); }
          out.push({ size: FLAT, pos: [(b.x + nx) / 2, 0, (b.z + nz) / 2], yaw: yawOf(Math.cos(a), Math.sin(a)) });
          b.x = nx; b.z = nz; b.a = a; b.done++;
          if (b.done === 2 && branches.length < 6 && rng.chance(0.7)) branches.push({ x: b.x, z: b.z, a: a + rng.pick([-1, 1]) * rng.float(0.8, 1.2), n: rng.int(2, 4), done: 0 });
          if (b.done >= b.n) out.push({ size: UP, pos: [b.x, 0, b.z], yaw: yawOf(Math.cos(a), Math.sin(a)), tip: true });
        }
      }
      return out;
    },

    /** a wall built wrong on purpose */
    imperfection(rng) {
      const out = [], n = 4, x0 = -((n - 1) * L) / 2;
      for (let c = 0; c < 5; c++) {
        const skip = rng.int(0, n - 1);
        for (let i = 0; i < n + (c % 2); i++) {
          let x = x0 + i * L - (c % 2) * L * 0.5;
          if (i === skip && c > 0) continue;                                            // a gap
          if (c === 2 && i === 1) { out.push({ size: UP, pos: [x, c * H, 0.0], yaw: rng.float(-0.4, 0.4) }); continue; }  // standing where it should lie
          out.push({ size: FLAT, pos: [x + rng.float(-0.025, 0.025), c * H, rng.float(-0.015, 0.015)], yaw: rng.float(-0.22, 0.22) + (c === 3 && i === 0 ? Math.PI / 2 : 0) });
        }
      }
      return out;
    },
  };

  /* ---- the game --------------------------------------------------------------------- */
  class Game {
    constructor({ growth, daemon, scene }) {
      this.growth = growth;
      this.daemon = daemon;
      this.scene = scene;
      growth.game = this;
      const q = new URLSearchParams(location.search);
      this.players = clamp(parseInt(q.get('players'), 10) || 3, 1, 8);
      this.pace = clamp(parseFloat(q.get('pace')) || 7, 2, 30);       // seconds per block
      this.fixed = GAMES.includes(q.get('game')) ? q.get('game') : null;
      let i = 0;
      try { i = parseInt(localStorage.getItem('ruin-game') || '0', 10) || 0; } catch (e) { /* no storage */ }
      this.index = i;
      this.id = this.fixed || GAMES[i % GAMES.length];
      this.state = 'off';
      this.active = false;
      this.placed = [];
      this.gen = 0;
      daemon.on('session:start', ({ seed }) => this.begin(seed));
      daemon.on('session:end', () => { this.state = 'off'; this.active = false; });
      daemon.on('dormant', () => { this.state = 'off'; this.active = false; this.placed = []; this.cur = null; });
    }

    get colour() { return COLOURS[this.id]; }
    get hex() { return HEX[this.id]; }

    /** the next session plays the next expression (or the one asked for) */
    begin(seed) {
      // every start plays the next expression (unless one was asked for)
      this.id = this.fixed || GAMES[this.index % GAMES.length];
      if (!this.fixed) {
        this.index++;
        try { localStorage.setItem('ruin-game', String(this.index)); } catch (e) { /* no storage */ }
      }
      this.rng = new RUIN.Random(((seed || 1) ^ 0x6a3e) >>> 0);
      this.plan = PLANS[this.id](this.rng).slice(0, 25).map((q, k) => ({ ...q, owner: k % this.players }));
      this.wait = 0;
      this.k = -1;
      this.placed = [];
      this.cur = null;
      this.gen++;
      this.state = 'wait';
      this.active = false;
      this.aliveT = 0;
    }

    /** G: switch to another expression and start again */
    choose(id) {
      this.fixed = id;
      this.id = id;
    }

    cycle() {
      const i = (GAMES.indexOf(this.id) + 1) % GAMES.length;
      this.choose(GAMES[i]);
      return GAMES[i];
    }

    setPlayers(n) {
      this.players = clamp(n, 1, 8);
      if (this.plan) this.plan.forEach((q, k) => { q.owner = k % this.players; });
    }

    piece(k) {
      const q = this.plan[k];
      return { id: 900000 + this.gen * 1000 + k, kind: 'box', size: q.size.slice(), pos: q.pos.slice(), yaw: q.yaw, start: -10, dur: 0.1,
        stray: false, seed: this.rng.int(1, 1e9), g: 1, boost: 0, grown: true, guide: true, owner: q.owner, plan: q, order: k };
    }

    show(k) {
      this.wait = 0;
      const p = this.piece(k);
      this.cur = p;
      this.growth.pieces.push(p);
      this.growth.version++;
    }

    /** the players placed the glowing block: it becomes real; the next one glows */
    next() {
      if (this.state !== 'build') return false;
      const p = this.cur;
      if (p) {
        p.guide = false;
        p.start = this.growth.t; p.dur = 0.45; p.g = 0; p.grown = false;
        p.base = p.pos.slice(); p.baseYaw = p.yaw;
        this.placed.push(p);
        this.growth.version++;
      }
      this.k++;
      if (this.k >= this.plan.length) {
        this.cur = null;
        this.state = 'alive';
        this.aliveT = 0;
        if (this.scene) this.scene.burst = 1;
        return true;
      }
      this.show(this.k);
      return true;
    }

    /** take the last block back */
    back() {
      if (this.state === 'alive') { this.state = 'build'; this.k = this.plan.length; }
      if (this.state !== 'build' || !this.placed.length) return false;
      if (this.cur) { const i = this.growth.pieces.indexOf(this.cur); if (i >= 0) this.growth.pieces.splice(i, 1); }
      const p = this.placed.pop();
      p.guide = true; p.g = 1; p.start = -10; p.dur = 0.1; p.grown = true;
      p.pos = p.base.slice(); p.yaw = p.baseYaw;
      this.cur = p;
      this.k--;
      this.growth.version++;
      return true;
    }

    update(dt) {
      const G = this.growth;
      if (this.state === 'off' || this.daemon.state !== 'session') return;
      if (this.state === 'wait') {
        if (G.lifeAt != null && G.t > G.lifeAt - 0.6) {
          this.state = 'build';
          this.active = true;
          this.k = 0;
          this.show(0);
          // come closer to the table
          const c = this.scene && this.scene.cam;
          if (c && !this.scene.auto) {
            const top = Math.max(...this.plan.map((q) => q.pos[1] + q.size[1]));
            const wide = Math.max(...this.plan.map((q) => Math.hypot(q.pos[0], q.pos[2]) + q.size[0] / 2));
            c.distT = clamp(0.55 + wide * 1.6 + top * 1.4, 0.8, 1.7); c.pitchT = 0.55; c.tgtT = [0, top * 0.45, 0];
          }
        }
        return;
      }
      if (this.state === 'build') {
        // nobody has to touch anything: each block glows for a while, then the next one
        this.wait += dt;
        if (this.wait > this.pace * (this.k === 0 ? 1.4 : 1)) this.next();
      }
      if (this.state === 'alive') this.live(dt);
    }

    /** complete: the form comes alive, each in its own way */
    live(dt) {
      this.aliveT += dt;
      const t = this.aliveT, rise = Math.min(1, t / 2);
      for (const p of this.placed) {
        if (!p.base) continue;
        let dy = 0, dx = 0, dz = 0, dyaw = 0, shake = 0;
        switch (this.id) {
          case 'attachment': {
            // a wave runs round the ring, from block to block, holding them together
            dy = 0.004 * Math.max(0, Math.sin(t * 2.2 - p.plan.a * 2 - p.base[1] * 20));
            break;
          }
          case 'intimacy': {
            // they breathe together, one heartbeat
            const ph = (t / 1.05) % 1, beat = Math.exp(-Math.pow((ph - 0.08) / 0.05, 2)) + 0.7 * Math.exp(-Math.pow((ph - 0.28) / 0.05, 2));
            dy = 0.003 * beat;
            const r = Math.hypot(p.base[0], p.base[2]) || 1;
            dx = -p.base[0] / r * 0.0015 * beat; dz = -p.base[2] / r * 0.0015 * beat;
            break;
          }
          case 'vulnerability': {
            // it trembles, more the higher it is, and sways as if it could fall
            shake = 0.25 + p.base[1] * 2.5;
            dx = Math.sin(t * 1.3) * 0.004 * p.base[1] * 4;
            break;
          }
          case 'curiosity': {
            // a pulse runs out along the paths to the tips, which look around
            dy = 0.005 * Math.max(0, Math.sin(t * 3 - p.order * 0.45));
            if (p.plan.tip) dyaw = Math.sin(t * 0.8 + p.order) * 0.5;
            break;
          }
          case 'imperfection': {
            // it glitches: a block jumps out of place, then falls back
            const k = Math.floor(t * 2.5), hit = ((k * 7919 + p.order * 104729) % 13) === 0;
            if (hit) { dx = 0.006 * Math.sin(p.order * 12.9 + k); dz = 0.004 * Math.cos(p.order * 7.1 + k); dyaw = 0.12 * Math.sin(k + p.order); }
            break;
          }
        }
        p.pos = [p.base[0] + dx * rise, p.base[1] + dy * rise, p.base[2] + dz * rise];
        p.yaw = p.baseYaw + dyaw * rise;
        p.shake = shake * rise;
      }
    }

    /** for the screen: which expression, whose turn, how far */
    status() {
      if (this.state === 'off' || this.state === 'wait') return null;
      return { id: this.id, hex: this.hex, players: this.players, turn: this.cur ? this.cur.owner : -1, k: Math.min(this.k + (this.state === 'alive' ? 0 : 1), this.plan.length), n: this.plan.length, alive: this.state === 'alive',
        left: this.state === 'build' ? clamp(1 - this.wait / (this.pace * (this.k === 0 ? 1.4 : 1)), 0, 1) : 0 };
    }
  }

  Game.GAMES = GAMES;
  Game.BLOCK = BLOCK;
  RUIN.Game = Game;
})((window.RUIN = window.RUIN || {}));
