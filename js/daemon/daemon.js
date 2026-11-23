/* ---------------------------------------------------------------------------
 * daemon.js — the public face of the daemon.
 *
 * This is the only object the rest of the application talks to.
 *
 *   daemon.begin({ seed, origin })   start (or restart) a session
 *   daemon.end()                     close the session; the body dissolves
 *   daemon.update(dt)                advance time
 *   daemon.stimulate(x, y, amount)   an external signal at a point
 *                                    (pointer now — physical pieces later)
 *   daemon.describe()                semantic snapshot of what it "says":
 *                                    loci, characters, densities, links…
 *   daemon.place(i, j, delta)        the participant reports a piece added
 *                                    (+1) or removed (-1) at a grid cell
 *   daemon.clearModel()              the physical model was taken apart
 *   daemon.on(event, fn)             'session:start' | 'session:end' |
 *                                    'dormant' | 'phase' | 'gesture:start' |
 *                                    'gesture:end' | 'stimulus' | 'beat' |
 *                                    'signal' (kind: pulse | arrive | fire |
 *                                              link | dissolve | emerge | bead)
 *                                    'piece' | 'response' | 'impulse' |
 *                                    'will:accord' | 'will:discord'
 *
 * States: dormant → session → ending → dormant
 * ------------------------------------------------------------------------- */
