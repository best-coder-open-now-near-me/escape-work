// Tactical positioning (TACTICS_PLAN.md). Milestone 1 is the to-hit
// assembler: the one place the terms are summed, read by both the real roll
// and the hover preview. These tests pin the arithmetic that four hand-rolled
// copies in combat.js used to each own.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toHitTerms, cheb, threatens, provokedBy, hasCover, isFlanked, isBackstab, positionMods,
  dist, reachOpen, inReach,
} from '../../src/tactics.js';
import { HIT, REACH, hitChance } from '../../src/stats.js';

test('an empty pair is all zeroes - no accidental baseline', () => {
  assert.deepEqual(toHitTerms(), { acc: 0, dodge: 0, mods: 0 });
  assert.deepEqual(toHitTerms({}), { acc: 0, dodge: 0, mods: 0 });
});

test('accuracy and dodge pass through to their own terms, unmixed', () => {
  const t = toHitTerms({ accuracy: 0.2, dodge: 0.15 });
  assert.equal(t.acc, 0.2);
  assert.equal(t.dodge, 0.15);
  assert.equal(t.mods, 0); // nothing positional yet (milestones 3-5)
});

test('a surprised defender hands the attacker exactly SURPRISE_ACC_BONUS', () => {
  const calm = toHitTerms({ accuracy: 0.1 });
  const caught = toHitTerms({ accuracy: 0.1, surprised: true });
  assert.equal(caught.acc - calm.acc, HIT.SURPRISE_ACC_BONUS);
  assert.equal(caught.dodge, calm.dodge); // surprise is an accuracy term, not a dodge one
});

test('status accMod lands on the attacker, dodgeMod on the defender', () => {
  // A blinded attacker (negative accMod) aims worse; it must never be
  // mistaken for the defender being harder to hit - they clamp differently.
  const t = toHitTerms({ accuracy: 0.2, dodge: 0.1, accMod: -0.3, dodgeMod: 0.05 });
  assert.ok(Math.abs(t.acc - (0.2 - 0.3)) < 1e-9);
  assert.ok(Math.abs(t.dodge - (0.1 + 0.05)) < 1e-9);
});

test('every term composes in one pass', () => {
  const t = toHitTerms({
    accuracy: 0.10, dodge: 0.05, surprised: true, accMod: -0.02, dodgeMod: 0.03, positional: 0.2,
  });
  assert.ok(Math.abs(t.acc - (0.10 + HIT.SURPRISE_ACC_BONUS - 0.02)) < 1e-9);
  assert.ok(Math.abs(t.dodge - (0.05 + 0.03)) < 1e-9);
  assert.equal(t.mods, 0.2);
});

test('the positional term passes through untouched, both signs', () => {
  // Cover is negative (defender-favouring), flank/backstab positive. The
  // assembler must not clamp or reinterpret either - hitChance owns clamping.
  assert.equal(toHitTerms({ positional: -0.2 }).mods, -0.2);
  assert.equal(toHitTerms({ positional: 0.35 }).mods, 0.35);
});

test('the terms feed hitChance in the shape it consumes', () => {
  // The contract this milestone exists to guarantee: one assembler, and its
  // output drops straight into the roll AND the preview with no reshaping.
  const t = toHitTerms({ accuracy: 0.1, dodge: 0.05, surprised: true });
  const chance = hitChance(t.acc, t.dodge, t.mods);
  assert.equal(chance, hitChance(0.1 + HIT.SURPRISE_ACC_BONUS, 0.05, 0));
  assert.ok(chance > 0 && chance <= HIT.CLAMP_HI);
});

test('a defender-favouring positional term can only lower the chance', () => {
  const open = toHitTerms({ accuracy: 0.1, dodge: 0.05 });
  const covered = toHitTerms({ accuracy: 0.1, dodge: 0.05, positional: -0.2 });
  assert.ok(hitChance(covered.acc, covered.dodge, covered.mods)
    <= hitChance(open.acc, open.dodge, open.mods));
});

// --- threat & opportunity attacks (TACTICS_PLAN M2) -------------------------

test('cheb treats a diagonal as one step, like the rest of the grid', () => {
  assert.equal(cheb(0, 0, 0, 0), 0);
  assert.equal(cheb(0, 0, 1, 1), 1);  // diagonal is adjacent
  assert.equal(cheb(0, 0, 2, 0), 2);
  assert.equal(cheb(3, 3, 1, 2), 2);  // max of the two axes, not the sum
});

