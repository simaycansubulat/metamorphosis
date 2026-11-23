# The Ruin Daemon — an abstract language of communication

<p align="center"><img src="logo/ruin-daemon-cycle.png" alt="The Ruin Daemon: a ring of cut stone that decays into dust and regrows as living tissue" width="280"></p>

Interactive prototype for the ETAD project. The daemon of the artificial ruin
tries to communicate with a human, not through words but through an evolving
field of stains, blots, beads and veins. The participant reads this field and
answers by building with physical pieces.

## Running it

Open `index.html` in a recent Chrome, Edge, Firefox or Safari. You don't need
a build step, a server or any dependencies; it works offline. WebGL2 is required.

| Action | Effect |
|---|---|
| click / tap / Enter | wake the daemon; the configuration unfolds from where you touched |
| press & hold still on the board | offer attention at a point; nearby loci respond and nearby pieces grow faster |
| drag · scroll / pinch | turn around the board · come closer (left alone, the view turns slowly) |
| T (or "above") | look straight down, as in the flat version, and back |
| Space | **hold**: freeze the daemon to study a configuration |
| N | a new session (the old body dissolves while a new one grows) |
| Esc | end the session |
| F | fullscreen |
| H | hide every mark; only the surface remains |
| D | observer's notes: a live readout of the daemon's state, for the team |
| M | sound on / off (the slider beside "sound" sets the volume) |

Each session gets a 5-character code (top left, also written into the URL as
`?seed=XXXXX`). Opening that URL reproduces the same initial configuration and
the same dialect. Use it to compare or to present a specific session.

The small dot at the top left is the only signal of intent. **Filled**: the
daemon is speaking. **Hollow**: it is listening. The listening phase is the
moment for the participant to answer with the pieces.

## In three dimensions: the daemon grows its body

The surface lies on a board, and out of it the daemon grows its own pieces.
Nobody places them. Every session unfolds a different composition from the
seed and from the will's intention (`js/daemon/growth.js`): spires, stacks,
crosses, twin posts, arches spanning two places, low slabs and knots. The
pieces rise one after another, and the upper ones only once what carries
them has grown. A few stray pieces grow where it does not want matter;
they irritate and, after a while, sink back into the surface.

The pieces are not blocks: each is a subdivided form that is tapered, bent,
swollen, with its corners pulled in and every vertex knocked, so it is
irregular, sharp-faceted and organic. The field is still painted exactly
as before (into a texture on the board, `js/render/scene.js`), and its
pattern continues onto the pieces:

- the ground's stains and veins are folded up the sides of each piece, and
  its cell tissue (walls thickening at junctions, nuclei) covers every facet
- only the sharp folds are inked, with a wobbling hand-drawn line
- the ground stays calm and clean, with no board edge; the field shows on it
  only as a few veins and stains spreading from where pieces are born
- shadows bleed into the ground like soot
- freshly grown matter is pale; a piece the will reads as excess irritates
  (red scratches, a shiver); accepted ones settle, with a faint moss

The body is reported to the will as the same 8 × 5 height map, so the loop
below now runs between the daemon and its own growth: lack stains gather
where it has not grown yet, and it settles as the form completes. The
participant watches, turns around it and offers attention.

## The loop: intention, construction, negotiation

1. **Initiation:** touching the surface starts a session. The daemon fixes a
   **morphological intention** for the whole session (`js/daemon/will.js`).
   It wants to become a particular form, chosen deterministically from the
   seed among five archetypes:
   - `radial`: a centre with a ring and spokes
   - `tower`: one dominant tall point, sometimes with a smaller twin
   - `branching`: a trunk that forks into arms
   - `nucleus`: a dense core with scattered satellites
   - `constellation`: separate groups of different weight

   The intention is a target height map on the same 8×5 grid as the
   construction. It is **never drawn**.
2. **Expression:** the intention biases the abstract language. It shapes the
   initial composition, where matter gathers and grows, which forms and
   gestures the daemon prefers, and how compact or loose each area is.
   The field keeps evolving, but it gravitates toward its intended
   distribution.
3. **Interpretation and response:** the participant reads the surface, builds
   with physical pieces, and reports the construction on the grid. The grid
   covers the whole surface, top-down, so each cell is a region of the surface.
   Pointing at a cell lights its region.
4. **Communication:** the daemon compares the model with its intention. The
   comparison combines blurred cell-by-cell agreement with shape features
   (mass, centroid, spread, peak height, number of separate groups), so a
   near-miss counts partly. It produces:
   - **alignment** (0..1)
   - **precision**: is what was built wanted?
   - a spatial **error map**: *lack* (wants matter here), *excess* (rejects
     matter here) and *harmony* (agrees)
