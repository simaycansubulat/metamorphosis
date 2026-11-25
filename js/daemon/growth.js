/* ---------------------------------------------------------------------------
 * growth.js — the daemon grows its own body.
 *
 * At the start of every session the daemon unfolds a different composition of
 * PIECES out of its intention (the will's target height-map), built like the
 * workshop's Jenga models: mostly standing stones; gates (two posts and a
 * lintel), posts stacked end on end, T's whose beam cantilevers out, totems
 * of storeys crowned by a lone post.
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

  const LEVEL = 0.065;              // one level of the will, in world height
  // the ruin's history, in seconds from the start of a session
  const HISTORY = { stub: 0.075, palace: 2.5, burn: 5.2, carry: 8.8, age: 16, fall: 20, rise: 22.6 };
  // the history is told at double speed: its 20 s pass in 10; the fall keeps real time (2 s)
  const FAST = 2, SHIFT = HISTORY.fall - HISTORY.fall / FAST;
  const storyTime = (t) => (t * FAST < HISTORY.fall ? t * FAST : t + SHIFT);
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
      this.live = false;             // cameras: the body mirrors the physical model
      this.liveH = null;
      this.liveSeed = 1;
      daemon.on('session:start', ({ seed }) => (this.live ? this.restartLive() : this.generate(seed)));
      daemon.on('session:end', () => { for (const p of this.pieces) if (!p.leaving) { p.leaving = true; p.leaveAt = this.t + Math.random() * 4; p.leaveDur = 4 + Math.random() * 3; } });
      daemon.on('dormant', () => { this.pieces = []; this.dust = null; this.ivy = null; this.ruinM = null; this.story = false; this.lifeAt = null; this.version++; });
    }

    /* ---- the plan ----------------------------------------------------------------- */
    // The body is built the way the workshop models were: elongated pieces
    // (about 3 : 1 : 0.6, like Jenga blocks, but grown, so never regular),
    // mostly standing as posts, with lintels and cantilevers across them.
    generate(seed) {
      const W = RUIN.will, A = this.A, will = this.daemon.will;
      const rng = new RUIN.Random((seed ^ 0xb10c5) >>> 0);
      if (this.game) {
        // a game: after its history the ruin becomes ground, and the players build (game.js)
        const pieces = [];
        this.story = false; this.lifeAt = null;
        this.ruin(pieces, rng);
        if (this.lifeAt == null) this.lifeAt = 1;
        this.pieces = pieces; this.t = 0; this.reportT = 0; this.version++;
        return;
      }
      const T = will.T;
      const cell = (i, j) => { const w = W.cellToWorld(i, j, A); return [w.x - A / 2, w.y - 0.5]; };
      const key = (i, j) => j * W.COLS + i;
      const pieces = [];
      let id = 0;

      const L = rng.float(0.15, 0.17), B = L / 3, Th = L * 0.2;   // this session's piece
      const v = () => rng.float(0.82, 1.18);                      // no two alike: cut stone, not factory blocks
      let grp = 0;                                                // which being a piece belongs to

      const add = (o) => {
        const p = {
          id: id++, kind: o.kind || 'beam', size: o.size, pos: o.pos, yaw: o.yaw + rng.float(-0.07, 0.07),
          start: o.start, dur: o.dur ?? 2.2 + o.size[1] * 9 + rng.float(0, 1.2),
          stray: !!o.stray, seed: rng.int(1, 1e9), g: 0, boost: 0, grown: false, grp: o.stray ? -1 : grp,
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
      // every stone its own proportions: long, short, square, thick, big, small
      const SPAN = ['slab', 'thick', 'std', 'slab', 'big'];          // stones that must bridge a gap
      const dims = (sh = rng.pick(['square', 'square', 'square', 'short', 'short', 'short', 'thick', 'thick', 'small', 'small', 'big', 'slab', 'std', 'long'])) => {
        switch (sh) {
          case 'long':   return [L * rng.float(1.25, 1.5), B * rng.float(0.75, 1), Th * v()];
          case 'short':  return [L * rng.float(0.5, 0.7), B * v(), Th * rng.float(1, 1.4)];
          case 'square': { const a = B * rng.float(1.3, 1.9); return [a * rng.float(0.95, 1.15), a, a * rng.float(0.65, 1)]; }
          case 'thick':  return [L * v(), B * rng.float(1.35, 1.7), Th * rng.float(1.7, 2.4)];
          case 'big':    { const k = rng.float(1.2, 1.4); return [L * k * v(), B * k * v(), Th * k * v()]; }
          case 'slab':   return [L * rng.float(0.85, 1.05), B * rng.float(1.6, 2.2), Th * rng.float(0.9, 1.25)];
          case 'small':  { const k = rng.float(0.6, 0.75); return [L * k * v(), B * k * v(), Th * k * v()]; }
          default:       return [L * v(), B * v(), Th * v()];
        }
      };
      const post = (x, z, y, yaw, t, sh) => { const [l, m, n] = dims(sh); return add({ size: [m, l, n], pos: [x, y, z], yaw, start: t }); };
      const beam = (x, z, y, yaw, t, sh) => { const [l, m, n] = dims(sh); return add({ size: [l, n, m], pos: [x, y, z], yaw, start: t }); };
      const edge = (x, z, y, yaw, t, sh) => { const [l, m, n] = dims(sh); return add({ size: [l, m, n], pos: [x, y, z], yaw, start: t }); };
      const top = (p) => p.pos[1] + p.size[1];

      // ABSTRACT: no gates, lintels, stacks or towers, nothing that reads as
      // building. Each place the daemon wants matter grows a cluster of fused,
      // leaning, tapering masses (shards, swollen knots, blades) whose height
      // follows the intention, so the intention is felt, not readable.
      const budget = rng.int(16, 26) - 2;
      const full = () => pieces.length >= budget;
      const formStarts = [];
      const grow = (kind, x, z, y, w, h, d, yaw, t) => add({ kind, size: [w, h, d], pos: [x, y, z], yaw, start: t });
      const near = (x, z, r) => { const a = rng.float(0, Math.PI * 2), rr = r * rng.float(0.45, 1); return [x + Math.cos(a) * rr, z + Math.sin(a) * rr]; };

      const cells = [];
      for (let j = 0; j < W.ROWS; j++) for (let i = 0; i < W.COLS; i++) if (T[key(i, j)] > 0.5) cells.push({ i, j, h: T[key(i, j)], r: rng.next() });
      cells.sort((a, b) => b.h - a.h || a.r - b.r);
      const used = new Set();
      let clock = 0.3, forms = 0;

      for (const c of cells) {
        if (used.has(key(c.i, c.j)) || full()) continue;
        used.add(key(c.i, c.j));
        const [cx, cz] = cell(c.i, c.j);
        const x = jit(cx, 0.03), z = jit(cz, 0.03);
        const yaw = rng.float(0, Math.PI * 2);
        const t0 = clock + rng.float(0, 0.6);
        clock += rng.float(0.8, 1.6);
        forms++;
        grp++;
        formStarts.push(pieces.length);
        const H = c.h * LEVEL * rng.float(0.85, 1.12);

        if (c.h >= 3.5) {
          // a rising cluster: one dominant shard, smaller ones leaning out of its foot
          const w = rng.float(0.045, 0.072);
          const main = grow(rng.pick(['shard', 'shard', 'post']), x, z, 0, w, H, w * rng.float(0.55, 0.95), yaw, t0);
          const n = rng.int(2, 4);
          for (let k = 0; k < n; k++) {
            const [sx, sz] = near(x, z, w * 0.9), sw = w * rng.float(0.45, 0.8);
            grow(rng.pick(['shard', 'knot', 'shard']), sx, sz, 0, sw, H * rng.float(0.2, 0.6), sw * rng.float(0.6, 1), rng.float(0, Math.PI * 2), t0 + rng.float(0.4, 1.6));
          }
          // sometimes a swelling lodged in its flank
          if (rng.chance(0.4)) { const kw = w * rng.float(0.7, 1.1); grow('knot', jit(x, w * 0.35), jit(z, w * 0.35), H * rng.float(0.3, 0.6), kw, kw * rng.float(0.6, 1), kw, rng.float(0, 6.3), after(main) - 0.4); }
        } else if (c.h >= 2) {
          const v = rng.pick(['lean', 'swell', 'blade']);
          if (v === 'lean') {
            // two shards rising from nearby, leaning apart
            for (let k = 0; k < 2; k++) { const [sx, sz] = near(x, z, 0.03), sw = rng.float(0.035, 0.055); grow('shard', sx, sz, 0, sw, H * rng.float(0.7, 1.05), sw * rng.float(0.6, 0.9), rng.float(0, Math.PI * 2), t0 + k * rng.float(0.3, 0.9)); }
          } else if (v === 'swell') {
            // a swollen mass with a point breaking out of it
            const w = rng.float(0.07, 0.1);
            grow('knot', x, z, 0, w, H * rng.float(0.5, 0.7), w * rng.float(0.7, 1), yaw, t0);
            const [sx, sz] = near(x, z, w * 0.25);
            grow('shard', sx, sz, 0, w * 0.45, H * rng.float(0.9, 1.1), w * 0.35, rng.float(0, Math.PI * 2), t0 + rng.float(0.8, 1.4));
          } else {
            // a thin bowed blade with a pebble at its foot
            const w = rng.float(0.08, 0.12);
            grow('slab', x, z, 0, w, H, w * rng.float(0.18, 0.28), yaw, t0);
            const [sx, sz] = near(x, z, w * 0.6), kw = rng.float(0.025, 0.04);
            grow('knot', sx, sz, 0, kw, kw * rng.float(0.6, 0.9), kw, rng.float(0, 6.3), t0 + rng.float(0.5, 1.2));
          }
        } else {
          // low: a scatter of knots and stubs
          const n = rng.int(1, 3);
          for (let k = 0; k < n; k++) {
            const [sx, sz] = k ? near(x, z, 0.04) : [x, z], kw = rng.float(0.03, 0.055);
            grow(rng.pick(['knot', 'knot', 'shard']), sx, sz, 0, kw, Math.max(kw * 0.6, H * rng.float(0.6, 1.1)), kw * rng.float(0.7, 1), rng.float(0, Math.PI * 2), t0 + k * rng.float(0.3, 0.8));
          }
        }
      }

      // too many: the last (least wanted) clusters are left out whole
      while (pieces.length > budget && formStarts.length > 1) pieces.length = formStarts.pop();

      // never too sparse: small knots and stubs beside what grows
      const grounded = pieces.filter((p) => p.pos[1] === 0);
      while ((forms < 9 || pieces.length < 13) && grounded.length && !full()) {
        const host = rng.pick(grounded);
        const [hx, hz] = near(host.pos[0], host.pos[2], rng.float(0.12, 0.2));
        const kw = rng.float(0.025, 0.045), ht = rng.float(1, Math.max(2, clock));
        grp++;
        grow(rng.chance(0.6) ? 'knot' : 'shard', hx, hz, 0, kw, kw * rng.float(0.6, 1.8), kw * rng.float(0.7, 1), rng.float(0, Math.PI * 2), ht);
        forms++;
      }

      // strays: where it does not want matter, a few pieces grow anyway
      const empty = [];
      for (let j = 0; j < W.ROWS; j++) for (let i = 0; i < W.COLS; i++) if (T[key(i, j)] < 0.5) empty.push({ i, j });
      const ns = Math.min(empty.length, pieces.length < 14 ? 2 : rng.int(1, 2));
      for (let k = 0; k < ns; k++) {
        const e = empty.splice(rng.int(0, empty.length - 1), 1)[0];
        const [ex, ez] = cell(e.i, e.j), kw = rng.float(0.03, 0.05);
        add({ kind: rng.pick(['shard', 'knot']), size: [kw, rng.float(0.04, 0.12), kw * rng.float(0.6, 1)], pos: [jit(ex, 0.03), 0, jit(ez, 0.03)], yaw: rng.float(0, Math.PI * 2), start: rng.float(3, 12), stray: true });
      }

      this.story = false;
      this.lifeAt = null;
      this.ruin(pieces, rng);
      if (this.lifeAt == null) this.lifeAt = Math.max(0, ...pieces.filter((p) => !p.stray && !p.ruinOnly).map((p) => p.start + p.dur)) + 1;
      this.pieces = pieces;
      this.t = 0;
      this.reportT = 0;
      this.version++;
    }

    /* ---- the beginning: the Künstliche Ruine ------------------------------------------
     * Every session opens with the ruin, built after the reference image: a long
     * wall of mixed grey and ochre random rubble with mortar behind; at its west
     * end a tall corner pier of pale dressed stone with a lower buttress beside
     * it; the crown falls from there in broken steps toward the east; three
     * windows in pale stone frames (jambs, lintel, sill); a pale quoin strip; at
     * the east end a pointed Gothic doorway in a pale frame, a pier crowned by a
     * stone ball, then a low stepped wall. Ivy hangs in strands from the crown,
     * bushes grow at its foot, small plants on its top, grass along its base,
     * a few stones lie in the grass (this.ivy: real leaves, stems and blades).
     * Then it collapses, without trembling: from the west the stones fall, break
     * on the ground and lie there as dust, which creeps along the ground to where
     * the new form rises out of it. The will never reads the ruin's stones. */
    ruin(pieces, rng) {
      if (RUIN.ruinModel) return this.ruinFromModel(pieces, rng);
      const HOLD = 10;
      const yaw0 = rng.float(-0.12, 0.12), cz = rng.float(-0.03, 0.03);
      const TH = 0.044;                                           // wall thickness
      const cs = Math.cos(yaw0), sn = Math.sin(yaw0);
      const at = (u, w) => [cs * u + sn * w, cz - sn * u + cs * w];
      const ruin = [];
      const stone = (size, u, w, y, yaw, tint = 0, kind = 'block') => {
        const [x, z] = at(u, w);
        const p = { id: 5e5 + ruin.length, kind, size, pos: [x, y, z], yaw, start: 0, dur: 1,
          stray: false, seed: rng.int(1, 1e9), g: 0, boost: 0, grown: true, ruinOnly: true, wallU: u, wallW: w, tint };
        ruin.push(p);
        return p;
      };
      const ph = [rng.float(0, 6.3), rng.float(0, 6.3), rng.float(0, 6.3)];
      const rag = (u) => 0.008 * Math.sin(u * 29 + ph[0]) + 0.006 * Math.sin(u * 71 + ph[1]) + 0.005 * Math.sin(u * 151 + ph[2]);
      const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));

      // the silhouette, west → east (measured off the reference)
      const U0 = -0.45, U1 = 0.45;
      const crown = (u) => {
        if (u < -0.398) return 0.18 + rag(u) * 0.5;                        // low buttress
        if (u < -0.326) return 0.323;                                     // tall dressed corner pier
        if (u < -0.135) return 0.312 + rag(u);
        if (u < -0.05) return Math.round(lerp(0.312, 0.24, (u + 0.135) / 0.085) / 0.018) * 0.018 + rag(u) * 0.5;   // broken steps down
        if (u < 0.17) return lerp(0.24, 0.212, (u + 0.05) / 0.22) + rag(u);
        if (u < 0.282) return Math.round(lerp(0.205, 0.16, (u - 0.17) / 0.112) / 0.014) * 0.014 + rag(u) * 0.6;
        if (u < 0.41) return 0.152;                                       // the doorway's frame
        return Math.max(0.02, Math.round(lerp(0.11, 0.03, (u - 0.41) / 0.04) / 0.02) * 0.02);   // low stepped wall
      };
      // pale dressed zones: the corner pier, a quoin strip, the doorway
      const pale = (u) => (u > -0.402 && u < -0.326) || (u > -0.147 && u < -0.112) || (u > 0.282 && u < 0.41);
      // windows [u0, u1, y0, y1] (the opening; the frame goes round it)
      const windows = [[-0.2425, -0.1994, 0.2075, 0.261], [-0.0242, 0.0162, 0.116, 0.17], [0.1267, 0.1564, 0.086, 0.137]];
      const F = 0.011;                                            // frame width
      const inFrame = (u, y) => windows.some(([a, b, c, d]) => u > a - F * 1.7 && u < b + F * 1.7 && y > c - F * 1.4 && y < d + F * 1.5);
      // the pointed doorway
      const D0 = 0.315, D1 = 0.38, DS = 0.07, DR = 0.056;
      const inDoor = (u, y, grow = 0) => {
        if (u < D0 - grow || u > D1 + grow) return false;
        if (y < DS) return true;
        const l = Math.hypot(u - (D0 + DR), y - DS), r = Math.hypot(u - (D1 - DR), y - DS);
        return l < DR + grow && r < DR + grow;
      };

      // random rubble (and dressed blocks in the pale zones) in rough courses
      let y = 0;
      while (y < 0.33) {
        const ch = rng.float(0.012, 0.022);
        let u = U0 - rng.float(0, 0.03), runStart = null;
        const flushMortar = (uEnd) => {
          if (runStart == null) return;
          const a = Math.max(runStart, U0), b = Math.min(uEnd, U1);
          if (b - a > 0.008) stone([b - a, ch, TH * 0.7], (a + b) / 2, 0, y, yaw0, 3, 'box');
          runStart = null;
        };
        while (u < U1) {
          const pz = pale(u + 0.005);
          const l = pz ? rng.float(0.024, 0.045) : rng.float(0.014, 0.04);
          let s0 = Math.max(u, U0), s1 = Math.min(u + l, U1);
          // pale zones keep their own joints
          if (!pz && pale(s1)) { s1 = Math.min(s1, [-0.402, -0.147, 0.282].find((e) => e > s0 && e <= s1 + 0.001) ?? s1); }
          const mid = (s0 + s1) / 2, ym = y + ch * 0.5;
          const blocked = inFrame(mid, ym) || inDoor(mid, ym, 0.016) || ym > crown(mid) - rng.float(0, 0.008);
          if (blocked || s1 - s0 < 0.008) { flushMortar(s0); u = s1 + 0.0005; continue; }
          if (runStart == null) runStart = s0;
          if (pz) stone([s1 - s0 - 0.0015, ch * 0.96, TH * rng.float(0.98, 1.08)], mid, 0.004, y, yaw0 + rng.float(-0.02, 0.02), 1);
          else if (rng.chance(0.3) && s1 - s0 < 0.028) {
            // two small stones stacked in one slot
            const h1 = ch * rng.float(0.35, 0.6);
            stone([s1 - s0 - rng.float(0.002, 0.006), h1 * 0.9, TH * rng.float(0.88, 1.1)], mid + rng.float(-0.002, 0.002), rng.float(-0.005, 0.005), y, yaw0 + rng.float(-0.2, 0.2));
            stone([(s1 - s0) * rng.float(0.6, 0.95), (ch - h1) * 0.9, TH * rng.float(0.88, 1.1)], mid + rng.float(-0.004, 0.004), rng.float(-0.005, 0.005), y + h1, yaw0 + rng.float(-0.2, 0.2));
          } else {
            const hh = ch * rng.float(0.62, 1.0);
            stone([s1 - s0 - rng.float(0.002, 0.007), hh, TH * rng.float(0.88, 1.12)], mid + rng.float(-0.002, 0.002), rng.float(-0.006, 0.006), y + (ch - hh) * rng.next(), yaw0 + rng.float(-0.18, 0.18));
          }
          u = s1;
        }
        flushMortar(U1);
        y += ch;
      }
      // window frames: jambs of alternating dressed blocks, a lintel, a projecting sill
      for (const [a, b, c, d] of windows) {
        for (const [u0, u1] of [[a - F, a], [b, b + F]]) {
          let yy = c, k = 0;
          while (yy < d - 0.002) {
            const h = Math.min(0.02, d - yy), wide = k++ % 2 ? 1.6 : 1;
            const cu = u0 < a ? a - F * wide / 2 : b + F * wide / 2;
            stone([F * wide - 0.0015, h - 0.0015, TH * 1.04], cu, 0.003, yy, yaw0, 1);
            yy += h;
          }
        }
        stone([b - a + F * 2.4, 0.016, TH * 1.06], (a + b) / 2, 0.003, d, yaw0, 1);                 // lintel
        stone([b - a + F * 2.8, 0.01, TH * 1.2], (a + b) / 2, 0.008, c - 0.01, yaw0, 1);           // sill
      }
      // the doorway: a pointed ring of voussoirs
      for (const side of [-1, 1]) {
        const cu = side < 0 ? D0 + DR : D1 - DR, apexA = Math.acos(((D0 + D1) / 2 - cu) / DR);
        const a0 = side < 0 ? Math.PI : 0, a1 = apexA;
        for (let k = 0; k < 7; k++) {
          const a = a0 + (a1 - a0) * ((k + 0.5) / 7), r = DR + 0.008;
          stone([0.014, 0.014, TH * 1.08], cu + r * Math.cos(a), 0.004, DS + r * Math.sin(a) - 0.007, yaw0 + (a - Math.PI / 2) * 0, 1, 'box');
        }
      }
      // the east pier's cap and its stone ball
      stone([0.038, 0.012, TH * 1.25], 0.395, 0.003, 0.152, yaw0, 1);
      stone([0.022, 0.012, 0.022], 0.395, 0.003, 0.164, yaw0, 1);
      stone([0.032, 0.032, 0.032], 0.395, 0.003, 0.176, yaw0, 1, 'ball');
      // a few stones in the grass
      for (let k = 0; k < 8; k++) {
        const l = rng.float(0.012, 0.03);
        stone([l, l * rng.float(0.5, 0.8), l * rng.float(0.6, 0.9)], rng.float(U0, U1), rng.pick([-1, 1]) * rng.float(0.035, 0.09), 0, rng.float(0, Math.PI), rng.chance(0.3) ? 1 : 0);
      }

      // plants: real leaves, stems and grass blades (drawn by scene.js)
      const leaves = [];
      const fallAtU = (u) => HOLD + (u - U0) * 1.1;
      const face = (side) => [sn * side, 0, cs * side];
      const leaf = (u, yy, w, n, size, kind, shade) => { const [x, z] = at(u, w); leaves.push({ c: [x, yy, z], n, size, rot: rng.float(-0.7, 0.7), kind, shade, fall: fallAtU(u) }); };
      const outward = (side, tilt, turn) => {
        const nx = sn * side * Math.cos(turn) + cs * Math.sin(turn), nz = cs * side * Math.cos(turn) - sn * Math.sin(turn);
        const ct = Math.cos(tilt), st = Math.sin(tilt), l = Math.hypot(nx * ct, st, nz * ct);
        return [nx * ct / l, st / l, nz * ct / l];
      };
      // ivy hanging in strands from the crown
      const strands = [[-0.432, 0.0, 0.016], [-0.405, 0.12, 0.01], [-0.215, 0.12, 0.012], [-0.13, 0.17, 0.01], [-0.095, 0.08, 0.012], [0.19, 0.03, 0.012], [0.215, 0.0, 0.014], [0.24, 0.06, 0.01]];
      for (const side of [1, -1]) for (const [su, yEnd, spread] of strands) {
        if (side < 0 && rng.chance(0.5)) continue;
        let u = su, yy = crown(su) + 0.004;
        while (yy > yEnd) {
          const du = rng.float(-0.004, 0.004), dy = 0.008;
          leaf(u + du / 2, yy - dy / 2, side * (TH / 2 + 0.002), face(side), dy * 0.6, 1, rng.next());
          for (let k = 0; k < 3; k++) {
            const lu = u + rng.float(-spread, spread), ly = yy + rng.float(-0.006, 0.006);
            if (inFrame(lu, ly) && rng.chance(0.7)) continue;
            leaf(lu, ly, side * (TH / 2 + rng.float(0.003, 0.012)), outward(side, rng.float(-0.4, 0.8), rng.float(-0.6, 0.6)), rng.float(0.005, 0.009), 0, rng.next());
          }
          u += du; yy -= dy;
        }
      }
      // bushes at the foot, plants on the crown
      const bush = (cu, cy, r, side, n) => {
        for (let k = 0; k < n; k++) {
          const th = rng.float(0, Math.PI * 2), ph2 = Math.acos(rng.float(-0.2, 1)), rr = r * Math.cbrt(rng.next());
          const d = [Math.sin(ph2) * Math.cos(th), Math.cos(ph2), Math.sin(ph2) * Math.sin(th)];
          const ly = cy + d[1] * rr;
          if (ly < 0.002) continue;
          const w = side * (TH / 2 + r * 0.6) + d[2] * rr, lu = cu + d[0] * rr;
          const [x, z] = at(lu, w);
          leaves.push({ c: [x, ly, z], n: d, size: rng.float(0.006, 0.011), rot: rng.float(-1, 1), kind: 0, shade: rng.next() * 0.8 + 0.2, fall: fallAtU(lu) });
        }
      };
      for (const [cu, r] of [[-0.31, 0.04], [-0.17, 0.03], [0.0, 0.035], [0.17, 0.04], [0.25, 0.03], [-0.44, 0.03]]) {
        const side = rng.chance(0.75) ? 1 : -1;
        for (let l = 0; l < rng.int(3, 5); l++) {
          const rr = r * rng.float(0.35, 0.65);
          bush(cu + rng.float(-r, r) * 0.8, rr * rng.float(0.4, 1.4), rr, side, Math.round(rr * 4200));
        }
      }
      // sprigs on the crown: a few leafy stems reaching up
      for (const cu of [-0.385, -0.36, -0.2, 0.1, 0.12, 0.22]) {
        for (let s2 = 0; s2 < rng.int(2, 4); s2++) {
          let su = cu + rng.float(-0.012, 0.012), sy = crown(cu), ang = Math.PI / 2 + rng.float(-0.6, 0.6);
          for (let k = 0; k < rng.int(3, 6); k++) {
            const u2 = su + Math.cos(ang) * 0.008, y2 = sy + Math.sin(ang) * 0.008;
            leaf((su + u2) / 2, (sy + y2) / 2, rng.float(-0.01, 0.01), face(1), 0.005, 1, rng.next());
            leaf(u2 + rng.float(-0.006, 0.006), y2, rng.float(-0.012, 0.012), outward(rng.pick([-1, 1]), rng.float(0.3, 1.2), rng.float(-1.5, 1.5)), rng.float(0.005, 0.009), 0, rng.next());
            su = u2; sy = y2; ang += rng.float(-0.4, 0.4);
          }
        }
      }
      // grass along the base, both sides
      for (let k = 0; k < 2200; k++) {
        const tuft = Math.sin(k * 0.37) > 0.2;
        if (!tuft && rng.chance(0.6)) continue;
        const u = rng.float(U0 - 0.02, U1 + 0.02), side = rng.pick([-1, 1]), w = side * (TH / 2 + rng.float(0, 0.07) ** 1.5 * 3 + 0.002);
        const h = rng.float(0.003, 0.012) * (tuft ? 1 : 0.6);
        const [x, z] = at(u, w);
        leaves.push({ c: [x, h, z], n: outward(side, 0, rng.float(-1.2, 1.2)), size: h, rot: rng.float(-0.35, 0.35), kind: 2, shade: rng.next(), fall: fallAtU(u) + 0.6 });
      }

      // the collapse: from the west the stones fall, no trembling
      const G = 3.2;
      for (const p of ruin) {
        const fallAt = fallAtU(p.wallU) + rng.float(0, 0.25) - p.pos[1] * 0.6;
        const hit = fallAt + Math.sqrt((2 * Math.max(p.pos[1], 0.0005)) / G);
        p.ruinT = { rise: 0, yaw0: p.yaw, y0: p.pos[1], x0: p.pos[0], z0: p.pos[2], fallAt, hit, G,
          vx: rng.float(-0.05, 0.05) + sn * rng.float(-0.1, 0.1), vz: rng.float(-0.05, 0.05) + cs * rng.float(-0.1, 0.1), spin: rng.float(-1.5, 1.5) };
        p.ruinT.hitPos = [p.pos[0] + p.ruinT.vx * (hit - fallAt), p.pos[2] + p.ruinT.vz * (hit - fallAt)];
      }
      this.ivy = { leaves, version: (this.ivy?.version || 0) + 1 };

      // the new form: compressed in time, rising out of the dust once it has crept there
      const body = pieces.filter((p) => !p.stray);
      const t0 = Math.min(...body.map((p) => p.start)), from = HOLD + 3.6;
      for (const p of body) { p.start = from + (p.start - t0) * 0.3; p.dur = Math.min(p.dur, 2) * rng.float(0.8, 1.1); }
      const formEnd = Math.max(from, ...body.map((p) => p.start + p.dur));
      for (const p of pieces) if (p.stray) p.start += formEnd + 2;
      for (const p of pieces) if (p.leaveAt != null) p.leaveAt = p.start + p.dur + rng.float(30, 60);

      // dust: where each stone breaks it lies on the ground as a little heap of grit;
      // then the grit creeps along the ground to a new stone
      const parts = [];
      const vol = (q) => q.size[0] * q.size[1] * q.size[2];
      const totalV = body.reduce((a, q) => a + vol(q), 0) || 1;
      const pickBody = () => { let r = rng.next() * totalV; for (const q of body) if ((r -= vol(q)) <= 0) return q; return body[body.length - 1]; };
      for (const st of ruin) {
        if (st.tint === 3) continue;
        const n = Math.max(8, Math.min(34, Math.round(vol(st) / 0.5e-6)));
        const T = st.ruinT, heap = Math.min(0.012, 0.003 + st.size[1] * 0.2);
        for (let k = 0; k < n; k++) {
          const rr = Math.sqrt(rng.next()) * Math.max(st.size[0], st.size[2]) * 0.8, aa = rng.float(0, Math.PI * 2);
          const p0 = [T.hitPos[0] + Math.cos(aa) * rr, 0.0015 + heap * (1 - rr / Math.max(st.size[0], st.size[2]) / 0.8) * rng.next(), T.hitPos[1] + Math.sin(aa) * rr];
          const a = rng.float(0, Math.PI * 2), sp = rng.float(0.01, 0.06) * (0.4 + T.y0 * 3);
          const q = body.length ? pickBody() : null;
          let target = p0, arrive = from + 2;
          if (q) {
            const qc = Math.cos(q.yaw), qs = Math.sin(q.yaw), r = 1.0 + rng.float(0, 0.4);
            const tu = rng.float(-0.5, 0.5) * q.size[0] * r, tw = rng.float(-0.5, 0.5) * q.size[2] * r;
            target = [q.pos[0] + qc * tu + qs * tw, 0.0015, q.pos[2] - qs * tu + qc * tw];
            arrive = q.start + rng.float(-0.2, 0.5);
          }
          const haze = rng.chance(0.08);
          parts.push({ p0, v0: [Math.cos(a) * sp, haze ? rng.float(0.01, 0.05) : 0, Math.sin(a) * sp], emit: T.hit + rng.float(0, 0.06),
            seek: Math.min(arrive - 1.2, from - 0.4 + rng.float(0, 0.8)), arrive, target,
            size: haze ? rng.float(0.018, 0.035) : rng.float(0.003, 0.007), alpha: haze ? 0.22 : 0.95 });
        }
      }
      this.dust = { n: 0, data: new Float32Array(parts.length * 5), parts };
      pieces.push(...ruin);
    }

    /** The ruin from its 3D model (js/daemon/ruin-model.js, after
     *  assets/kuenstliche_ruine_weimar_game_ready.glb), told through its history
     *  in about ten seconds (the times below are story time, told at double speed):
     *    0 s   a short wall stands alone (the model's lowest stones)
     *    2.5 s beside it the palace rises (pale dressed blocks, a tower)
     *    5 s   the palace burns (1774), blackens and falls into a heap
     *    9 s   its stones are carried over, one by one, and built onto the wall:
     *          the ruin grows course by course out of the palace's stones (1784)
     *   16 s   time: ivy and grass grow over it, the fresh stones weather
     *   20 s   in two seconds it falls, breaks, and becomes ground
     *   22 s   the ground creeps together and the daemon's own body rises out of it
     *  The will never reads any of this. */
    ruinFromModel(pieces, rng) {
      const M = RUIN.ruinModel, G = 4.5;
      const T = HISTORY;
      const yaw0 = rng.float(-0.08, 0.08), cz = rng.float(0.02, 0.06), cs = Math.cos(yaw0), sn = Math.sin(yaw0);
      const s = 0.9 / M.length, [xc, yc] = M.center, fs = M.frontSign;
      const parts = M.parts.map((pt) => {
        const P = pt.p, n = P.length / 3, W = new Float32Array(P.length);
        const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
        let uSum = 0;
        for (let k = 0; k < n; k++) {
          const u = (P[k * 3] - xc) * s, w = (P[k * 3 + 1] - yc) * s * fs, y = P[k * 3 + 2] * s;
          const v = [cs * u + sn * w, y, cz - sn * u + cs * w];
          W.set(v, k * 3); uSum += u;
          for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], v[a]); mx[a] = Math.max(mx[a], v[a]); }
        }
        const pivot = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
        return { verts: W, idx: M.patterns[pt.i], col: pt.c, plant: pt.k, pivot, minY: Math.max(0, mn[1]), u: uSum / n, ext: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]] };
      });

      // the palace, behind the wall; its heap is where the ruin's stones come from
      const heap = this.palace(pieces, rng);

      // who is what: the old short wall, the stones carried from the palace, the plants
      const upper = [];
      for (const p of parts) {
        // green, thin parts are plants even when the model does not say so
        const green = p.col && p.col[1] > p.col[0] * 1.04 && p.col[1] > p.col[2] * 1.1;
        if (!p.plant && green && Math.min(p.ext[0], p.ext[2]) < 0.012) p.grass = true;
        if (p.plant || p.grass) p.grow = T.age + rng.float(0, 2.6) + (p.pivot[1] > 0.04 ? 0.6 : 0);
        else if (p.pivot[1] < T.stub && p.ext[1] < T.stub * 1.4) p.stub = true;
        else upper.push(p);
      }
      upper.sort((a, b) => a.minY - b.minY || a.u - b.u);
      upper.forEach((p, k) => {
        p.go = T.carry + (k / upper.length) * (T.age - T.carry - 2.2) + rng.float(0, 0.3);
        p.from = [rng.float(heap.x0, heap.x1), rng.float(heap.z0, heap.z1)];
        p.travel = rng.float(0.9, 1.3);
      });
      // the fall: two seconds, from the west, no trembling; each part breaks where it lands
      const U0 = -0.45;
      for (const p of parts) {
        p.fallAt = T.fall + (p.u - U0) / 0.9 * 0.9 + rng.float(0, 0.3);
        p.hit = p.fallAt + Math.sqrt((2 * Math.max(p.minY, 0.0005)) / G);
        p.vx = rng.float(-0.05, 0.05) + sn * rng.float(-0.12, 0.12);
        p.vz = rng.float(-0.05, 0.05) + cs * rng.float(-0.12, 0.12);
        p.spin = rng.float(-1.5, 1.5) * (p.plant ? 2 : 1);
      }
      this.ruinM = { parts, G, state: new Float32Array(parts.length * 4 * 3), version: (this.ruinM?.version || 0) + 1 };
      parts.forEach((p, i) => this.ruinM.state.set([p.pivot[0], p.pivot[1], p.pivot[2], p.plant], i * 4));
      this.ivy = null;
      this.story = true;

      // the new form: compressed in time, rising out of the ground once it has crept there
      const body = pieces.filter((p) => !p.stray && !p.ruinOnly);
      const t0 = Math.min(...body.map((p) => p.start)), from = T.rise - SHIFT;
      for (const p of body) { p.start = from + (p.start - t0) * 0.3; p.dur = Math.min(p.dur, 2) * rng.float(0.8, 1.1); }
      const formEnd = Math.max(from, ...body.map((p) => p.start + p.dur));
      for (const p of pieces) if (p.stray) p.start += formEnd + 2;
      for (const p of pieces) if (p.leaveAt != null) p.leaveAt = p.start + p.dur + rng.float(30, 60);
      this.lifeAt = formEnd + 1;

      // dust: where each stone breaks it lies on the ground as a little heap of grit,
      // then the grit creeps along the ground to a new stone
      const dust = [];
      const vol = (q) => q.size[0] * q.size[1] * q.size[2];
      const totalV = body.reduce((a, q) => a + vol(q), 0) || 1;
      const pickBody = () => { let r = rng.next() * totalV; for (const q of body) if ((r -= vol(q)) <= 0) return q; return body[body.length - 1]; };
      for (const st of parts) {
        if (st.plant) continue;
        const v = st.ext[0] * st.ext[1] * st.ext[2];
        const n = Math.max(6, Math.min(40, Math.round(v / 1.2e-6)));
        const hx = st.pivot[0] + st.vx * (st.hit - st.fallAt), hz = st.pivot[2] + st.vz * (st.hit - st.fallAt);
        const R = Math.max(st.ext[0], st.ext[2]) * 0.7, hp = Math.min(0.012, 0.003 + st.ext[1] * 0.2);
        for (let k = 0; k < n; k++) {
          const rr = Math.sqrt(rng.next()) * R, aa = rng.float(0, Math.PI * 2);
          const p0 = [hx + Math.cos(aa) * rr, 0.0015 + hp * (1 - rr / R) * rng.next(), hz + Math.sin(aa) * rr];
          const a = rng.float(0, Math.PI * 2), sp = rng.float(0.01, 0.05) * (0.4 + st.minY * 3);
          const q = body.length ? pickBody() : null;
          let target = p0, arrive = from + 2;
          if (q) {
            const qc = Math.cos(q.yaw), qs = Math.sin(q.yaw), r = 1.0 + rng.float(0, 0.4);
            const tu = rng.float(-0.5, 0.5) * q.size[0] * r, tw = rng.float(-0.5, 0.5) * q.size[2] * r;
            target = [q.pos[0] + qc * tu + qs * tw, 0.0015, q.pos[2] - qs * tu + qc * tw];
            arrive = q.start + rng.float(-0.2, 0.5);
          }
          dust.push({ p0, v0: [Math.cos(a) * sp, 0, Math.sin(a) * sp], emit: st.hit - SHIFT + rng.float(0, 0.06),
            seek: Math.min(arrive - 1.2, from - 0.6 + rng.float(0, 0.6)), arrive, target,
            size: rng.float(0.003, 0.007), alpha: 0.95 });
        }
      }
      this.dust = { n: 0, data: new Float32Array(dust.length * 5), parts: dust };
    }

    /** The palace (the Wilhelmsburg) behind the wall: a long block of pale dressed
     *  stone with rows of windows and a tower at one end. It rises, burns, falls
     *  into a heap, and the heap is slowly carried away. Returns the heap's extent. */
    palace(pieces, rng) {
      const T = HISTORY;
      const X0 = -0.34, X1 = 0.34, Z = -0.3, D = 0.11, H = 0.2, TX = 0.22, TH = 0.32, CH = 0.02, BL = 0.042, TK = 0.026;
      let k = 0;
      const win = (u, y) => {
        const row = [[0.045, 0.085], [0.11, 0.15], [0.165, 0.19]].some(([a, b]) => y > a && y < b);
        const col = Math.abs((((u - X0) / 0.068) % 1) - 0.5) < 0.2;
        return row && col;
      };
      const list = [];
      const wall = (x0, z0, x1, z1, top, front) => {
        const len = Math.hypot(x1 - x0, z1 - z0), yaw = -Math.atan2(z1 - z0, x1 - x0);
        for (let y = 0, c = 0; y < top - 0.001; y += CH, c++) {
          for (let d = (c % 2) * BL * 0.5 - BL * 0.5; d < len; d += BL) {
            const a = Math.max(0, d), b = Math.min(len, d + BL);
            if (b - a < 0.008) continue;
            const m = (a + b) / 2, x = x0 + ((x1 - x0) * m) / len, z = z0 + ((z1 - z0) * m) / len;
            if (front && x < TX && win(x, y + CH / 2)) continue;
            if (y >= H && (x < TX - 0.005 || x > TX + 0.095)) continue;
            const fall = T.burn + 2.2 + rng.float(0, 1.4) + (top - y) * 2.5 * rng.next();
            const hit = fall + Math.sqrt((2 * Math.max(y, 0.0005)) / 3.2);
            const p = { id: 6e5 + k++, kind: 'block', size: [b - a - 0.002, CH * 0.95, TK * rng.float(0.95, 1.05)], pos: [x, y, z], yaw: yaw + rng.float(-0.015, 0.015),
              start: T.palace + (y / TH) * 2.2 + rng.float(0, 0.2), dur: 0.45, stray: false, seed: rng.int(1, 1e9), g: 0, boost: 0, grown: true,
              ruinOnly: true, history: true, tint: 1, burn: 0 };
            p.ruinT = { yaw0: p.yaw, y0: y, x0: x, z0: z, fallAt: fall, hit, G: 3.2, burnAt: T.burn + rng.float(0, 0.8) + (x - X0) * 1.6 + (TH - y) * 1.5,
              gone: T.carry + rng.float(0, T.age - T.carry - 1.5), vx: rng.float(-0.06, 0.06), vz: rng.float(-0.04, 0.1), spin: rng.float(-2, 2) };
            list.push(p);
          }
        }
      };
      const zf = Z + D / 2, zb = Z - D / 2;
      wall(X0, zf, X1, zf, H, true);
      wall(X0, zb, X1, zb, H, false);
      wall(X0, zb + TK, X0, zf - TK, H, false);
      wall(X1, zb + TK, X1, zf - TK, H, false);
      // the tower rises above the roofline at the east end
      wall(TX, zf + 0.001, TX + 0.09, zf + 0.001, TH, false);
      wall(TX, zb - 0.001, TX + 0.09, zb - 0.001, TH, false);
      wall(TX, zb + TK, TX, zf - TK, TH, false);
      wall(TX + 0.09, zb + TK, TX + 0.09, zf - TK, TH, false);
      pieces.push(...list);
      return { x0: X0, x1: X1, z0: Z - D * 0.9, z1: Z + D * 0.9 };
    }

    /** words for the history, shown under the scene while it plays */
    caption() {
      if (!this.story || (this.game && this.game.active)) return '';
      const t = storyTime(this.t), T = HISTORY;
      if (t < T.palace) return 'a short wall';
      if (t < T.burn) return 'beside it, the palace';
      if (t < T.carry) return '1774 · the palace burns';
      if (t < T.carry + 3.3) return 'its stones are carried to the wall';
      if (t < T.age) return '1784 · a ruin is built out of them';
      if (t < T.fall) return 'ivy, rain, two hundred years';
      if (t < T.rise - 0.3) return 'it falls';
      if (t < T.rise + 2.5) return 'and becomes ground';
      return '';
    }

    /** the model ruin's parts through their history: the short wall, the stones
     *  carried from the palace and built onto it, the plants, then the fall */
    moveRuin() {
      const R = this.ruinM, t = storyTime(this.t), st = R.state, n = R.parts.length, T = HISTORY;
      let alive = 0;
      R.parts.forEach((p, i) => {
        let ox = 0, oy = 0, oz = 0, sp = 0, sc = 1, fresh = 0;
        if (p.plant || p.grass) sc = smooth(clamp((t - p.grow) / 1.4, 0, 1));
        else if (!p.stub) {
          if (t < p.go) sc = 0;
          else {
            // it appears on the heap, is carried along the ground, then lifted into its place
            const e = clamp((t - p.go) / 0.3, 0, 1);
            const m = smooth(clamp((t - p.go - 0.2) / p.travel, 0, 1));
            const r = smooth(clamp((t - p.go - 0.2 - p.travel) / 0.55, 0, 1));
            ox = (p.from[0] - p.pivot[0]) * (1 - m);
            oz = (p.from[1] - p.pivot[2]) * (1 - m);
            oy = (p.ext[1] / 2 - p.pivot[1]) * (1 - r);
            sc = 0.3 + 0.7 * smooth(e);
            fresh = 1 - smooth(clamp((t - T.age) / 3.5, 0, 1));
          }
        }
        if (t >= p.fallAt) {
          const f = Math.min(t, p.hit) - p.fallAt;
          ox = p.vx * f; oz = p.vz * f; oy = -0.5 * R.G * f * f; sp = p.spin * f;
          if (t >= p.hit) {
            if (!p.landed) { p.landed = true; if (!p.plant && this.onLand) this.onLand(p.pivot[0] + ox, p.pivot[2] + oz, Math.max(p.ext[0], p.ext[2])); }
            sc *= 1 - smooth(clamp((t - p.hit) / (p.plant ? 0.3 : 0.4), 0, 1));
          }
        }
        if (sc > 0 || t < T.fall) alive++;
        st[(n + i) * 4] = ox; st[(n + i) * 4 + 1] = oy; st[(n + i) * 4 + 2] = oz; st[(n + i) * 4 + 3] = sp;
        st[(2 * n + i) * 4] = sc; st[(2 * n + i) * 4 + 1] = fresh;
      });
      if (!alive) this.ruinM = null;
    }

    /* ---- live: the body mirrors what the cameras see ------------------------------------ */
    /** cameras on: the daemon stops growing on its own; its body becomes a mirror
     *  of the physical construction (cameras.js calls mirror()) */
    setLive(on) {
      if (on === this.live) return;
      this.live = on;
      this.dismiss();
      this.liveH = null;
      this.stacks = new Map();
      if (!on && this.daemon.state === 'session') this.generate((Math.random() * 1e9) >>> 0);
    }

    restartLive() {
      this.pieces = []; this.stacks = new Map(); this.t = 0; this.version++;
      if (this.liveH) { const H = this.liveH; this.liveH = null; this.mirror(H); }
    }

    dismiss() {
      for (const p of this.pieces) if (!p.leaving) { p.leaving = true; p.leaveAt = this.t + Math.random() * 1.5; p.leaveDur = 1.5 + Math.random(); }
    }

    /** the will's height map (levels per cell) → a stack of pieces in each cell:
     *  standing posts for the tall part, criss-crossed lying pieces for the rest */
    mirror(H) {
      const W = RUIN.will, A = this.A;
      this.liveH = Float32Array.from(H);
      const L = 0.16, B = L / 3, Th = L * 0.2;
      const postLv = L / LEVEL, beamLv = Th / LEVEL;
      for (let c = 0; c < W.N; c++) {
        const h = H[c] || 0;
        let posts = Math.floor((h + 0.4) / postLv), rest = h - posts * postLv;
        const beams = h < 0.25 ? 0 : Math.max(posts ? 0 : 1, Math.min(3, Math.round(rest / beamLv)));
        const sig = posts + ':' + beams;
        const old = this.stacks.get(c);
        if (old && old.sig === sig) continue;
        if (old) for (const p of old.pieces) if (!p.leaving) { p.leaving = true; p.leaveAt = this.t; p.leaveDur = 0.8; }
        if (!posts && !beams) { this.stacks.delete(c); continue; }
        const rng = new RUIN.Random((c * 7919 + this.liveSeed++) >>> 0);
        const w = W.cellToWorld(c % W.COLS, (c / W.COLS) | 0, A);
        const x = w.x - A / 2 + rng.float(-0.01, 0.01), z = w.y - 0.5 + rng.float(-0.01, 0.01);
        let yaw = rng.pick([0, Math.PI / 2]) + rng.float(-0.12, 0.12), y = 0, t = this.t;
        const list = [];
        const add = (size, kind) => {
          const p = { id: this.nextId = (this.nextId || 1e6) + 1, kind, size, pos: [x + rng.float(-0.006, 0.006), y, z + rng.float(-0.006, 0.006)], yaw: yaw + rng.float(-0.06, 0.06),
            start: t, dur: 1.2 + rng.float(0, 0.4), stray: false, seed: rng.int(1, 1e9), g: 0, boost: 0, grown: true };
          list.push(p); this.pieces.push(p);
          y += size[1]; t += p.dur * 0.8;
        };
        for (let k = 0; k < posts; k++) add([B * rng.float(0.92, 1.08), L * rng.float(0.95, 1.05), Th * rng.float(0.92, 1.08)], 'beam');
        for (let k = 0; k < beams; k++) { add([L * rng.float(0.95, 1.05), Th * rng.float(0.92, 1.08), B * rng.float(0.92, 1.08)], 'beam'); yaw += Math.PI / 2; }
        this.stacks.set(c, { sig, pieces: list });
      }
      this.version++;
    }

    /* ---- time ----------------------------------------------------------------------- */
    /** attention offered at a point on the board: nearby pieces grow faster */
    attend(x, z, amount) {
      if (this.onAttend) this.onAttend(x, z, amount);
      for (const p of this.pieces) {
        const d = Math.hypot(p.pos[0] - x, p.pos[2] - z);
        p.boost += amount * 2.5 * Math.exp(-(d * d) / 0.02);
      }
    }

    update(dt) {
      if (dt <= 0 || (!this.pieces.length && !this.ruinM && !this.dust && !(this.game && this.game.state !== 'off'))) return;
      this.t += dt;
      const d = this.daemon;
      for (let k = this.pieces.length - 1; k >= 0; k--) {
        const p = this.pieces[k];
        const local = (p.history ? storyTime(this.t) : this.t) + p.boost;
        let g = smooth(clamp((local - p.start) / p.dur, 0, 1));
        if (p.ruinT) {
          // the ruin's stones: they stand; then each falls, breaks on the ground and is dust.
          // The palace's blocks burn first, fall, and lie in a heap until they are carried off.
          const R = p.ruinT, t = p.history ? storyTime(this.t) : this.t;
          if (!p.history) g = 1;
          else p.burn = smooth(clamp((t - R.burnAt) / 1.6, 0, 1));
          if (t >= R.fallAt) {
            const f = Math.min(t, R.hit) - R.fallAt;
            p.pos = [R.x0 + R.vx * f, Math.max(0, R.y0 - 0.5 * R.G * f * f), R.z0 + R.vz * f];
            p.yaw = R.yaw0 + R.spin * f;
            if (t >= R.hit) {
              const b = p.history ? clamp((t - Math.max(R.hit, R.gone)) / 0.5, 0, 1) : clamp((t - R.hit) / 0.18, 0, 1);
              g = Math.min(g, 1 - smooth(b));
              if (b >= 1) { this.pieces.splice(k, 1); this.version++; continue; }
            }
          }
        }
        if (p.leaveAt != null && this.t > p.leaveAt) {
          const out = smooth(clamp((this.t - p.leaveAt) / p.leaveDur, 0, 1));
          g = Math.min(g, 1 - out);
          if (!p.leftReported && d.state === 'session' && !this.live) { p.leftReported = true; this.report(p, -1); }
          if (out >= 1) { this.pieces.splice(k, 1); this.version++; continue; }
        }
        p.g = g;
        if (!p.grown && g > 0.985) { p.grown = true; if (d.state === 'session') this.report(p, +1); }
      }
      if (this.ruinM) this.moveRuin();
      this.moveDust();
      if (this.live) return;          // the cameras report the body
      this.reportT -= dt;
      if (this.reportT <= 0) { this.reportT = 0.5; this.report(null, 0); }
    }

    /** the ruin's dust: it spreads low over the ground where the stones broke, settles,
     *  then creeps along the ground to the new stones, which rise out of it */
    moveDust() {
      const D = this.dust;
      if (!D) return;
      const t = this.t, out = D.data;
      let n = 0, alive = 0;
      const k = 4;
      const spread = (q, s) => {
        const f = (1 - Math.exp(-k * s)) / k;
        return [q.p0[0] + q.v0[0] * f, q.p0[1] + q.v0[1] * f * Math.exp(-s * 1.8), q.p0[2] + q.v0[2] * f];
      };
      for (const q of D.parts) {
        if (t > q.arrive + 0.8) continue;
        alive++;
        if (t < q.emit) continue;
        let pos;
        if (t < q.seek) pos = spread(q, t - q.emit);
        else {
          const a = spread(q, q.seek - q.emit), u = smooth(clamp((t - q.seek) / (q.arrive - q.seek), 0, 1));
          pos = [a[0] + (q.target[0] - a[0]) * u, a[1] * (1 - u) + q.target[1] * u + 0.002 * Math.sin(Math.PI * u), a[2] + (q.target[2] - a[2]) * u];
        }
        const alpha = q.alpha * smooth(clamp((t - q.emit) / 0.1, 0, 1)) * (1 - smooth(clamp((t - q.arrive) / 0.8, 0, 1)));
        out[n * 5] = pos[0]; out[n * 5 + 1] = pos[1]; out[n * 5 + 2] = pos[2]; out[n * 5 + 3] = alpha; out[n * 5 + 4] = q.size;
        n++;
      }
      D.n = n;
      if (!alive) this.dust = null;
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
        if (p.g < 0.02 || p.ruinOnly) continue;
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
      if (this.daemon.state !== 'session' || this.live) return;
      const H = this.heights();
      let at = null;
      if (p) {
        const W = RUIN.will, g = W.worldToGrid(p.pos[0] + this.A / 2, p.pos[2] + 0.5, this.A);
        const i = clamp(Math.floor(g.gx), 0, W.COLS - 1), j = clamp(Math.floor(g.gy), 0, W.ROWS - 1);
        at = { i, j, delta, height: H[j * W.COLS + i] };
      }
      this.daemon.setModel(H, this.pieces.filter((q) => q.g > 0.5 && !q.ruinOnly).length, at);
    }
  }

  RUIN.Growth = Growth;
  RUIN.growth = { LEVEL };
})((window.RUIN = window.RUIN || {}));
