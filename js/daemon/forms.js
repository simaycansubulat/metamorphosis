/* ---------------------------------------------------------------------------
 * forms.js — the vocabulary.
 * Each "character" is a way a cluster of matter can hold itself together.
 * A form is a list of spot specifications in the cluster's local frame
 * (1 unit = the cluster's scale, x = along its orientation).
 *
 *   type   0 = INK  (dense matter, merges with neighbours like a metaball)
 *          1 = WASH (diffuse stain, soft gaussian)
 *          2 = RING (transparent circle with a pooled rim)
 *   rf     radius factor (× cluster scale)
 *   order  0..1 — the "fill" (mass) at which this spot exists. Low-order
 *          spots are the skeleton; high-order ones are detail that only
 *          appears when the cluster is well fed.
 *   alpha  maximum opacity / density
 *   tint   0..1 between the two wash pigments
 *
 * Derived from the references:
 *   blot   — 2.jpg: a heavy merged mass with soft halo and thrown droplets
 *   spray  — 2.jpg: graded spots dispersed along a direction
 *   string — 3.jpg: beads strung on a line, a fine dotted companion, rings
 *   pool   — 3.jpg: overlapping transparent circles, small dots inside
 *   cell   — 1.jpg: a filled void held by a membrane of merged beads
 * ------------------------------------------------------------------------- */
