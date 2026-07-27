// Character sheet + progression. Pure logic - no PlayCanvas, no DOM.
import { CLASSES } from './data/classes.js';
import { COMPANIONS } from './data/companions.js';
import { ITEMS } from './data/items.js';
import { ACTIONS } from './data/actions.js';

// Thrown-weapon ammo: paper picked up from spills, spent on throws. There is
// no longer a carry limit - hoarding sheets is the whole fantasy, and the cap
// only ever produced "your pockets are full" refusals at a paper spill.
// Kept as a named export (Infinity) so every clamp site stays honest without
// each one growing a special case.
export const PAPER_CAP = Infinity;

// --- attributes & derived stats ---------------------------------------------
// The four office attributes are a character's single source of truth for its
// combat numbers; maxHp/maxAp are DERIVED from them (the same shape the grid
// uses - a logical value derived from raw state). A sheet carries its four
// `attr` scores plus an innate `base` floor; recomputeDerived folds them into
// the stored maxHp/maxAp that combat and the HUD read.
//
// All the progression knobs live in one block so balancing is a single edit
// (and the god panel can pin them). Attribute POINTS, the class track, and
// Savvy/Composure driving damage/deflect arrive in later milestones; this
// milestone only makes attributes the stat SOURCE, calibrated so every
// character's level-1 numbers are byte-for-byte today's.
export const PROGRESSION = {
  HP_PER_GRIT: 2,       // each point of Grit adds this much max HP
  AP_PER_HUSTLE: 4,     // every N points of Hustle adds +1 max AP (AP is precious)
  DMG_PER_SAVVY: 3,     // every N points of Savvy adds +1 attack damage
  COMP_PER_DEFLECT: 4,  // every N points of Composure softens a hit by 1
  // One point of EACH type every level - a flat, consistent cadence, not
  // "attributes fast, class points slow".
  ATTR_PER_LEVEL: 1,    // attribute points banked per level-up
  CP_PER_LEVEL: 1,      // class points banked per level-up (spent on the track, M3)
};

// --- the to-hit / defense model (HIT_PLAN.md) -------------------------------
// A DOS2-style percentage hit model: hitChance = BASE + accuracy(attacker) -
// dodge(defender) + mods, clamped. Accuracy derives from Savvy, dodge from
// Hustle - the same "attributes are the source, numbers are derived" shape the
// rest of the sheet uses. Enemies aren't sheets, so their innate accuracy/dodge
// ride through unitCombat(def).
//
// The model is LIVE (milestone 2): a base 85% hit, nudged ±5% per accuracy/
// dodge step, clamped to [35%, 95%] so a 1-in-20 whiff always remains and a
// stacked dodge is never unhittable. Milestone 1 shipped the same machinery
// with BASE/clamps pinned to 1.0 (nothing could miss) to prove the wiring
// behavior-neutral first; these are the constants that turn misses on.
export const HIT = {
  BASE: 0.85,            // hit chance before any modifiers
  ACC_PER_SAVVY: 3,      // every N Savvy = one accuracy step
  DODGE_PER_HUSTLE: 3,   // every N Hustle = one dodge step
  STEP: 0.05,            // one step = ±5% hit chance
  CLAMP_LO: 0.35,        // a stacked dodge build is never unhittable
  CLAMP_HI: 0.95,        // a universal 1-in-20 whiff, even fully buffed
  SURPRISE_ACC_BONUS: 0.15, // attacking a surprised target (applied by combat, M3)
  // Positional terms (TACTICS_PLAN). They ride the `mods` argument of
  // hitChance, assembled per attacker/defender pair in tactics.js - never
  // stored on a unit, because each depends on where the OTHER one is standing.
  COVER_DODGE: 0.20,     // a solid edge shielding the defender from a RANGED attacker
  FLANK_ACC_BONUS: 0.15, // a pincer: an ally on the exactly opposite side (MELEE)
  BACKSTAB_ACC_BONUS: 0.20, // striking from behind the defender's logical facing
  POSITION_CAP: 0.35,    // ceiling on the summed POSITIVE positional terms
};

