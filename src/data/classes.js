// Player class registry. A class is starting stats, a character model
// (assets/characters/<model>.glb), and the combat actions it brings (ids into
// data/actions.js). Weapons/perks later modify or extend the same action list.
//
// A class is becoming the shared unit archetype - not just what you pick, but
// what companions and (increasingly) enemies are (see SUMMON_PLAN.md). Two
// optional fields carry that:
//   playable: false  - kept out of the class picker (ui.showClassPicker)
//   AI-combat fields (attacks, attackAp, xp, loot) - read via stats.js
//     unitCombat when a class backs an AI-DRIVEN unit (a summon, later an
//     enemy) instead of a player. Player classes omit them and are unchanged.
export const CLASSES = {
  'office-drone': {
    name: 'Office Drone',
    model: 'worker',
    tagline: 'Seen everything. Feels nothing. Balanced stats.',
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
  'mail-room': {
    name: 'Mail Room',
    model: 'worker', // TODO: dedicated mailroom .glb when one lands in assets
    tagline: 'Knows every corridor. Slips on nothing. Delivers regardless.',
    experience: 'Mail Room Clerk, 11 yrs. Knows where every body is filed.',
    maxHp: 24,
    ap: 6,
    bonusDmg: 0,
    actions: ['mail-cone', 'return-to-sender', 'snack-cart'],
    talent: {
      name: 'Warehouse Soles',
      blurb: 'Eleven years of ignored wet-floor signs. You cannot slip. Ever.',
      effects: { slipImmune: true },
    },
  },
  'it-support': {
    name: 'IT Support',
    model: 'itsupport',
    tagline: 'Fragile, caffeinated, devastating.',
    experience: '"Have you tried turning it off and on again," 10 yrs.',
    maxHp: 17,
    ap: 7,
    bonusDmg: 0,
    actions: ['reboot', 'firewall', 'energy-drink'],
    // (An anti-slip footwear talent is reserved for a future talent-choice
    // system - the engine already honors slipImmune. Until then, gum on your
    // shoe is the anti-slip option, at a price.)
    talent: {
      name: 'ESD Steel-Toes',
      blurb: 'Electrostatic-discharge rated, steel toe box. Live water can\'t shock you, and the toe adds a Steel-Toe Kick to your repertoire.',
      effects: { shockImmune: true, grantsAction: 'kick' },
    },
  },

  // --- summoned, never chosen -------------------------------------------------
  // The applicant is a class with no résumé worth reading: spawned by an HR
  // summon (data/enemies.js hr.summon, and later the HR class's Post the Role),
  // it fights on whichever side called it. `playable: false` keeps it out of
  // the picker; the AI-combat fields below are what let a class stand in for an
  // AI-driven unit (stats.js unitCombat, combat.js). Deliberately flimsy - a
  // swarm you clear, not a wall you grind - and worth no XP or loot, so an HR
  // that summons on a cooldown is a spawner, not a farm (SUMMON_PLAN #6).
  applicant: {
    name: 'Applicant',
    model: 'worker', // reuse the office-worker rig; a temp .glb can land later
    playable: false,
    maxHp: 5,
    ap: 4,
    bonusDmg: 0,
    actions: [], // AI-driven: it swings from `attacks`, never an action bar
    talent: null,
    // AI-combat fields (read only for AI-driven class units):
    attackAp: 3,
    xp: 0,
    loot: [],
    attacks: [
      { min: 1, max: 2, log: 'An applicant waves a résumé in your face.' },
      { min: 1, max: 3, log: 'An applicant asks if this "counts as an interview".' },
      { min: 1, max: 2, log: 'An applicant follows up. And follows up again.' },
    ],
  },
};
