/* ---------------------------------------------------------------------------
 * temperament.js — the disposition of the daemon for one session.
 * A seed is unfolded into a set of tendencies: which forms it prefers,
 * which gestures it favours, how fast it thinks, how ordered it is.
 * Different seeds → different "dialects" of the same language.
 * ------------------------------------------------------------------------- */
(function (RUIN) {
  'use strict';

  const CHARACTERS = ['blot', 'spray', 'string', 'pool', 'cell'];
  const GESTURES = ['converge', 'divide', 'reach', 'release', 'insist', 'realign', 'transmute', 'link', 'sever', 'migrate'];

  function create(seed, aspect) {
    const rng = new RUIN.Random(seed);

    // Preferred forms: a dominant one, a secondary one, the rest faint.
    const characterWeights = {};
    CHARACTERS.forEach((c) => (characterWeights[c] = rng.float(0.15, 0.45)));
    const order = [...CHARACTERS].sort(() => rng.next() - 0.5);
    characterWeights[order[0]] += 1.4;
    characterWeights[order[1]] += 0.6;

    const gestureWeights = {};
    GESTURES.forEach((g) => (gestureWeights[g] = rng.float(0.6, 1.4)));

    const wide = Math.max(1, aspect);
    return {
      seed,
      code: RUIN.random.seedToCode(seed),
      palette: RUIN.palette.SETS[rng.int(0, RUIN.palette.SETS.length - 1)],
      clusterCount: Math.round(rng.float(4, 6.5) * Math.sqrt(wide / 1.6)),
      maxClusters: rng.int(7, 9),
      minClusters: 3,
      axis: rng.float(-Math.PI, Math.PI), // dominant direction of the field
      coherence: rng.float(0.35, 0.85),   // how strongly forms align to it
      tempo: rng.float(0.8, 1.25),        // speed of thought
      tension: rng.float(0.45, 0.8),      // baseline compactness
      restless: rng.float(0.7, 1.3),      // amplitude of drift
      totalMass: rng.float(2.6, 3.6) * Math.sqrt(wide / 1.6),
      dominant: order[0],
      characterWeights,
      gestureWeights,
    };
  }

  /** The will's archetype reshapes the dialect: it expresses its intention
   *  through preferred forms, gestures, density and alignment. */
  function express(temp, will) {
    const ex = will.def.expression;
    for (const c of CHARACTERS) temp.characterWeights[c] = temp.characterWeights[c] * 0.35 + (ex.characters[c] ?? 0.5);
    for (const g of GESTURES) temp.gestureWeights[g] *= ex.gestures[g] ?? 1;
    temp.gestureWeights.demand = 1;
    temp.tension = temp.tension * 0.3 + ex.tension * 0.7;
    temp.coherence = temp.coherence * 0.3 + ex.coherence * 0.7;
    temp.dominant = CHARACTERS.reduce((a, b) => (temp.characterWeights[a] >= temp.characterWeights[b] ? a : b));
    temp.archetype = will.archetype;
    return temp;
  }

  RUIN.temperament = { create, express, CHARACTERS, GESTURES };
})((window.RUIN = window.RUIN || {}));
