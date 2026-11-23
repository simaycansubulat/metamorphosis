/* ---------------------------------------------------------------------------
 * interface.js — the participant's side of the threshold.
 *
 *   click / tap / Enter    (dormant) wake the daemon — it unfolds from there
 *   press & hold still     (session) offer attention at a point (view.js)
 *   Space                  hold: freeze the daemon to study a configuration
 *   N                      a new session (the old body dissolves, a new one grows)
 *   Esc                    end the session
 *   F                      fullscreen
 *   H                      hide every mark (only the surface remains)
 *   D                      observer's notes (state readout for the team)
 *   M                      sound on / off (the slider sets the volume)
 *   (pointing at the board and the camera live in view.js)
 * ------------------------------------------------------------------------- */
(function (RUIN) {
  'use strict';

  class Interface {
    constructor({ daemon, canvas, clock, synth }) {
      this.daemon = daemon;
      this.synth = synth;
      this.canvas = canvas;
      this.clock = clock; // { held: bool }
      this.body = document.body;
      this.el = {
        phase: document.getElementById('phase'),
        code: document.getElementById('code'),
        clockText: document.getElementById('clock'),
        hold: document.getElementById('btn-hold'),
        sound: document.getElementById('btn-sound'),
        volume: document.getElementById('volume'),
        anew: document.getElementById('btn-new'),
        end: document.getElementById('btn-end'),
        notes: document.getElementById('notes'),
      };
      this.pointer = null;
      this.idleTimer = 0;
      this.bind();
      this.syncState();
    }

    seedFromURL() {
      const s = new URLSearchParams(location.search).get('seed');
      return s ? RUIN.random.codeToSeed(s) : undefined;
    }

    begin(origin) {
      const seed = this._firstSeed ?? undefined;
      this._firstSeed = null;
      this.setHeld(false);
      this.daemon.begin({ seed: seed ?? RUIN.random.newSeed(), origin });
    }

    setHeld(v) {
      this.clock.held = v;
      this.el.hold.setAttribute('aria-pressed', String(v));
      this.el.hold.textContent = v ? 'resume' : 'hold';
    }

    bind() {
      const d = this.daemon;
      this._firstSeed = this.seedFromURL();

      this.el.hold.addEventListener('click', () => this.setHeld(!this.clock.held));
      this.el.sound.addEventListener('click', () => this.toggleSound());
      this.el.volume.addEventListener('input', () => {
        if (!this.synth) return;
        this.synth.start();
        this.synth.setVolume(+this.el.volume.value);
        if (!this.synth.enabled && +this.el.volume.value > 0) this.toggleSound();
      });
      this.el.anew.addEventListener('click', () => this.begin());
      this.el.end.addEventListener('click', () => d.end());

      window.addEventListener('keydown', (ev) => {
        if (ev.target instanceof HTMLButtonElement && (ev.key === ' ' || ev.key === 'Enter')) return;
        if (ev.target instanceof HTMLInputElement) return;
        switch (ev.key) {
          case 'Enter': if (d.state === 'dormant') this.begin(); break;
          case ' ': ev.preventDefault(); if (d.state === 'session') this.setHeld(!this.clock.held); else if (d.state === 'dormant') this.begin(); break;
          case 'Escape': this.setHeld(false); d.end(); break;
          case 'n': case 'N': this.begin(); break;
          case 'f': case 'F':
            if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
            else document.exitFullscreen?.();
            break;
          case 'h': case 'H': this.body.classList.toggle('is-bare'); break;
          case 'd': case 'D': this.el.notes.hidden = !this.el.notes.hidden; break;
          case 'm': case 'M': this.toggleSound(); break;
          default: return;
        }
        this.wake();
      });

      window.addEventListener('pointermove', () => this.wake());

      d.on('session:start', ({ code }) => {
        this.el.code.textContent = code;
        try {
          const url = new URL(location.href);
          url.searchParams.set('seed', code);
          history.replaceState(null, '', url);
        } catch (e) { /* sandboxed viewers may refuse URL changes */ }
        this.syncState();
        this.wake();
      });
      d.on('session:end', () => this.syncState());
      d.on('dormant', () => this.syncState());
      d.on('phase', ({ mode }) => this.el.phase.classList.toggle('is-listening', mode === 'listening'));
    }

    toggleSound() {
      if (!this.synth) return;
      const on = !this.synth.enabled;
      this.synth.start(); // also unlocks audio if this is the first gesture
      this.synth.setEnabled(on);
      this.el.sound.setAttribute('aria-pressed', String(on));
      this.el.sound.textContent = on ? 'sound' : 'muted';
      this.el.volume.disabled = false;
    }

    syncState() {
      const s = this.daemon.state;
      this.body.classList.toggle('is-dormant', s === 'dormant');
      this.body.classList.toggle('is-session', s === 'session');
      if (s !== 'session') this.el.phase.classList.remove('is-listening');
    }

    wake() {
      this.body.classList.remove('is-idle');
      this.idleTimer = 3.5;
    }

    update(dt) {
      if (this.idleTimer > 0) {
        this.idleTimer -= dt;
        if (this.idleTimer <= 0 && this.daemon.state === 'session') this.body.classList.add('is-idle');
      }
      const t = Math.floor(this.daemon.sessionTime);
      this.el.clockText.textContent = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;

      if (!this.el.notes.hidden) {
        this._notesT = (this._notesT || 0) - dt;
        if (this._notesT <= 0) { this._notesT = 0.25; this.el.notes.textContent = this.notes(); }
      }
    }

    notes() {
      const s = this.daemon.describe();
      const temp = this.daemon.temperament;
      const lines = [
        `state     ${s.state}${s.state === 'session' ? ' · ' + s.mode : ''}`,
        temp ? `dialect   ${temp.code} · ${temp.palette.name} · prefers ${temp.dominant}` : '',
        `axis      ${(s.axis * 57.3).toFixed(0)}°  coherence ${s.coherence}`,
        `gestures  ${s.gestures.join(', ') || '—'}`,
        ...(s.will ? [
          '',
          `will      wants ${s.will.intention}${s.will.accord ? ' · ACCORD' : ''}`,
          `body      ${s.will.pieces} pieces grown${s.will.engaged ? '' : ' (nothing grown yet)'}`,
          `alignment ${bar(s.will.alignment)} ${s.will.alignment.toFixed(2)}`,
          `insists   ${bar(s.will.insistence)} ${s.will.insistence.toFixed(2)}  urgency ${s.will.urgency.toFixed(2)}`,
          `focus     ${s.will.focus.map((f) => `${f.kind === 'lack' ? '+' : '−'}(${f.i + 1},${f.j + 1})`).join(' ') || '—'}`,
          `target    ${this.targetText()}`,
        ] : []),
        '',
        ...s.loci.map((l) => `#${String(l.id).padEnd(4)} ${l.character.padEnd(7)} m ${l.mass.toFixed(2)}  ρ ${l.density.toFixed(2)}  a ${l.activation.toFixed(2)}  → ${l.links.join(',') || '·'}`),
        '',
        `links     ${s.links.length} (${s.links.filter((l) => l.continuous).length} continuous)`,
      ];
      return lines.filter((l, i) => l !== '' || i > 0).join('\n');
    }
  }

  function bar(v) { const n = Math.round(v * 10); return '▮'.repeat(n) + '·'.repeat(10 - n); }

  /* the will's target, for the team only (observer's notes): never shown to the participant */
  Interface.prototype.targetText = function () {
    const w = this.daemon.will, W = RUIN.will;
    if (!w) return '';
    const rows = [];
    for (let j = 0; j < W.ROWS; j++) {
      let r = '';
      for (let i = 0; i < W.COLS; i++) { const v = Math.round(w.target[j * W.COLS + i]); r += v ? v : '·'; }
      rows.push(r);
    }
    return rows.join('\n          ');
  };

  RUIN.Interface = Interface;
})((window.RUIN = window.RUIN || {}));
