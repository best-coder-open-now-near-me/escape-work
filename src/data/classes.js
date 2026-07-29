// Player class registry. A class is starting stats, a character model
// (assets/characters/<model>.glb), and the combat actions it brings (ids into
// data/actions.js). Weapons/perks later modify or extend the same action list.
//
// `model` names a RIG FILE, and the file is named for the role that wears it.
// That was already the house rule - `mailroom.glb` became `security.glb` the
// day the guard took it over, "since the file is named for the role it plays" -
// but the rule was applied once and then dropped, and three classes drifted
// onto files named for somebody else while reassignments skipped the rename.
// The entries below are back on their own names. One exception survives: the
// Mail Room wears `hr.glb`, because the rig actually named for that job was
// given to Security on purpose (it read as a uniform) and no file is left for
// it. That one needs art, not a rename.
//
// Where two entries share a rig - a class and the coworker version of it you
// FIGHT - each carries a `look.build` that makes them read as different people.
// Keep that up when you hand a rig to someone new, and remember that an
// INHERITED rig makes a second wearer without either entry naming it.
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
// Fields that belong to the class PICKER, not to a character built from one: a
// companion is met and an enemy is fought, neither is hired off a résumé card.
//
// `name` is NOT one of them, and used to be. Dropping it forced every
// class-backed character to invent a display name, and what got invented were
// adjectives - a state asserted in a label that no rule ever touches and no
// scene ever resolves. The player's own character is named for the job (you are
// "Mail Room"), so a coworker doing that job inherits the same label and reads
// as the same kind of thing. An entry that genuinely IS a distinct person - the
// Security Guard you fight - still says so by overriding `name`; the point is
// that it has to be a deliberate line, not a blank the shape demands be filled.
//
// The same rule governs every other field. An adjective strapped onto one of
// our people - a different rig, a renamed track node, a hand-tuned tier - is
// the same failure wearing data instead of a string, and it is worse, because
// it drifts silently. If an entry IS one of the classes, it names the class and
// inherits; what is left is only what genuinely departs.
const PICKER_ONLY = ['tagline', 'experience', 'startGear', 'playable'];

// `primary` (POWERS_PLAN M8): the ONE verb a class is for. Six playable classes
// once shipped as attack + defend + heal with different words on the buttons -
// only HR departed from it, and only because `summon` happened to get built -
// so the roster read as one character with six vocabularies. Stating the
// intent in data lets a lint hold the line: every playable class declares one,
// no two share one, and the kit must actually contain an action of that type.
//
// It is the DEFINING verb, not an exclusive one. Security also carries a
// control and HR also carries a buff; what the lint prevents is two classes
// being *about* the same thing.

/**
 * Build a character FROM a class: `{ classId, ...overrides }` in, a full def
 * out. This is the one mechanism behind "a class is the shared unit archetype"
 * (ARCHITECTURE) - companions and enemies that ARE a class name it and inherit
 * it, instead of keeping a private copy that drifts the moment the class moves.
 * An override is for DEPARTING from the class; anything that merely matches it
 * should be deleted (there's a lint).
 *
 * `drop` removes further inherited fields. Enemies pass `maxHp`: the two
 * registries spell max HP differently and `unitCombat` prefers `maxHp` over
 * `hp`, so an inherited `maxHp` would silently outrank the enemy's own `hp`.
 */
export function fromClass({ classId, ...over }, { drop = [] } = {}) {
  const base = CLASSES[classId];
  if (!base) throw new Error(`archetype references unknown class "${classId}"`);
  const kit = { ...base };
  for (const key of [...PICKER_ONLY, ...drop]) delete kit[key];
  const out = { classId, ...kit, ...over };
  for (const key of MERGED_PER_KEY) {
    if (over[key] && kit[key]) out[key] = { ...kit[key], ...over[key] };
  }
  return out;
}

// Fields merged one KEY at a time rather than replaced wholesale. `attr` is
// four independent dials, so "an intern is IT Support who isn't savvy yet" is
// honestly written `attr: { savvy: 3 }` - restating the other three just to
// change one is the copy-that-drifts problem in miniature.
//
// `look` is deliberately NOT in here: a build is one silhouette, adopted or
// replaced, not a bag of dials. Half-inheriting a stretch and a stockiness
// meant for different bodies produces a shape nobody chose.
//
// The lint's granularity follows this list - a per-key merge is checked per
// key, a whole-value replace is checked whole.
export const MERGED_PER_KEY = ['attr'];