// --- the movement economy (MOVEMENT_PLAN.md) --------------------------------
// Movement and actions share ONE pool (the DOS2 branch of the genre), so the
// price of a step is the price of part of a swing. At 1 AP per tile against
// 3 AP attacks in a 5-7 AP pool, walking around a body to reach someone's back
// cost a whole attack - which made the positional layer (TACTICS_PLAN: cover,
// flanking, backstab) a bad trade you would never take.
//
// Halving the rate is the baseline relief every character gets: that same walk
// now costs half an attack instead of a whole one. It deliberately does NOT
// try to make repositioning free - that is what the Pawn talent is for.
export const MOVE = {
  COST_PER_TILE: 0.5, // AP per tile of clean floor (was an implicit 1.0)
};

// --- reach (TACTICS_PLAN "Revision - reach is a DISTANCE") -------------------
// Melee reach is a DISTANCE between continuous positions, not tile adjacency.
// The engine has always placed bodies continuously - `GridActor.x` is the
// logical tile *derived* from the position via Math.round - and it already
// charges movement per unit of real distance, so a diagonal step costs
// 1.41x. Reach was the one system still measuring in grid cells, which let two
// units at opposite far corners of diagonally adjacent tiles (hypot(2,2) =
// 2.83 apart) trade swings while a deliberate walk-up stops at 0.85.
//
// DEFAULT is derived, not tasted: orthogonal tile centres are 1.0 apart and
// diagonal ones 1.41, so 1.5 keeps every attack that LOOKS adjacent legal while
// the 2.0-2.83 far-corner cases stop working. 1.0 would forbid diagonal attacks
// (reads as a bug); 2.0 would readmit most of the pathology.
//
// A weapon's `stats.reach` ADDS to DEFAULT and is positive-only: below 1.41 a
// weapon cannot hit a diagonal neighbour, which reads as broken however well
// the flavour justifies it. So reach is an upgrade axis and DEFAULT is the
// floor - a short weapon expresses itself through dmg/acc instead.
export const REACH = {
  DEFAULT: 1.5,
  // A shove is arms-length whatever you are holding: a broom must not become a
  // telekinesis upgrade. Its own constant, deliberately not weapon reach.
  SHOVE: 1.5,
};

// How far a thrown weapon carries, in tiles (Chebyshev). Combat's throw gate
// and main.js's out-of-combat targeting gate must agree on it, and they used to
// keep private copies held together by a `// must match combat.js` comment.
export const THROW_RANGE = 5;

export const ATTR_KEYS = ['grit', 'hustle', 'savvy', 'composure'];

// Equipment slots (EQUIPMENT_PLAN.md): a damage choice, a defense choice, a
// wildcard, and footwear (the floor is a hazard). Rendered as In Hand / Dress
// Code / Flair / On Foot. An item's `slot` (data/items.js) says where it goes;
// `stats` fold into the derived numbers.
export const EQUIP_SLOTS = ['weapon', 'outfit', 'trinket', 'shoes'];

// A clean {grit,hustle,savvy,composure} object from any partial source.
export function normalizeAttr(src = {}) {
  const attr = {};
  for (const k of ATTR_KEYS) attr[k] = Number.isFinite(src[k]) ? src[k] : 0;
  return attr;
}

// The innate floor that, added to the attribute contribution, reproduces a
// given maxHp/maxAp. Stored on the sheet so raising attributes always lands
// ABOVE today's numbers rather than redefining them.
function baseFrom(maxHp, maxAp, attr) {
  return {
    hp: maxHp - attr.grit * PROGRESSION.HP_PER_GRIT,
    ap: maxAp - Math.floor(attr.hustle / PROGRESSION.AP_PER_HUSTLE),
  };
}