// --- reach as a distance (TACTICS_PLAN revision, M1) ------------------------

// A symmetric solid edge between two tiles - what grid.edgeOpen reports for a
// partition, which blocks whichever way you cross it.
const wallBetween = (ax, az, bx, bz) => (x, z, nx, nz) =>
  !((x === ax && z === az && nx === bx && nz === bz)
    || (x === bx && z === bz && nx === ax && nz === az));

test('dist is true Euclidean distance, not a grid step', () => {
  assert.equal(dist(0, 0, 3, 4), 5);
  assert.ok(Math.abs(dist(0, 0, 1, 1) - Math.SQRT2) < 1e-9); // a diagonal is 1.41, not 1
  assert.equal(dist(2, 2, 2, 2), 0);
});

test('REACH.DEFAULT keeps every attack that LOOKS adjacent and drops the rest', () => {
  const r = REACH.DEFAULT;
  assert.equal(inReach(0, 0, 1, 0, r), true);        // orthogonal centres: 1.0
  assert.equal(inReach(0, 0, 1, 1, r), true);        // diagonal centres: 1.41
  assert.equal(inReach(0, 0, 2, 0, r), false);       // two tiles out: 2.0
  // The defect this revision exists to fix: both units are cheb-adjacent
  // (tiles (0,0) and (1,1)) but sit at opposite far corners, 2.83 apart.
  assert.equal(cheb(0, 0, 1, 1), 1);                 // ...the old rule said yes
  assert.equal(inReach(-0.5, -0.5, 1.5, 1.5, r), false); // ...distance says no
});

test('reach is inclusive at the boundary', () => {
  assert.equal(inReach(0, 0, 1.5, 0, 1.5), true);
  assert.equal(inReach(0, 0, 1.51, 0, 1.5), false);
});

test('a longer reach buys exactly the distance it says', () => {
  assert.equal(inReach(0, 0, 2, 0, REACH.DEFAULT), false);
  assert.equal(inReach(0, 0, 2, 0, REACH.DEFAULT + 0.7), true); // a long handle
});

test('reachOpen is inert without an edge test rather than throwing', () => {
  assert.equal(reachOpen(0, 0, 1, 0, null), true);
  assert.equal(inReach(0, 0, 1, 0, REACH.DEFAULT, undefined), true);
});

test('a solid edge between two bodies blocks the swing', () => {
  const wall = wallBetween(0, 0, 1, 0);
  assert.equal(reachOpen(0, 0, 1, 0, wall), false);
  assert.equal(inReach(0, 0, 1, 0, REACH.DEFAULT, wall), false); // in range, no line
  assert.equal(reachOpen(0, 0, 0, 1, wall), true);               // a different face is open
});

test('reaching diagonally around a partition end works - either L-path is enough', () => {
  // The rule stepOpen deliberately forbids for BODIES and reach allows for
  // ARMS: one of the two ways around the corner is walled, the other is not.
  const oneSide = wallBetween(0, 0, 1, 0);
  assert.equal(reachOpen(0, 0, 1, 1, oneSide), true);
  // Wall BOTH ways around the corner and the diagonal really is blocked.
  const bothSides = (x, z, nx, nz) =>
    wallBetween(0, 0, 1, 0)(x, z, nx, nz) && wallBetween(0, 0, 0, 1)(x, z, nx, nz);
  assert.equal(reachOpen(0, 0, 1, 1, bothSides), false);
});

test('a body standing on the same tile always has a line to itself', () => {
  const wall = wallBetween(0, 0, 1, 0);
  assert.equal(reachOpen(0, 0, 0, 0, wall), true);
  assert.equal(reachOpen(0.2, 0.1, 0.3, -0.1, wall), true); // sub-tile jitter, same cell
});

test('a unit threatens the ground its reach covers, not a ring of tiles', () => {
  const r = REACH.DEFAULT;
  // At tile centres the outcome is the same eight neighbours as the old rule -
  // by geometry now (1.0 and 1.41 both clear 1.5) rather than by definition.
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      assert.equal(threatens(5, 5, 5 + dx, 5 + dz, r), true, `${dx},${dz} is threatened`);
    }
  }
  assert.equal(threatens(5, 5, 7, 5, r), false); // two tiles out is free
  assert.equal(threatens(5, 5, 7, 7, r), false);
  // What actually changed: a spot inside a NEIGHBOURING tile can be out of
  // reach, so standing in the far corner of it is no longer being zoned.
  assert.equal(threatens(5, 5, 6.4, 6.4, r), false);
  // ...and a longer weapon zones ground a pair of fists cannot.
  assert.equal(threatens(5, 5, 7, 5, r + 0.7), true);
});

