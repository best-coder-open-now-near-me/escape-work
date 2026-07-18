// Player class registry. A class is starting stats, a character model
// (assets/characters/<model>.glb), and the combat actions it brings (ids into
// data/actions.js). Weapons/perks later modify or extend the same action list.
export const CLASSES = {
  'office-drone': {
    name: 'Office Drone',
    model: 'worker',
    tagline: 'Seen everything. Feels nothing. Balanced stats.',
    objective: 'To occupy a chair with minimal supervision until something better comes along.',
    experience: 'Cubicle Occupant, 2019–present. Duties: unclear.',
    maxHp: 22,
    ap: 6,
    bonusDmg: 0,
    actions: ['attack', 'defend', 'coffee'],
    talent: {
      name: 'Origami Specialist',
      blurb: 'Immune to paper cuts. Projectiles +2 damage; airplanes fold for 1 sheet.',
      effects: { paperDamageBonus: 2, paperAmmoDiscount: 1, paperCutImmune: true },
    },
  },
  'middle-manager': {
    name: 'Middle Manager',
    model: 'midmanager',
    tagline: 'Absorbs blame like a sponge. Tough, but hits like a memo.',
    objective: 'Seeking synergies. Comfortable owning outcomes I did not cause.',
    experience: 'VP of Alignment (self-described), 6 yrs. Survived 4 reorgs.',
    maxHp: 28,
    ap: 5,
    bonusDmg: 0,
    actions: ['delegate', 'own-calendar', 'espresso'],
    talent: {
      name: 'Smoker',
      blurb: 'A lighter, always. Ignite anything flammable. Smoke breaks steady the nerves in combat.',
      effects: { hasLighter: true, grantsAction: 'cigarette' },
    },
  },
  'it-support': {
    name: 'IT Support',
    model: 'itsupport',
    tagline: 'Fragile, caffeinated, devastating.',
    objective: 'To close tickets. All of them. Forever.',
    experience: '"Have you tried turning it off and on again," 10 yrs.',
    maxHp: 17,
    ap: 7,
    bonusDmg: 0,
    actions: ['reboot', 'firewall', 'energy-drink'],
    talent: {
      name: 'Rubber-Soled Shoes',
      blurb: 'Immune to electrified water. You know better.',
      effects: { shockImmune: true },
    },
  },
};
