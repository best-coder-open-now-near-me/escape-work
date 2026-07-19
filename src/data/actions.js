// Combat action registry. Buttons in the combat panel are generated from the
// player's action list (from their class; later modified by weapons/items).
// The id doubles as the DOM id suffix (#act-<id>), so keep ids stable.
//
// Types the combat runner understands:
//   attack - rolls min..max (+ the character sheet's bonusDmg)
//   defend - halves the next incoming hit
//   heal   - restores `amount` HP, limited to `uses` per fight
export const ACTIONS = {
  // --- Office Drone -----------------------------------------------------------
  attack: {
    type: 'attack',
    ap: 3,
    label: 'Passive-Aggressive Email',
    min: 3,
    max: 5,
    log: 'You send a passive-aggressive email.',
  },
  defend: {
    type: 'defend',
    ap: 2,
    label: 'Deflect Blame',
    log: 'You pre-emptively deflect blame. Incoming damage halved.',
  },
  coffee: {
    type: 'heal',
    ap: 2,
    label: 'Coffee Break',
    amount: 6,
    uses: 3,
    log: 'You chug lukewarm coffee. +6 HP.',
  },

  // --- Middle Manager ---------------------------------------------------------
  delegate: {
    type: 'attack',
    ap: 3,
    label: 'Delegate Ruthlessly',
    min: 2,
    max: 4,
    log: 'You delegate the problem back to them.',
  },
  'own-calendar': {
    type: 'defend',
    ap: 2,
    label: 'Decline the Invite',
    log: 'You decline their meeting invite. Incoming damage halved.',
  },
  espresso: {
    type: 'heal',
    ap: 2,
    label: 'Executive Espresso',
    amount: 8,
    uses: 2,
    log: 'You down a double espresso from the good machine. +8 HP.',
  },

  // --- IT Support ---------------------------------------------------------------
  reboot: {
    type: 'attack',
    ap: 3,
    label: 'Turn It Off And On Again',
    min: 4,
    max: 7,
    log: 'You power-cycle their whole workflow.',
  },
  firewall: {
    type: 'defend',
    ap: 2,
    label: 'Blame the Firewall',
    log: '"That\'s a firewall issue." Incoming damage halved.',
  },
  'energy-drink': {
    type: 'heal',
    ap: 2,
    label: 'Energy Drink',
    amount: 4,
    uses: 4,
    log: 'You crack open something neon. +4 HP.',
  },

  // --- universal ----------------------------------------------------------------
  shove: {
    type: 'shove',
    ap: 2,
    label: 'Shove',
    log: 'You shove them.',
  },

  // --- talent-granted -----------------------------------------------------------
  cigarette: {
    type: 'heal',
    ap: 2,
    label: 'Smoke Break',
    amount: 3,
    uses: 2,
    log: 'You step "outside" without going anywhere. Nerves steadied. +3 HP.',
  },

  // --- thrown weapons (any class; consume paper ammo picked up from paper
  // spills; see sheet.paper) -----------------------------------------------------
  'paper-ball': {
    type: 'attack',
    ap: 2,
    ammoCost: 1,
    label: 'Paper Ball',
    min: 2,
    max: 4,
    log: 'You wad up a TPS report and bean them.',
  },
  'paper-airplane': {
    type: 'attack',
    ap: 2,
    ammoCost: 2,
    label: 'Paper Airplane',
    min: 4,
    max: 6,
    log: 'You fold a dart and send it. Right in the lanyard.',
  },
};