test('threat stops at a wall - you cannot zone through a partition', () => {
  // Threat has to agree with the swing it becomes, or an opportunity attack
  // fires for a hit that could never have landed.
  const wall = wallBetween(5, 5, 6, 5);
  assert.equal(threatens(5, 5, 6, 5, REACH.DEFAULT), true);              // no wall passed
  assert.equal(threatens(5, 5, 6, 5, REACH.DEFAULT, wall), false);       // walled off
});

test('stepping out of reach provokes; approaching does not', () => {
  const foe = [{ x: 5, z: 5, reach: REACH.DEFAULT }];
  assert.equal(provokedBy(foe, 5, 6, 5, 8).length, 1); // in reach -> away: provokes
  assert.equal(provokedBy(foe, 5, 8, 5, 6).length, 0); // away -> in reach: closing is free
});

test('a threat missing its reach falls back to the floor, not to omniscience', () => {
  // Guards the NaN trap: comparing against `undefined` is false either way, so
  // an unstated reach would threaten everywhere and therefore provoke nowhere.
  const sloppy = [{ x: 5, z: 5 }];
  assert.equal(provokedBy(sloppy, 5, 6, 5, 8).length, 1);
});

test('a longer reach zones a wider ring - you must get further away to escape', () => {
  const pike = [{ x: 5, z: 5, reach: REACH.DEFAULT + 0.7 }];
  const fists = [{ x: 5, z: 5, reach: REACH.DEFAULT }];
  // A step from 1.0 to 2.0 away escapes fists but is still inside the pike.
  assert.equal(provokedBy(fists, 5, 6, 5, 7).length, 1);
  assert.equal(provokedBy(pike, 5, 6, 5, 7).length, 0);
  // Keep going and even the pike loses you.
  assert.equal(provokedBy(pike, 5, 6, 5, 9).length, 1);
});

test('circling a foe provokes nothing - the threat set never lapses', () => {
  // Both spots are inside the foe's reach, so it never stops threatening. Under
  // the old tile rule the set-diff APPROXIMATED this; against a radius it is
  // the question exactly.
  const foe = [{ x: 5, z: 5, reach: REACH.DEFAULT }];
  assert.deepEqual(provokedBy(foe, 4, 5, 4, 4), []); // orthogonal -> diagonal, still in reach
  assert.deepEqual(provokedBy(foe, 4, 4, 5, 4), []); // diagonal -> orthogonal
  assert.deepEqual(provokedBy(foe, 5, 5, 5, 5), []); // standing still is not leaving
});

test('only the threats actually escaped fire, not every nearby foe', () => {
  const a = { x: 5, z: 5, tag: 'left-behind', reach: REACH.DEFAULT };
  const b = { x: 8, z: 5, tag: 'still-adjacent', reach: REACH.DEFAULT };
  // Move from between them to a tile that only b still reaches.
  const provoked = provokedBy([a, b], 6, 5, 7, 5);
  assert.equal(provoked.length, 1);
  assert.equal(provoked[0].tag, 'left-behind'); // b never lost reach, so it gets nothing
});

test('escaping several threats at once provokes each of them', () => {
  const swarm = [{ x: 4, z: 5 }, { x: 5, z: 4 }, { x: 6, z: 5 }]
    .map((t) => ({ ...t, reach: REACH.DEFAULT }));
  assert.equal(provokedBy(swarm, 5, 5, 5, 9).length, 3); // walking out of a surround
});

test('provokedBy tolerates an empty or missing threat list', () => {
  assert.deepEqual(provokedBy([], 1, 1, 5, 5), []);
  assert.deepEqual(provokedBy(undefined, 1, 1, 5, 5), []);
});

// --- cover (TACTICS_PLAN M3) ------------------------------------------------

// A solid edge on ONE face of the defender's tile. `edgeOpen(x,z,nx,nz)` is
// the shape combat passes (world.stepOpen): false means something solid.
const wallOn = (fx, fz, tx, tz) => (x, z, nx, nz) =>
  !(x === fx && z === fz && nx === tx && nz === tz);

test('a solid edge on the attacker side is cover; the far side is not', () => {
  // Defender at (5,5) with a partition on its EAST face.
  const east = wallOn(5, 5, 6, 5);
  assert.equal(hasCover(9, 5, 5, 5, east), true);  // attacker east - shielded
  assert.equal(hasCover(1, 5, 5, 5, east), false); // attacker west - wide open
  assert.equal(hasCover(5, 1, 5, 5, east), false); // attacker north - wrong axis
});

