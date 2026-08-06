// Where a summon may be posted, and how many arrive - pure logic, no
// PlayCanvas, no DOM, no closure.
//
// It exists because this rule was written twice with the copies already
// visibly out of step: `summonSpotProblem` in combat.js and `summonDropProblem`
// in main.js asked the same four questions in the same order, and main.js's
// version carried a comment explaining that it was "deliberately the same four
// questions combat's summonSpotProblem asks, less the AP and uses". A rule
// documented as a copy of another rule is a rule waiting to drift.
//
// One ladder now, with the two fight-only legs (AP, per-fight uses) simply
// absent out of combat: `ap` and `usesLeft` are omitted there, and the ladder
// skips what it was not given.
import { isLivingMember } from './member-rules.js';

// How far a summon can be posted from the summoner, in tiles.
export const summonRange = (a) => a.range ?? 5;

// How much of this summoner's headcount is still free. The cap is per-SUMMONER
// and outlives the fight it was spent in: a summon that walks out of one fight
// and into the next is still on the books, and the link back to whoever called
// them is what lets the cap see it (SUMMON_PLAN #7).
export const summonRoom = (a, liveCount) => Math.max(0, (a.cap ?? a.count) - liveCount);

// Count one explicit population against a summoner's cap. Map-side temps,
// fight-side AI units, player-side members and borrowed units use different
// record shapes, but ownership and liveness are the same two questions.
export function countLiveSummons(summoner, records) {
  return (records || []).filter((record) => {
    const owner = record?.summonedBy ?? record?.unit?.summonedBy;
    if (owner !== summoner) return false;
    if (record.sheet) return isLivingMember(record);
    return record.alive !== false && (record.hp == null || record.hp > 0);
  }).length;
}

// How many actually arrive: what the action posts, bounded by what the cap has
// left.
export const dropCount = (a, room) => Math.max(0, Math.min(a.count, room));

// Why this spot is unusable, or null when it is good. Shared by the click, the
// hover rings and both sides of the in-fight/out-of-fight split, so what you
// see is the rule that runs (ARCHITECTURE.md on previewAction).
//
// `s` is the spot's state as plain values:
//   { dist, los, hasRoomToStand, room, ap?, actionAp?, usesLeft? }
//
// Order matters and is the design: the two things a FIGHT owns are asked
// first - you find out you cannot afford it before you find out where it would
// have gone - then distance, then line, then the ground, then the headcount.
export function summonSpotProblem(a, s = {}) {
  if (s.ap !== undefined && s.ap < (s.actionAp ?? a.ap)) return 'Not enough AP.';
  if (a.uses && s.usesLeft !== undefined && s.usesLeft <= 0) return 'No postings left this fight.';
  if (s.dist > summonRange(a)) return 'Too far - post it closer.';
  if (!s.los) return 'No clear line to that spot.';
  if (!s.hasRoomToStand) return 'No room for anyone to stand there.';
  // Out of combat this is the whole limit, so it gets a message about the
  // headcount rather than about the fight. In a fight the caller has already
  // been refused by `uses` above if it was going to be.
  if (s.room !== undefined && s.room <= 0) {
    return 'Your req is full - that is all the headcount you have.';
  }
  return null;
}
