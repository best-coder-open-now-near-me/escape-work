// Talent registry (TALENT_PLAN.md). Talents nobody owns.
//
// A talent used to be extra class stats with a name on them: declared inside
// the class entry, fixed the moment you picked a class, one per character. It
// could not be anything BUT redundant with the class it lived in, because
// nothing about it was a separate choice - and the tell was `slipImmune`,
// which was the Mail Room's entire named talent, a one-point Middle Manager
// track node, AND a stat on boots. A Manager could buy the Mail Room's whole
// identity for one class point. That is the same convergence POWERS_PLAN M2-M4
// cleaned out of `grantsAction`, in the layer where no lint was looking.
//
// So: a talent is a NAME and an EFFECTS BAG, and nothing else. It is not
// attached to a class, it may not require one (there is a lint), and a
// character may hold several - the bags merge, numbers accumulating and flags
// replacing, exactly as stats.applyEffect already merged a track node's talent
// effect. That function was written for the tracks and is, unmodified, a
// multi-talent merge; this registry is mostly a place to put what the classes
// were holding.
//
// Fields:
//   name    - what the character sheet calls it
//   blurb   - one line, player-facing
//   effects - the bag. Keys must be in TALENT_EFFECT_KEYS below (linted): a
//             typo here is how Open Door Policy shipped doing nothing at all.
//   requires- optional prereqs: { talents: [...], attr: { grit: 6 } }. NOT a
//             class gate - see the lint. And deliberately light: at 2-3 picks
//             a campaign there is no room to climb a chain, so `requires` is
//             for attribute thresholds, not for carrying balance.
//
// WEIGHT. A talent is a rare, defining pick - "2-3 a campaign" (designer,
// 2026-07-31) - so every entry here has to be worth a third of a character.
// Several of these are not yet: the four freed track nodes were sized as one
// node in a five-node track you buy out, and `slipImmune` alone is thin as one
// of three things that define you for a whole campaign. They are carried over
// at their existing weights ON PURPOSE - a migration that also rebalances is a
// migration you cannot verify - and the content pass that levels them up is
// TALENT_PLAN M4. Do not treat these numbers as the intended ceiling.
export const TALENTS = {
  // --- the six that were class property ---------------------------------------
  'origami-specialist': {
    name: 'Origami Specialist',
    blurb: 'Immune to paper cuts. Projectiles +2 damage; airplanes fold for 1 sheet.',
    // The richest entry here, and the template the rest should reach rather
    // than the outlier to trim. `foldsAirplanes` is the only unlock for the
    // Paper Airplane throwable at all (data/actions.js `needsTalent`) - which
    // is now a thing ANY class can buy into, and the sharpest single proof
    // that the axes came apart.
    effects: { paperDamageBonus: 2, paperAmmoDiscount: 1, paperCutImmune: true, foldsAirplanes: true },
  },
  smoker: {
    name: 'Smoker',
    blurb: 'A lighter, always. Ignite anything flammable. Smoke breaks steady the nerves in combat.',
    // Was the Middle Manager's, and granted `cigarette` - a seventh self-heal
    // hiding in a talent, retired with the other five (POWERS_PLAN M9). What
    // is left is the half that was always the interesting one: a light source
    // and an ignition, feeding the fire runtime the way paper-storm does.
    effects: { hasLighter: true },
  },
  'warehouse-soles': {
    name: 'Warehouse Soles',
    blurb: 'Eleven years of ignored wet-floor signs. You cannot slip. Ever.',
    // The ONE home for slipImmune among talents now. Corner-Office Traction
    // was a Manager track node granting exactly this, which is what made the
    // Mail Room's whole identity purchasable for a point; it is gone, and this
    // is what is left of it.
    effects: { slipImmune: true },
  },
  'esd-steel-toes': {
    name: 'ESD Steel-Toes',
    blurb: 'Electrostatic-discharge rated, steel toe box. Live water can\'t shock you, and the toe adds a Steel-Toe Kick to your repertoire.',
    effects: { shockImmune: true, grantsAction: 'kick' },
  },
  'incident-report': {
    name: 'Incident Report',
    blurb: 'You have walked through whatever the day shift spilled. Hazards on the floor hurt you less.',
    effects: { surfaceDamageResist: 1 },
  },
  'open-door-policy': {
    name: 'Open Door Policy',
    blurb: 'The door is always open. So is the req. There is always another applicant.',
    // Shipped with `effects: {}` on the HR class and did nothing from the day
    // it landed - the exact failure the effect-key lint now catches. It is
    // carried over empty rather than invented on the way past, because M1 is a
    // move and M4 is the content pass. Its blurb has promised a summon-scaling
    // effect since it landed and that is still the obvious payload; the summon
    // it would scale belongs to the Manager now (POWERS_PLAN M9), which is an
    // argument FOR it as a talent rather than against - anybody who takes the
    // summon can take the talent that deepens it.
    effects: {},
  },

  // --- the class-track nodes that were talents in disguise ---------------------
  // "Never provoke" and "cannot slip" have nothing to do with a class's VERB,
  // which is what a track is for, so they come here.
  //
  // Sharp Folds did NOT survive the move, and the effect-duplication lint is
  // why. As a Drone track node stacking a +1 onto the Origami Specialist's +2
  // it was a fine increment. As a standalone talent it is Origami Specialist
  // with a smaller number - the same effect, weaker, competing for one of the
  // two or three picks a character ever makes. That is the convergence this
  // plan exists to stop, arriving from the other direction: not two classes
  // being the same, but two talents. Its +1 is not reinstated anywhere; if the
  // Drone's paper build wants more depth it belongs in Origami Specialist's
  // own numbers (TALENT_PLAN M4), not in a second entry beside it.
  'frequent-flier': {
    name: 'Frequent Flier',
    blurb: 'Always at a conference, never in the building to be hit.',
    // Never triggers an opportunity attack.
    effects: { noProvoke: true },
  },
  'always-moving': {
    name: 'Always Moving',
    blurb: 'You are already on your way somewhere. The first step is always free.',
    // AP that ONLY movement may spend, drawn before real AP.
    effects: { freeMoveAp: 1 },
  },
  // --- sneaking (SNEAK_PLAN M6) ---------------------------------------------
  'quiet-shoes': {
    name: 'Quiet Shoes',
    blurb: 'Soft soles for hard floors. Nobody hears you coming, and you keep pace.',
    // No movement penalty while sneaking (main.js memberSpeed).
    effects: { sneakSpeed: true },
  },
  disgruntled: {
    name: 'Disgruntled',
    blurb: 'Years of performance reviews, repaid with interest, once.',
    // +40% on the opening strike of a fight you start from sneak - DOS2's
    // Guerrilla number (confirmed, SNEAK_PLAN inspirations).
    effects: { ambushDamage: 0.4 },
  },
  'forgettable-face': {
    name: 'Forgettable Face',
    blurb: 'Security has looked straight at you for years. It never sticks.',
    // Every coworker's watch cone narrows against your party (degrees off
    // the half-angle - main.js sneakSightOpts).
    effects: { coneShrink: 15 },
  },
  'corner-office-traction': {
    name: 'Corner-Office Traction',
    blurb: 'Better shoes than the job requires.',
    // Was the Manager node that duplicated Warehouse Soles outright. Kept as a
    // SEPARATE entry rather than deleted so the effect-duplication lint has a
    // real case to hold: two talents may not both grant `slipImmune`, so this
    // one has to become its own thing in M4 or go. It is deliberately the
    // thinnest entry in the file until then.
    effects: { moveCost: 0.9 },
  },
};

