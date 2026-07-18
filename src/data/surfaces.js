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
//   style     - 'puddle' | 'cable' (how scene.js draws it)
export const SURFACES = {
  water: {
    conducts: true,
    style: 'puddle',
    color: [0.42, 0.68, 0.84],
    pathCost: 1,
    onEnter: { message: 'Your socks are instantly soaked. HP intact. Dignity, less so.' },
    examine: 'Standing water. Facilities has been notified. Allegedly.',
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
};

// Derived state for conduction pools touching a power source - not painted
// directly.
export const ELECTRIFIED = {
  pathCost: 9,
  onEnter: { amount: 6, message: 'ZAP! The water is LIVE! -6 HP.' },
  examine: 'The water is humming faintly. That seems bad.',
  color: [0.55, 0.85, 1.0],
};
