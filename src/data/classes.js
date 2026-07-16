// Player class registry. A class is starting stats, a character model
// (assets/characters/<model>.glb), and the combat actions it brings (ids into
// data/actions.js). Weapons/perks later modify or extend the same action list.
export const CLASSES = {
  'office-drone': {
    name: 'Office Drone',
    model: 'worker',
    tagline: 'Seen everything. Feels nothing. Balanced stats.',
    maxHp: 22,
    bonusDmg: 0,
    actions: ['attack', 'defend', 'coffee'],
  },
  'middle-manager': {
    name: 'Middle Manager',
    model: 'midmanager',
    tagline: 'Absorbs blame like a sponge. Tough, but hits like a memo.',
    maxHp: 28,
    bonusDmg: 0,
    actions: ['delegate', 'own-calendar', 'espresso'],
  },
  'it-support': {
    name: 'IT Support',
    model: 'itsupport',
    tagline: 'Fragile, caffeinated, devastating.',
    maxHp: 17,
    bonusDmg: 0,
    actions: ['reboot', 'firewall', 'energy-drink'],
  },
};