test('a diagonal attacker is blocked by either facing edge', () => {
  const east = wallOn(5, 5, 6, 5);
  const north = wallOn(5, 5, 5, 4);
  // Attacker up-and-right: the east face alone is enough to break the angle,
  // and so is the north face - going around one corner suffices.
  assert.equal(hasCover(9, 1, 5, 5, east), true);
  assert.equal(hasCover(9, 1, 5, 5, north), true);
  // ...but an edge on neither facing side does nothing.
  assert.equal(hasCover(9, 1, 5, 5, wallOn(5, 5, 4, 5)), false); // west face
});

// --- cover from a CELL (POWERS_PLAN M7) -------------------------------------
// A toppled bookcase - or a teammate holding a guard stance - occupies a cell
// rather than an edge, so the same two faces get asked a second question.
const propAt = (px, pz) => (x, z) => x === px && z === pz;
const noEdges = () => true;

test('a shielding cell on the attacker side is cover, just like an edge', () => {
  // Defender at (5,5), a fallen cabinet in the tile to their EAST.
  const east = propAt(6, 5);
  assert.equal(hasCover(9, 5, 5, 5, noEdges, east), true);  // attacker east
  assert.equal(hasCover(1, 5, 5, 5, noEdges, east), false); // attacker west
  assert.equal(hasCover(5, 1, 5, 5, noEdges, east), false); // wrong axis
});

test('a diagonal attacker is blocked by a shielding cell on either face', () => {
  assert.equal(hasCover(9, 1, 5, 5, noEdges, propAt(6, 5)), true); // east face
  assert.equal(hasCover(9, 1, 5, 5, noEdges, propAt(5, 4)), true); // north face
  assert.equal(hasCover(9, 1, 5, 5, noEdges, propAt(4, 5)), false); // wrong side
});

test('edges and cells stack to at most ONE cover', () => {
  // The boolean rule survives the second source: tucking behind a partition
  // AND a toppled cabinet on the same face is not double cover.
  const east = wallOn(5, 5, 6, 5);
  assert.equal(hasCover(9, 5, 5, 5, east, propAt(6, 5)), true);
  // ...and either source alone still works with the other absent.
  assert.equal(hasCover(9, 5, 5, 5, east, () => false), true);
  assert.equal(hasCover(9, 5, 5, 5, noEdges, propAt(6, 5)), true);
});

test('omitting the cell predicate leaves the old edge behaviour exactly as it was', () => {
  const east = wallOn(5, 5, 6, 5);
  assert.equal(hasCover(9, 5, 5, 5, east), true);
  assert.equal(hasCover(1, 5, 5, 5, east), false);
});

test('positionMods routes the cell predicate through, ranged only', () => {
  const shielded = { edgeOpen: noEdges, coverCell: propAt(6, 5) };
  // Ranged: the fallen prop spoils the shot.
  assert.equal(positionMods(9, 5, 5, 5, { ...shielded, melee: false }).covered, true);
  // Melee: it does not. Cover is ranged-only, so a toppled cabinet is a
  // counter to throwers and something a melee attacker simply walks around -
  // which is what stops "topple everything" being a universal answer.
  assert.equal(positionMods(9, 5, 5, 5, { ...shielded, melee: true }).covered, false);
});

test('no edges anywhere means no cover', () => {
  const open = () => true;
  assert.equal(hasCover(9, 5, 5, 5, open), false);
  assert.equal(hasCover(5, 9, 5, 5, open), false);
});

test('hasCover is inert without an edge test rather than throwing', () => {
  assert.equal(hasCover(9, 5, 5, 5, undefined), false);
  assert.equal(hasCover(9, 5, 5, 5, null), false);
});

test('cover is ranged-only - melee ignores the partition', () => {
  const east = wallOn(5, 5, 6, 5);
  // Adjacent through that very edge: no help once they are on top of you.
  const melee = positionMods(6, 5, 5, 5, { edgeOpen: east });
  assert.equal(melee.covered, false);
  assert.equal(melee.positional, 0);
  // The same wall, from across the room, does apply.
  const ranged = positionMods(9, 5, 5, 5, { edgeOpen: east });
  assert.equal(ranged.covered, true);
  assert.equal(ranged.positional, -HIT.COVER_DODGE); // defender-favouring, so negative
});

