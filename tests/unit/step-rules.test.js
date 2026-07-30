// What the floor does to whoever stands on it (src/step-rules.js). Pure
// module, plain fact sheets - no grid, no runtime, no bodies.
//
// These rules previously existed three times over (main.js for party members
// and summons, combat.js for AI units, actors.js for wanderers), so this suite
// is deliberately written against the SHARED module rather than any one
// caller: a rule that only one of the three obeys is the exact failure the
// carve exists to prevent.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  surfaceEffect, rawSurfaceDamage, effectiveSurfaceDamage, slipChance, slips,
  hasGum, speedUnderStatus, surfacePathCost,
} from '../../src/step-rules.js';
import { SURFACES, FIRE, ELECTRIFIED } from '../../src/data/surfaces.js';

const dry = {};
const water = { surfaceId: 'water' };
const paper = { surfaceId: 'paper' };
const live = { surfaceId: 'water', electrified: true };
const fire = { surfaceId: 'water', electrified: true, burning: true };

test('the dynamic layer outranks the static one: fire, then current, then paint', () => {
  assert.equal(surfaceEffect(dry), null);
  assert.equal(surfaceEffect(water), SURFACES.water.onEnter);
  // A live puddle is not water any more.
  assert.equal(surfaceEffect(live), ELECTRIFIED.onEnter);
  // And a BURNING live puddle is a fire, not live water.
  assert.equal(surfaceEffect(fire), FIRE.onEnter);
});

test('raw damage is what the floor does before anybody\'s shoes', () => {
  assert.equal(rawSurfaceDamage(dry), 0);
  assert.equal(rawSurfaceDamage(water), 0); // wet socks are not an injury
  assert.equal(rawSurfaceDamage(paper), SURFACES.paper.onEnter.amount);
  assert.equal(rawSurfaceDamage(live), ELECTRIFIED.onEnter.amount);
});

test('talents discount damage, and no talents means the raw number', () => {
  // An AI unit wears nothing: it takes the floor exactly as painted. This is
  // the case that must never silently pick up the player's immunities.
  assert.equal(effectiveSurfaceDamage(live), ELECTRIFIED.onEnter.amount);
  assert.equal(effectiveSurfaceDamage(live, {}), ELECTRIFIED.onEnter.amount);

  assert.equal(effectiveSurfaceDamage(live, { shockImmune: true }), 0);
  assert.equal(effectiveSurfaceDamage(paper, { paperCutImmune: true }), 0);
  // The wrong immunity is no immunity.
  assert.equal(effectiveSurfaceDamage(live, { paperCutImmune: true }), ELECTRIFIED.onEnter.amount);
});

test('fire voids both immunities - steel toes are not about being on fire', () => {
  assert.equal(effectiveSurfaceDamage(fire, { shockImmune: true }), FIRE.onEnter.amount);
  assert.equal(
    effectiveSurfaceDamage({ surfaceId: 'paper', burning: true }, { paperCutImmune: true }),
    FIRE.onEnter.amount,
  );
});

test('surfaceDamageResist subtracts, and never below zero', () => {
  assert.equal(effectiveSurfaceDamage(paper, { surfaceDamageResist: 1 }), 0);
  assert.equal(effectiveSurfaceDamage(live, { surfaceDamageResist: 2 }),
    ELECTRIFIED.onEnter.amount - 2);
  assert.equal(effectiveSurfaceDamage(paper, { surfaceDamageResist: 99 }), 0);
});

test('slip chance is the floor\'s alone - talent-free, because enemies read it', () => {
  assert.equal(slipChance(dry), 0);
  assert.equal(slipChance(water), SURFACES.water.slippery);
  // Electrified and burning water are different problems, not slippery ones.
  assert.equal(slipChance(live), 0);
  assert.equal(slipChance(fire), 0);
});

test('slips takes the roll as an argument, so a seeded fight reproduces', () => {
  const chance = SURFACES.water.slippery;
  assert.equal(slips({ chance, roll: 0 }), true);
  assert.equal(slips({ chance, roll: 0.99 }), false);
  // The boundary is strict-less-than, so a roll exactly at the chance stands up.
  assert.equal(slips({ chance, roll: chance }), false);
  assert.equal(slips({ chance: 0, roll: 0 }), false);
  assert.equal(slips({}), false);
});

test('tread and gum both keep you upright, by either name', () => {
  const wet = { chance: SURFACES.water.slippery, roll: 0 };
  assert.equal(slips(wet), true);
  assert.equal(slips({ ...wet, slipProof: true }), false); // gum, or slip-proof shoes
  assert.equal(slips({ ...wet, slipImmune: true }), false); // the talent
});

test('hasGum finds a wad and nothing else', () => {
  assert.equal(hasGum({ surfaceId: 'gum' }), true);
  assert.equal(hasGum(water), false);
  assert.equal(hasGum(dry), false);
});

test('speed DERIVES from the base, so applying it twice changes nothing', () => {
  // The double-slow bug in one assertion: scaling in place compounded, because
  // combat captures baseSpeed lazily and so captured an already-slowed speed.
  const slow = { speedMult: 0.6 };
  const once = speedUnderStatus(3, slow);
  assert.equal(once, 3 * 0.6);
  assert.equal(speedUnderStatus(3, slow), once);
  assert.equal(speedUnderStatus(3, {}), 3);
  assert.equal(speedUnderStatus(3), 3);
});

test('path cost prices fire over current over paint, and only the player\'s talents discount', () => {
  assert.equal(surfacePathCost(dry), 0);
  assert.equal(surfacePathCost(water), SURFACES.water.pathCost);
  assert.equal(surfacePathCost(live), ELECTRIFIED.pathCost);
  assert.equal(surfacePathCost(fire), FIRE.pathCost);
  // ESD soles make live water ordinary water to walk through...
  assert.equal(surfacePathCost(live, { shockImmune: true }), 1);
  // ...but the enemy model is passed no talents, so their fears stay their own.
  assert.equal(surfacePathCost(live, {}), ELECTRIFIED.pathCost);
  // And it does not rescue them from fire.
  assert.equal(surfacePathCost(fire, { shockImmune: true }), FIRE.pathCost);
});

test('gum is free to path through - that is what makes it a mine', () => {
  assert.equal(surfacePathCost({ surfaceId: 'gum' }), 0);
});
