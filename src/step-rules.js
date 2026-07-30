// What the floor does to whoever stands on it - pure logic, no PlayCanvas, no
// DOM, no closure. THE module for "this character just entered this tile":
// what the surface is, how much it hurts them, whether the wad sticks, whether
// their feet go out from under them, and how fast they walk once it has.
//
// It exists because those rules were written three times over - main.js for
// party members and summons, combat.js for AI units in a fight, actors.js for
// wanderers ambling around out of one - and three copies of a rule drift. They
// already had: the gum slow was applied by SCALING speed in place on one side
// and by DERIVING it from a captured base on the other, so a wanderer who got
// gummed before a fight started wore the slow twice.
//
// The three callers keep what genuinely differs - the narration (the lines are
// written in the player's voice, and a temp is not the player), the FX, whether
// gum ever wears off (a member's ticks down, a coworker's is for keeps) - and
// share the DECISIONS.
//
// The floor arrives as a plain fact sheet rather than a grid:
//   { burning, electrified, surfaceId }
// which is what makes every rule below testable with an object literal.

import { SURFACES, FIRE, ELECTRIFIED } from './data/surfaces.js';

// What the tile does on entry, consulting the dynamic layer (fire) before the
// static one. Fire outranks electrification outranks the painted surface: a
// burning puddle is a fire, not live water.
export function surfaceEffect(floor = {}) {
  if (floor.burning) return FIRE.onEnter;
  if (floor.electrified) return ELECTRIFIED.onEnter;
  return SURFACES[floor.surfaceId]?.onEnter || null;
}

// Surface damage before anyone's talents. ENEMY decisions (pathing, wander
// avoidance) run on this: what hurts a coworker has nothing to do with the
// player's shoes, and a talent-aware hazard model would have the AI fearing
// exactly the tiles the PLAYER is immune to.
export function rawSurfaceDamage(floor = {}) {
  return surfaceEffect(floor)?.amount || 0;
}

// What a step actually costs a character, after their talents (ESD Steel-Toes,
// Origami Specialist). `talents` is a sheet's `talent.effects` object, or {}
// for anyone who has none - an AI unit wears nothing, so it takes the raw
// number and this returns it unchanged.
//
// Both immunities are deliberately voided by fire: steel toes are about
// current and paper immunity is about edges, and neither one is about being on
// fire. A burning puddle hurts everybody.
export function effectiveSurfaceDamage(floor = {}, talents = {}) {
  const fx = surfaceEffect(floor);
  if (!fx || !fx.amount) return 0;
  const t = talents || {};
  if (t.shockImmune && floor.electrified && !floor.burning) return 0;
  if (t.paperCutImmune && floor.surfaceId === 'paper' && !floor.burning) return 0;
  // surfaceDamageResist is a RESERVED talent effect - the handler is live but
  // no class/companion sets it yet (a future flat surface-armor perk plugs in
  // here with zero systems change). See ARCHITECTURE.md talents.
  return Math.max(0, fx.amount - (t.surfaceDamageResist || 0));
}

// Wet floors are SLIPPERY - unless electrified or burning, which are different
// problems. Chance per tile entered. Talent-free by design: enemies consult it
// too, and the tread that saves you is checked at the FOOT (see `slips`), not
// in the floor.
export function slipChance(floor = {}) {
  if (floor.electrified || floor.burning) return 0;
  return SURFACES[floor.surfaceId]?.slippery || 0;
}

// Does this step actually put them on the floor? One predicate for all three
// callers, with the roll passed IN rather than read from Math.random - which is
// what lets combat run it through its seeded `rng` (a slip ends a whole turn,
// so an unseeded one is exactly the kind of thing that makes a resolution test
// flaky for reasons unrelated to what it asserts).
//
// `roll` is a FUNCTION, not a number, and that is the whole subtlety. The
// callers short-circuit on immunity - `!slipProof && rng() < chance` - so a
// slip-proof character never drew at all. Taking the roll as a value would
// evaluate it eagerly at every call site, burning one draw per tile stepped
// out of combat's SEEDED stream on exactly the characters that cannot slip;
// every later roll in that fight would shift, and a seeded run would stop
// reproducing - which is the one thing the seeding exists for.
//
// `slipProof` covers gum's genuine upside and any slip-proof footwear;
// `slipImmune` is the talent. A gummed shoe grips: that is the trade the wad
// offers for the slow.
export function slips({ chance = 0, roll = () => 1, slipProof = false, slipImmune = false } = {}) {
  if (slipImmune || slipProof) return false;
  return chance > 0 && roll() < chance;
}

// Is there a wad here to pick up? The tile being SPENT by the pickup (the wad
// is on their shoe now) is the caller's business - it touches the grid and the
// scene - but whether there was one to collect is a rule.
export function hasGum(floor = {}) {
  return floor.surfaceId === 'gum';
}

// Walk speed under a status load. DERIVED from a captured base rather than
// scaled in place, and this is the whole reason the function exists: scaling
// applied the slow twice to anyone gummed before a fight, because combat
// captures `baseSpeed` lazily on first sync and so captured an already-slowed
// speed and multiplied the status in on top of it. Deriving is idempotent, so
// combat and the wander brain can run in any order and agree.
export function speedUnderStatus(baseSpeed, statusEffects = {}) {
  return baseSpeed * (statusEffects.speedMult ?? 1);
}

// What a tile costs a router to cross. Dangerous and uncomfortable surfaces
// cost extra so characters route around them unless told otherwise or there is
// no other way. Talents discount only the PLAYER's model - pass `{}` for the
// enemy one, which is what keeps your shoes out of their fears.
//
// Fire is priced before electrification for the same reason damage is: a
// burning pool is a fire. Electrification is the one term a talent zeroes,
// because ESD soles make live water ordinary water to walk through.
export function surfacePathCost(floor = {}, talents = {}) {
  if (floor.burning) return FIRE.pathCost;
  if (floor.electrified) return talents?.shockImmune ? 1 : ELECTRIFIED.pathCost;
  return SURFACES[floor.surfaceId]?.pathCost || 0;
}
