/* ---------------------------------------------------------------------------
 * random.js — seeded randomness.
 * Every session is born from a single seed, so a configuration can be
 * reproduced exactly (e.g. ?seed=K7F3Q in the URL).
 * ------------------------------------------------------------------------- */
(function (RUIN) {
  'use strict';

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // Short human-shareable code for a seed (Crockford-ish base32, 5 chars).
  const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  function seedToCode(seed) {
    let s = seed >>> 0, out = '';
    for (let i = 0; i < 5; i++) { out = ALPHABET[s & 31] + out; s >>>= 5; }
    return out;
  }
  function codeToSeed(code) {
    const c = String(code).toUpperCase().replace(/[^0-9A-Z]/g, '');
    if (c.length === 5 && [...c].every((ch) => ALPHABET.includes(ch))) {
      let s = 0;
      for (const ch of c) s = (s << 5) | ALPHABET.indexOf(ch);
      return s >>> 0;
    }
    return hashString(c || 'ruin');
  }

  class Random {
    constructor(seed) {
      this.seed = seed >>> 0;
      this.next = mulberry32(this.seed);
    }
    float(a = 0, b = 1) { return a + (b - a) * this.next(); }
    int(a, b) { return Math.floor(this.float(a, b + 1)); }
    chance(p) { return this.next() < p; }
    sign() { return this.next() < 0.5 ? -1 : 1; }
    pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
    gauss() {
      let u = 0, v = 0;
      while (u === 0) u = this.next();
      while (v === 0) v = this.next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }
    /** Pick from an array using weightFn(item) → weight. */
    weighted(items, weightFn) {
      let total = 0;
      const w = items.map((it) => { const x = Math.max(0, weightFn(it)); total += x; return x; });
      if (total <= 0) return null;
      let r = this.next() * total;
      for (let i = 0; i < items.length; i++) { r -= w[i]; if (r <= 0) return items[i]; }
      return items[items.length - 1];
    }
    fork() { return new Random(Math.floor(this.next() * 4294967296)); }
  }

  RUIN.Random = Random;
  RUIN.random = {
    newSeed: () => (Math.random() * 4294967296) >>> 0,
    seedToCode,
    codeToSeed,
  };
})((window.RUIN = window.RUIN || {}));
