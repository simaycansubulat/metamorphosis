/* ---------------------------------------------------------------------------
 * sonifier.js — every sound is caused by an event.
 *
 * Nothing is scheduled on a grid and nothing loops: a sound happens at the
 * moment something happens in the daemon (a pulse arrives, a locus fires,
 * a vein grows a bead) or in the room (a piece is placed or removed).
 *
 * The SAME state that drives the visual feedback drives the sound: the
 * will's insistence (0..1) and alignment. From them:
 *
 *   intensity   gain of the daemon's own events
 *   density     how many of its events become audible (rate limits per voice)
 *   sharpness   attack / brightness / shortness of every voice
 *
 * Misaligned → loud, frequent, repetitive, sharp. Aligned → soft, sparse,
 * rounded. Sounds are panned by where they happen on the surface.
 * ------------------------------------------------------------------------- */
(function (RUIN) {
  'use strict';

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  class Sonifier {
    constructor(daemon, synth) {
      this.daemon = daemon;
      this.synth = synth;
      this.listening = false;
      this.insist = 0.25;  // smoothed will state
      this.align = 0;
      this.last = {};      // per-voice last trigger time (rate limiting)
      this.bind();
    }

    /* ---- state → sound character ---------------------------------------- */
    get sharp() { return clamp(0.15 + 0.85 * this.insist, 0, 1); }
    get intensity() { return lerp(0.45, 1, this.insist) * (this.listening ? 0.6 : 1); }
    /** Minimum gap for a voice: shrinks as the will insists. */
    gap(voice, calm, urgent) {
      const now = this.synth.now;
      const g = lerp(calm, urgent, this.insist) * (this.listening ? 1.8 : 1);
      if (now - (this.last[voice] ?? -1e9) < g) return false;
      this.last[voice] = now;
      return true;
    }
    pan(e) { return clamp(((e.xn ?? 0.5) * 2 - 1) * 0.75, -0.85, 0.85); }
    soon(d = 0) { return this.synth.now + 0.005 + d; }

    update(dt) {
      const w = this.daemon.state === 'session' ? this.daemon.will : null;
      const targetI = w ? w.insistence : 0.15;
      const targetA = w && w.engaged ? w.alignment : 0;
      const k = 1 - Math.exp(-dt * 2);
      this.insist = lerp(this.insist, targetI, k);
      this.align = lerp(this.align, targetA, k);
    }

    bind() {
      const d = this.daemon, s = this.synth;

      d.on('session:start', () => {
        s.start();
        this.last = {};
        this.listening = false;
        s.thud(this.soon(), { freq: 52, gain: 0.7, decay: 0.3, sharp: 0.1 });
        s.pulse(this.soon(0.35), { freq: 120, gain: 0.18, len: 0.5 });
      });

      d.on('session:end', () => {
        // a few dry, spreading impacts, further and further apart
        [0, 0.7, 1.9, 3.8].forEach((dt, k) => s.thud(this.soon(dt), { freq: 60 - k * 6, gain: 0.45 - k * 0.09, decay: 0.2, sharp: 0.05 }));
      });

      d.on('phase', ({ mode }) => {
        this.listening = mode === 'listening';
        // the turn to listening: one soft exhale; to speaking: one dry tap
        if (this.listening) s.pulse(this.soon(), { freq: 110, gain: 0.12, len: 0.6 });
        else s.tap(this.soon(), { freq: 1700, gain: 0.06 * this.intensity, sharp: this.sharp });
      });

      d.on('signal', (e) => this.onSignal(e));
      d.on('beat', (e) => {
        if (!this.gap('beat', 0.5, 0.18)) return;
        s.thud(this.soon(), { freq: 48 + 22 * (1 - clamp(e.mass, 0, 1)), gain: 0.55 * this.intensity, sharp: this.sharp, decay: 0.14, pan: this.pan(e) });
      });
      d.on('gesture:start', ({ name }) => this.onGesture(name));
      d.on('stimulus', (e) => s.click(this.soon(), { freq: 2000 + 1500 * e.amount, gain: 0.08, pan: this.pan({ xn: e.x / d.organism.aspect }), sharp: 0.3 }));

      /* ---- the participant's construction and the daemon's answers --------- */
      d.on('piece', (e) => {
        if (e.cleared) { s.rattle(this.soon(), { n: 9, span: 0.45, gain: 0.14, sharp: 0.4, freq: 1800, fall: 0.5 }); return; }
        // a piece set down (or lifted): a wooden knock; taller stack → higher, harder
        const h = e.height;
        if (e.delta > 0) s.knock(this.soon(), { freq: 260 + h * 70, gain: 0.32, pan: this.pan(e), sharp: 0.35 + h * 0.08, hollow: 0.6 });
        else s.knock(this.soon(), { freq: 420 + h * 50, gain: 0.18, pan: this.pan(e), sharp: 0.2, hollow: 0.2 });
      });

      d.on('response', (e) => {
        const pan = this.pan(e), sh = this.sharp;
        if (e.kind === 'closer') {
          // acceptance: a soft, rounded throb
          s.pulse(this.soon(), { freq: 140 + 60 * e.alignment, gain: 0.2, len: 0.35 + 0.2 * e.alignment, pan, sharp: 0 });
        } else if (e.kind === 'further') {
          // refusal: hard double contact, then a short scrape
          s.tap(this.soon(), { freq: 2600, gain: 0.2, pan, sharp: 0.9 });
          s.tap(this.soon(0.07 + 0.03 * Math.random()), { freq: 2900, gain: 0.17, pan, sharp: 0.9 });
          s.rattle(this.soon(0.16), { n: 3 + Math.round(4 * e.insistence), span: 0.15, gain: 0.1, pan, sharp: 0.8, freq: 3400 });
        } else if (e.kind === 'neutral') {
          s.click(this.soon(), { freq: 1800, gain: 0.1, pan, sharp: sh * 0.6 });
        }
      });

      d.on('impulse', (e) => this.onImpulse(e));

      d.on('will:accord', () => {
        // agreement: three slow soft throbs, wider and wider apart
        [0, 0.9, 2.3].forEach((dt, k) => s.pulse(this.soon(dt), { freq: 130 - k * 12, gain: 0.2 - k * 0.04, len: 0.5 + k * 0.15 }));
      });
      d.on('will:discord', () => {
        s.rattle(this.soon(), { n: 6, span: 0.2, gain: 0.14, sharp: 0.8, freq: 3000 });
      });
    }

    /** The will insists on a place. Repetition and sharpness grow with insistence. */
    onImpulse(e) {
      const s = this.synth, pan = this.pan(e);
      const st = e.strength, sh = this.sharp;
      if (e.kind === 'want') {
        // before any piece: it only points, softly
        s.pulse(this.soon(), { freq: 100 + 40 * st, gain: 0.1 + 0.08 * st, len: 0.3, pan });
        return;
      }
      const reps = 1 + Math.round(st * 3.4);
      let t = 0;
      for (let k = 0; k < reps; k++) {
        if (e.kind === 'lack') {
          // it wants matter there: low knocks on the place, "here"
          s.thud(this.soon(t), { freq: 62 + 8 * k, gain: (0.38 + 0.4 * st) * (1 - k * 0.12), pan, sharp: sh, decay: 0.12 });
          if (sh > 0.45) s.click(this.soon(t + 0.004), { freq: 2500, gain: 0.08 * sh, pan, sharp: sh });
        } else {
          // it rejects matter there: scraping, tight, high
          s.rattle(this.soon(t), { n: 2 + Math.round(3 * st), span: 0.06 + 0.04 * (1 - st), gain: 0.08 + 0.1 * st, pan, sharp: sh, freq: 3200 + 1200 * st });
          s.tap(this.soon(t), { freq: 3100, gain: 0.08 + 0.1 * st, pan, sharp: sh });
        }
        // irregular spacing: tighter when it insists more
        t += (0.42 - 0.26 * st) * (0.7 + 0.6 * Math.random());
      }
    }

    onGesture(name) {
      const s = this.synth, I = this.intensity, sh = this.sharp;
      switch (name) {
        case 'demand': s.knock(this.soon(), { freq: 180, gain: 0.3 * I, sharp: sh, hollow: 0.8 }); break;
        case 'divide': s.knock(this.soon(), { freq: 380, gain: 0.2 * I, sharp: sh, hollow: 0.3 }); s.knock(this.soon(0.09), { freq: 410, gain: 0.16 * I, sharp: sh, hollow: 0.3 }); break;
        case 'release': case 'sever': s.rattle(this.soon(), { n: 4, span: 0.3, gain: 0.07 * I, sharp: sh * 0.6, freq: 1600, fall: 0.4 }); break;
        case 'converge': s.pulse(this.soon(), { freq: 90, gain: 0.14 * I, len: 0.45, sharp: sh * 0.5 }); break;
        default: break; // other gestures are heard through their own events
      }
    }

    onSignal(e) {
      const s = this.synth;
      if (!s.ready || this.daemon.state !== 'session') return;
      const pan = this.pan(e), I = this.intensity, sh = this.sharp;
      switch (e.kind) {
        case 'arrive':   // a pulse reaches a locus: weight, impact
          if (!this.gap('arrive', 1.4, 0.25)) return;
          s.thud(this.soon(), { freq: 46 + 30 * (1 - clamp(e.mass / 1.2, 0, 1)), gain: (0.3 + 0.25 * Math.min(1, e.amp)) * I, pan, sharp: sh, decay: 0.12 + 0.08 * (1 - sh) });
          break;
        case 'pulse':    // excitation leaves along a vein: contact
          if (!this.gap('pulse', 1.1, 0.12)) return;
          if (e.strength < 0.4) s.click(this.soon(), { freq: 3600, gain: 0.07 * I, pan, sharp: sh });
          else s.click(this.soon(), { freq: 2200 - 900 * clamp(e.length, 0, 1), gain: (0.06 + 0.08 * Math.min(1, e.amp)) * I, pan, sharp: sh });
          break;
        case 'fire':     // a locus fires: its form decides the body
          if (!this.gap('fire', 1.0, 0.2)) return;
          this.fire(e, pan, I, sh);
          break;
        case 'link':
          s.knock(this.soon(), { freq: 520, gain: 0.14 * I, pan: pan - 0.2, sharp: sh, hollow: 0.2 });
          s.knock(this.soon(0.11 + 0.05 * Math.random()), { freq: 560, gain: 0.11 * I, pan: pan + 0.2, sharp: sh, hollow: 0.2 });
          break;
        case 'dissolve':
          s.rattle(this.soon(), { n: 5, span: 0.6, gain: 0.06, pan, sharp: 0.2, freq: 1400, fall: 0.5 });
          break;
        case 'emerge':   // new matter appears: a soft organic throb
          s.pulse(this.soon(), { freq: 90 + 80 * (1 - clamp(e.mass, 0, 1)), gain: 0.16, len: 0.4, pan, sharp: sh * 0.3 });
          break;
        case 'bead':     // a vein grows: tiny, very dry
          if (!this.gap('bead', 0.5, 0.15)) return;
          s.tap(this.soon(), { freq: 4200, gain: 0.03 + 0.03 * this.insist, pan, sharp: sh });
          break;
      }
    }

    fire(e, pan, I, sh) {
      const s = this.synth, m = clamp(e.mass, 0, 1.5);
      switch (e.character) {
        case 'blot':   s.thud(this.soon(), { freq: 58 - m * 8, gain: 0.32 * I, pan, sharp: sh }); break;
        case 'spray':  s.rattle(this.soon(), { n: 3 + Math.round(4 * sh), span: 0.14, gain: 0.07 * I, pan, sharp: sh, freq: 3800 }); break;
        case 'string': s.tap(this.soon(), { freq: 2000, gain: 0.08 * I, pan, sharp: sh }); s.tap(this.soon(0.13), { freq: 1650, gain: 0.06 * I, pan, sharp: sh }); break;
        case 'pool':   s.knock(this.soon(), { freq: 240 + 60 * (1 - m), gain: 0.2 * I, pan, sharp: sh, hollow: 0.9 }); break;
        case 'cell':   s.pulse(this.soon(), { freq: 150, gain: 0.16 * I, len: 0.22, pan, sharp: sh }); break;
      }
    }
  }

  RUIN.Sonifier = Sonifier;
})((window.RUIN = window.RUIN || {}));