// Fold attributes + base into the stored derived stats. Called after sheet
// creation, save-load backfill, and (later) every point spend. hp is clamped
// down to a shrunken max but never raised - healing is the caller's job.
export function recomputeDerived(sheet) {
  const { base } = sheet;
  // Equipped gear folds in here too: attrBonus lifts the attributes maxHp/maxAp
  // derive from, and flat maxHp/maxAp add on top (EQUIPMENT_PLAN.md). No gear =
  // no change, so the attribute math stays exactly as it was.
  const gear = equippedStats(sheet);
  const grit = (sheet.attr.grit || 0) + (gear.attrBonus.grit || 0);
  const hustle = (sheet.attr.hustle || 0) + (gear.attrBonus.hustle || 0);
  sheet.maxHp = base.hp + grit * PROGRESSION.HP_PER_GRIT + gear.maxHp;
  sheet.maxAp = base.ap + Math.floor(hustle / PROGRESSION.AP_PER_HUSTLE) + gear.maxAp;
  if (sheet.hp > sheet.maxHp) sheet.hp = sheet.maxHp;
  return sheet;
}

// Backfill attributes onto a sheet from an older save (pre-attributes). Prefer
// the character's own class/companion spread; the base is computed from the
// sheet's SAVED maxHp/maxAp so the loaded character keeps the exact stats it
// was saved with either way. Idempotent - a sheet that already has attributes
// is just recomputed.
export function ensureAttributes(sheet) {
  if (sheet.attr && sheet.base) return recomputeDerived(sheet);
  const block = (sheet.classId && CLASSES[sheet.classId])
    || (sheet.companionId && COMPANIONS[sheet.companionId]) || null;
  sheet.attr = normalizeAttr(block?.attr);
  const maxHp = sheet.maxHp ?? sheet.hp;
  const maxAp = sheet.maxAp ?? block?.ap ?? 0;
  sheet.base = baseFrom(maxHp, maxAp, sheet.attr);
  return recomputeDerived(sheet);
}

// The sheet is the persistent record of one character - the player or a
// companion. Combat mutates hp in place so wounds carry between fights.
// `block` is any class-shaped stat source (data/classes.js, or a companion
// entry from data/companions.js); `extra` stamps identity fields on top
// (classId for classes, companionId for companions).
export function createSheetFrom(block, extra = {}) {
  const actions = [...block.actions];
  // Talents can grant an extra combat action (Smoker's cigarette).
  if (block.talent?.effects?.grantsAction) actions.push(block.talent.effects.grantsAction);
  const attr = normalizeAttr(block.attr);
  const maxHp = block.maxHp ?? block.hp;
  const base = baseFrom(maxHp, block.ap, attr); // reproduces the block's maxHp/ap
  const sheet = {
    // The JOB, and then the PERSON. A block built from a class (fromClass -
    // companions, and enemies that are a class) carries `classId`, so the job
    // is always the class's own label, whatever the block calls itself: that is
    // what keeps a named archetype (the Security Guard) filed under the job he
    // does (Security) instead of under himself. Someone with no name of their
    // own inherits the class's, so both fields read the job - which is exactly
    // what the player gets too (a picked class has no `classId` on the block,
    // so `block.name` IS the class label).
    className: (block.classId && CLASSES[block.classId]?.name) || block.name,
    name: block.name, // display name - the class label, or the companion's own
    model: block.model,
    hp: maxHp,
    maxHp,
    maxAp: block.ap,
    attr, // the four office attributes - the source maxHp/maxAp derive from
    base, // innate floor; growth stacks on top (recomputeDerived)
    attrPoints: 0, // unspent attribute points, banked by gainXp, spent by hand
    classPoints: 0, // unspent class points, banked alongside (spent on the track)
    perks: [], // class-track node ids taken; each node's effect is baked in place
    level: 1,
    xp: 0,
    xpNext: 10,
    bonusDmg: block.bonusDmg,
    actions,
    talent: block.talent || null,
    paper: 0, // thrown-weapon ammo, picked up from paper spills
    statuses: {}, // active status effects (statuses.js) - gum, bleed, and the rest
    // Worn gear (EQUIPMENT_PLAN). A class can furnish a slot from creation via
    // `startGear` ({ slot: itemId }); everything else starts empty. Migrations
    // and companions reach this through their own paths and carry no startGear,
    // so only a freshly-picked class walks in wearing its signature piece.
    equipped: Object.fromEntries(EQUIP_SLOTS.map((s) => [s, block.startGear?.[s] || null])),
    inventory: [], // looted item ids (data/items.js) - persists across floors
    ...extra,
  };
  recomputeDerived(sheet); // no-op at creation (base was solved to match), but
  sheet.hp = sheet.maxHp;  // the invariant that keeps maxHp derived, not stored
  return sheet;
}