test('cover lowers the resulting hit chance by exactly COVER_DODGE', () => {
  const east = wallOn(5, 5, 6, 5);
  const open = hitChance(0.1, 0.05, positionMods(9, 5, 5, 5, { edgeOpen: () => true }).positional);
  const behind = hitChance(0.1, 0.05, positionMods(9, 5, 5, 5, { edgeOpen: east }).positional);
  assert.ok(Math.abs((open - behind) - HIT.COVER_DODGE) < 1e-9);
});

// --- flanking (TACTICS_PLAN M4) ---------------------------------------------

test('an ally exactly opposite is a pincer; the same side is not', () => {
  // Defender (5,5), attacker to the WEST at (4,5).
  assert.equal(isFlanked(4, 5, 5, 5, [{ x: 6, z: 5 }]), true);  // ally east - sandwiched
  assert.equal(isFlanked(4, 5, 5, 5, [{ x: 4, z: 4 }]), false); // ally on our own side
  assert.equal(isFlanked(4, 5, 5, 5, [{ x: 5, z: 4 }]), false); // ally north - a corner, not a pincer
  assert.equal(isFlanked(4, 5, 5, 5, []), false);               // nobody else
});

test('a diagonal pincer counts when it is exactly opposite', () => {
  // Attacker up-left of the defender; ally must be down-right.
  assert.equal(isFlanked(4, 4, 5, 5, [{ x: 6, z: 6 }]), true);
  assert.equal(isFlanked(4, 4, 5, 5, [{ x: 6, z: 5 }]), false); // near-opposite doesn't count
});

test('a flanking ally has to be in the defender face, not lobbing from afar', () => {
  // Opposite side, but two tiles out - it is not part of any sandwich.
  assert.equal(isFlanked(4, 5, 5, 5, [{ x: 7, z: 5 }]), false);
  assert.equal(isFlanked(4, 5, 5, 5, [{ x: 6, z: 5 }]), true); // adjacent, same direction
});

test('a crowd on one flank is not a pincer', () => {
  // Three allies, all west-ish with the attacker. Headcount would call this
  // flanking; strict opposition correctly does not (TACTICS_PLAN #7).
  const clump = [{ x: 4, z: 4 }, { x: 4, z: 6 }, { x: 5, z: 4 }];
  assert.equal(isFlanked(4, 5, 5, 5, clump), false);
});

test('flanking is melee-only and pays FLANK_ACC_BONUS', () => {
  const opposite = [{ x: 6, z: 5 }];
  const melee = positionMods(4, 5, 5, 5, { allies: opposite });
  assert.equal(melee.flanked, true);
  assert.equal(melee.positional, HIT.FLANK_ACC_BONUS);
  // The same pincer, but the attacker is shooting from across the room: a
  // pincer means bodies, so range gets nothing.
  const ranged = positionMods(1, 5, 5, 5, { allies: opposite });
  assert.equal(ranged.flanked, false);
  assert.equal(ranged.positional, 0);
});

test('positive positional terms are capped by POSITION_CAP', () => {
  const opposite = [{ x: 6, z: 5 }];
  const m = positionMods(4, 5, 5, 5, { allies: opposite });
  assert.ok(m.positional <= HIT.POSITION_CAP);
});

test('cover and flanking cannot both apply - they are range-exclusive', () => {
  // One is melee-only, the other ranged-only, so no attack gets both.
  const east = wallOn(5, 5, 6, 5);
  const opposite = [{ x: 6, z: 5 }];
  const near = positionMods(4, 5, 5, 5, { edgeOpen: east, allies: opposite });
  const far = positionMods(1, 5, 5, 5, { edgeOpen: east, allies: opposite });
  assert.equal(near.covered && near.flanked, false);
  assert.equal(far.covered && far.flanked, false);
});

// --- backstab (TACTICS_PLAN M5) ---------------------------------------------

const facingEast = { x: 1, z: 0 };

test('striking the rear arc is a backstab; the front is not', () => {
  // Defender at (5,5) facing EAST.
  assert.equal(isBackstab(1, 5, 5, 5, facingEast), true);  // attacker due west - behind
  assert.equal(isBackstab(9, 5, 5, 5, facingEast), false); // attacker due east - head on
});

test('the flanks are neither front nor back', () => {
  // Perpendicular: dot product 0, so no bonus either way. A backstab must be
  // behind, not merely off-axis.
  assert.equal(isBackstab(5, 1, 5, 5, facingEast), false); // due north
  assert.equal(isBackstab(5, 9, 5, 5, facingEast), false); // due south
});

