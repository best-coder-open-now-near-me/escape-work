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
    label: 'Passive-Aggressive Email',
    min: 3,
    max: 5,
    log: 'You send a passive-aggressive email.',
  },
  defend: {
    type: 'defend',
    label: 'Deflect Blame',
    log: 'You pre-emptively deflect blame. Incoming damage halved.',
  },
  coffee: {
    type: 'heal',
    label: 'Coffee Break',
    amount: 6,
    uses: 3,
    log: 'You chug lukewarm coffee. +6 HP.',
  },

  // --- Middle Manager ---------------------------------------------------------
  delegate: {
    type: 'attack',
    label: 'Delegate Ruthlessly',
    min: 2,
    max: 4,
    log: 'You delegate the problem back to them.',
  },
  'own-calendar': {
    type: 'defend',
    label: 'Decline the Invite',
    log: 'You decline their meeting invite. Incoming damage halved.',
  },
  espresso: {
    type: 'heal',
    label: 'Executive Espresso',
    amount: 8,
    uses: 2,
    log: 'You down a double espresso from the good machine. +8 HP.',
  },

  // --- IT Support ---------------------------------------------------------------
  reboot: {
    type: 'attack',
    label: 'Turn It Off And On Again',
    min: 4,
    max: 7,
    log: 'You power-cycle their whole workflow.',
  },
  firewall: {
    type: 'defend',
    label: 'Blame the Firewall',
    log: '"That\'s a firewall issue." Incoming damage halved.',
  },
  'energy-drink': {
    type: 'heal',
    label: 'Energy Drink',
    amount: 4,
    uses: 4,
    log: 'You crack open something neon. +4 HP.',
  },
};