(function (RUIN) {
  'use strict';

  const INK = 0, WASH = 1, RING = 2, SOOT = 3;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  const FORMS = {
    blot(rng, tint) {
      const s = [];
      s.push({ ox: 0, oy: 0, rf: 1.6, type: WASH, tint, order: 0.05, alpha: 0.7 });
      s.push({ ox: rng.float(-0.35, 0.35), oy: rng.float(-0.25, 0.25), rf: 0.75, type: WASH, tint: 1 - tint * 0.6, order: 0.35, alpha: 0.55 });
      s.push({ ox: rng.float(-0.2, 0.2), oy: rng.float(-0.15, 0.15), rf: 0.62, type: SOOT, order: 0.15, alpha: 0.55 });
      s.push({ ox: 0, oy: 0, rf: 0.5, type: INK, order: 0 });
      const lobes = rng.int(3, 6);
      const a0 = rng.float(0, TAU);
      for (let i = 0; i < lobes; i++) {
        const a = a0 + (i / lobes) * TAU + rng.float(-0.4, 0.4);
        const d = rng.float(0.22, 0.52);
        s.push({ ox: Math.cos(a) * d * 1.3, oy: Math.sin(a) * d * 0.85, rf: rng.float(0.2, 0.4), type: INK, order: 0.06 + i * 0.07 });
      }
      const drops = rng.int(5, 11);
      for (let i = 0; i < drops; i++) {
        const a = rng.float(0, TAU), d = rng.float(0.75, 1.5);
        s.push({ ox: Math.cos(a) * d * 1.4, oy: Math.sin(a) * d * 0.7, rf: rng.float(0.035, 0.11), type: INK, order: 0.3 + rng.float(0, 0.65) });
      }
      return s;
    },

    spray(rng, tint) {
      const s = [];
      s.push({ ox: -0.35, oy: 0, rf: 1.3, type: WASH, tint, order: 0, alpha: 0.6 });
      s.push({ ox: 0.45, oy: rng.float(-0.15, 0.15), rf: 0.7, type: WASH, tint: tint * 0.5 + 0.3, order: 0.25, alpha: 0.5 });
      s.push({ ox: rng.float(-0.3, 0.3), oy: 0, rf: 0.55, type: SOOT, order: 0.05, alpha: 0.45 });
      const n = rng.int(10, 17);
      for (let i = 0; i < n; i++) {
        const gx = rng.gauss() * 0.7, gy = rng.gauss() * 0.3;
        const central = Math.exp(-(gx * gx + gy * gy) * 1.4);
        const rf = 0.045 + 0.2 * central * rng.float(0.45, 1);
        const order = clamp(0.9 - central + rng.float(-0.15, 0.15), 0, 0.95);
        const soft = rng.chance(0.45);
        s.push({ ox: gx, oy: gy, rf: soft ? rf * 1.5 : rf, type: soft ? SOOT : INK, order, alpha: soft ? rng.float(0.6, 1) : 1 });
        if (!soft && rng.chance(0.4)) {
          // a companion spot dragged along the axis → elongated blot
          s.push({ ox: gx + rf * rng.float(0.9, 1.5), oy: gy + rng.float(-0.03, 0.03), rf: rf * rng.float(0.6, 0.85), type: INK, order: clamp(order + 0.05, 0, 0.97) });
        }
      }
      return s;
    },

    string(rng, tint) {
      const s = [];
      const n = rng.int(9, 15);
      const ph = rng.float(0, TAU), amp = rng.float(0.06, 0.2), freq = rng.float(1.6, 3.4);
      const len = 1.4;
      const y = (u) => Math.sin(u * freq + ph) * amp;
      for (let i = 0; i < n; i++) {
        const u = (i / (n - 1)) * 2 - 1;
        const big = rng.chance(0.2);
        const rf = big ? rng.float(0.13, 0.2) : 0.055 + 0.05 * Math.abs(Math.sin(i * 0.9 + ph));
        s.push({ ox: u * len, oy: y(u), rf, type: INK, order: Math.abs(u) * 0.75 + rng.float(0, 0.1) });
      }
      // fine dotted companion line
      const off = rng.sign() * rng.float(0.2, 0.32);
      const m = rng.int(12, 20);
      for (let i = 0; i < m; i++) {
        const u = (i / (m - 1)) * 2 - 1;
        s.push({ ox: u * len * 0.92, oy: y(u) + off, rf: rng.float(0.018, 0.032), type: INK, order: 0.35 + Math.abs(u) * 0.55 });
      }
      const rings = rng.int(2, 4);
      for (let i = 0; i < rings; i++) {
        const u = rng.float(-0.9, 0.9);
        s.push({ ox: u * len, oy: y(u) + rng.float(-0.12, 0.12), rf: rng.float(0.18, 0.36), type: RING, order: 0.15 + i * 0.2, alpha: 0.85 });
      }
      s.push({ ox: 0, oy: 0, rf: 1.3, type: WASH, tint, order: 0.2, alpha: 0.45 });
      return s;
    },

    pool(rng, tint) {
      const s = [];
      s.push({ ox: 0, oy: 0, rf: 1.35, type: WASH, tint, order: 0, alpha: 0.5 });
      const rings = rng.int(2, 4);
      for (let i = 0; i < rings; i++) {
        const a = rng.float(0, TAU), d = rng.float(0.05, 0.45);
        s.push({ ox: Math.cos(a) * d, oy: Math.sin(a) * d * 0.8, rf: rng.float(0.32, 0.62), type: RING, order: i * 0.18, alpha: 0.9 });
      }
      const dots = rng.int(3, 7);
      for (let i = 0; i < dots; i++) {
        const a = rng.float(0, TAU), d = rng.float(0, 0.6);
        s.push({ ox: Math.cos(a) * d, oy: Math.sin(a) * d, rf: rng.float(0.04, 0.11), type: INK, order: 0.15 + i * 0.1 });
      }
      const a = rng.float(0, TAU);
      s.push({ ox: Math.cos(a) * 0.5, oy: Math.sin(a) * 0.4, rf: 0.17, type: INK, order: 0.08 });
      s.push({ ox: Math.cos(a) * 0.35, oy: Math.sin(a) * 0.3, rf: 0.4, type: SOOT, order: 0.3, alpha: 0.35 });
      return s;
    },

    cell(rng) {
      const s = [];
      s.push({ ox: 0, oy: 0, rf: 0.72, type: WASH, tint: 1, order: 0, alpha: 0.85 });
      s.push({ ox: rng.float(-0.2, 0.2), oy: rng.float(-0.2, 0.2), rf: 0.5, type: WASH, tint: 0.8, order: 0.1, alpha: 0.6 });
      const n = rng.int(18, 24);
      const ph = rng.float(0, TAU), k1 = rng.float(0.06, 0.15);
      const gap = rng.int(0, n - 1);
      const junction = rng.float(0, TAU);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU;
        const rr = 0.86 * (1 + k1 * Math.sin(a * 2 + ph) + 0.05 * Math.sin(a * 5 + ph * 2));
        const near = Math.max(0, Math.cos(a - junction));
        let rf = 0.115 + 0.03 * Math.sin(a * 3 + ph) + 0.09 * near * near * near;
        if (i === gap || i === (gap + 1) % n) rf *= 0.4; // an opening in the membrane
        s.push({ ox: Math.cos(a) * rr * 1.15, oy: Math.sin(a) * rr * 0.9, rf, type: INK, order: (i / n) * 0.55 });
      }
      s.push({ ox: Math.cos(junction) * 1.05, oy: Math.sin(junction) * 0.82, rf: 0.24, type: INK, order: 0.04 });
      // a few loose grains inside the void
      const grains = rng.int(1, 4);
      for (let i = 0; i < grains; i++) {
        s.push({ ox: rng.float(-0.4, 0.4), oy: rng.float(-0.35, 0.35), rf: rng.float(0.025, 0.05), type: INK, order: 0.6 + i * 0.1 });
      }
      return s;
    },
  };

  /* Dendrites: tapered, branching filaments that grow out of a cluster.
   * They make separate stains read as one connected tissue (the vein
   * networks of the references). Each spec describes a growth tendency;
   * the actual path is recomputed every frame, so dendrites slowly wander,
   * grow when the cluster is fed or excited, and retract when it is calm.
   *   angle  local direction      len   length (× cluster scale)
   *   r0     root thickness       curl  how much it meanders
   *   forkP  branching chance     seek  bends toward the nearest neighbour
   *   light  cream filament (crosses dark matter) instead of dark vein   */
  const DENDRITE_CFG = {
    blot: [4, 6, 0.07, 0.3], spray: [2, 4, 0.045, 0.3], string: [2, 3, 0.05, 1.3],
    pool: [2, 4, 0.05, 0.6], cell: [5, 7, 0.06, 0.95],
  };
  function dendrites(character, rng) {
    const [min, max, r0, start] = DENDRITE_CFG[character];
    const n = rng.int(min, max);
    const a0 = rng.float(0, TAU);
    const out = [];
    for (let i = 0; i < n; i++) {
      const light = rng.chance(0.15);
      let angle = a0 + (i / n) * TAU + rng.float(-0.5, 0.5);
      if (character === 'string') angle = (i % 2 ? Math.PI : 0) + rng.float(-0.4, 0.4);
      out.push({
        angle, start,
        len: rng.float(1.3, 2.8),
        r0: r0 * rng.float(0.5, 0.95) * (light ? 0.4 : 1),
        curl: light ? rng.float(0.06, 0.14) : rng.float(0.12, 0.38),
        seed: rng.float(0, 1000),
        forkP: rng.float(0.18, 0.4),
        seek: rng.chance(0.55),
        light,
      });
    }
    return out;
  }

  RUIN.forms = { FORMS, INK, WASH, RING, SOOT, SEGMENT: 4, dendrites };
})((window.RUIN = window.RUIN || {}));