export function createSheet(classId) {
  const cls = CLASSES[classId];
  if (!cls) throw new Error(`Unknown class "${classId}"`);
  return createSheetFrom(cls, { classId });
}

// Enemy progression is a CURVE, not points (they aren't sheets). An enemy's
// native `level` is its tier; placed on a floor deeper than that tier it scales
// up. Mirrors the player's "level -> stats" shape but stays a pure function, so
// a scaled def flows through unitCombat/EnemyActor unchanged (PROGRESSION_PLAN.md).
export const ENEMY_SCALING = {
  HP_GROWTH: 0.15,  // +15% max HP per level above native
  XP_GROWTH: 0.15,  // +15% XP reward per level above native
  DMG_PER: 2,       // +1 to each attack's min/max per this many levels
  AP_PER: 3,        // +1 AP per this many levels
  // A deep floor also makes enemies a touch more ACCURATE (they've seen your
  // moves) - a small, capped nudge on top of any innate accuracy. Dodge is left
  // an identity trait of the seniority variants, not something depth grows.
  ACC_PER: 4,       // +1 accuracy step (HIT.STEP) per this many levels above native
  ACC_STEP_CAP: 2,  // scaling adds at most this many accuracy steps
};

// A scaled copy of an enemy def at `level` (clamped to >= its native level). At
// the native level the def is returned UNCHANGED (same reference), so base
// enemies on their home floor are byte-identical to before this system.
export function scaleEnemy(def, level) {
  const native = def.level || 1;
  const d = Math.max(0, (level ?? native) - native);
  if (d === 0) return def;
  const bump = Math.floor(d / ENEMY_SCALING.DMG_PER);
  const hp = Math.round((def.hp ?? def.maxHp) * (1 + ENEMY_SCALING.HP_GROWTH * d));
  const accSteps = Math.min(ENEMY_SCALING.ACC_STEP_CAP, Math.floor(d / ENEMY_SCALING.ACC_PER));
  const out = {
    ...def,
    level,
    ap: (def.ap || 0) + Math.floor(d / ENEMY_SCALING.AP_PER),
    xp: Math.round((def.xp || 0) * (1 + ENEMY_SCALING.XP_GROWTH * d)),
    attacks: (def.attacks || []).map((a) => ({ ...a, min: a.min + bump, max: a.max + bump })),
    // Innate accuracy plus the depth nudge; dodge (if any) rides along via spread.
    accuracy: (def.accuracy || 0) + accSteps * HIT.STEP,
  };
  // Scale whichever HP field the def carries - enemies spell it `hp`, a
  // class-backed unit `maxHp` (EnemyActor/unitCombat prefer maxHp), so keep both
  // consistent when present.
  if (def.hp != null) out.hp = hp;
  if (def.maxHp != null) out.maxHp = hp;
  if (def.hp == null && def.maxHp == null) out.hp = hp;
  return out;
}

// The level an enemy actually spawns at on a floor of the given depth: never
// below its native tier, so a high variant keeps its tier on a shallow floor
// and a base enemy scales up on a deep one.
export const effectiveLevel = (def, depth) => Math.max(def.level || 1, depth || 1);

