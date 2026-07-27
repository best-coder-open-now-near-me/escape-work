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
  paper: {
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

// Gum-on-shoe: the status a stepped-on wad (or a well-aimed Manager) applies.
// Slows movement and disables footwork actions (the kick) - but gum is
// TRACTION: you cannot slip while stuck. Wears off after `steps` tiles
// walked. `slow` scales walk speed; `moveCost` scales combat move AP.
export const GUM = { steps: 20, slow: 0.6, moveCost: 1.5 };

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
