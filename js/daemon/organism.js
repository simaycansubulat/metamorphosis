/* ---------------------------------------------------------------------------
 * organism.js — the body of the daemon.
 *
 *   Cluster  — a locus of matter (a "word"). Has mass, a character (form),
 *              an orientation, a tension (compact ↔ dispersed) and an
 *              activation level (how intensely it is "thinking").
 *   Spot     — one stain belonging to a cluster. Spots never jump: they
 *              ease toward targets, so every change is a transformation.
 *   Bond     — a connection between clusters, drawn as a chain of ink beads.
 *              Strong bonds merge into continuous veins; weak ones break
 *              into dotted lines; dead ones evaporate. Mass flows along
 *              bonds and activation travels along them as pulses.
 *
 * World units: height = 1, width = aspect. y grows downward.
 * Nothing here knows about rendering; `collect()` exports plain numbers.
 * ------------------------------------------------------------------------- */
(function (RUIN) {
  'use strict';

  const { FORMS, INK } = RUIN.forms;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (rate, dt) => 1 - Math.exp(-rate * dt);
  const smooth = (t) => t * t * (3 - 2 * t);
  const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

  const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

  const FULL_MASS = 0.85;
  const ZERO_SIGNAL = { lack: 0, excess: 0, harmony: 0 }; // mass at which a cluster shows all its detail

  /* ------------------------------------------------------------------ Spot */
  class Spot {
    constructor(spec, rng, x, y) {
      this.x = x; this.y = y;
      this.r = 0; this.alpha = 0; this.act = 0;
      this.seed = rng.next();
      this.k = rng.float(1.0, 2.6); // responsiveness: low k = trailing, smeared
      this.retired = false;
      this.apply(spec);
    }
    apply(sp) {
      this.ox = sp.ox; this.oy = sp.oy; this.rf = sp.rf; this.type = sp.type;
      this.tint = sp.tint ?? 0; this.order = sp.order ?? 0; this.amax = sp.alpha ?? 1;
      this.dist = Math.hypot(sp.ox, sp.oy);
    }
  }

  /* --------------------------------------------------------------- Cluster */
  class Cluster {
    constructor(org, o) {
      this.org = org;
      this.id = org.nextId++;
      this.rng = org.rng.fork();
      this.x = o.x; this.y = o.y; this.vx = 0; this.vy = 0;
      this.mass = o.mass ?? 0.4;
      this.baseTension = o.tension ?? 0.6;
      this.tension = this.baseTension; this.tensionT = this.baseTension;
      this.angleOffset = o.angleOffset ?? this.rng.float(-Math.PI / 2, Math.PI / 2);
      this.angle = o.angle ?? org.axis + this.angleOffset; this.angleT = this.angle;
      this.tint = o.tint ?? this.rng.next();
      this.life = 0;
      this.lifeRate = o.emerge === Infinity ? 0 : 1 / (o.emerge ?? 4);
      this.delay = o.delay ?? 0;
      this.dissolving = false; this.dead = false;
      this.act = 0; this.refractory = 0;
      this.goal = null; this.goalW = 0; this.goalTime = 0;
      this.age = 0;
      this.dormant = !!o.dormant;
      this.breathPhase = this.rng.float(0, TAU);
      this.spots = [];
      this.dendrites = [];
      this.grow = 0;   // dendrite extension 0..1
      this.vis = 0;    // overall visibility 0..1
      this.setForm(o.character ?? 'blot');
    }

    get S() { return (0.06 + 0.135 * Math.sqrt(Math.max(this.mass, 0))) * smooth(clamp(this.life, 0, 1)); }
    get fill() { return clamp(this.mass / FULL_MASS, 0, 1); }
    get alive() { return !this.dissolving && !this.dead && this.delay <= 0; }

    /** Change character. Existing spots are re-assigned to new roles, so the
     *  form morphs rather than being replaced. */
    setForm(character) {
      this.character = character;
      this.dendrites = RUIN.forms.dendrites(character, this.rng);
      this.grow *= 0.4; // new dendrites grow out again
      const specs = FORMS[character](this.rng, this.tint);
      const pools = [[], [], [], []]; // by type
      for (const s of this.spots) if (!s.retired) pools[s.type].push(s);
      const next = [];
      for (const sp of specs) {
        const pool = pools[sp.type];
        if (pool.length) {
          // the closest donor takes the new role → minimal travel
          let best = 0, bd = Infinity;
          for (let i = 0; i < pool.length; i++) {
            const d = (pool[i].ox - sp.ox) ** 2 + (pool[i].oy - sp.oy) ** 2;
            if (d < bd) { bd = d; best = i; }
          }
          const donor = pool.splice(best, 1)[0];
          donor.apply(sp);
          next.push(donor);
        } else {
          next.push(new Spot(sp, this.rng, this.x, this.y));
        }
      }
      for (const pool of pools) for (const s of pool) { s.retired = true; next.push(s); }
      this.spots = next;
    }

    excite(amount, force = false) {
      this.act = Math.max(this.act, Math.min(1.2, amount));
      if (force) this.refractory = 0;
    }

    dissolve() {
      if (this.dissolving) return;
      this.dissolving = true;
      this.org.signal('dissolve', { x: this.x, y: this.y, mass: this.mass, character: this.character });
      this.tensionT = 0.02; // it lets go: spreads out while fading
      this.goal = null;
    }

    update(dt) {
      const org = this.org;
      if (this.delay > 0) {
        this.delay -= dt;
        return;
      }
      if (!this._announced && this.lifeRate > 0 && !this.dormant) {
        this._announced = true; // a new locus appears
        this.org.signal('emerge', { x: this.x, y: this.y, mass: this.mass, character: this.character });
      }
      this.age += dt;
      if (!this.dissolving) this.life = Math.min(1, this.life + dt * this.lifeRate);

      const calmTension = org.calm * 0.12;
      // where it wants height it gathers; where it rejects matter it loosens
      const desire = org.will ? org.desireAt(this.x, this.y) : 0.4;
      const sig = this.sig = org.signalAt(this.x, this.y);
      const bias = org.will ? (desire - 0.3) * 0.3 + sig.lack * 0.15 - sig.excess * 0.35 : 0;
      this.tension += (clamp(this.tensionT + calmTension + bias, 0, 1) - this.tension) * ease(0.35, dt);
      this.angleT = org.axis + this.angleOffset * (1 - org.coherence);
      this.angle += angDiff(this.angleT, this.angle) * ease(0.1, dt);

      this.act *= Math.exp(-dt * 0.85);
      this.refractory -= dt;
      if (this.act > 0.42 && this.refractory <= 0 && !this.dissolving) {
        org.propagate(this);
        this.refractory = 2.4;
      }

      const growT = this.dissolving ? 0 : clamp(0.45 + 0.4 * this.fill + 0.35 * this.act - 0.2 * org.calm, 0, 1.15);
      this.grow += (growT - this.grow) * ease(this.dissolving ? 0.4 : 0.25, dt);
      const visT = this.dissolving ? 0 : smooth(clamp(this.life, 0, 1));
      this.vis += (visT - this.vis) * ease(this.dissolving ? 0.3 : 1.2, dt);

      this.updateSpots(dt);

      if (this.dissolving) {
        this.mass = Math.max(0, this.mass - dt * 0.03);
        let visible = false;
        for (const s of this.spots) if (s.alpha > 0.004) { visible = true; break; }
        if (!visible) this.dead = true;
      }
    }

    updateSpots(dt) {
      const org = this.org, t = org.time;
      const S = this.S, fill = this.fill;
      const breathe = Math.sin(t * org.breathRate + this.breathPhase);
      const spread = lerp(1.8, 0.78, this.tension) * (1 + 0.035 * breathe);
      const ca = Math.cos(this.angle), sa = Math.sin(this.angle);
      const sg = this.sig || ZERO_SIGNAL;
      const unrest = (1 + 2.2 * sg.excess + 0.8 * sg.lack) * (1 - 0.5 * sg.harmony);
      const jitter = (0.05 + 0.12 * (1 - this.tension)) * S * org.restless * (1 - 0.6 * org.calm) * unrest;
      const sizeK = lerp(0.85, 1.1, this.tension);
      let keep = 0;

      for (let i = 0; i < this.spots.length; i++) {
        const s = this.spots[i];
        const visible = !s.retired && !this.dissolving && fill + 0.001 >= s.order;

        // activation ripples outward from the cluster's centre
        s.act += (this.act - s.act) * ease(3.2 / (0.5 + s.dist * 1.6), dt);

        const lx = s.ox * spread * S, ly = s.oy * spread * S;
        const n1 = org.noise(s.seed * 41.3, t * 0.05, 0.5);
        const n2 = org.noise(s.seed * 17.9 + 9.1, t * 0.05, 3.7);
        const tx = this.x + lx * ca - ly * sa + n1 * jitter;
        const ty = this.y + lx * sa + ly * ca + n2 * jitter;
        const kk = ease(s.k, dt);
        s.x += (tx - s.x) * kk;
        s.y += (ty - s.y) * kk;

        const pulse = 1 + 0.06 * Math.sin(t * org.breathRate + this.breathPhase - s.dist * 1.3);
        const actGain = 1 + s.act * (s.type === INK ? 0.32 : 0.15);
        const rT = visible ? s.rf * S * sizeK * pulse * actGain : s.rf * S * 0.35;
        s.r += (rT - s.r) * ease(visible ? 1.4 : 0.8, dt);

        const aT = visible ? s.amax : 0;
        const fadeRate = visible ? 0.8 : this.dissolving ? 0.25 + s.seed * 0.5 : 0.55;
        s.alpha += (aT - s.alpha) * ease(fadeRate, dt);

        if (!(s.retired && s.alpha < 0.004)) this.spots[keep++] = s;
      }
      this.spots.length = keep;
    }
  }

  /* ------------------------------------------------------------------ Bond */
  class Bond {
    constructor(org, a, b, o = {}) {
      this.org = org;
      this.id = org.nextId++;
      this.a = a; this.b = b;
      const rng = org.rng;
      this.strength = 0;
      this.strengthT = o.strength ?? 0.7;
      this.growth = o.growth ?? 0;
      this.growthT = 1;
      this.growthRate = o.growthRate ?? 0.2;
      this.restT = null;
      this.rest = Math.hypot(b.x - a.x, b.y - a.y);
      this.flow = 0; // mass per second, + means a → b
      this.bend = rng.float(-0.7, 0.7);
      this.phase = rng.float(0, TAU);
      this.seed = rng.next();
      this.delay = o.delay ?? 0;
      this.pulses = [];
      this.dead = false;
      this.beads = [];
      if (this.delay <= 0) this.buildBeads();
    }

    /** Bead count is fixed at birth from the current distance: if the two
     *  clusters later drift apart the chain thins into dots; if they come
     *  together it thickens into a continuous vein. */
    buildBeads() {
      const a = this.a, b = this.b, rng = this.org.rng;
      this.rest = this.length;
      const n = clamp(Math.round(Math.max(0.12, this.rest) / 0.026), 5, 30);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const x = lerp(a.x, b.x, t * 0.2), y = lerp(a.y, b.y, t * 0.2);
        this.beads.push({ t, type: INK, x, y, r: 0, alpha: 0, act: 0, seed: rng.next(), wob: rng.float(-1, 1) });
        if (i % 3 === 1) this.beads.push({ t, type: RUIN.forms.WASH, x, y, r: 0, alpha: 0, act: 0, seed: rng.next(), wob: rng.float(-1, 1) });
      }
    }

    other(c) { return c === this.a ? this.b : this.a; }
    has(c) { return c === this.a || c === this.b; }
    flowFrom(src, rate) { this.flow = src === this.a ? rate : -rate; }
    get length() { return Math.hypot(this.b.x - this.a.x, this.b.y - this.a.y); }
    get established() { return this.strength > 0.2 && this.growth > 0.85; }

    pulse(from, amp) {
      if (this.pulses.length > 4) return;
      const dir = from === this.a ? 1 : -1;
      this.pulses.push({ t: dir > 0 ? 0 : 1, dir, amp, speed: 0.2 / Math.max(0.1, this.length) });
      this.org.signal('pulse', { x: from.x, y: from.y, amp, strength: this.strength, length: this.length });
    }

    update(dt) {
      const org = this.org, a = this.a, b = this.b;
      if (this.delay > 0) { this.delay -= dt; return; }
      if (!this.beads.length) this.buildBeads();
      if (a.dissolving || b.dissolving || a.dead || b.dead) this.strengthT = 0;
      this.strength += (this.strengthT - this.strength) * ease(0.35, dt);
      const g0 = this.growth;
      this.growth += clamp(this.growthT - this.growth, -this.growthRate * dt, this.growthRate * dt);
      if (this.growth > g0 && this.growth < 1 && Math.floor(g0 * 6) !== Math.floor(this.growth * 6)) {
        org.signal('bead', { x: lerp(a.x, b.x, this.growth), y: lerp(a.y, b.y, this.growth) });
      }
      const L = this.length;
      this.rest += ((this.restT ?? L) - this.rest) * ease(0.3, dt);

      // matter flows along the connection
      if (this.flow !== 0 && this.growth > 0.6) {
        const amount = this.flow * this.strength * dt;
        const src = amount > 0 ? a : b, dst = amount > 0 ? b : a;
        const m = Math.min(Math.abs(amount), Math.max(0, src.mass - 0.04));
        src.mass -= m; dst.mass += m;
      }
      // slow equalisation: connected matter tends toward balance
      if (this.established) {
        const d = (a.mass - b.mass) * 0.006 * this.strength * dt;
        a.mass -= d; b.mass += d;
      }

      // travelling pulses
      for (let i = this.pulses.length - 1; i >= 0; i--) {
        const p = this.pulses[i];
        p.t += p.dir * p.speed * dt;
        if (p.t > 1 || p.t < 0) {
          const target = p.dir > 0 ? b : a;
          if (!target.dissolving) {
            target.excite(target.act + p.amp * 0.8);
            org.signal('arrive', { x: target.x, y: target.y, amp: p.amp, mass: target.mass, character: target.character });
          }
          this.pulses.splice(i, 1);
        }
      }

      // geometry: a quadratic curve between the two clusters
      const dx = b.x - a.x, dy = b.y - a.y;
      const ux = dx / (L || 1), uy = dy / (L || 1), nx = -uy, ny = ux;
      const p0x = a.x + ux * a.S * 0.3, p0y = a.y + uy * a.S * 0.3;
      const p2x = b.x - ux * b.S * 0.3, p2y = b.y - uy * b.S * 0.3;
      const bend = this.bend + 0.35 * org.noise(this.seed * 13.1, org.time * 0.035, 7.7);
      const cx = (p0x + p2x) / 2 + nx * bend * L * 0.25;
      const cy = (p0y + p2y) / 2 + ny * bend * L * 0.25;
      const st = Math.pow(Math.max(0, this.strength), 0.8);
      let anyVisible = false;

      for (const bd of this.beads) {
        const t = bd.t, mt = 1 - t;
        const wob = org.noise(bd.seed * 29.0, org.time * 0.06, 1.9) * 0.008 * (0.5 + bd.wob);
        const tx = mt * mt * p0x + 2 * mt * t * cx + t * t * p2x + nx * wob;
        const ty = mt * mt * p0y + 2 * mt * t * cy + t * t * p2y + ny * wob;
        const kk = ease(2.4, dt);
        bd.x += (tx - bd.x) * kk; bd.y += (ty - bd.y) * kk;

        const visible = t <= this.growth && this.strengthT > 0.001;
        let pb = 0;
        for (const p of this.pulses) { const e = (t - p.t) / 0.07; pb += p.amp * Math.exp(-e * e); }
        bd.act += (Math.min(1, pb) - bd.act) * ease(8, dt);

        let rT, aT;
        if (bd.type === INK) {
          const ends = 1 + 0.9 * (Math.exp(-t * 7) + Math.exp(-mt * 7));
          const profile = 0.62 + 0.38 * Math.sin(t * L * 38 + this.phase);
          rT = visible ? 0.0122 * st * ends * profile * (1 + 1.2 * bd.act) : 0;
          aT = visible ? 1 : 0;
        } else {
          rT = visible ? 0.034 * st * (1 + 0.5 * bd.act) : 0;
          aT = visible ? 0.3 * st : 0;
        }
        bd.r += (rT - bd.r) * ease(visible ? 1.6 : 0.6, dt);
        bd.alpha += (aT - bd.alpha) * ease(visible ? 1.5 : 0.5, dt);
        if (bd.alpha > 0.004 && bd.r > 0.0005) anyVisible = true;
      }

      if (this.strengthT <= 0.001 && this.strength < 0.02 && !anyVisible) this.dead = true;
    }
  }

  /* ------------------------------------------------------------- Organism */
  class Organism {
    constructor(seed = 1) {
      this.rng = new RUIN.Random(seed);
      this.noise = RUIN.createNoise3D(new RUIN.Random(seed ^ 0x9e3779b9));
      this.clusters = [];
      this.bonds = [];
      this.time = 0;
      this.aspect = 1.6;
      this.nextId = 1;
      this.axis = 0; this.axisT = 0;
      this.coherence = 0.5; this.coherenceT = 0.5;
      this.calm = 0; this.calmT = 0;
      this.restless = 1;
      this.breathRate = 0.85;
      this.massTarget = 0; // 0 = no homeostasis
      this.will = null;    // the daemon's intention (set during a session)
    }

    /** How much the will wants matter at a world point (0..1). */
    desireAt(x, y) {
      if (!this.will) return 0.4;
      const g = RUIN.will.worldToGrid(x, y, this.aspect);
      return this.will.desireGrid(g.gx, g.gy);
    }

    /** The will's feedback around a world point: lack / excess / harmony. */
    signalAt(x, y) {
      const w = this.will;
      if (!w) return ZERO_SIGNAL;
      const { COLS, ROWS } = RUIN.will;
      const g = RUIN.will.worldToGrid(x, y, this.aspect);
      const i = clamp(Math.floor(g.gx), 0, COLS - 1), j = clamp(Math.floor(g.gy), 0, ROWS - 1), c = j * COLS + i;
      return { lack: w.lackS[c], excess: w.excessS[c], harmony: w.harmonyS[c] };
    }

    setAspect(a) { this.aspect = a; }

    reseed(seed) { this.rng = new RUIN.Random(seed); }

    living() { return this.clusters.filter((c) => c.alive && c.life > 0.4); }

    addCluster(o) { const c = new Cluster(this, o); this.clusters.push(c); return c; }

    findBond(a, b) { return this.bonds.find((x) => !x.dead && x.has(a) && x.has(b)) || null; }

    bond(a, b, o = {}) {
      let bd = this.findBond(a, b);
      if (bd) {
        bd.strengthT = o.strength ?? Math.max(bd.strengthT, 0.7);
        if (o.growthRate) bd.growthRate = o.growthRate;
        bd.growthT = 1;
        return bd;
      }
      bd = new Bond(this, a, b, o);
      this.bonds.push(bd);
      if (!o.delay) this.signal('link', { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, strength: bd.strengthT });
      return bd;
    }

    bondsOf(c) { return this.bonds.filter((b) => !b.dead && b.has(c) && b.strengthT > 0.05); }
    neighbors(c) { return this.bondsOf(c).map((b) => b.other(c)); }
    degree(c) { return this.bondsOf(c).length; }

    nearest(c, exclude = []) {
      let best = null, bd = Infinity;
      for (const o of this.living()) {
        if (o === c || exclude.includes(o)) continue;
        const d = Math.hypot(o.x - c.x, o.y - c.y);
        if (d < bd) { bd = d; best = o; }
      }
      return best;
    }

    /** A point far from existing matter, between minD and maxD from `from`. */
    emptySpot(rng, from, minD, maxD) {
      let best = null, bestScore = -Infinity;
      for (let i = 0; i < 24; i++) {
        const a = rng.float(0, TAU), d = rng.float(minD, maxD);
        const x = from.x + Math.cos(a) * d * 1.2, y = from.y + Math.sin(a) * d;
        const m = 0.12;
        if (x < m || x > this.aspect - m || y < m || y > 1 - m) continue;
        let score = Infinity;
        for (const c of this.clusters) {
          if (c.dead) continue;
          score = Math.min(score, Math.hypot(c.x - x, c.y - y) - c.S * 1.2);
        }
        if (this.will) score += this.desireAt(x, y) * 0.35;
        if (score > bestScore) { bestScore = score; best = { x, y }; }
      }
      return best;
    }

    /** Activation spreads to neighbours — the network "thinks" collectively. */
    signal(kind, data) { if (this.onSignal) this.onSignal(kind, data); }

    propagate(c) {
      this.signal('fire', { x: c.x, y: c.y, act: c.act, mass: c.mass, character: c.character, degree: this.degree(c) });
      for (const b of this.bondsOf(c)) {
        if (b.established) b.pulse(c, c.act * 0.55);
      }
    }

    /** External stimulus (pointer today; the physical model later). */
    stimulate(x, y, amount = 0.6) {
      for (const c of this.living()) {
        const d = Math.hypot(c.x - x, c.y - y);
        const k = Math.exp(-(d * d) / 0.04);
        if (k > 0.05) {
          c.excite(c.act + amount * k);
          // a faint lean toward the source of attention
          c.vx += (x - c.x) * 0.02 * k;
          c.vy += (y - c.y) * 0.02 * k;
        }
      }
    }

    dissolveAll() { for (const c of this.clusters) c.dissolve(); }

    update(dt) {
      this.time += dt;
      this.calm += (this.calmT - this.calm) * ease(0.4, dt);
      this.coherence += (this.coherenceT - this.coherence) * ease(0.15, dt);
      this.axis += angDiff(this.axisT, this.axis) * ease(0.08, dt);
      this.breathRate = lerp(0.85, 0.45, this.calm);

      this.physics(dt);
      this.homeostasis(dt);
      for (const c of this.clusters) c.update(dt);
      for (const b of this.bonds) b.update(dt);
      this.clusters = this.clusters.filter((c) => !c.dead);
      this.bonds = this.bonds.filter((b) => !b.dead);
    }

    /** Pigment is (roughly) conserved: if the body has lost matter it is
     *  slowly replenished, if it has too much it slowly evaporates. */
    homeostasis(dt) {
      if (!this.massTarget) return;
      const live = this.clusters.filter((c) => c.alive);
      if (!live.length) return;
      const total = live.reduce((s, c) => s + c.mass, 0);
      const delta = (this.massTarget - total) * 0.02 * dt;
      for (const c of live) c.mass = Math.max(0.02, c.mass + (delta * c.mass) / total);
      if (this.will) {
        // matter migrates slowly toward where the will wants height
        const w = live.map((c) => 0.25 + this.desireAt(c.x, c.y));
        const ws = w.reduce((a, b) => a + b, 0);
        live.forEach((c, k) => { c.mass += ((total * w[k]) / ws - c.mass) * 0.012 * dt; });
      }
    }

    physics(dt) {
      const cs = this.clusters.filter((c) => c.delay <= 0);
      const W = this.aspect;
      const driftSpeed = 0.01 * this.restless * (1 - 0.75 * this.calm);
      for (const c of cs) {
        let fx = 0, fy = 0;
        const S = c.S;

        // slow flow field, oriented by the daemon's current axis
        const fa = this.axis + this.noise(c.x * 1.1, c.y * 1.1, this.time * 0.018) * 2.4;
        let dvx = Math.cos(fa) * driftSpeed, dvy = Math.sin(fa) * driftSpeed;
        if (this.will && !c.dissolving) {
          const e = 0.05;
          const gx = this.desireAt(c.x + e, c.y) - this.desireAt(c.x - e, c.y);
          const gy = this.desireAt(c.x, c.y + e) - this.desireAt(c.x, c.y - e);
          dvx += gx * 0.12; dvy += gy * 0.12;
        }

        for (const o of cs) {
          if (o === c) continue;
          const dx = c.x - o.x, dy = c.y - o.y;
          const d = Math.hypot(dx, dy) || 1e-4;
          const dmin = (S + o.S) * 1.25 + 0.03;
          if (d < dmin) {
            const f = ((dmin - d) / dmin) * 0.12 * (c.dissolving ? 0.3 : 1);
            fx += (dx / d) * f; fy += (dy / d) * f;
          }
        }
        for (const b of this.bonds) {
          if (!b.has(c) || b.strength < 0.05 || b.growth < 0.5) continue;
          const o = b.other(c);
          const dx = o.x - c.x, dy = o.y - c.y;
          const d = Math.hypot(dx, dy) || 1e-4;
          const f = (d - b.rest) * 0.12 * b.strength;
          fx += (dx / d) * f; fy += (dy / d) * f;
        }
        const m = S * 1.05 + 0.04;
        if (c.x < m) fx += (m - c.x) * 0.8;
        if (c.x > W - m) fx -= (c.x - (W - m)) * 0.8;
        if (c.y < m) fy += (m - c.y) * 0.8;
        if (c.y > 1 - m) fy -= (c.y - (1 - m)) * 0.8;

        if (c.goal) {
          c.goalTime += dt;
          fx += (c.goal.x - c.x) * 0.22 * c.goalW;
          fy += (c.goal.y - c.y) * 0.22 * c.goalW;
          if (c.goalTime > 25) c.goal = null;
        }

        c.vx += (dvx - c.vx) * ease(0.25, dt) + fx * dt;
        c.vy += (dvy - c.vy) * ease(0.25, dt) + fy * dt;
        const damp = Math.exp(-dt * 0.9);
        c.vx *= damp; c.vy *= damp;
        const sp = Math.hypot(c.vx, c.vy), max = 0.09;
        if (sp > max) { c.vx *= max / sp; c.vy *= max / sp; }
        c.x += c.vx * dt; c.y += c.vy * dt;
      }
    }

    /** Export render primitives into a Float32Array laid out as three rows:
     *  row 0: x, y, r, type   row 1: alpha, tint, activation, seed
     *  row 2: (segments only) x1, y1, r1, light */
    collect(buf, max) {
      let n = 0;
      const row = max * 4, row2 = max * 8;
      const put = (x, y, r, type, alpha, tint, act, seed) => {
        if (n >= max || alpha < 0.008 || r < 0.0006) return;
        const i = n * 4;
        buf[i] = x; buf[i + 1] = y; buf[i + 2] = r; buf[i + 3] = type;
        buf[row + i] = alpha; buf[row + i + 1] = tint; buf[row + i + 2] = act; buf[row + i + 3] = seed;
        buf[row2 + i] = 0; buf[row2 + i + 1] = 0; buf[row2 + i + 2] = 0; buf[row2 + i + 3] = 0;
        n++;
      };
      const seg = (x0, y0, r0, x1, y1, r1, alpha, act, light) => {
        if (n >= max || alpha < 0.008) return;
        const i = n * 4;
        buf[i] = x0; buf[i + 1] = y0; buf[i + 2] = Math.max(r0, 0.0008); buf[i + 3] = 4;
        buf[row + i] = alpha; buf[row + i + 1] = 0; buf[row + i + 2] = act; buf[row + i + 3] = 0;
        buf[row2 + i] = x1; buf[row2 + i + 1] = y1; buf[row2 + i + 2] = Math.max(r1, 0.0008); buf[row2 + i + 3] = light ? 1 : 0;
        n++;
      };

      // 1. bonds first (they matter most): tapered veins through the beads
      for (const b of this.bonds) {
        const tint = (b.a.tint + b.b.tint) * 0.5;
        const st = Math.max(0, b.strength);
        const segA = clamp((st - 0.18) / 0.3, 0, 1);
        let px = b.a.x, py = b.a.y, pr = 0.0035 + 0.006 * st, pAct = 0, last = null;
        for (const bd of b.beads) {
          if (bd.type !== INK) continue;
          if (bd.t > b.growth + 0.02 || bd.alpha < 0.05) break;
          const ends = 1 + 1.6 * (Math.exp(-bd.t * 6) + Math.exp(-(1 - bd.t) * 6));
          const r = 0.0034 * st * ends * (1 + 0.9 * bd.act);
          seg(px, py, pr, bd.x, bd.y, r, segA * bd.alpha, Math.max(pAct, bd.act), false);
          px = bd.x; py = bd.y; pr = r; pAct = bd.act; last = bd;
        }
        if (last && b.growth >= 0.99) seg(px, py, pr, b.b.x, b.b.y, 0.0035 + 0.006 * st, segA * last.alpha, pAct, false);
        for (const bd of b.beads) put(bd.x, bd.y, bd.r * 0.8, bd.type, bd.alpha, tint, bd.act, bd.seed);
      }

      // 2. clusters: their stains, then their dendrites
      const live = this.clusters.filter((c) => c.delay <= 0);
      for (const c of live) for (const s of c.spots) put(s.x, s.y, s.r, s.type, s.alpha, s.tint, s.act, s.seed);
      for (const c of live) {
        if (c.vis < 0.02 || c.grow < 0.02) continue;
        let near = null, nd = 0.65;
        for (const o of live) {
          if (o === c || o.dissolving) continue;
          const d = Math.hypot(o.x - c.x, o.y - c.y);
          if (d < nd) { nd = d; near = o; }
        }
        const S = c.S, spread = lerp(1.8, 0.78, c.tension);
        for (const d of c.dendrites) {
          let ang = c.angle + d.angle;
          if (d.seek && near) ang += angDiff(Math.atan2(near.y - c.y, near.x - c.x), ang) * 0.6;
          const sx = c.x + Math.cos(ang) * d.start * S * spread * 0.6;
          const sy = c.y + Math.sin(ang) * d.start * S * spread * 0.6;
          let len = d.len * S * (0.7 + 0.3 * spread) * c.grow;
          const r0 = d.r0 * S * (1 + 0.4 * c.act);
          // anastomosis: a seeking filament that can reach its neighbour joins it,
          // ending inside the other stain instead of floating free
          let target = null;
          if (d.seek && near && !d.light) {
            const ux = c.x - near.x, uy = c.y - near.y, ul = Math.hypot(ux, uy) || 1;
            const tx = near.x + (ux / ul) * near.S * 0.35, ty = near.y + (uy / ul) * near.S * 0.35;
            const reach = Math.hypot(tx - sx, ty - sy);
            if (reach < len * 1.6 + near.S) { target = { x: tx, y: ty, k: smooth(clamp((len * 1.6 + near.S - reach) / 0.08, 0, 1)) }; len = reach; }
          }
          this.branch(seg, sx, sy, ang, len, r0, 0, d.seed, d.curl, d.forkP, c.vis * (d.light ? 0.6 : 1), d.light ? 0 : c.act, d.light, target);
        }
      }
      return n;
    }

    /** One meandering, tapering, sometimes forking filament. */
    branch(seg, x, y, ang, len, r0, depth, seed, curl, forkP, alpha, act, light, target = null) {
      if (len < 0.004) return;
      const steps = depth === 0 ? (target ? 9 : 7) : depth === 1 ? 4 : 3;
      let step = len / steps;
      let px = x, py = y, r = r0, a0 = alpha;
      for (let i = 0; i < steps; i++) {
        const u = (i + 1) / steps;
        ang += this.noise(seed + i * 0.31, this.time * 0.025, depth * 3.1) * curl;
        if (target) {
          // steer progressively into the neighbour; the last steps land on it
          const want = Math.atan2(target.y - py, target.x - px);
          ang += angDiff(want, ang) * Math.min(1, Math.pow(u, 1.3) * 1.1) * target.k;
          const rem = Math.hypot(target.x - px, target.y - py);
          step = lerp(step, rem / (steps - i), target.k);
        }
        const nx = px + Math.cos(ang) * step, ny = py + Math.sin(ang) * step;
        // joined filaments thin in the middle and swell into the other stain;
        // free ones taper and fade into the ground
        const r1 = target
          ? r0 * (lerp(Math.pow(1 - u * 0.9, 1.6), 0.4 + 0.6 * Math.pow(1 - u, 1.4) + 0.6 * Math.pow(u, 5), target.k))
          : r0 * Math.pow(1 - u * 0.9, 1.6);
        const a1 = target ? lerp(alpha * (1 - 0.55 * u), alpha, target.k) : alpha * (1 - 0.55 * u);
        seg(px, py, r, nx, ny, r1, (a0 + a1) * 0.5, act, light);
        a0 = a1;
        if (depth < 2 && i > 0 && i < steps - 1 && hash(seed * 7.3 + i) < forkP * (depth ? 0.6 : 1.2)) {
          const side = hash(seed * 3.1 + i) < 0.5 ? -1 : 1;
          this.branch(seg, nx, ny, ang + side * (0.45 + 0.45 * hash(seed + i * 1.7)), len * 0.5 * (1 - i / steps * 0.4),
            r1 * 0.75, depth + 1, seed * 1.37 + i * 11, curl * 1.3, forkP, alpha, act, light);
        }
        px = nx; py = ny; r = r1;
      }
    }
  }

  RUIN.Organism = Organism;
  RUIN.organism = { Cluster, Bond, Spot, FULL_MASS };
})((window.RUIN = window.RUIN || {}));
