// Surface registry - the Divinity-style layer. A tile type may carry a
// surface (see data/tiles.js); surfaces have their own effects and, crucially,
// interactions: `conducts` surfaces form pools (4-connected flood fill) and a
// pool touching a `powers` surface becomes ELECTRIFIED.
//
// Fields:
//   conducts  - joins conduction pools (can be electrified)
//   powers    - energizes adjacent conduction pools
//   slow      - movement speed multiplier while standing on it
//   onEnter   - { amount?, message } applied when stepping on (amount = damage)
//   pathCost  - extra pathfinding cost (characters route around expensive
//               surfaces unless told otherwise); electrified pools use
//               ELECTRIFIED.pathCost regardless
//   slippery  - chance (0..1), per tile entered, of slipping: the walker goes
//               down and the walk ends there (in combat, movement already
//               paid for is lost; a slipped enemy loses the rest of its
//               turn). Electrified/burning tiles never also slip - they have
//               bigger problems. slipImmune talents (safety tread) ignore it.
//   style     - 'puddle' | 'cable' | 'gum' | 'paper' (how tile-renderer.js
//               draws it)
export const SURFACES = {
  water: {
    conducts: true,
    slippery: 0.45,
    style: 'puddle',
    color: [0.42, 0.68, 0.84],
    pathCost: 2,
    onEnter: { message: 'Your socks are instantly soaked. HP intact. Dignity, less so.' },
    examine: 'Standing water, slick as a resignation letter. Facilities has been notified. Allegedly.',
  },
  coffee: {
    style: 'puddle',
    color: [0.34, 0.22, 0.14],
    slow: 0.5,
    pathCost: 2,
    onEnter: { message: 'Sticky coffee floor. Your shoes protest. (Slowed.)' },
    examine: 'The 3pm incident. Nobody speaks of it.',
  },
  cable: {
    impact: 'zap', // bare copper sparks even unpowered
    powers: true,
    style: 'cable',
    color: [0.14, 0.14, 0.18],
    pathCost: 5,
    onEnter: { amount: 2, message: 'You step on a frayed power cable. -2 HP.' },
    examine: 'A frayed power strip, daisy-chained six deep. OSHA would like a word.',
  },
  gum: {
    style: 'gum',
    color: [0.93, 0.5, 0.65],
    pathCost: 0, // nobody routes around gum - that's what makes it a mine
    onEnter: { applies: 'gum', message: 'Squish. That was gum. It is yours now.' },
    examine: 'A wad of gum, pre-owned. Possibly load-bearing.',
  },
  // What a toppled prop leaves underfoot (POWERS_PLAN M6). It exists as a
  // SURFACE rather than as fields on the fallen tile because movement cost is
  // the surface layer's job - `slow` and `pathCost` already drive walk speed,
  // combat's AP pricing, the AI's route costing and the pathfinder's
  // avoidance, and inventing a per-tile `moveCost` would have been a second
  // implementation of all four.
  debris: {
    // No `style`: the fallen prop's own MODEL is the visual (tile-renderer
    // returns on `def.model` before it reaches the surface styles), so there
    // is nothing for this layer to draw. The surface is here for the RULES.
    color: [0.42, 0.36, 0.30],
    // Clambering over costs about what wading through coffee does.
    slow: 0.6,
    pathCost: 2,
    examine: 'Somebody is going to have to file an incident report about this.',
  },
  paper: {
    impact: 'paper', // what a paper cut throws: shreds
    style: 'paper',
    flammable: true,
    color: [0.93, 0.91, 0.83],
    pathCost: 2,
    // Cuts on every step (bleed: keep losing 1 HP for the next N tiles). The
    // ammo isn't picked up by walking - you gather a drift once via the Alt
    // loot overlay, so a Mail Room can't farm their own cone for endless paper.
    onEnter: { amount: 1, bleed: 2, message: 'Paper cuts! -1 HP. The edges keep biting.' },
    examine: 'A drift of shredded TPS reports. Sharp edges. Gather it (Alt) for ammo.',
  },
};

// Gum-on-shoe used to carry its numbers here, as a `GUM` export, back when the
// wad was a surface that did its own slowing. It is a STATUS now - the `gum`
// surface above just names it in `onEnter.applies` - so data/statuses.js's
// `gum` entry owns the duration and the two multipliers, and nothing imported
// this. The migration the two comments kept promising has already happened;
// the export was the last thing still describing the old shape (Q173/Q174).

// Derived state for conduction pools touching a power source - not painted
// directly.
export const ELECTRIFIED = {
  pathCost: 9,
  onEnter: { amount: 6, message: 'ZAP! The water is LIVE! -6 HP.' },
  examine: 'The water is humming faintly. That seems bad.',
  color: [0.55, 0.85, 1.0],
};

// Runtime state for burning cells (see surfaces-runtime.js) - fire spreads
// through `flammable` surfaces from ignited trash cans, then burns out.
export const FIRE = {
  pathCost: 10,
  // In combat, striding through flame also sets you alight (the 'burning'
  // status, statuses.js): a dot on each of your turns until it burns out. Out
  // of combat there are no turns to tick, so only the instant damage lands.
  onEnter: { amount: 4, applies: 'burning', message: 'You stride through open flame. Bold. -4 HP.' },
  examine: 'That is on fire. This is fine.',
  color: [1.0, 0.45, 0.1],
};
