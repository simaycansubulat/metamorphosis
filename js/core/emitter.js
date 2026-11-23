/* ---------------------------------------------------------------------------
 * emitter.js — minimal event bus.
 * The daemon announces what it is doing (session start/end, gestures,
 * speaking/listening phases) so other modules — the UI today, the physical
 * model tomorrow — can listen without being coupled to its internals.
 * ------------------------------------------------------------------------- */
(function (RUIN) {
  'use strict';

  class Emitter {
    constructor() { this._handlers = new Map(); }
    on(type, fn) {
      if (!this._handlers.has(type)) this._handlers.set(type, new Set());
      this._handlers.get(type).add(fn);
      return () => this.off(type, fn);
    }
    off(type, fn) { this._handlers.get(type)?.delete(fn); }
    emit(type, payload) {
      this._handlers.get(type)?.forEach((fn) => {
        try { fn(payload); } catch (e) { console.error(`[daemon] handler for "${type}" failed`, e); }
      });
      this._handlers.get('*')?.forEach((fn) => fn({ type, payload }));
    }
  }

  RUIN.Emitter = Emitter;
})((window.RUIN = window.RUIN || {}));
