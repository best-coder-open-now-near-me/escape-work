// Player class registry. A class is starting stats + the combat actions it
// brings (ids into data/actions.js). Weapons/perks later modify or extend the
// same action list.
export const CLASSES = {
  'office-drone': {
    name: 'Office Drone',
    maxHp: 22,
    bonusDmg: 0,
    actions: ['attack', 'defend', 'coffee'],
  },
};