// Normalize any unit archetype - an ENEMY_TYPES def or a class - into the
// combat stats the AI reads. The only field that differs by registry is max
// HP (enemies spell it `hp`, classes `maxHp`); everything else already lines
// up. This is the seam the class-as-shared-archetype direction widens: an
// AI-driven unit reads its stats through here whether it came from the enemy
// registry or the class registry (see SUMMON_PLAN.md).
export function unitCombat(def) {
  return {
    name: def.name,
    model: def.model,
    maxHp: def.maxHp ?? def.hp,
    ap: def.ap,
    attackAp: def.attackAp,
    attacks: def.attacks || [],
    xp: def.xp ?? 0,
    loot: def.loot || [],
    // Innate hit-chance stats for AI units (fractions, default 0). Enemies
    // aren't sheets, so this is the seam their accuracy/dodge ride through -
    // the same passthrough every other unit stat uses (HIT_PLAN.md).
    accuracy: def.accuracy || 0,
    dodge: def.dodge || 0,
    // Melee reach. An AI unit wears no weapon, so its reach is stated on the
    // def outright rather than derived from equipment - a coworker with a long
    // handled thing sets `reach` and everyone else inherits the floor.
    reach: def.reach ?? REACH.DEFAULT,
  };
}

// The summed bonuses of everything the sheet has equipped (EQUIPMENT_PLAN.md).
// One read the derivations fold in, so a weapon's damage, an outfit's soak, a
// trinket's attribute bump all reach the numbers the same way. Empty for an
// unequipped sheet.
export function equippedStats(sheet) {
  const out = { dmg: 0, soak: 0, maxHp: 0, maxAp: 0, acc: 0, dodge: 0, reach: 0, slipProof: false, moveCost: 1, attrBonus: {} };
  const eq = sheet.equipped || {};
  for (const slot of EQUIP_SLOTS) {
    const st = ITEMS[eq[slot]]?.stats;
    if (!st) continue;
    out.reach += st.reach || 0; // a long weapon extends REACH.DEFAULT (positive-only)
    out.dmg += st.dmg || 0;
    out.soak += st.soak || 0;
    out.maxHp += st.maxHp || 0;
    out.maxAp += st.maxAp || 0;
    out.acc += st.acc || 0;
    out.dodge += st.dodge || 0;
    out.slipProof = out.slipProof || !!st.slipProof; // footwear traction
    // Footwear movement efficiency MULTIPLIES, so it composes with surfaces and
    // statuses instead of fighting them - good boots partly offset a spill
    // rather than ignoring it (MOVEMENT_PLAN #6).
    if (st.moveCost) out.moveCost *= st.moveCost;
    for (const k in st.attrBonus || {}) out.attrBonus[k] = (out.attrBonus[k] || 0) + st.attrBonus[k];
  }
  return out;
}

// The equipped weapon's on-hit proc (EQUIPMENT_PLAN #8), or null. A proc is
// { applies: '<status>', chance, appliesLog? } - combat rolls it when you land
// the weapon's own swing.
// A sheet's footwear movement multiplier (1 = ordinary shoes). Multiplied into
// the per-tile cost, so <1 is faster and >1 is slower.
export function moveCostOf(sheet) {
  return equippedStats(sheet).moveCost;
}

export function weaponProc(sheet) {
  return ITEMS[sheet?.equipped?.weapon]?.proc || null;
}

// The basic weapon-attack action for a sheet (EQUIPMENT_PLAN decision #7):
// the equipped weapon names its own swing; bare hands fall back to 'punch'.
// Always returns an action id, so everyone has a basic attack - the combat bar
// and the hotbar splice it in beside the class powers.
export function equippedAction(sheet) {
  return ITEMS[sheet?.equipped?.weapon]?.attack || 'punch';
}

// A sheet's attributes with equipped `attrBonus` folded in - the "effective"
// spread every attribute-derived number reads, so a +1 Savvy mug lifts damage
// AND accuracy for free. Falls through to the raw attr when no gear bends it.
export function effectiveAttr(sheet) {
  const gear = equippedStats(sheet).attrBonus;
  const a = sheet.attr || {};
  if (!Object.keys(gear).length) return a;
  const out = { ...a };
  for (const k in gear) out[k] = (out[k] || 0) + gear[k];
  return out;
}

