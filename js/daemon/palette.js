/* ---------------------------------------------------------------------------
 * palette.js — pigments of overgrown ruin: moss, lichen, olive, bronze.
 * Each session draws one set. A set defines its own ground (linen/paper),
 * two washes (large tonal fields), the ink (veins and dense matter), its
 * bled edge, the rim of transparent rings, the cream of light filaments,
 * the colour of memory traces, and the line colour of the cell tissue.
 * Derived from References/image.png (greens + bronze on linen) while
 * keeping the earthen tones of the first references.
 * ------------------------------------------------------------------------- */
(function (RUIN) {
  'use strict';

  const hex = (h) => {
    const n = parseInt(h.replace('#', ''), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  };

  const SETS = [
    {
      name: 'moss / forest',
      paper: hex('#e3dfc6'), paperDeep: hex('#c9c6a3'),
      washA: hex('#8c9862'), washB: hex('#4f6338'),
      ink: hex('#141b10'), inkEdge: hex('#33402a'), rim: hex('#4c5a33'),
      cream: hex('#efe9cf'), memory: hex('#a9ad86'), tissue: hex('#2a3520'), signal: hex('#9a3a24'),
    },
    {
      name: 'lichen / bronze',
      paper: hex('#e3dfc4'), paperDeep: hex('#c6c39c'),
      washA: hex('#8f9a5e'), washB: hex('#87643a'),
      ink: hex('#161a10'), inkEdge: hex('#363f24'), rim: hex('#5b5f33'),
      cream: hex('#f0eacd'), memory: hex('#a8ab82'), tissue: hex('#263020'), signal: hex('#a1381f'),
    },
    {
      name: 'olive / ochre',
      paper: hex('#e8e0c6'), paperDeep: hex('#d1c59f'),
      washA: hex('#a99054'), washB: hex('#56693a'),
      ink: hex('#151a0f'), inkEdge: hex('#344126'), rim: hex('#56602f'),
      cream: hex('#f2eacd'), memory: hex('#b5a57d'), tissue: hex('#2b2f1b'), signal: hex('#a33c22'),
    },
    {
      name: 'fern / umber',
      paper: hex('#dfdcc2'), paperDeep: hex('#bfc09a'),
      washA: hex('#6f8550'), washB: hex('#7a5233'),
      ink: hex('#121810'), inkEdge: hex('#2e3d26'), rim: hex('#46553a'),
      cream: hex('#ebe7cc'), memory: hex('#9fa77f'), tissue: hex('#223020'), signal: hex('#983524'),
    },
  ];

  // the resting state: pale, neutral, faintly green
  const DORMANT = {
    name: 'dormant',
    paper: hex('#e6e2cc'), paperDeep: hex('#cfcbac'),
    washA: hex('#9da279'), washB: hex('#6d7350'),
    ink: hex('#1a1f14'), inkEdge: hex('#3a4430'), rim: hex('#56603f'),
    cream: hex('#efe9d0'), memory: hex('#aeb08c'), tissue: hex('#2d3524'), signal: hex('#9a3a24'),
  };

  RUIN.palette = { SETS, DORMANT, hex };
})((window.RUIN = window.RUIN || {}));
