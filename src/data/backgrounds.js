// Why you are still here: the axis that is not your job. Pure data.
//
// A background is the class track's node shape arriving at creation instead of
// at level 3 - the same `effect` vocabulary, baked the same way at spend time
// (stats.js applyEffect). So the whole registry is content, and no system knows
// backgrounds exist: `attrBonus` lands in `attr`, `talent` merges into
// `talent.effects`, and every existing read site honours it already.
//
// `attrBonus` MUST SUM TO ZERO. A background is a SWAP - you are better at one
// thing because you were worse at another - not a bonus. Eight free stat lifts
// at creation would blow straight through the curve-neutrality rule startGear
// was introduced under (data/classes.js), and would make exactly one background
// correct for every class. A swap is a real choice with a real cost and needs
// no rebalance. There is a lint.
//
// `gear` fills ONE equipment slot, and only a slot the class left EMPTY. The
// class's own startGear is its signature piece - the Drone's stress ball is
// characterisation, not a stat - so a background quietly replacing it would
// delete the more specific statement about who you are. Filling an empty slot
// adds; overwriting a full one subtracts.
export const BACKGROUNDS = {
  'reorg-survivor': {
    name: 'Reorg Survivor',
    blurb: 'Four restructures. Same desk. Different logo on the mug each time.',
    line: 'Hustles more than most, and minds it less.',
    effect: { attrBonus: { hustle: 1, composure: -1 } },
  },
  'union-adjacent': {
    name: 'Union Adjacent',
    blurb: 'Never joined. Read the whole thing twice.',
    line: 'Hard to rattle, slower to swing.',
    effect: { attrBonus: { composure: 1, savvy: -1 } },
  },
  'night-shift': {
    name: 'Night Shift',
    blurb: 'Knows which lights are on a timer.',
    line: 'Tough, and unhurried about it.',
    effect: { attrBonus: { grit: 1, hustle: -1 } },
  },
  'temp-to-perm': {
    name: 'Temp To Perm',
    blurb: 'The perm part is still pending. It has been six years.',
    line: 'Quick on their feet. Thin-skinned about it.',
    effect: { attrBonus: { hustle: 1, grit: -1 } },
  },
  'former-smoker': {
    name: 'Former Smoker',
    blurb: 'Quit. Kept the lighter. You never know.',
    line: 'Still carries fire.',
    // `hasLighter` is read by main.js's ignite affordance, so this background
    // hands out a real verb - lighting a paper drift without carrying matches.
    effect: { attrBonus: { savvy: 1, grit: -1 }, talent: { hasLighter: true } },
  },
  'mailroom-alum': {
    name: 'Mailroom Alum',
    blurb: 'Started downstairs. Everyone forgets that but you.',
    line: 'Folds a sharper airplane than the job requires.',
    effect: { attrBonus: { savvy: 1, composure: -1 }, talent: { paperDamageBonus: 1 } },
  },
  'wellness-committee': {
    name: 'Wellness Committee',
    blurb: 'Volunteered. Once. It is a life sentence.',
    line: 'Sturdy shoes, softer edges.',
    effect: { attrBonus: { grit: 1, savvy: -1 } },
    gear: { shoes: 'warehouse-boots' },
  },
  'expensed-it': {
    name: 'Expensed It',
    blurb: 'Filed it under "supplies". Nobody checked.',
    line: 'Came in with something they should not have.',
    effect: { attrBonus: { composure: 1, hustle: -1 } },
    // Also the Office Drone's own startGear, and deliberately so: it is the
    // collision the empty-slot rule exists to resolve. An Expensed It Drone
    // keeps the class's stress ball and this adds nothing; any other class
    // arrives carrying one.
    gear: { trinket: 'stress-ball' },
  },
};