// Total damage bonus: Savvy (the office damage stat) + the equipped weapon's
// `dmg` + any flat class bump. `bonusDmg` is the class/legacy flat bump (0 for
// every current class - damage now grows by spending points into Savvy). The
// old "best carried stapler counts" rule is gone: a weapon only counts in hand.
export function damageBonus(sheet) {
  const savvy = Math.floor((effectiveAttr(sheet).savvy || 0) / PROGRESSION.DMG_PER_SAVVY);
  return (sheet.bonusDmg || 0) + savvy + equippedStats(sheet).dmg;
}

// A sheet's melee reach in tile-units: the floor every character has, plus
// whatever the equipped weapon extends it by. The one number the reach test
// consumes for a party member; AI units read `def.reach` (see unitCombat).
export function reachOf(sheet) {
  return REACH.DEFAULT + (equippedStats(sheet).reach || 0);
}

// What one throw actually costs THIS character in paper. The `paperAmmoDiscount`
// talent (the Office Drone's Origami Specialist) shaves a sheet off anything
// that costs more than one, never below one - a talent that made a throw free
// would make ammo meaningless.
//
// This lives here, with the other sheet-derived numbers, because it is read by
// three layers that must agree: combat's affordability gate, main.js's
// out-of-combat targeting gate, and the hotbar's enabled/disabled paint. When
// the hotbar carried its own copy that ignored the discount, a Drone holding
// exactly one sheet of paper watched the airplane grey out on a throw the
// other two layers would both have allowed.
export function ammoCostOf(sheet, actionId) {
  const base = ACTIONS[actionId]?.ammoCost || 0;
  if (base <= 1) return base;
  return Math.max(1, base - (sheet?.talent?.effects?.paperAmmoDiscount || 0));
}

// Composure buys flat damage mitigation - a small amount shaved off every
// incoming hit (one point of damage always lands, so it never fully negates).
// Outfit/trinket `soak` stacks on top.
export function deflect(sheet) {
  return Math.floor((effectiveAttr(sheet).composure || 0) / PROGRESSION.COMP_PER_DEFLECT)
    + equippedStats(sheet).soak;
}

// Composure also shakes off applied statuses faster - it shortens the sticky
// ones (a combat gum flick) by this many turns. Poise on a different axis.
export function statusResist(sheet) {
  return Math.floor((effectiveAttr(sheet).composure || 0) / PROGRESSION.COMP_PER_DEFLECT);
}

// A sheet's accuracy: how much its Savvy (+ gear acc) adds to the hit chance,
// as a fraction (0.05 per step). Layered onto the attacker side of hitChance.
export function accuracy(sheet) {
  return Math.floor((effectiveAttr(sheet).savvy || 0) / HIT.ACC_PER_SAVVY) * HIT.STEP
    + equippedStats(sheet).acc;
}

// A sheet's dodge: how much its Hustle (+ gear dodge) subtracts from an
// attacker's hit chance, as a fraction. Hustle already buys AP and initiative;
// this is its defensive second job (HIT_PLAN #2).
export function dodge(sheet) {
  return Math.floor((effectiveAttr(sheet).hustle || 0) / HIT.DODGE_PER_HUSTLE) * HIT.STEP
    + equippedStats(sheet).dodge;
}

// The chance an attack lands: base + attacker accuracy - defender dodge + any
// flat modifiers (surprise, and later status/equipment terms), clamped to the
// HIT bounds. `acc`/`dge`/`mods` are fractions (0.05 = 5%). A pure function of
// its inputs and the HIT constants - combat reads it, the god panel can pin the
// constants, tests assert the math.
export function hitChance(acc, dge, mods = 0) {
  const raw = HIT.BASE + (acc || 0) - (dge || 0) + (mods || 0);
  return Math.min(HIT.CLAMP_HI, Math.max(HIT.CLAMP_LO, raw));
}

