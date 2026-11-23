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
 *   thud    a low, dull impact with a fast pitch drop (weight, arrival)
 *   pulse   an organic swelling throb, soft-edged (breath, membrane)
 *   rattle  an irregular burst of contacts (scraping, friction, agitation)
 *
 * Every voice takes `sharp` (0..1): sharper → harder attack, brighter
 * filter, shorter body. The sonifier derives it from the will's insistence.
 * ------------------------------------------------------------------------- */
(function (RUIN) {
  'use strict';

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  class Synth {
    constructor() {
      this.ctx = null;
      this.enabled = true;
      this.level = 0.75;   // user volume 0..1
    }

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
      comp.threshold.value = -14; comp.ratio.value = 5; comp.attack.value = 0.002; comp.release.value = 0.12;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 28;
      this.master.connect(hp); hp.connect(comp); comp.connect(ctx.destination);

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
      const dur = 0.004 + 0.012 * (1 - sharp);
      const n = this.noiseSrc(t, dur + 0.01);
      const f = this.bp(freq * (0.8 + 0.6 * sharp), 1.5 + 4 * sharp);
      const g = this.vca(t, gain, 0.0006, dur);
      n.connect(f); f.connect(g); this.out(pan, g);
    }

    tap(t, { freq = 2400, gain = 0.15, pan = 0, sharp = 0.5 } = {}) {
      if (!this.ready) return;
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
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(freq * (2.2 + 1.5 * sharp), t);
      o.frequency.exponentialRampToValueAtTime(freq, t + 0.025);
      o.frequency.exponentialRampToValueAtTime(freq * 0.7, t + decay);
      const dec = decay * (1 - 0.4 * sharp);
      const g = this.vca(t, gain, 0.002, dec);
      o.connect(g); o.start(t); o.stop(t + dec + 0.05);
      // dull contact noise on top
      const n = this.noiseSrc(t, 0.04);
      const nf = this.lp(500 + 2500 * sharp);
      const ng = this.vca(t, gain * (0.15 + 0.35 * sharp), 0.001, 0.02 + 0.02 * (1 - sharp));
      n.connect(nf); nf.connect(ng);
      const sum = ctx.createGain(); g.connect(sum); ng.connect(sum);
      this.out(pan, sum);
    }

    pulse(t, { freq = 160, gain = 0.25, pan = 0, len = 0.22, sharp = 0 } = {}) {
      if (!this.ready) return;
      // a soft throb: filtered noise and a low partial swelling and receding
      const n = this.noiseSrc(t, len + 0.05);
      const f = this.lp(freq * (2 + 4 * sharp), 4);
      f.frequency.setValueAtTime(freq * 0.8, t);
      f.frequency.linearRampToValueAtTime(freq * (2.5 + 4 * sharp), t + len * 0.35);
      f.frequency.exponentialRampToValueAtTime(freq * 0.6, t + len);
      const a = len * (0.35 - 0.25 * sharp);
      const g = this.vca(t, gain, a, len - a);
      const o = this.ctx.createOscillator();
      o.type = 'sine'; o.frequency.setValueAtTime(freq * 0.5, t); o.frequency.linearRampToValueAtTime(freq * 0.42, t + len);
      const og = this.vca(t, gain * 0.6, a, len - a);
      o.connect(og); o.start(t); o.stop(t + len + 0.05);
      n.connect(f); f.connect(g);
      const sum = this.ctx.createGain(); g.connect(sum); og.connect(sum);
      this.out(pan, sum);
    }

    rattle(t, { n = 5, span = 0.12, gain = 0.12, pan = 0, sharp = 0.5, freq = 2600, fall = 0 } = {}) {
      if (!this.ready) return;
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