5. **Feedback:** both the visual and the acoustic feedback come from that one
   state:

   | where | surface | sound |
   |---|---|---|
   | it wants matter (lack) | an oxide-red stain gathers in that region; nearby loci tighten and are pulled toward it; insistent impulses excite it | low repeated thuds on that place, more and sharper as insistence rises |
   | it rejects matter (excess) | the tissue there irritates, with red-walled cells and agitated fibres; its own matter loosens and is pushed away | tight scraping rattles and hard taps |
   | it agrees (harmony) | the tissue softens and lightens, jitter calms, the vignette opens | soft rounded throbs |
   | a piece is placed or lifted | — | a wooden knock (taller stack = higher, harder) |
   | about 0.5 s later, its judgement | *closer*: calm; *further*: excitation and a red flash ripple | a throb, or a double hard tap and scrape |
   | sustained agreement (accord) | it speaks less and listens longer | three slow throbs |

   **Insistence** rises with misalignment, mostly with *wrong* matter rather
   than *unfinished* matter. It also rises with **urgency**, which grows when
   nothing improves and falls when things do. Insistence sets how often
   impulses happen, how hard they are, and how sharp every sound is. When it
   is high, the `demand` gesture takes over: the daemon works directly on the
   most misaligned place, reaching out and growing matter there or pushing
   its own matter away.
6. **Negotiation:** the daemon does not simply reward compliance, and it is
   not converted. If a deviation is held for a long time (more than 18 s), it
   absorbs part of it, bounded by its per-session *plasticity* (0.15–0.35),
   and more readily when the deviation is next to its own intention. If a
   demand is ignored for a long time, it softens a little. The intention
   never becomes the participant's construction.

The loop continues until accord is reached or the session is ended.

## The language

The visual system was derived from the three images in `References/`:

- **1.jpg (marbling):** cells of colour held by dark membranes that thicken
  at junctions, with light veins running through the dark masses.
- **2.jpg (sprayed ink):** soft blots of very different scales, aligned along
  a direction, with fibrous halos.
- **3.jpg (ink dots):** strings of graded beads, fine dotted companion lines,
  overlapping transparent circles.

- **image.png (main direction):** neural, mycelial networks. It shows bubbly
  cell tissue, dark veins tapering into fine branching filaments, cream fibres
  crossing dark masses, and moss, olive and bronze tones on linen.

These were translated into abstract matter rather than drawn literally.

### Network (veins, dendrites, tissue)
Lines are not drawn on top of the stains; they are made of the same matter.
Every vein casts a soft, blurred shadow into the ground, free dendrite tips
fade out, and a dendrite that seeks its neighbour joins it: it thins in the
middle and swells as it enters the other stain. Cream fibres are wide, soft
and translucent.

- **Veins:** links between clusters are drawn as tapered lines that thicken
  where they meet a cluster and swell as pulses travel along them.
- **Dendrites:** each cluster grows branching filaments. They extend when it is
  fed or excited and pull back when it is calm. Some bend toward the nearest
  neighbour, so separate stains seem to reach for each other. A few are cream
  fibres instead of dark veins.
- **Tissue:** a layer of irregular, bubbly cells (two scales, thicker at the
  junctions) grows wherever there is matter. The cell walls are dark on light
  ground and cream inside dark masses. A faint ghost of the tissue stays where
  matter used to be.

### Matter (5 kinds)
| | | |
|---|---|---|
| **ink** | dense, opaque | merges with neighbours like liquid: close spots become one mass, separated spots become dots |
| **wash** | diffuse tonal field (moss ↔ bronze, depending on the palette) | uneven pigment load, broken tide lines at its edge |
| **ring** | transparent circle with a pooled rim | overlaps accumulate |
| **soot** | soft dark spray | fibrous edges aligned with the daemon's current axis |
| **segment** | tapered vein (dark) or fibre (cream) | used for links and dendrites |

### Words: loci and their characters
A **locus** (cluster) is a concentration of matter with a *mass*, an
*orientation*, a *density* (compact ↔ dispersed) and an *activation*. It holds
itself in one of five characters:

- `blot` — a heavy merged mass with thrown droplets (2.jpg)
- `spray` — graded spots dispersed along a direction (2.jpg)
- `string` — beads on a line, a fine dotted companion, rings (3.jpg)
- `pool` — overlapping transparent circles with small dots inside (3.jpg)
- `cell` — a terracotta void held by a membrane of merged beads (1.jpg)

Detail depends on mass: a starving locus shows only its skeleton, while a fed one
grows its full form. When a locus changes character, its existing spots take
on the new roles, so the form *morphs* and is never swapped.

### Connections
Loci are linked by chains of ink beads. A strong link merges into a continuous
vein. A weak link breaks into a dotted line. A dissolved link evaporates. Matter
flows along links, so when one stain grows another shrinks. Activation travels
along links as visible pulses: a locus that is excited passes the excitation
on to its neighbours, and the whole field thinks collectively.