// Roll a hit against a chance in [0, 1]. `rng` returns a float in [0, 1) - the
// same injectable-rng shape initiative.js uses, so combat can feed a seeded or
// pinned source and tests stay deterministic. A hit is rng() < chance, so
// chance 1 always hits and chance 0 never does.
export function rollHit(chance, rng = Math.random) {
  return rng() < chance;
}

// Returns true when the character levelled up ("got promoted"). Level-ups fully
// heal and BANK attribute points; the player spends them on the level-up screen
// (companions included - nothing auto-allocates). Damage no longer rises
// automatically - it comes from spending those points into Savvy.
export function gainXp(sheet, amount) {
  sheet.xp += amount;
  let promoted = false;
  while (sheet.xp >= sheet.xpNext) {
    sheet.xp -= sheet.xpNext;
    sheet.xpNext = Math.round(sheet.xpNext * 1.5);
    sheet.level += 1;
    sheet.attrPoints = (sheet.attrPoints || 0) + PROGRESSION.ATTR_PER_LEVEL;
    sheet.classPoints = (sheet.classPoints || 0) + PROGRESSION.CP_PER_LEVEL;
    sheet.hp = sheet.maxHp;
    promoted = true;
  }
  return promoted;
}

// How many points this character has banked and unspent, across BOTH pools -
// the number every surface that nudges you toward the character sheet shows.
//
// It lives here, with the pools it adds up, because five places used to derive
// it independently: the HUD card, the party bar, the level-up screen, the
// character sheet and main.js's own helper. A third pool - or a rename - meant
// finding all five, and missing one left that surface quietly under-reporting
// points the others were advertising.
export const pendingPoints = (sheet) => (sheet?.attrPoints || 0) + (sheet?.classPoints || 0);

// Spend one banked attribute point raising `attr` by 1, then re-derive. Returns
// false (and changes nothing) if the pool is empty or the attribute unknown.
export function spendAttrPoint(sheet, attr) {
  if (!ATTR_KEYS.includes(attr) || (sheet.attrPoints || 0) <= 0) return false;
  const maxHpBefore = sheet.maxHp;
  sheet.attr[attr] += 1;
  sheet.attrPoints -= 1;
  recomputeDerived(sheet);
  creditNewHp(sheet, maxHpBefore);
  return true;
}

// Investing in max HP (raising Grit) credits the fresh capacity to current HP -
// the new muscle arrives undamaged. Only the DELTA is added (a wound fraction
// is preserved, not free-healed), and only on a spend: this deliberately lives
// OUTSIDE recomputeDerived, which also runs on save-load and creation, where
// healing would be wrong.
function creditNewHp(sheet, maxHpBefore) {
  if (sheet.maxHp > maxHpBefore) {
    sheet.hp = Math.min(sheet.maxHp, sheet.hp + (sheet.maxHp - maxHpBefore));
  }
}

// --- the class ability track (class points) ---------------------------------
// A track node is data on a class/companion (`track: [{ id, name, cost,
// requires?, effect }]`); its `effect` reuses the shapes the engine already
// understands, so spending a class point BAKES the effect into the sheet in
// place and every existing read site picks it up - no combat/stepping changes:
//   grantsAction: '<id>'      -> pushed onto sheet.actions (hotbar/combat render it)
//   attrBonus: { <attr>: n }  -> added to sheet.attr (recompute/damage/deflect read it)
//   talent: { <effect>: v }   -> merged into sheet.talent.effects (talentFxOf et al.)
// The perk id is recorded so the screen can grey a taken node; the baked state
// is what persists, so nothing is re-applied on load (no double-apply).
// (`upgradeAction` - patching an action's numbers - is deferred; it needs a
// combat-side action accessor. See PROGRESSION_PLAN.md.)
const TRACK_NODES = {};
for (const reg of [CLASSES, COMPANIONS]) {
  for (const def of Object.values(reg)) {
    for (const node of def.track || []) TRACK_NODES[node.id] = node;
  }
}

