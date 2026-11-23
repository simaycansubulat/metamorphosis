/* ---------------------------------------------------------------------------
 * synth.js — the daemon's acoustic matter: short, dry, tactile sounds built
 * from raw Web Audio (no samples, works offline).
 *
 * There is no melody, no tuning, no reverb tail, no delay, no drone and no
 * tempo: every voice is a single physical event that starts and ends.
 *
 *   click   a dry contact: a few milliseconds of band-passed noise
 *   tap     a hard, small mechanical tick (two inharmonic partials)
 *   knock   a resonant body struck once (wood, clay, hollow piece)
 *   thud    a heavy, dense contact: a block set down on stone (weight, arrival)
 *   pulse   a soft breath of high noise, like a brush over paper
 *   rattle  an irregular burst of contacts (scraping, friction, agitation)
 *
 * Every voice takes `sharp` (0..1): sharper → harder attack, brighter
 * filter, shorter body. The sonifier derives it from the will's insistence.
 *
 * HARSH (0..1, default 0.3) roughens everything: every voice is pushed
 * sharper, and the master runs through a light asymmetric saturation and a
 * presence boost. Everything under 120 Hz is cut, so nothing rumbles.
 * ------------------------------------------------------------------------- */
(function (RUIN) {
  'use strict';

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  class Synth {
    constructor() {
      this.ctx = null;
      this.enabled = true;
      this.level = 0.75;   // user volume 0..1
      this.harsh = 0.3;    // grit of the whole voice 0..1
    }

    /** every voice is pushed toward hard, bright, short */
    edge(sharp) { return clamp(sharp + (1 - sharp) * 0.6 * this.harsh, 0, 1); }

    get ready() { return !!this.ctx && this.ctx.state === 'running' && this.enabled; }
    get now() { return this.ctx ? this.ctx.currentTime : 0; }

    /** Must be called from a user gesture (browsers block audio otherwise). */
    start() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        this.ctx = new AC({ latencyHint: 'interactive' });
        this.build();
      }
      if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
      return true;
    }

    setEnabled(on) { this.enabled = on; this.applyGain(); }
    setVolume(v) { this.level = clamp(v, 0, 1); this.applyGain(); }

    applyGain() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const g = this.enabled ? this.level * this.level : 0; // perceptual curve
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(g, t, 0.06);
    }

    build() {
      const ctx = this.ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.enabled ? this.level * this.level : 0;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18; comp.ratio.value = 8; comp.attack.value = 0.001; comp.release.value = 0.08;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 120;   // nothing below: no rumble
      // grit: drive into an asymmetric saturator with a coarse quantiser
      const drive = ctx.createGain(); drive.gain.value = 1 + 5 * this.harsh;
      const shaper = ctx.createWaveShaper();
      const N = 4096, curve = new Float32Array(N), k = 4 + 18 * this.harsh;
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * 2 - 1;
        let y = ((1 + k) * x) / (1 + k * Math.abs(x));
        y += 0.12 * this.harsh * x * x;                       // asymmetry → rasp
        curve[i] = y;
      }
      shaper.curve = curve; shaper.oversample = '2x';
      const presence = ctx.createBiquadFilter();
      presence.type = 'peaking'; presence.frequency.value = 3800; presence.Q.value = 0.9; presence.gain.value = 9 * this.harsh;
      const air = ctx.createBiquadFilter();
      air.type = 'highshelf'; air.frequency.value = 6000; air.gain.value = 5 * this.harsh;
      const trim = ctx.createGain(); trim.gain.value = 0.55;
      this.master.connect(hp); hp.connect(drive); drive.connect(shaper); shaper.connect(presence);
      presence.connect(air); air.connect(trim); trim.connect(comp); comp.connect(ctx.destination);

      // one short noise buffer, reused by every voice
      const len = Math.floor(ctx.sampleRate * 0.5);
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }

    /* ---- plumbing ------------------------------------------------------- */
    out(pan, node) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      node.connect(p); p.connect(this.master);
      return p;
    }
    vca(t, peak, attack, decay) {
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
      return g;
    }
    noiseSrc(t, dur) {
      const s = this.ctx.createBufferSource();
      s.buffer = this.noise;
      s.playbackRate.value = 0.8 + Math.random() * 0.4;
      s.start(t, Math.random() * 0.4, dur + 0.02);
      return s;
    }
    bp(freq, Q) { const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = Q; return f; }
    lp(freq, Q = 0.7) { const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq; f.Q.value = Q; return f; }

    /* ---- voices ---------------------------------------------------------- */
    click(t, { freq = 3200, gain = 0.2, pan = 0, sharp = 0.5 } = {}) {
      if (!this.ready) return;
      sharp = this.edge(sharp);
      const dur = 0.004 + 0.012 * (1 - sharp);
      const n = this.noiseSrc(t, dur + 0.01);
      const f = this.bp(freq * (0.8 + 0.6 * sharp), 1.5 + 4 * sharp);
      const g = this.vca(t, gain, 0.0006, dur);
      n.connect(f); f.connect(g); this.out(pan, g);
    }

    tap(t, { freq = 2400, gain = 0.15, pan = 0, sharp = 0.5 } = {}) {
      if (!this.ready) return;
      sharp = this.edge(sharp);
      const dec = 0.012 + 0.03 * (1 - sharp);
      const g = this.vca(t, gain, 0.0005, dec);
      for (const [m, a] of [[1, 1], [2.76, 0.5]]) {
        const o = this.ctx.createOscillator();
        o.type = 'square';
        o.frequency.value = freq * m;
        const og = this.ctx.createGain(); og.gain.value = a;
        o.connect(og); og.connect(g);
        o.start(t); o.stop(t + dec + 0.02);
      }
      const f = this.bp(freq * 1.4, 2);
      g.connect(f); this.out(pan, f);
    }

    knock(t, { freq = 320, gain = 0.3, pan = 0, sharp = 0.4, hollow = 0.5 } = {}) {
      if (!this.ready) return;
      sharp = this.edge(sharp);
      // an impulse exciting a resonant body: no pitch held long enough to be a note
      const n = this.noiseSrc(t, 0.01);
      const ex = this.vca(t, 1, 0.0005, 0.004 + 0.004 * (1 - sharp));
      const body = this.bp(freq, 6 + 14 * hollow);
      const body2 = this.bp(freq * (1.47 + 0.2 * hollow), 5);
      const g = this.ctx.createGain(); g.gain.value = gain * (4 + 6 * hollow);
      n.connect(ex); ex.connect(body); ex.connect(body2); body.connect(g); body2.connect(g);
      const click = this.vca(t, gain * 0.5 * (0.3 + sharp), 0.0005, 0.006);
      const cf = this.bp(2500 + 3000 * sharp, 1);
      ex.connect(cf); cf.connect(click);
      const sum = this.ctx.createGain();
      g.connect(sum); click.connect(sum);
      // short gate: kills any ringing → dry
      const gate = this.vca(t, 1, 0.0005, 0.06 + 0.1 * hollow * (1 - sharp));
      sum.connect(gate); this.out(pan, gate);
    }

    thud(t, { freq = 70, gain = 0.5, pan = 0, sharp = 0.3, decay = 0.16 } = {}) {
      if (!this.ready) return;
      // weight, arrival: a heavy block set down on stone. No low sine and no
      // pitch glide (those read as a body noise), just a dense, dry contact.
      const w = clamp((freq - 40) / 40, 0, 1);              // lighter → higher
      this.knock(t, { freq: 170 + 130 * w, gain: gain * 0.75, pan, sharp, hollow: 0.15 + 0.2 * (1 - clamp(decay / 0.3, 0, 1)) });
      this.click(t + 0.002, { freq: 1400 + 900 * w, gain: gain * 0.12, pan, sharp });
    }

    pulse(t, { freq = 160, gain = 0.25, pan = 0, len = 0.22, sharp = 0 } = {}) {
      if (!this.ready) return;
      sharp = this.edge(sharp);
      // a soft breath: a short swell of band-passed noise high above any body
      // resonance, like a brush passing over paper or dry stone
      len = Math.min(len, 0.35);
      const n = this.noiseSrc(t, len + 0.05);
      const centre = 1100 + freq * 5;
      const f = this.bp(centre, 1.2 + 2 * sharp);
      f.frequency.setValueAtTime(centre * 0.8, t);
      f.frequency.linearRampToValueAtTime(centre * 1.15, t + len);
      const a = len * (0.4 - 0.25 * sharp);
      const g = this.vca(t, gain * 0.55, a, len - a);
      n.connect(f); f.connect(g);
      this.out(pan, g);
    }

    rattle(t, { n = 5, span = 0.12, gain = 0.12, pan = 0, sharp = 0.5, freq = 2600, fall = 0 } = {}) {
      if (!this.ready) return;
      n = Math.round(n * (1 + 0.8 * this.harsh)); gain *= 1 + 0.4 * this.harsh;
      // irregular contacts, accelerating or decelerating: never an even rhythm
      let at = t;
      for (let k = 0; k < n; k++) {
        const u = k / Math.max(1, n - 1);
        this.click(at, { freq: freq * (1 - fall * u) * (0.85 + Math.random() * 0.3), gain: gain * (1 - 0.5 * u), pan: pan + (Math.random() - 0.5) * 0.2, sharp });
        at += (span / n) * (0.4 + Math.random() * 1.2);
      }
    }
  }

  RUIN.Synth = Synth;
})((window.RUIN = window.RUIN || {}));
