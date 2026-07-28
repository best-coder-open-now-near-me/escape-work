// The wardrobe: which rigs a player may wear, and the dials they may turn.
// Pure data - imports nothing, per the layering rule.
//
// Every .glb in assets/characters/ is here, including the six that only enemies
// and companions wear today. A rig is a BODY, not a role: wearing the intern's
// rig does not make you an intern, it makes you someone who looks like that.
// (The class registry already says to read the entry rather than the filename.)
//
// TINTS is a CURATED palette rather than a colour picker, for two reasons. A
// free RGB wheel produces neon-green employees, and a screenshot of one reads
// as a rendering bug rather than as a character. And the portrait cache keys on
// the tint triple (portraits.js), so an unbounded colour space is an unbounded
// cache.
export const RIGS = {
  worker: { name: 'Standard Issue', blurb: 'The one they hand you.' },
  intern: { name: 'Fresh', blurb: 'Still owns a lanyard from orientation.' },
  veteran: { name: 'Weathered', blurb: 'Has outlasted four reorgs and one fire.' },
  hr: { name: 'Pressed', blurb: 'Ironed. Deliberately.' },
  midmanager: { name: 'Business Casual', blurb: 'The quarter-zip is load-bearing.' },
  seniormanager: { name: 'Escalated', blurb: 'Dresses like the next role up.' },
  manager: { name: 'Managerial', blurb: 'Owns a blazer for the office.' },
  itsupport: { name: 'Utility', blurb: 'Pockets for things nobody else carries.' },
  security: { name: 'Uniformed', blurb: 'Comes with a radio you cannot use.' },
  hrrep: { name: 'Compliant', blurb: 'Nothing about it violates the handbook.' },
  regional: { name: 'Visiting', blurb: 'Flew in. Will fly out. Judged everything.' },
  executive: { name: 'Upstairs', blurb: 'You should not have this. Enjoy it.' },
};

// Multiplied against the rig's baked diffuse (models.js tintMaterials), so
// every swatch is <= 1 in each channel: these darken and shift, they never
// brighten. Named for what an office actually contains.
export const TINTS = [
  { id: 'as-issued', name: 'As Issued', rgb: [1.00, 1.00, 1.00] },
  { id: 'charcoal', name: 'Charcoal', rgb: [0.62, 0.63, 0.68] },
  { id: 'navy', name: 'Navy', rgb: [0.58, 0.66, 0.86] },
  { id: 'oatmeal', name: 'Oatmeal', rgb: [0.94, 0.90, 0.80] },
  { id: 'sage', name: 'Sage', rgb: [0.76, 0.86, 0.74] },
  { id: 'rust', name: 'Rust', rgb: [0.88, 0.70, 0.58] },
  { id: 'plum', name: 'Plum', rgb: [0.78, 0.68, 0.82] },
  { id: 'teal', name: 'Regrettable Teal', rgb: [0.62, 0.86, 0.86] },
];

// The two dials, and why they are only two. models.js documents the cautions in
// full: height belongs in `legs`, because arms and head hang off the torso and a
// large torso stretch runs along an arm's length once a clip rotates it down -
// and 1.9 legs is the value that was checked against the walk cycle in-game.
//
// These ranges are the span the SHIPPED entries already occupy across classes,
// companions and enemies, widened only far enough to include the un-nudged
// default. `head` and `arms` stay authored-only: they are counter-scales that
// CANCEL the torso stretch, not silhouette dials, and exposing them would let a
// player undo the correction rather than express anything.
export const BUILD_RANGE = {
  legs: { min: 1.55, max: 2.05, step: 0.01, label: 'Height' },
  torso: { min: 1.00, max: 1.40, step: 0.01, label: 'Heft' },
};

// Clamp a build to the dials' ranges. A saved value from an older palette, a
// hand-edited save, or a future re-tune of the ranges all arrive here rather
// than reaching the rig - `applyCharacterProportions` has no opinion about what
// is sane, and a torso of 40 is a genuinely broken-looking character.
export function clampBuild(build) {
  if (!build) return null;
  const out = {};
  for (const [key, range] of Object.entries(BUILD_RANGE)) {
    if (!Number.isFinite(build[key])) continue;
    out[key] = Math.min(range.max, Math.max(range.min, build[key]));
  }
  return Object.keys(out).length ? out : null;
}