export const trackNode = (id) => TRACK_NODES[id] || null;

// The track the sheet's own class/companion offers.
export function classTrack(sheet) {
  const def = (sheet.classId && CLASSES[sheet.classId])
    || (sheet.companionId && COMPANIONS[sheet.companionId]) || null;
  return def?.track || [];
}

// A node is available when it isn't already taken, its prereqs are met, and the
// pool covers its cost.
export function nodeAvailable(sheet, node) {
  if (!node) return false;
  const perks = sheet.perks || [];
  if (perks.includes(node.id)) return false;
  if ((sheet.classPoints || 0) < (node.cost || 1)) return false;
  if (node.requires && !node.requires.every((r) => perks.includes(r))) return false;
  return true;
}

function bakeNodeEffect(sheet, effect = {}) {
  if (effect.grantsAction && !sheet.actions.includes(effect.grantsAction)) {
    sheet.actions.push(effect.grantsAction);
  }
  if (effect.attrBonus) {
    for (const k of ATTR_KEYS) sheet.attr[k] += effect.attrBonus[k] || 0;
  }
  if (effect.talent) {
    const base = sheet.talent?.effects || {};
    const merged = { ...base };
    for (const [k, v] of Object.entries(effect.talent)) {
      merged[k] = typeof v === 'number' ? (merged[k] || 0) + v : v;
    }
    sheet.talent = { name: sheet.talent?.name || 'Training', blurb: sheet.talent?.blurb || '', effects: merged };
  }
}

// Spend class points on a track node: validate, bake its effect, record the
// perk, re-derive. Returns false (changing nothing) if it isn't available.
export function spendClassPoint(sheet, nodeId) {
  const node = TRACK_NODES[nodeId];
  if (!nodeAvailable(sheet, node)) return false;
  const maxHpBefore = sheet.maxHp;
  bakeNodeEffect(sheet, node.effect);
  (sheet.perks = sheet.perks || []).push(nodeId);
  sheet.classPoints -= (node.cost || 1);
  recomputeDerived(sheet);
  creditNewHp(sheet, maxHpBefore); // a Grit node's extra HP arrives undamaged
  return true;
}

// --- equipment (EQUIPMENT_PLAN.md) ------------------------------------------
// Equip the inventory item at index `i` into its slot: the incumbent (if any)
// returns to the bag, the item leaves the bag for the slot, derived numbers
// refresh, and any fresh max-HP capacity is credited (a Grit/maxHp piece
// arrives undamaged). Returns false, changing nothing, for a non-equippable
// item or a bad index.
export function equipItem(sheet, i) {
  const id = sheet.inventory?.[i];
  const def = ITEMS[id];
  if (!def || !EQUIP_SLOTS.includes(def.slot)) return false;
  sheet.equipped = sheet.equipped || Object.fromEntries(EQUIP_SLOTS.map((s) => [s, null]));
  const maxHpBefore = sheet.maxHp;
  const prev = sheet.equipped[def.slot];
  sheet.inventory.splice(i, 1);          // out of the bag...
  sheet.equipped[def.slot] = id;         // ...into the slot
  if (prev) sheet.inventory.push(prev);  // the displaced piece returns to the bag
  recomputeDerived(sheet);
  creditNewHp(sheet, maxHpBefore);
  return true;
}

// Unequip the item in `slot` back to the bag. Refused (returns false, nothing
// moves) when the bag is at `invCap`, so gear never vanishes. Recompute clamps
// hp down to any max the removal shrank.
export function unequipItem(sheet, slot, invCap = Infinity) {
  const id = sheet.equipped?.[slot];
  if (!id) return false;
  if ((sheet.inventory?.length || 0) >= invCap) return false; // no room - politely refuse
  sheet.equipped[slot] = null;
  (sheet.inventory = sheet.inventory || []).push(id);
  recomputeDerived(sheet);
  return true;
}

export function applyDamage(sheet, amount) {
  sheet.hp = Math.max(0, sheet.hp - amount);
  return sheet.hp <= 0;
}
