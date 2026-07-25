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
//
// startGear (EQUIPMENT_PLAN): { slot: itemId } worn from character creation, so
// a new character's equipment listing is furnished with one signature piece
// instead of four empty rows. Seeded by stats.createSheetFrom (createSheet
// only - migrations and companions omit it). Kept curve-neutral: none of these
// touch maxHp/maxAp (Grit/Hustle), so each class's headline HP/AP stay exact -
// the signature piece flavours a slot, it doesn't inflate the sheet.
export const CLASSES = {
  'office-drone': {
    name: 'Office Drone',
    model: 'worker',
    tagline: 'Seen everything. Feels nothing. Balanced stats.',
    experience: 'Cubicle Occupant, 2019–present. Duties: unclear.',
    maxHp: 22,
    ap: 6,
    bonusDmg: 0,
    startGear: { trinket: 'stress-ball' }, // the grief-squeezed desk companion
    // Office attributes (Grit/Hustle/Savvy/Composure) - the source the sheet
    // derives maxHp/maxAp/damage from (stats.js recomputeDerived). Calibrated so
    // level-1 stats equal the maxHp/ap above; the Drone is deliberately even.
    attr: { grit: 5, hustle: 5, savvy: 5, composure: 5 },
    // Class ability track: spend class points (level-up screen) to bake these in.
    // `effect` reuses the engine's known shapes (attrBonus / talent / grantsAction).
    track: [
      { id: 'drone-thick-skin', name: 'Thick Skin', cost: 1, effect: { attrBonus: { grit: 1 } } },
      { id: 'drone-sharp-folds', name: 'Sharp Folds', cost: 1, effect: { talent: { paperDamageBonus: 1 } } },
      { id: 'drone-seminar', name: 'Self-Defense Seminar', cost: 1, requires: ['drone-thick-skin'], effect: { grantsAction: 'kick' } },
    ],
    actions: ['attack', 'defend', 'coffee'],
    talent: {
      name: 'Origami Specialist',
      blurb: 'Immune to paper cuts. Projectiles +2 damage; airplanes fold for 1 sheet.',
      // foldsAirplanes is what unlocks the Paper Airplane throwable at all
      // (data/actions.js `needsTalent`) - the blurb above already promised it.
      effects: { paperDamageBonus: 2, paperAmmoDiscount: 1, paperCutImmune: true, foldsAirplanes: true },
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
    startGear: { outfit: 'company-fleece' }, // padded, logo-embroidered, tank-adjacent
    attr: { grit: 8, hustle: 3, savvy: 4, composure: 7 }, // tanky, unhurried
    track: [
      { id: 'mgr-stonewall', name: 'Stonewall', cost: 1, effect: { attrBonus: { composure: 1 } } },
      { id: 'mgr-reorg', name: 'Reorg Survivor', cost: 1, effect: { attrBonus: { grit: 1 } } },
      { id: 'mgr-traction', name: 'Corner-Office Traction', cost: 1, requires: ['mgr-stonewall'], effect: { talent: { slipImmune: true } } },
    ],
    actions: ['delegate', 'own-calendar', 'espresso'],
    talent: {
      name: 'Smoker',
      blurb: 'A lighter, always. Ignite anything flammable. Smoke breaks steady the nerves in combat.',
      effects: { hasLighter: true, grantsAction: 'cigarette' },
    },
  },
  'mail-room': {
    name: 'Mail Room',
    model: 'mailroom',
    // Rangy from eleven years of corridors - its own rig now, so the build
    // nudge is character rather than compensation for shared art.
    look: { build: { legs: 2.0 } },
    tagline: 'Knows every corridor. Slips on nothing. Delivers regardless.',
    experience: 'Mail Room Clerk, 11 yrs. Knows where every body is filed.',
    maxHp: 24,
    ap: 6,
    bonusDmg: 0,
    startGear: { shoes: 'warehouse-boots' }, // the Dock Boots the track later doubles down on
    attr: { grit: 6, hustle: 8, savvy: 4, composure: 4 }, // fast on his feet
    track: [
      { id: 'mail-cart-legs', name: 'Cart Legs', cost: 1, effect: { attrBonus: { hustle: 1 } } },
      { id: 'mail-routes', name: 'Route Knowledge', cost: 1, effect: { attrBonus: { savvy: 1 } } },
      { id: 'mail-dock-boots', name: 'Dock Boots', cost: 1, requires: ['mail-cart-legs'], effect: { grantsAction: 'kick' } },
    ],
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
    startGear: { weapon: 'letter-opener' }, // precise, low-punch - a glass cannon's scalpel
    attr: { grit: 3, hustle: 6, savvy: 8, composure: 3 }, // glass cannon
    track: [
      { id: 'it-root', name: 'Root Access', cost: 1, effect: { attrBonus: { savvy: 1 } } },
      { id: 'it-ergonomic', name: 'Ergonomic Chair', cost: 1, effect: { attrBonus: { grit: 1 } } },
      { id: 'it-server-breaks', name: 'Server-Room Breaks', cost: 1, effect: { grantsAction: 'cigarette' } },
    ],
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

  'human-resources': {
    name: 'Human Resources',
    model: 'hr', // the HR rig already ships (assets/characters/hr.glb)
    tagline: 'Doesn\'t fight so much as staff. Brings friends to your review.',
    experience: 'People Ops "Business Partner". Owns the offsite. Tenure: undisclosed.',
    maxHp: 20,
    ap: 6,
    bonusDmg: 0,
    startGear: { outfit: 'interview-blazer' }, // poise you can wear (composure the HR way)
    attr: { grit: 5, hustle: 5, savvy: 4, composure: 8 }, // unflappable support
    track: [
      { id: 'hr-candor', name: 'Radical Candor', cost: 1, effect: { attrBonus: { composure: 1 } } },
      { id: 'hr-read-room', name: 'Reading the Room', cost: 1, effect: { attrBonus: { savvy: 1 } } },
      { id: 'hr-tenure', name: 'Untouchable Tenure', cost: 1, requires: ['hr-candor'], effect: { attrBonus: { grit: 1 } } },
    ],
    // Post the Role summons applicants to fight for you; Deflect Blame and
    // Coffee Break round out a support kit that survives while the temps swing.
    actions: ['summon-applicants', 'defend', 'coffee'],
    talent: {
      name: 'Open Door Policy',
      blurb: 'The door is always open. So is the req. There is always another applicant.',
      effects: {}, // flavor for now; a summon-scaling effect can land later
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
    // Deliberately the office-worker rig: an applicant is meant to read as
    // anonymous, and the wash-out below is the point, not a workaround. It is
    // the one character type that shares a model, by choice.
    model: 'worker',
    look: { tint: [0.82, 0.86, 0.95], build: { legs: 1.7, torso: 1.2 } },
    playable: false,
    maxHp: 5,
    ap: 4,
    bonusDmg: 0,
    // Explicit zeros keep the source-of-truth rule (every class carries `attr`)
    // without changing behavior: base is solved to reproduce maxHp/ap, and a
    // zero spread means no Savvy damage, no Composure deflect, +0 initiative -
    // exactly what the applicant had when it omitted the block.
    attr: { grit: 0, hustle: 0, savvy: 0, composure: 0 },
    // Player-controlled summons swing from `actions` (an action bar) like any
    // member; enemy-side AI summons roll from `attacks` below instead. The
    // applicant carries both - the superset a shared archetype needs.
    actions: ['resume-slap'],
    talent: null,
    // AI-combat fields (read only for AI-driven class units):
    attackAp: 3,
    xp: 0,
    loot: [],
    // Side-neutral flavor: applicants fight on either team, so no line
    // addresses "you" - it reads the same whoever they're swinging at.
    attacks: [
      { min: 1, max: 2, log: 'An applicant brandishes a résumé.' },
      { min: 1, max: 3, log: 'An applicant asks about the growth trajectory.' },
      { min: 1, max: 2, log: 'An applicant follows up. And follows up again.' },
    ],
  },
};
