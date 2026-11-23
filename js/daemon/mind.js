/* ---------------------------------------------------------------------------
 * mind.js — the grammar of the daemon.
 *
 * The daemon does not move randomly. It speaks in PHRASES made of GESTURES,
 * and between phrases it LISTENS (the field calms, slows, contracts — this
 * is the moment for the participant to answer with the physical pieces).
 *
 * Each gesture is a small intention acting on the organism:
 *
 *   converge   matter is drawn into a hub along strengthened veins
 *   divide     a large mass buds a new locus and pushes it away
 *   reach      a chain of beads extends toward empty space; a locus forms there
 *   release    a locus loosens, disperses, gives its matter away, may vanish
 *   insist     a locus pulses rhythmically; the pulse travels through the web
 *   realign    the whole field rotates toward a new axis
 *   transmute  a locus changes character (e.g. blot → string)
 *   link       two nearby loci become connected
 *   sever      a connection thins into dots and dissolves
 *   migrate    a locus travels, dragging and stretching its connections
 *   demand     (once the participant builds) it works on the area where the
 *              construction most departs from its intention: gathering and
 *              insisting where it lacks matter, loosening and pushing away
 *              where it rejects matter
 *
 * Where gestures act is not random: they are biased by the will's desire
 * (reach and migrate go where it wants matter, release prefers loci where
 * it does not, divide feeds the loci it wants to grow).
 *
 * Gestures overlap (max 2 at once) so the transformations are interwoven.
 * Weights come from the temperament (the session's dialect), the current
 * state of the body (population, masses), and recent history (it avoids
 * repeating itself too soon — but `insist` is precisely repetition).
 * ------------------------------------------------------------------------- */