// Every effect key the engine actually honours. The lint checks TALENTS
// against this, because a key nobody reads is a talent that silently does
// nothing - which is not hypothetical: Open Door Policy shipped that way and
// nobody noticed for the life of the class system.
//
// TALENT_PLAN decision 8 opens this list to new kinds; this is the list, and
// adding to it means adding a consumer in the same PR.
export const TALENT_EFFECT_KEYS = [
  'paperDamageBonus',   // combat.js: bonus damage on anything with ammoCost
  'paperAmmoDiscount',  // stats.ammoCostOf
  'paperCutImmune',     // statuses.js / main.js: the paper-cut status
  'foldsAirplanes',     // data/actions.js `needsTalent` on paper-airplane
  'slipImmune',         // main.js: the slip roll on wet floors
  'shockImmune',        // main.js: electrified water
  'hasLighter',         // main.js: igniting a flammable surface
  'noProvoke',          // combat.js: opportunity attacks
  'freeMoveAp',         // combat.js: the movement-only AP pool
  'surfaceDamageResist',// main.js: flat reduction on surface damage per step
  'moveCost',           // stats.js: multiplies the AP a tile costs
  'grantsAction',       // stats.applyEffect: pushed onto sheet.actions
  'sneakSpeed',         // main.js memberSpeed: no sneak movement penalty
  'ambushDamage',       // combat.js ambushDmg: the sneak-opened first strike
  'coneShrink',         // main.js sneakSightOpts: narrower watch cones
  // statuses.js isImmune: the status ids this character simply cannot catch.
  // Honoured by the runtime and pinned by statuses.test.js since before this
  // list existed - it was only ever missing from the list, which made the
  // lint reject the migration the review recommends (rewriting
  // `paperCutImmune: true` as `statusImmune: ['bleed']`) with the false
  // message "nothing reads it" (Q104). Note for that migration: `applyEffect`
  // REPLACES non-numeric values on merge, so two talents granting this would
  // clobber rather than union - fine while the "no effect key has two homes"
  // lint holds, worth solving before it does not.
  'statusImmune',
];

// TEMPORARY (TALENT_PLAN M1 -> deleted by M2).
//
// The picker does not exist yet, so without this every existing character
// would silently lose the talent their class used to grant and have no way to
// get one back. This seeds them with exactly what they had, which is what
// makes M1 provably a MOVE rather than a rebalance - the equivalence test in
// tests/unit/stats.test.js pins it.
//
// It lives here rather than in data/classes.js on purpose. A `startTalent`
// field on a class entry would be the association coming straight back, one
// key at a time, and the lint that forbids it could not tell the difference.
// Here it is one table, named for what it is, with a deletion date attached:
// when the picker lands, a character CHOOSES their first talent and this goes.
//
// It is also why decision 11's budget bites immediately - a seeded talent is
// one of your two or three, spent before you chose anything - so M2 should
// make the seeded pick refundable the first time the picker opens.
export const STARTING_TALENT_BY_CLASS = {
  'office-drone': 'origami-specialist',
  'middle-manager': 'smoker',
  'mail-room': 'warehouse-soles',
  'it-support': 'esd-steel-toes',
  security: 'incident-report',
  'human-resources': 'open-door-policy',
};
