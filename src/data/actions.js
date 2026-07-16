// Combat action registry. Buttons in the combat panel are generated from the
// player's action list (from their class; later modified by weapons/items).
// The id doubles as the DOM id suffix (#act-<id>), so keep ids stable.
//
// Types the combat runner understands:
//   attack - rolls min..max (+ the character sheet's bonusDmg)
//   defend - halves the next incoming hit
//   heal   - restores `amount` HP, limited to `uses` per fight
export const ACTIONS = {
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
};