(function (RUIN) {
  'use strict';

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  const GESTURES = {
    converge: {
      weight: (org) => (org.living().length >= 3 ? 1 : 0),
      begin(org, rng) {
        const L = org.living();
        const hub = rng.weighted(L, (c) => c.mass + 0.1);
        const others = L.filter((c) => c !== hub).sort((p, q) => dist(p, hub) - dist(q, hub)).slice(0, rng.int(1, 2));
        const bonds = others.map((o) => {
          const b = org.bond(o, hub, { strength: 0.95, growthRate: 0.25 });
          b.flowFrom(o, 0.035);
          b.restT = (o.S + hub.S) * 1.4;
          return b;
        });
        hub.tensionT = 0.92;
        return { hub, bonds, beat: 2, dur: rng.float(10, 15) };
      },
      update(g, dt, org) {
        g.beat -= dt;
        if (g.beat <= 0) { g.beat = 1.7; for (const b of g.bonds) if (b.established) b.pulse(b.other(g.hub), 0.5); }
      },
      end(g) {
        for (const b of g.bonds) { b.flow = 0; b.restT = null; b.strengthT = Math.min(b.strengthT, 0.6); }
        g.hub.tensionT = g.hub.baseTension;
      },
    },

    divide: {
      weight: (org, mind) => {
        const L = org.living();
        if (L.length >= mind.temp.maxClusters) return 0;
        return L.some((c) => c.mass > 0.55) ? 1.2 : 0;
      },
      begin(org, rng, mind) {
        const A = rng.weighted(org.living().filter((c) => c.mass > 0.55), (c) => c.mass * (0.3 + org.desireAt(c.x, c.y)));
        const ang = A.angle + (rng.chance(0.5) ? 0 : Math.PI / 2) * rng.sign() + rng.float(-0.4, 0.4);
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const B = org.addCluster({
          x: A.x + ca * A.S * 0.25, y: A.y + sa * A.S * 0.25,
          mass: 0.03, character: mind.pickCharacter(), tension: A.tension, emerge: 3,
        });
        const d = A.S + 0.2;
        B.goal = { x: clamp(A.x + ca * d * 1.5, 0.12, org.aspect - 0.12), y: clamp(A.y + sa * d, 0.12, 0.88) };
        B.goalW = 1;
        const bond = org.bond(A, B, { strength: 1, growth: 1 });
        bond.flowFrom(A, 0.06);
        A.excite(0.7, true);
        return { A, B, bond, target: A.mass * rng.float(0.35, 0.5), dur: rng.float(12, 17) };
      },
      update(g) {
        if (g.B.mass >= g.target) g.bond.flow = 0;
        if (g.t > g.dur * 0.6) { g.bond.strengthT = 0.3; g.B.goalW = 0.3; }
      },
      end(g, org, mind) {
        g.bond.flow = 0;
        g.B.goal = null;
        g.bond.strengthT = mind.rng.chance(0.5) ? 0.35 : 0;
      },
    },

    reach: {
      weight: (org, mind) => (org.living().length < mind.temp.maxClusters ? 1 : 0),
      begin(org, rng, mind) {
        const A = rng.weighted(org.living(), (c) => c.mass + c.act);
        const target = org.emptySpot(rng, A, 0.28, 0.5);
        if (!target) return null;
        const B = org.addCluster({
          x: target.x, y: target.y, mass: 0.05, emerge: Infinity,
          character: mind.pickCharacter(null, ['string', 'spray', 'pool', 'blot']),
        });
        const bond = org.bond(A, B, { strength: 0.8, growth: 0, growthRate: 1 / rng.float(5, 8) });
        bond.flowFrom(A, 0.03);
        return { A, B, bond, beat: 1, dur: rng.float(11, 15) };
      },
      update(g, dt) {
        if (g.bond.growth > 0.7 && g.B.lifeRate === 0) g.B.lifeRate = 1 / 4;
        g.beat -= dt;
        if (g.beat <= 0 && g.bond.growth > 0.3) { g.beat = 2.2; g.bond.pulse(g.A, 0.6); }
      },
      end(g) {
        if (g.B.lifeRate === 0) g.B.lifeRate = 1 / 3;
        g.bond.flow = 0;
        g.bond.strengthT = 0.5;
      },
    },

    release: {
      weight: (org, mind) => (org.living().length > mind.temp.minClusters ? 1 : 0.15),
      begin(org, rng, mind) {
        const L = org.living();
        const A = rng.weighted(L, (c) => (1 / (c.mass + 0.15) + c.age * 0.003) * (1.3 - org.desireAt(c.x, c.y)));
        A.tensionT = 0.05;
        let nb = org.neighbors(A).filter((n) => n.alive);
        if (!nb.length) {
          const n = org.nearest(A);
          if (n) { org.bond(A, n, { strength: 0.6, growth: 0, growthRate: 0.3 }); nb = [n]; }
        }
        const bonds = nb.map((n) => { const b = org.findBond(A, n); b.flowFrom(A, 0.045); return b; });
        const mayVanish = L.length > mind.temp.minClusters;
        return { A, bonds, mayVanish, done: false, dur: rng.float(10, 14) };
      },
      update(g) {
        if (g.mayVanish && !g.done && g.t > g.dur * 0.6 && g.A.mass < 0.3) { g.A.dissolve(); g.done = true; }
      },
      end(g) {
        for (const b of g.bonds) b.flow = 0;
        if (!g.done) g.A.tensionT = g.A.baseTension;
      },
    },

    insist: {
      weight: (org) => (org.living().length ? 0.9 : 0),
      begin(org, rng) {
        const A = rng.weighted(org.living(), (c) => c.mass + org.degree(c) * 0.3);
        const beats = rng.int(3, 6), interval = rng.float(0.9, 1.5);
        return { A, beats, interval, n: 0, next: 0, dur: beats * interval + 2.5 };
      },
      update(g, dt, org, mind) {
        g.next -= dt;
        if (g.next <= 0 && g.n < g.beats) {
          g.A.excite(0.95, true);
          mind.emitter.emit('beat', { x: g.A.x, y: g.A.y, n: g.n, of: g.beats, mass: g.A.mass });
          g.A.tensionT = g.n % 2 ? g.A.baseTension : clamp(g.A.baseTension + 0.25, 0, 1);
          g.n++; g.next = g.interval;
        }
      },
      end(g) { g.A.tensionT = g.A.baseTension; },
    },

    realign: {
      weight: () => 0.6,
      begin(org, rng, mind) {
        org.axisT = org.axis + rng.sign() * rng.float(0.5, 1.4);
        org.coherenceT = clamp(mind.temp.coherence + 0.3, 0, 0.95);
        return { dur: rng.float(12, 16) };
      },
      end(g, org, mind) { org.coherenceT = mind.temp.coherence; },
    },

    transmute: {
      weight: (org) => (org.living().length ? 0.7 : 0),
      begin(org, rng, mind) {
        const A = rng.pick(org.living());
        A.setForm(mind.pickCharacter(A.character));
        A.excite(0.5);
        return { A, dur: 7 };
      },
    },

    demand: {
      weight: (org, mind) => {
        const w = org.will;
        if (!w || !w.engaged || !w.focus(1).length) return 0;
        return 1 + 9 * w.insistence;
      },
      begin(org, rng, mind) {
        const f = org.will.focus(1)[0];
        const p = RUIN.will.cellToWorld(f.i, f.j, org.aspect);
        const L = org.living();
        const g = { f, p, dur: rng.float(7, 11), beat: 0.5, touched: [] };
        if (f.kind === 'lack') {
          let A = null, bd = Infinity;
          for (const c of L) { const d = dist(c, p); if (d < bd) { bd = d; A = c; } }
          if (A && bd > 0.42 && L.length < mind.temp.maxClusters) {
            // nothing close enough: it reaches out and grows matter there
            const B = org.addCluster({ x: p.x, y: p.y, mass: 0.06, emerge: Infinity, character: mind.pickCharacter() });
            const bond = org.bond(A, B, { strength: 0.9, growth: 0, growthRate: 1 / rng.float(3, 5) });
            bond.flowFrom(A, 0.05);
            g.B = B; g.bond = bond; g.A = A;
          } else if (A) {
            A.goal = { x: p.x, y: p.y }; A.goalW = 0.9; A.goalTime = 0;
            A.tensionT = Math.min(0.97, A.baseTension + 0.3);
            for (const b of org.bondsOf(A)) { b.flowFrom(b.other(A), 0.03); g.touched.push(b); }
            g.A = A;
          }
        } else {
          // it rejects matter here: loosen and push its own matter away
          for (const c of L) {
            const d = dist(c, p);
            if (d < 0.35) {
              c.tensionT = 0.1;
              const away = Math.atan2(c.y - p.y, c.x - p.x);
              c.goal = { x: clamp(c.x + Math.cos(away) * 0.2, 0.1, org.aspect - 0.1), y: clamp(c.y + Math.sin(away) * 0.2, 0.1, 0.9) };
              c.goalW = 0.6; c.goalTime = 0;
              g.touched.push(c);
            }
          }
        }
        return g;
      },
      update(g, dt, org, mind) {
        if (g.B && g.bond.growth > 0.6 && g.B.lifeRate === 0) g.B.lifeRate = 1 / 3;
        g.beat -= dt;
        if (g.beat <= 0) {
          // irregular insistence, faster when the will is more insistent
          const ins = org.will ? org.will.insistence : 0.3;
          g.beat = (1.6 - 1.1 * ins) * mind.rng.float(0.7, 1.4);
          if (g.A && !g.A.dissolving) g.A.excite(0.6 + 0.5 * ins, true);
          if (g.bond) g.bond.pulse(g.A, 0.7);
        }
      },
      end(g) {
        if (g.B && g.B.lifeRate === 0) g.B.lifeRate = 1 / 3;
        if (g.bond) { g.bond.flow = 0; g.bond.strengthT = 0.6; }
        if (g.A && !g.B) { g.A.goal = null; g.A.tensionT = g.A.baseTension; }
        for (const x of g.touched) {
          if (x.flow !== undefined && x.pulses) x.flow = 0;
          else { x.goal = null; x.tensionT = x.baseTension; }
        }
      },
    },

    link: {
      weight: (org) => (candidatePairs(org).length ? 0.9 : 0),
      begin(org, rng) {
        const pairs = candidatePairs(org);
        const [a, b] = rng.weighted(pairs, ([p, q]) => 1 / (dist(p, q) + 0.05));
        const bond = org.bond(a, b, { strength: rng.float(0.55, 1), growth: 0, growthRate: 1 / rng.float(4, 7) });
        return { bond, a, beat: 3, dur: 10 };
      },
      update(g, dt) {
        g.beat -= dt;
        if (g.beat <= 0 && g.bond.established) { g.beat = 2.5; g.bond.pulse(g.a, 0.55); }
      },
    },

    sever: {
      weight: (org) => (org.bonds.filter((b) => b.strengthT > 0.1).length > 1 ? 0.7 : 0),
      begin(org, rng) {
        const bond = rng.weighted(org.bonds.filter((b) => b.strengthT > 0.1), (b) => b.length);
        bond.strengthT = 0.16; // first it breaks into dots…
        return { bond, dur: rng.float(8, 11) };
      },
      update(g) { if (g.t > g.dur * 0.5) g.bond.strengthT = 0; }, // …then it is gone
    },

    migrate: {
      weight: (org) => (org.living().length ? 0.7 : 0),
      begin(org, rng) {
        const A = rng.pick(org.living());
        const target = org.emptySpot(rng, A, 0.18, 0.4);
        if (!target) return null;
        A.goal = target; A.goalW = 0.7; A.goalTime = 0;
        A.tensionT = A.baseTension * 0.75;
        return { A, dur: rng.float(12, 16) };
      },
      end(g) { g.A.goal = null; g.A.tensionT = g.A.baseTension; },
    },
  };

  function candidatePairs(org) {
    const L = org.living(), out = [];
    for (let i = 0; i < L.length; i++)
      for (let j = i + 1; j < L.length; j++)
        if (!org.findBond(L[i], L[j]) && dist(L[i], L[j]) < 0.6) out.push([L[i], L[j]]);
    return out;
  }

  class Mind {
    constructor(org, temp, rng, emitter) {
      this.org = org;
      this.temp = temp;
      this.rng = rng;
      this.emitter = emitter;
      this.active = [];
      this.history = [];
      this.mode = 'speaking';
      this.phraseLeft = rng.int(2, 4);
      this.wait = 9; // let the initial configuration unfold first
      this.listenLeft = 0;
      this.ambient = 4;
    }

    pickCharacter(exclude = null, among = null) {
      const w = this.temp.characterWeights;
      const names = (among || Object.keys(w)).filter((n) => n !== exclude);
      return this.rng.weighted(names, (n) => w[n]);
    }

    start(name) {
      const G = GESTURES[name];
      const g = G.begin(this.org, this.rng, this);
      if (!g) return null;
      g.name = name; g.t = 0;
      this.active.push(g);
      this.history.push(name);
      if (this.history.length > 6) this.history.shift();
      this.emitter.emit('gesture:start', { name, duration: g.dur });
      return g;
    }

    choose() {
      const names = Object.keys(GESTURES);
      for (let attempt = 0; attempt < 4; attempt++) {
        const name = this.rng.weighted(names, (n) => {
          let w = GESTURES[n].weight(this.org, this) * (this.temp.gestureWeights[n] ?? 1);
          if (this.history.slice(-2).includes(n)) w *= 0.2;
          if (this.active.some((g) => g.name === n)) w = 0;
          return w;
        });
        if (!name) return null;
        const g = this.start(name);
        if (g) return g;
      }
      return null;
    }

    update(dt) {
      const org = this.org;

      for (let i = this.active.length - 1; i >= 0; i--) {
        const g = this.active[i];
        g.t += dt;
        const G = GESTURES[g.name];
        G.update?.(g, dt, org, this);
        if (g.t >= g.dur) {
          G.end?.(g, org, this);
          this.active.splice(i, 1);
          this.emitter.emit('gesture:end', { name: g.name });
        }
      }

      // sub-vocal activity: small spontaneous excitations
      this.ambient -= dt;
      if (this.ambient <= 0) {
        const L = org.living();
        if (L.length) this.rng.pick(L).excite(this.mode === 'listening' ? 0.3 : 0.5);
        this.ambient = this.rng.float(2.5, 6) / this.temp.tempo;
      }

      if (this.mode === 'listening') {
        this.listenLeft -= dt;
        if (this.listenLeft <= 0) {
          this.mode = 'speaking';
          org.calmT = 0;
          this.phraseLeft = this.rng.int(3, 5);
          this.wait = 0.5;
          this.emitter.emit('phase', { mode: 'speaking' });
        }
        return;
      }

      // when the construction pleases it, it speaks less and listens longer
      const content = org.will && org.will.engaged ? org.will.alignment : 0;
      this.wait -= dt * this.temp.tempo * (1 - 0.55 * content);
      if (this.wait > 0 || this.active.length >= 2) return;

      if (this.phraseLeft <= 0) {
        if (this.active.length === 0) {
          this.mode = 'listening';
          org.calmT = 1;
          const content2 = org.will && org.will.engaged ? org.will.alignment : 0;
          this.listenLeft = this.rng.float(8, 15) * (1 + content2);
          this.emitter.emit('phase', { mode: 'listening', duration: this.listenLeft });
        } else this.wait = 1;
        return;
      }

      const g = this.choose();
      if (g) { this.phraseLeft--; this.wait = g.dur * this.rng.float(0.45, 0.8); }
      else this.wait = 1.5;
    }

    /** Called when a session ends: let current intentions fade gracefully. */
    stop() {
      for (const g of this.active) GESTURES[g.name].end?.(g, this.org, this);
      this.active = [];
    }
  }

  RUIN.Mind = Mind;
  RUIN.mind = { GESTURES };
})((window.RUIN = window.RUIN || {}));