(function (RUIN) {
  'use strict';

  class Daemon extends RUIN.Emitter {
    constructor({ aspect = 1.6 } = {}) {
      super();
      this.organism = new RUIN.Organism(RUIN.random.newSeed());
      this.organism.setAspect(aspect);
      // low-level events of the body (pulses, arrivals, firings…) are re-emitted
      // as 'signal' so the sound — or anything else — can follow the pattern.
      this.organism.onSignal = (kind, d) => this.emit('signal', { kind, ...d, xn: d.x / this.organism.aspect });
      this.state = 'dormant';
      this.mind = null;
      this.temperament = null;
      this.sessionTime = 0;
      this.endTimer = 0;
      this.sleep();
    }

    setAspect(aspect) { this.organism.setAspect(aspect); }

    /** The resting state: a single small stain breathing at the centre. */
    sleep() {
      const org = this.organism;
      this.palette = RUIN.palette.DORMANT;
      org.restless = 0.25;
      org.calmT = 1;
      org.massTarget = 0;
      org.coherenceT = 0.5;
      this.nucleus = org.addCluster({
        x: org.aspect / 2, y: 0.5, mass: 0.07, character: 'blot',
        tension: 0.95, emerge: 3, dormant: true,
      });
    }

    begin({ seed = RUIN.random.newSeed(), origin = null } = {}) {
      const org = this.organism;
      if (this.mind) this.mind.stop();
      org.dissolveAll();

      const temp = RUIN.temperament.create(seed, org.aspect);
      // the will comes first: what it wants to become shapes how it speaks
      const will = new RUIN.will.Will(new RUIN.Random(seed ^ 0x77177));
      this.will = will;
      this.model = new RUIN.will.Model();
      will.attach(this.model);
      will.on((type, d) => this.emit('will:' + type, d));
      RUIN.temperament.express(temp, will);
      org.will = will;
      this.pending = [];
      this.temperament = temp;
      this.palette = temp.palette;
      org.reseed(seed);
      org.axisT = temp.axis;
      org.coherenceT = temp.coherence;
      org.restless = temp.restless;
      org.calmT = 0;
      org.massTarget = temp.totalMass;

      const o = origin || { x: org.aspect / 2, y: 0.5 };
      RUIN.composition.compose(org, temp, new RUIN.Random(seed ^ 0x51ed), o, will);
      this.mind = new RUIN.Mind(org, temp, new RUIN.Random(seed ^ 0xa11ce), this);

      this.state = 'session';
      this.sessionTime = 0;
      this.emit('session:start', { seed, code: temp.code, temperament: temp });
    }

    end() {
      if (this.state !== 'session') return;
      this.mind.stop();
      this.mind = null;
      this.organism.will = null;
      this.organism.massTarget = 0;
      this.organism.calmT = 1;
      this.organism.dissolveAll();
      this.state = 'ending';
      this.endTimer = 7;
      this.emit('session:end', { code: this.temperament.code, duration: this.sessionTime });
    }

    update(dt) {
      if (this.state === 'session') this.sessionTime += dt;
      if (this.state === 'session' && this.will) {
        const imp = this.will.update(dt);
        if (imp) this.impulse(imp);
        for (let k = this.pending.length - 1; k >= 0; k--) {
          const p = this.pending[k];
          p.t -= dt;
          if (p.t <= 0) { this.pending.splice(k, 1); this.respond(p); }
        }
      }
      this.mind?.update(dt);
      this.organism.update(dt);
      if (this.state === 'ending') {
        this.endTimer -= dt;
        if (this.endTimer <= 0) {
          this.state = 'dormant';
          this.sleep();
          this.emit('dormant');
        }
      }
    }

    /* ---- the participant's construction ------------------------------- */
    place(i, j, delta = 1) {
      if (this.state !== 'session' || !this.model) return 0;
      const before = this.will.result.raw; // unclamped: even small moves count
      const changed = this.model.add(i, j, delta);
      if (!changed) return 0;
      const w = RUIN.will.cellToWorld(i, j, this.organism.aspect);
      this.emit('piece', { i, j, delta: changed, height: this.model.get(i, j), pieces: this.model.pieces, x: w.x, y: w.y, xn: w.x / this.organism.aspect });
      // it takes a moment to consider the change before it answers
      this.pending = this.pending.filter((p) => !(p.i === i && p.j === j));
      const c = j * RUIN.will.COLS + i;
      // local error before the change (read from the previous evaluation)
      this.pending.push({ i, j, before, err: this.will.result.lack[c] + this.will.result.excess[c], t: 0.45 + Math.random() * 0.4 });
      return changed;
    }

    clearModel() {
      if (!this.model) return;
      const before = this.will.result.raw;
      this.model.clear();
      this.emit('piece', { cleared: true, pieces: 0, xn: 0.5 });
      this.pending.push({ i: -1, j: -1, before, t: 0.6 });
    }

    /** Its answer to a reported change: closer, further, or indifferent. */
    respond(p) {
      const will = this.will, org = this.organism;
      will.reevaluate();
      const after = will.result.alignment;
      // judged where it happened: did the local error shrink or grow?
      let delta = will.result.raw - p.before;
      if (p.i >= 0) {
        const c = p.j * RUIN.will.COLS + p.i;
        delta = (p.err - (will.result.lack[c] + will.result.excess[c])) + delta * 0.5;
      }
      const kind = !will.engaged ? 'empty' : delta > 0.02 ? 'closer' : delta < -0.02 ? 'further' : 'neutral';
      const w = p.i >= 0 ? RUIN.will.cellToWorld(p.i, p.j, org.aspect) : { x: org.aspect / 2, y: 0.5 };
      for (const c of org.living()) {
        const d = Math.hypot(c.x - w.x, c.y - w.y);
        const k = Math.exp(-(d * d) / 0.06);
        if (k < 0.05) continue;
        if (kind === 'further') c.excite(0.5 + 0.6 * k, true);
        else if (kind === 'closer') { c.excite(0.25 * k); c.tensionT += (c.baseTension - c.tensionT) * 0.5; }
      }
      if (kind === 'further' && p.i >= 0) will.flash[p.j * RUIN.will.COLS + p.i] = 1;
      this.emit('response', { kind, delta, alignment: after, i: p.i, j: p.j, x: w.x, y: w.y, xn: w.x / org.aspect, insistence: will.insistence });
    }

    /** An insistent impulse from the will, located on the surface. */
    impulse(imp) {
      const org = this.organism;
      const p = RUIN.will.cellToWorld(imp.i, imp.j, org.aspect);
      for (const c of org.living()) {
        const d = Math.hypot(c.x - p.x, c.y - p.y);
        const k = Math.exp(-(d * d) / 0.05);
        if (k < 0.05) continue;
        if (imp.kind === 'excess') {
          c.excite(0.4 + 0.5 * imp.strength * k, true);
          const a = Math.atan2(c.y - p.y, c.x - p.x);
          c.vx += Math.cos(a) * 0.03 * imp.strength * k; c.vy += Math.sin(a) * 0.03 * imp.strength * k;
        } else {
          c.excite(0.35 + 0.7 * imp.strength * k, true);
          c.vx += (p.x - c.x) * 0.06 * imp.strength * k; c.vy += (p.y - c.y) * 0.06 * imp.strength * k;
        }
      }
      this.emit('impulse', { ...imp, x: p.x, y: p.y, xn: p.x / org.aspect });
    }

    stimulate(x, y, amount = 0.6) {
      this.organism.stimulate(x, y, amount);
      this.emit('stimulus', { x, y, amount });
    }

    get mode() { return this.mind ? this.mind.mode : this.state; }

    /** A semantic reading of the current configuration — the bridge to the
     *  physical model. Positions are normalised to 0..1 on both axes. */
    describe() {
      const org = this.organism;
      const loci = org.living().map((c) => ({
        id: c.id,
        x: c.x / org.aspect, y: c.y,
        mass: +c.mass.toFixed(3),
        scale: +c.S.toFixed(3),
        character: c.character,
        density: +c.tension.toFixed(2),
        activation: +c.act.toFixed(2),
        orientation: +c.angle.toFixed(2),
        links: org.neighbors(c).map((n) => n.id),
      }));
      const links = org.bonds.filter((b) => b.strength > 0.05).map((b) => ({
        a: b.a.id, b: b.b.id,
        strength: +b.strength.toFixed(2),
        continuous: b.strength > 0.6,
        flow: +b.flow.toFixed(3),
      }));
      return {
        state: this.state,
        mode: this.mode,
        code: this.temperament?.code ?? null,
        time: +this.sessionTime.toFixed(1),
        axis: +org.axis.toFixed(2),
        coherence: +org.coherence.toFixed(2),
        gestures: this.mind ? this.mind.active.map((g) => g.name) : [],
        will: this.will ? {
          intention: this.will.archetype,
          engaged: this.will.engaged,
          alignment: +this.will.alignment.toFixed(2),
          insistence: +this.will.insistence.toFixed(2),
          urgency: +this.will.urgency.toFixed(2),
          accord: this.will.accord,
          focus: this.will.focus(3),
          pieces: this.model.pieces,
        } : null,
        loci,
        links,
      };
    }
  }

  RUIN.Daemon = Daemon;
})((window.RUIN = window.RUIN || {}));