### Grammar: gestures, phrases, listening
The daemon speaks in **phrases** of 3–5 overlapping **gestures**, then
**listens** (the field calms, slows and contracts) for 8–15 s:

`converge` · `divide` · `reach` · `release` · `insist` · `realign` ·
`transmute` · `link` · `sever` · `migrate` · `demand` (only once pieces are reported)
(see `js/daemon/mind.js` for what each one does).

### Dialects
Each seed unfolds into a **temperament**: a pigment set, preferred characters,
favoured gestures, tempo, a dominant axis and its coherence. Different sessions
therefore speak different dialects of the same language.

### Sound
Sound is made of short, dry, independent percussive events: `click`, `tap`,
`knock`, `thud`, `pulse` (an organic throb) and `rattle` (irregular
contacts). It is synthesized in the browser with no samples. There are no
melodies, held notes, loops, tempo, drone, reverb or delay. A sound happens
only when something happens:

| Event | Sound |
|---|---|
| a pulse arrives at a locus | thud (heavier locus = lower) |
| a pulse leaves along a vein | click |
| a locus fires | depends on its form: blot a thud, spray a rattle, string two taps, pool a hollow knock, cell a throb |
| a vein grows a bead | a tiny tap |
| a new locus emerges | a soft throb |
| two loci link | two small knocks |
| a locus dissolves | a falling, sparse rattle |
| `insist` beats | thuds |
| the will's impulses, pieces, responses, accord | see the feedback table above |

The will's insistence sets how loud the daemon's own events are, how dense
they are (each voice has a minimum gap that shrinks as insistence rises) and
how sharp they are (attack, brightness, shortness). Misaligned means
intense, frequent, repetitive and sharp; aligned means soft, sparse and
rounded. Repetitions are spaced irregularly, so they never form a rhythm.
Sounds are panned by their position on the surface. Audio starts only after
the first click. Mute with M or "sound"; set the level with the slider.

### Memory
The surface remembers. A low-resolution buffer keeps a slowly fading trace of
where matter has been (around 40 s), so earlier states remain as faint stains in
the paper, even across sessions.

## Architecture

```
index.html
css/daemon.css
js/
  core/      random.js (seeded RNG, session codes) · noise.js · emitter.js
  daemon/    palette.js      earth pigments (+ the oxide-red signal colour)
             will.js         the intention, the model, evaluation, negotiation
             growth.js       the body: pieces grown from the intention, every session anew
             temperament.js  seed → dialect (reshaped by the will)
             forms.js        the vocabulary (5 characters)
             organism.js     body: loci, spots, bonds, physics, flows
             composition.js  initial configuration of a session
             mind.js         grammar: gestures, phrases, listening
             daemon.js       public API (the only thing other modules use)
  render/    shaders.js · renderer.js   WebGL2 painting (tile-binned field → surface texture)
             scene.js        the 3D board, organic piece meshes, soot shadows, camera
  sound/     synth.js        dry percussive voices (click, tap, knock, thud, pulse, rattle)
             sonifier.js     event → sound, shaped by the will's insistence
  ui/        interface.js    threshold, marks, keyboard, pointer, volume, notes
             view.js         turning around the board, attention, the view from above
  main.js    wiring
```

The daemon knows nothing about rendering or the DOM. Everything passes through
`js/daemon/daemon.js`:

```js
daemon.begin({ seed, origin })   // start / restart a session
daemon.end()
daemon.stimulate(x, y, amount)   // external signal at a point (world units)
daemon.place(i, j, +1 | -1)      // a piece added / removed at a grid cell
daemon.clearModel()              // the physical model was taken apart
daemon.describe()                // semantic snapshot (see below)
daemon.on('phase', fn)           // 'session:start' | 'session:end' | 'dormant' |
                                 // 'phase' | 'gesture:start' | 'gesture:end' | 'stimulus' |
                                 // 'piece' | 'response' | 'impulse' | 'will:accord' | 'will:discord'
```

The intention is kept separate from its expression. `will.js` is pure
logic: it has no rendering, sound or DOM. It exposes a target, an
evaluation, an error map, insistence and impulses, and everything else only
reads them. It can be replaced by a learning agent with the same interface,
and the grid can be replaced by a camera or sensors that call `place()`.

`daemon.describe()` returns what the daemon is currently "saying" as data:
loci (normalised position, mass, character, density, activation, orientation,
links), links (strength, continuous or dotted, flow) and the will (intention,
alignment, insistence, urgency, accord, focus cells, pieces). The observer's
notes (D) also print the target, for the team only. The participant never
sees it. The instance is exposed as `window.daemon` for console experiments.