test('rear diagonals count, front diagonals do not', () => {
  assert.equal(isBackstab(4, 4, 5, 5, facingEast), true);  // behind-and-left
  assert.equal(isBackstab(4, 6, 5, 5, facingEast), true);  // behind-and-right
  assert.equal(isBackstab(6, 4, 5, 5, facingEast), false); // ahead-and-left
  assert.equal(isBackstab(6, 6, 5, 5, facingEast), false); // ahead-and-right
});

test('a defender that has never acted cannot be backstabbed', () => {
  // No facing = no rear. A stale or invented heading would hand out a free
  // bonus for standing in the right spot at the opening of a fight.
  assert.equal(isBackstab(1, 5, 5, 5, null), false);
  assert.equal(isBackstab(1, 5, 5, 5, undefined), false);
  assert.equal(isBackstab(1, 5, 5, 5, { x: 0, z: 0 }), false);
});

test('an attacker standing on the defender has no angle', () => {
  assert.equal(isBackstab(5, 5, 5, 5, facingEast), false);
});

test('backstab pays BACKSTAB_ACC_BONUS and works at range', () => {
  const melee = positionMods(4, 5, 5, 5, { facing: facingEast });
  assert.equal(melee.behind, true);
  assert.equal(melee.positional, HIT.BACKSTAB_ACC_BONUS);
  // Shooting someone in the back counts too - it is about facing, not reach.
  const ranged = positionMods(1, 5, 5, 5, { facing: facingEast });
  assert.equal(ranged.behind, true);
  assert.equal(ranged.positional, HIT.BACKSTAB_ACC_BONUS);
});

test('flank and backstab stack but never exceed POSITION_CAP', () => {
  // Attacker west, ally east (a pincer), and the defender facing east means
  // the attacker is also behind it. Raw sum would be 0.15 + 0.20 = 0.35.
  const m = positionMods(4, 5, 5, 5, { allies: [{ x: 6, z: 5 }], facing: facingEast });
  assert.equal(m.flanked, true);
  assert.equal(m.behind, true);
  assert.equal(m.positional, Math.min(HIT.POSITION_CAP, HIT.FLANK_ACC_BONUS + HIT.BACKSTAB_ACC_BONUS));
  assert.ok(m.positional <= HIT.POSITION_CAP);
});

test('cover still subtracts even when the attacker is behind', () => {
  // A ranged attacker behind its target, which is tucked behind a partition:
  // the positive term is capped, the cover is taken off the top of it.
  const east = wallOn(5, 5, 6, 5);
  const m = positionMods(9, 5, 5, 5, { edgeOpen: east, facing: { x: -1, z: 0 } });
  assert.equal(m.covered, true);
  assert.equal(m.behind, true); // it faces west, attacker is east
  assert.equal(m.positional, HIT.BACKSTAB_ACC_BONUS - HIT.COVER_DODGE);
});

test('cover applies at most once - a corner cannot double up', () => {
  // Both facing edges solid (a corner nook). Still one application.
  const corner = (x, z, nx, nz) => !(x === 5 && z === 5 && ((nx === 6 && nz === 5) || (nx === 5 && nz === 4)));
  const m = positionMods(9, 1, 5, 5, { edgeOpen: corner });
  assert.equal(m.positional, -HIT.COVER_DODGE);
});

// --- walls block swings (TACTICS_PLAN revision, M3) --------------------------

test('a partition beats reach: in range, no line, no swing', () => {
  // The defect M3 closes. Before it, cover was ranged-only AND melee ignored
  // edges, so a cubicle wall cost a melee attacker nothing at all.
  const wall = wallBetween(4, 4, 5, 4);
  assert.equal(dist(4, 4, 5, 4) <= REACH.DEFAULT, true); // distance says yes
  assert.equal(inReach(4, 4, 5, 4, REACH.DEFAULT, wall), false); // the wall says no
});

test('reach around a partition end still works with the line test on', () => {
  // The whole reason reach does not reuse stepOpen: a body cannot slip past the
  // end of a partition, but an arm can swing around it.
  const wall = wallBetween(4, 4, 5, 4);
  assert.equal(inReach(4, 4, 5, 5, REACH.DEFAULT, wall), true);
});

test('a longer reach does not buy a swing through a wall', () => {
  // Reach and line are independent gates: more reach never becomes x-ray.
  const wall = wallBetween(0, 0, 1, 0);
  assert.equal(inReach(0, 0, 1, 0, 5, wall), false);
});
