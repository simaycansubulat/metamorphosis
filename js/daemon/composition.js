/* ---------------------------------------------------------------------------
 * composition.js — the first utterance of a session.
 * Builds the initial configuration from the temperament: one dominant mass
 * off-centre, smaller loci arranged with a bias toward the daemon's axis,
 * and a sparse web of connections (a spanning tree with some links missing,
 * so the field always has both connected and isolated elements).
 * Everything is born at the point where the participant touched, and blooms
 * outward from there.
 * ------------------------------------------------------------------------- */
(function (RUIN) {
  'use strict';

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const scaleOf = (mass) => 0.06 + 0.135 * Math.sqrt(mass);

  function pickCharacter(rng, temp, exclude) {
    const names = Object.keys(temp.characterWeights).filter((n) => n !== exclude);
    return rng.weighted(names, (n) => temp.characterWeights[n]);
  }

  function compose(org, temp, rng, origin, will = null) {
    const W = org.aspect;
    const n = clamp(temp.clusterCount, 3, temp.maxClusters);
    if (will) return composeWill(org, temp, rng, origin, will, n);

    // masses: one dominant, the rest scattered on a power curve
    const raw = [rng.float(1.0, 1.5)];
    for (let i = 1; i < n; i++) raw.push(0.12 + Math.pow(rng.next(), 1.6) * 0.7);
    const sum = raw.reduce((a, b) => a + b, 0);
    const masses = raw.map((m) => (m / sum) * temp.totalMass);

    // placement: best-candidate sampling with a pull toward the axis line
    const ax = Math.cos(temp.axis), ay = Math.sin(temp.axis);
    const cx = W / 2, cy = 0.5;
    const pts = [];
    const first = {
      x: cx + rng.sign() * rng.float(0.06, 0.2) * W,
      y: cy + rng.float(-0.14, 0.14),
    };
    pts.push(first);
    for (let i = 1; i < n; i++) {
      const Si = scaleOf(masses[i]);
      let best = null, bestScore = -Infinity;
      for (let k = 0; k < 40; k++) {
        const m = Si + 0.07;
        const x = rng.float(m, W - m), y = rng.float(m, 1 - m);
        let s = Infinity;
        for (let j = 0; j < pts.length; j++) {
          const d = Math.hypot(pts[j].x - x, pts[j].y - y) - (Si + scaleOf(masses[j])) * 1.3;
          s = Math.min(s, d);
        }
        const perp = Math.abs((x - cx) * -ay + (y - cy) * ax);
        s -= perp * temp.coherence * 0.35;
        if (s > bestScore) { bestScore = s; best = { x, y }; }
      }
      pts.push(best);
    }

    // create — everything starts at the origin, then unfolds
    const clusters = pts.map((p, i) => {
      const d = Math.hypot(p.x - origin.x, p.y - origin.y);
      const character = i === 0 ? temp.dominant : pickCharacter(rng, temp);
      const c = org.addCluster({
        x: origin.x + rng.float(-0.01, 0.01),
        y: origin.y + rng.float(-0.01, 0.01),
        mass: masses[i],
        character,
        tension: clamp(temp.tension + rng.float(-0.15, 0.15), 0.15, 0.95),
        emerge: rng.float(3, 5),
        delay: 0.3 + d * 3.2 + i * 0.25,
      });
      c.goal = p; c.goalW = 1.4;
      return c;
    });

    // connections: Prim's minimum spanning tree, some edges dropped, one loop
    const inTree = [0], edges = [];
    while (inTree.length < n) {
      let best = null, bd = Infinity;
      for (const i of inTree) {
        for (let j = 0; j < n; j++) {
          if (inTree.includes(j)) continue;
          const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
          if (d < bd) { bd = d; best = [i, j]; }
        }
      }
      inTree.push(best[1]);
      edges.push(best);
    }
    const kept = edges.filter(() => rng.chance(0.72));
    if (n > 3 && rng.chance(0.6)) {
      const i = rng.int(0, n - 1), j = rng.int(0, n - 1);
      if (i !== j && !kept.some(([a, b]) => (a === i && b === j) || (a === j && b === i))) kept.push([i, j]);
    }
    for (const [i, j] of kept) {
      const a = clusters[i], b = clusters[j];
      org.bond(a, b, {
        strength: rng.float(0.4, 1),
        growth: 0,
        growthRate: 1 / rng.float(4, 7),
        delay: Math.max(a.delay, b.delay) + 2.5,
      });
    }
    return clusters;
  }

  /* With an intention: matter is distributed like the target, heavier and
   * denser where it wants height, plus a little unformed matter elsewhere. */
  function composeWill(org, temp, rng, origin, will, n) {
    const { COLS, ROWS, MAXH, cellToWorld } = RUIN.will;
    const T = will.T;
    const cells = [];
    for (let c = 0; c < T.length; c++) if (T[c] > 0) cells.push({ i: c % COLS, j: (c / COLS) | 0, h: T[c] });
    cells.sort((a, b) => b.h - a.h);
    const picks = [];
    for (const c of cells) {
      if (picks.length >= n - 1) break;
      if (picks.every((p) => Math.hypot(p.i - c.i, (p.j - c.j) * 1.2) >= 1.6)) picks.push(c);
    }
    // a locus of unformed matter, away from the intention
    for (let tries = 0; picks.length < n && tries < 60; tries++) {
      const i = rng.int(0, COLS - 1), j = rng.int(0, ROWS - 1);
      if (T[j * COLS + i] === 0 && picks.every((p) => Math.hypot(p.i - i, p.j - j) >= 2)) picks.push({ i, j, h: 0 });
    }
    const totalW = picks.reduce((s, p) => s + 0.25 + p.h / MAXH, 0);
    const clusters = picks.map((p, k) => {
      const w = cellToWorld(p.i, p.j, org.aspect);
      const pos = { x: w.x + rng.float(-0.03, 0.03), y: w.y + rng.float(-0.03, 0.03) };
      const d = Math.hypot(pos.x - origin.x, pos.y - origin.y);
      const tall = p.h >= 3;
      const character = k === 0 ? temp.dominant
        : tall ? pickCharacter(rng, { characterWeights: { blot: 1.4, pool: 1.0, cell: 0.6 } })
        : p.h === 0 ? pickCharacter(rng, { characterWeights: { spray: 1, string: 0.6 } })
        : pickCharacter(rng, temp);
      const c = org.addCluster({
        x: origin.x + rng.float(-0.01, 0.01), y: origin.y + rng.float(-0.01, 0.01),
        mass: (temp.totalMass * (0.25 + p.h / MAXH)) / totalW,
        character,
        tension: clamp(temp.tension + (p.h / MAXH) * 0.25 + rng.float(-0.1, 0.1), 0.15, 0.97),
        emerge: rng.float(3, 5),
        delay: 0.3 + d * 3.2 + k * 0.25,
      });
      c.goal = pos; c.goalW = 1.4;
      c.cell = p;
      return c;
    });
    // connections: spanning tree over the loci, favouring the intended ones
    const inTree = [0];
    while (inTree.length < clusters.length) {
      let best = null, bd = Infinity;
      for (const i of inTree) for (let j = 0; j < clusters.length; j++) {
        if (inTree.includes(j)) continue;
        const d = Math.hypot(clusters[i].goal.x - clusters[j].goal.x, clusters[i].goal.y - clusters[j].goal.y) * (picks[j].h ? 1 : 1.8);
        if (d < bd) { bd = d; best = [i, j]; }
      }
      inTree.push(best[1]);
      const a = clusters[best[0]], b = clusters[best[1]];
      if (picks[best[1]].h > 0 || rng.chance(0.4)) {
        org.bond(a, b, { strength: rng.float(0.5, 1), growth: 0, growthRate: 1 / rng.float(4, 7), delay: Math.max(a.delay, b.delay) + 2.5 });
      }
    }
    return clusters;
  }

  RUIN.composition = { compose, pickCharacter };
})((window.RUIN = window.RUIN || {}));