export const CLASSES = {
  'office-drone': {
    name: 'Office Drone',
    primary: 'attack', // the baseline the other five read against
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
      // Was a grant of `kick`, which the Mail Room and Security also handed
      // out - three classes unlocking one action (POWERS_PLAN M3).
      { id: 'drone-paper-storm', name: 'Paper Storm', cost: 1, requires: ['drone-sharp-folds'], effect: { grantsAction: 'paper-storm' } },
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
    primary: 'control', // he does not out-hit you, he takes your turn
    // The rig named for the job. Short and settled from six years in the
    // chair - the build is character here, not a way to tell two people apart.
    model: 'midmanager',
    look: { build: { legs: 1.68 } },
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
      // Frequent Flier (MOVEMENT_PLAN M3): never triggers an opportunity
      // attack. The manager is always at a conference and never in the
      // building to be hit - and it hands the slowest class an escape hatch,
      // which is a better spread than piling every movement talent on the
      // clerk.
      { id: 'mgr-frequent-flier', name: 'Frequent Flier', cost: 1, effect: { talent: { noProvoke: true } } },
      // The Manager's track granted only passive talents, so levelling one
      // never changed what he could DO (POWERS_PLAN M2).
      { id: 'mgr-all-hands', name: 'All-Hands', cost: 1, requires: ['mgr-stonewall'], effect: { grantsAction: 'all-hands' } },
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
    primary: 'mobility', // knows every corridor, and can now use one
    // Rangy from eleven years of corridors. Shared with the mail room
    // companion, who inherits this rig along with the rest of the class - he
    // reads apart by torso (data/companions.js), so keep the two builds
    // distinct when either one is retuned.
    model: 'hr',
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
      // Was a third copy of `kick` (POWERS_PLAN M4).
      { id: 'mail-hand-off', name: 'Hand-Off', cost: 1, requires: ['mail-cart-legs'], effect: { grantsAction: 'courier-swap' } },
      // The Pawn (MOVEMENT_PLAN M2): AP that ONLY movement may spend, drawn
      // before real AP. Turns repositioning from a cost into a habit - the
      // clerk flanks and gets behind people without giving up a swing.
      { id: 'mail-always-moving', name: 'Always Moving', cost: 1, requires: ['mail-cart-legs'], effect: { talent: { freeMoveAp: 1 } } },
    ],
    actions: ['mail-cone', 'courier-route', 'snack-cart'],
    talent: {
      name: 'Warehouse Soles',
      blurb: 'Eleven years of ignored wet-floor signs. You cannot slip. Ever.',
      effects: { slipImmune: true },
    },
  },
  'it-support': {
    name: 'IT Support',
    primary: 'purge', // the only class that can take a status OFF anybody
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
      // Was a grant of the Middle Manager's `cigarette` - one class's track
      // handing out another class's talent action (POWERS_PLAN M2).
      { id: 'it-percussive', name: 'Percussive Maintenance', cost: 1, requires: ['it-root'], effect: { grantsAction: 'percussive-maintenance' } },
      { id: 'it-remote', name: 'Remote Session', cost: 1, requires: ['it-root'], effect: { grantsAction: 'remote-session' } },
    ],
    // ONE purge, pointed at everybody: Reboot power-cycles a coworker, a
    // colleague or you. It used to need a second action (Remote Restart) purely
    // because targeting was a boolean - a verb aimed at friends OR foes had no
    // shape - so the same effect shipped twice under two names. Now that
    // `aimsAtAnyone` exists, one verb covers the board, which is what IT's
    // identity was always describing: nobody else can take a status off
    // anybody.
    actions: ['reboot', 'energy-drink'],
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
    primary: 'summon', // it staffs the fight; the buffs are the other half
    // The rig named for the job. Shared with the HR Representative you FIGHT
    // (data/enemies.js), who inherits this class and reads apart by build.
    model: 'hrrep',
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
      // The HR track granted no action at all, on the one class whose whole
      // job is doing things TO other people. Onboarding is the defensive twin
      // of Performance Review (POWERS_PLAN M1).
      { id: 'hr-onboarding', name: 'Onboarding Buddy', cost: 1, requires: ['hr-read-room'], effect: { grantsAction: 'onboarding' } },
    ],
    // Post the Role summons applicants to fight for you; Performance Review
    // makes whoever is already swinging connect more often. HR is the only
    // class that spends its turns on OTHER people (POWERS_PLAN M1) - it used
    // to carry Deflect Blame and Coffee Break, which is the Office Drone's
    // kit, so the support class supported nobody but itself.
    actions: ['summon-applicants', 'performance-review', 'coffee'],
    talent: {
      name: 'Open Door Policy',
      blurb: 'The door is always open. So is the req. There is always another applicant.',
      effects: {}, // flavor for now; a summon-scaling effect can land later
    },
  },

  security: {
    name: 'Security',
    primary: 'stance', // holds ground, and the reaction budget is how
    // The cop rig - the one the Mail Room clerk used to wear before it went to
    // the person whose job actually IS the uniform. Shared with the Security
    // Guard ENEMY (data/enemies.js), who is squarer through the vest; the
    // player's guard stands taller and less padded, so the two read apart when
    // you meet yourself coming the other way.
    model: 'security',
    look: { build: { legs: 1.98, torso: 1.18 } },
    tagline: 'Has the keys, the clipboard, and the authority. Slow to swing, hard to move.',
    experience: 'Night Security, 8 yrs. Has walked this floor more times than anyone alive.',
    maxHp: 26,
    ap: 5,
    bonusDmg: 0,
    startGear: { shoes: 'warehouse-boots' }, // the duty boot: sure-footed, not light
    attr: { grit: 7, hustle: 4, savvy: 5, composure: 6 }, // steady, unhurried, hard to rattle
    track: [
      { id: 'sec-post', name: 'Standing Post', cost: 1, effect: { attrBonus: { grit: 1 } } },
      { id: 'sec-rounds', name: 'Night Rounds', cost: 1, effect: { attrBonus: { hustle: 1 } } },
      { id: 'sec-deescalate', name: 'De-escalation Training', cost: 1, effect: { attrBonus: { composure: 1 } } },
      { id: 'sec-hold-line', name: 'Hold the Line', cost: 1, requires: ['sec-post'], effect: { grantsAction: 'hold-the-line' } },
      // Was a third copy of `kick` (POWERS_PLAN M2): the Drone, the Mail Room
      // and Security all granted the same action, so levelling up converged
      // the roster instead of separating it.
      { id: 'sec-lockdown', name: 'Badge Lockdown', cost: 1, requires: ['sec-post'], effect: { grantsAction: 'lockdown' } },
    ],
    actions: ['detain', 'stand-post', 'night-thermos'],
    talent: {
      name: 'Incident Report',
      blurb: 'Eight years of walking through whatever the day shift spilled. Hazards on the floor hurt you less.',
      // surfaceDamageResist is a live handler (main.js) that had no owner until
      // now - flat reduction on the damage a surface deals you per step.
      effects: { surfaceDamageResist: 1 },
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
