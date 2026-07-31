// Where a summon may be posted (src/summon-rules.js). Pure module, plain
// values - no bodies, no grid, no fight.
//
// This rule was written twice, and the copies were visibly out of step: the
// main.js version carried a comment saying it was "deliberately the same four
// questions combat's summonSpotProblem asks, less the AP and uses". A rule
// documented as a copy of another rule is a rule waiting to drift.
import test from 'node:test';
import assert from 'node:assert/strict';
import { summonRange, summonRoom, dropCount, summonSpotProblem } from '../../src/summon-rules.js';

const POST = { ap: 2, count: 2, cap: 3, uses: 1 };

// A legal spot in a fight: affordable, rationed but unspent, close, in sight,
// with ground to stand on.
const ok = (over = {}) => ({
  ap: 10, usesLeft: 1, dist: 2, los: true, hasRoomToStand: true, room: 3, ...over,
});

test('range defaults, and an action may declare its own', () => {
  assert.equal(summonRange({}), 5);
  assert.equal(summonRange({ range: 2 }), 2);
});

test('the cap is per-summoner and counts who is still standing', () => {
  assert.equal(summonRoom(POST, 0), 3);
  assert.equal(summonRoom(POST, 2), 1);
  assert.equal(summonRoom(POST, 3), 0);
  // Never negative: two who survived the last fight must not make the room
  // read as "minus one" and quietly re-enable a post.
  assert.equal(summonRoom(POST, 9), 0);
  // No declared cap means the count IS the cap.
  assert.equal(summonRoom({ count: 2 }, 0), 2);
});

test('how many arrive is what the action posts, bounded by the cap', () => {
  assert.equal(dropCount(POST, 5), 2); // the action's own count
  assert.equal(dropCount(POST, 1), 1); // what is left
  assert.equal(dropCount(POST, 0), 0);
});

test('a legal spot has no problem, in a fight or out of one', () => {
  assert.equal(summonSpotProblem(POST, ok()), null);
  // Out of combat the two fight-only fields are simply absent.
  assert.equal(summonSpotProblem(POST, {
    dist: 2, los: true, hasRoomToStand: true, room: 3,
  }), null);
});

test('the fight\'s own legs are asked FIRST', () => {
  // You find out you cannot afford it before you find out where it would have
  // gone - so an unaffordable post at an illegal spot blames the AP, not the
  // spot.
  assert.match(summonSpotProblem(POST, ok({ ap: 1, dist: 99, los: false })), /AP/);
  assert.match(summonSpotProblem(POST, ok({ usesLeft: 0, dist: 99 })), /postings left/);
});

test('a ration that does not exist is not a ration spent', () => {
  // usesLeft is undefined out of combat, and an unrationed action has no
  // `uses` at all: neither must read as zero.
  assert.equal(summonSpotProblem({ ...POST, uses: 0 }, ok({ usesLeft: 0 })), null);
  assert.equal(summonSpotProblem(POST, { dist: 2, los: true, hasRoomToStand: true }), null);
});

test('the placement legs run in order: distance, line, ground, headcount', () => {
  assert.match(summonSpotProblem(POST, ok({ dist: 99 })), /Too far/);
  assert.match(summonSpotProblem(POST, ok({ los: false })), /clear line/);
  assert.match(summonSpotProblem(POST, ok({ hasRoomToStand: false })), /room for anyone/);
  assert.match(summonSpotProblem(POST, ok({ room: 0 })), /req is full/);
});

test('the far edge of range is still in range', () => {
  assert.equal(summonSpotProblem(POST, ok({ dist: summonRange(POST) })), null);
  assert.match(summonSpotProblem(POST, ok({ dist: summonRange(POST) + 1 })), /Too far/);
});

test('an action\'s own range narrows the reach without touching the message', () => {
  const close = { ...POST, range: 2 };
  assert.equal(summonSpotProblem(close, ok({ dist: 2 })), null);
  assert.match(summonSpotProblem(close, ok({ dist: 3 })), /Too far/);
});
