// Unit tests for the turn engine - pure logic, no PlayCanvas, no DOM.
//
// The engine treats slots as OPAQUE and asks a host about them, so a test can
// drive the whole turn lifecycle with plain objects: no sheet, no actor, no
// panel. That is the point of the extraction - this used to be a closure inside
// combat.js's 2,000-line startCombat, reachable only by booting the engine and
// clicking through a fight in headless Chromium.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTurnOrder } from '../../src/turn-order.js';
import { applyStatus } from '../../src/statuses.js';

// A deterministic RNG: replays a fixed sequence of [0,1) values, looping.
const seqRng = (values) => {
  let i = 0;
  return () => values[i++ % values.length];
};

// A slot is whatever the caller threads through. Ours carries a name, an
// initiative modifier, a status carrier, and the flags the host reads.
function slot(name, initMod, extra = {}) {
  return { name, initMod, carrier: {}, alive: true, ...extra };
}

// A host that records what the engine asked it to do. Every hook has a sane
// default; a test overrides only the one it is about.
function harness(slots, over = {}) {
  const log = [];
  const host = {
    alive: (s) => s.alive,
    carrier: (s) => s.carrier,
    outcome: () => null,
    win: () => log.push('win'),
    lose: () => log.push('lose'),
    lifetimeLeft: (s) => (s.turnsLeft === undefined ? null : s.turnsLeft),
    spendLifetime: (s) => { s.turnsLeft -= 1; log.push(`spend:${s.name}`); },
    expire: (s) => { s.alive = false; log.push(`expire:${s.name}`); },
    dot: () => 'stands',
    skip: () => 'advance',
    take: (s) => log.push(`take:${s.name}`),
    roundStart: () => log.push('round'),
    ...over,
  };
  // A rng of 0.5 gives every entry the same die face, so the order is decided
  // by initMod (descending) - which makes the expected order readable.
  const turns = createTurnOrder({ entries: slots, rng: over.rng || (() => 0.5), host });
  return { turns, log, host };
}

test('begin hands the turn to the highest roll', () => {
  const a = slot('a', 1);
  const b = slot('b', 9);
  const { turns, log } = harness([a, b]);
  assert.equal(turns.begin(), 'taken');
  assert.deepEqual(log, ['take:b']);
  assert.equal(turns.current, b);
  assert.equal(turns.index, 0);
});

test('advance walks the order, then wraps into exactly one new round', () => {
  const { turns, log } = harness([slot('a', 9), slot('b', 5), slot('c', 1)]);
  turns.begin();
  turns.advance();
  turns.advance();
  assert.deepEqual(log, ['take:a', 'take:b', 'take:c']);
  assert.equal(turns.index, 2);
  log.length = 0;
  turns.advance(); // off the end: one round boundary, then back to the top
  assert.deepEqual(log, ['round', 'take:a']);
  assert.equal(turns.index, 0);
});

test('a slot that is no longer on the board is skipped, not offered', () => {
  const b = slot('b', 5);
  const { turns, log } = harness([slot('a', 9), b, slot('c', 1)]);
  b.alive = false;
  turns.begin();
  turns.advance();
  assert.deepEqual(log, ['take:a', 'take:c'], 'the downed slot never took a turn');
  assert.equal(turns.index, 2);
});

test('a whole order of corpses stalls instead of overflowing the stack', () => {
  // The old driver recursed on every skip, so a fight where nobody can act -
  // and no win condition has been reported - blew the stack rather than saying
  // so. It reports, and the round hook cannot run away either.
  const slots = [slot('a', 3), slot('b', 2), slot('c', 1)];
  for (const s of slots) s.alive = false;
  const { turns, log } = harness(slots);
  assert.equal(turns.begin(), 'stalled');
  assert.ok(log.filter((l) => l === 'round').length <= 3, 'bounded, not spinning');
});

// --- the win/lose boundary ------------------------------------------------

test('the outcome is read at every turn boundary', () => {
  let over = null;
  const { turns, log } = harness([slot('a', 9), slot('b', 1)], { outcome: () => over });
  turns.begin();
  assert.deepEqual(log, ['take:a']);
  over = 'win';
  assert.equal(turns.advance(), 'over');
  assert.deepEqual(log, ['take:a', 'win']);
});

test('a lost fight ends on the boundary rather than handing out another turn', () => {
  const { turns, log } = harness([slot('a', 9)], { outcome: () => 'lose' });
  assert.equal(turns.begin(), 'over');
  assert.deepEqual(log, ['lose']);
});

// --- temps ----------------------------------------------------------------

test('a temp spends one of its own turns at the top of each of them', () => {
  const temp = slot('temp', 9, { turnsLeft: 2 });
  const { turns, log } = harness([temp, slot('a', 1)]);
  turns.begin();
  assert.deepEqual(log, ['spend:temp', 'take:temp']);
  assert.equal(temp.turnsLeft, 1);
  turns.advance(); // a
  turns.advance(); // round, back to the temp
  assert.equal(temp.turnsLeft, 0, 'a second turn served');
  assert.equal(log.filter((l) => l === 'take:temp').length, 2);
});

test('a temp whose contract has lapsed expires and the turn moves on', () => {
  const temp = slot('temp', 9, { turnsLeft: 0 });
  const { turns, log } = harness([temp, slot('a', 1)]);
  turns.begin();
  assert.deepEqual(log, ['expire:temp', 'take:a']);
  assert.ok(!log.includes('spend:temp'), 'a lapsed contract is not also charged');
});

test('an expiring temp that empties the board ends the fight', () => {
  // Dismissing the last enemy-side temp is a win, and the engine has to notice
  // on the very next boundary rather than handing the turn to a corpse.
  const temp = slot('temp', 9, { turnsLeft: 0 });
  const other = slot('a', 1);
  let done = null;
  const { turns, log } = harness([temp, other], {
    expire: (s) => { s.alive = false; done = 'win'; },
    outcome: () => done,
  });
  assert.equal(turns.begin(), 'over');
  assert.deepEqual(log, ['win']);
});

// --- incapacitation -------------------------------------------------------

test('a member who cannot act loses the turn and play moves on', () => {
  const a = slot('a', 9);
  applyStatus(a.carrier, 'stunned');
  const { turns, log } = harness([a, slot('b', 1)], { skip: (s) => { log.push(`skip:${s.name}`); return 'advance'; } });
  assert.equal(turns.begin(), 'taken');
  assert.deepEqual(log, ['skip:a', 'take:b']);
});

test('an AI unit that cannot act HOLDS the turn while it stands there', () => {
  // The host plays out a beat on the dazed body; the engine must not walk past
  // it in the same frame, or nothing on screen says why it did nothing.
  const a = slot('a', 9);
  applyStatus(a.carrier, 'stunned');
  const { turns, log } = harness([a, slot('b', 1)], { skip: (s) => { log.push(`hold:${s.name}`); return 'hold'; } });
  assert.equal(turns.begin(), 'taken');
  assert.deepEqual(log, ['hold:a'], 'b was not offered the turn');
  assert.equal(turns.current, a);
});

test('a one-turn stun costs its owner the turn, then clears', () => {
  // The order matters and is easy to get backwards: the tick that expires the
  // status runs AFTER the engine has read it. Reading after would let a
  // one-turn stun lapse just in time for its victim to act - a stun that never
  // cost anything.
  const a = slot('a', 9);
  applyStatus(a.carrier, 'stunned'); // duration 1
  let skips = 0;
  const { turns, log } = harness([a, slot('b', 1)], { skip: () => { skips += 1; return 'advance'; } });
  turns.begin();
  assert.equal(skips, 1, 'the stun cost this turn');
  turns.advance(); // round, back to a - the tick has since expired it
  assert.equal(skips, 1, 'and only this one');
  assert.deepEqual(log.filter((l) => l.startsWith('take')), ['take:b', 'take:a']);
});

// --- turn-start dots ------------------------------------------------------

test('a dot that leaves its owner standing does not cost the turn', () => {
  const a = slot('a', 9);
  applyStatus(a.carrier, 'burning');
  const seen = [];
  const { turns, log } = harness([a, slot('b', 1)], {
    dot: (s, dmg) => { seen.push([s.name, dmg]); return 'stands'; },
  });
  turns.begin();
  assert.deepEqual(seen, [['a', 2]]); // burning's dot, from the registry
  assert.deepEqual(log, ['take:a']);
});

test('a dot that drops its owner passes the turn on', () => {
  const a = slot('a', 9);
  applyStatus(a.carrier, 'burning');
  const { turns, log } = harness([a, slot('b', 1)], {
    dot: (s) => { s.alive = false; return 'fell'; },
  });
  assert.equal(turns.begin(), 'taken');
  assert.deepEqual(log, ['take:b']);
});

test('a dot that decides the fight ends it WITHOUT opening a fresh round', () => {
  // The burning slot is last in the order, so moving the pointer would wrap -
  // aging the fire and refilling reactions on a fight that is already over.
  const a = slot('a', 9);
  const b = slot('b', 1);
  applyStatus(b.carrier, 'burning');
  let done = null;
  const { turns, log } = harness([a, b], {
    dot: (s) => { s.alive = false; done = 'lose'; return 'fell'; },
    outcome: () => done,
  });
  turns.begin(); // a
  assert.equal(turns.advance(), 'over');
  assert.deepEqual(log, ['take:a', 'lose']);
  assert.ok(!log.includes('round'), 'no round opened on a decided fight');
});

// --- joining mid-fight ----------------------------------------------------

test('a joiner slots in by its roll and keeps the acting unit current', () => {
  const a = slot('a', 9);
  const c = slot('c', 1);
  const { turns } = harness([a, c]);
  turns.begin();
  turns.advance(); // c has the floor, at index 1
  assert.equal(turns.current, c);
  const joiner = slot('j', 5);
  turns.insert(joiner);
  assert.equal(turns.current, c, 'the unit mid-turn did not hand the floor over');
  assert.deepEqual(turns.order.map((s) => s.name), ['a', 'j', 'c']);
});

test('a joiner behind the pointer does not steal the current turn either', () => {
  const { turns } = harness([slot('a', 9), slot('b', 5), slot('c', 1)]);
  turns.begin(); // a, index 0
  const joiner = slot('j', 20); // rolls above everyone - lands at the front
  turns.insert(joiner);
  assert.equal(turns.order[0], joiner);
  assert.equal(turns.current.name, 'a', 'still a\'s turn');
  assert.equal(turns.index, 1);
});

// --- the ambush -----------------------------------------------------------

test('lead moves the ambusher to the front and NOBODY loses a first turn', () => {
  // The bug this replaced: the pointer was jumped to the ambusher's existing
  // slot, so every slot ahead of them silently lost its whole first round.
  const teammate = slot('teammate', 9); // out-rolls the ambusher
  const ambusher = slot('ambusher', 1);
  const foe = slot('foe', 5);
  const { turns, log } = harness([teammate, ambusher, foe]);
  assert.equal(turns.lead((s) => s === ambusher), true);
  assert.deepEqual(turns.order.map((s) => s.name), ['ambusher', 'teammate', 'foe']);
  turns.begin();
  turns.advance();
  turns.advance();
  assert.deepEqual(log, ['take:ambusher', 'take:teammate', 'take:foe'],
    'everyone still got a first-round turn');
});

test('the ambusher takes the top roll, so the order stays sorted for joiners', () => {
  // `insert` walks a DESCENDING array. Leaving the ambusher's low roll at the
  // front would put a joiner ahead of slots it should have landed behind.
  const ambusher = slot('ambusher', 1);
  const { turns } = harness([slot('a', 9), ambusher, slot('c', 4)]);
  turns.lead((s) => s === ambusher);
  const inits = turns.order.map((s) => s.init);
  assert.deepEqual([...inits].sort((x, y) => y - x), inits, 'still descending');
  assert.ok(inits[0] > inits[1], 'the ambusher out-rolls the field');
});

test('lead reports a miss and leaves the order alone', () => {
  const { turns } = harness([slot('a', 9), slot('b', 1)]);
  const before = turns.order.map((s) => s.name);
  assert.equal(turns.lead((s) => s.name === 'nobody'), false);
  assert.deepEqual(turns.order.map((s) => s.name), before);
  assert.equal(turns.index, 0);
});

// --- the optional hooks ---------------------------------------------------

test('beforeAdvance fires when a turn is given up, not when one is opened', () => {
  const fired = [];
  const { turns } = harness([slot('a', 9), slot('b', 1)], {
    beforeAdvance: () => fired.push('clear'),
  });
  turns.begin();
  assert.deepEqual(fired, [], 'opening the first turn disarms nothing');
  turns.advance();
  assert.deepEqual(fired, ['clear']);
});

test('turnStart fires on every attempt, including the ones that skip', () => {
  const dead = slot('dead', 5, { alive: false });
  let starts = 0;
  const { turns } = harness([slot('a', 9), dead, slot('c', 1)], {
    turnStart: () => { starts += 1; },
  });
  turns.begin(); // a
  turns.advance(); // attempts dead, then c
  assert.equal(starts, 3);
});

test('afterTick fires with the slot whose statuses just ticked', () => {
  const a = slot('a', 9);
  const ticked = [];
  const { turns } = harness([a, slot('b', 1)], { afterTick: (s) => ticked.push(s.name) });
  turns.begin();
  assert.deepEqual(ticked, ['a']);
});

test('the engine works without the optional hooks at all', () => {
  // turnStart/afterTick/beforeAdvance are optional by design - a host that
  // supplies none of them must still get a working walk.
  const turns = createTurnOrder({
    entries: [slot('a', 9), slot('b', 1)],
    rng: seqRng([0.5]),
    host: {
      alive: () => true,
      carrier: (s) => s.carrier,
      outcome: () => null,
      win: () => {}, lose: () => {},
      lifetimeLeft: () => null,
      spendLifetime: () => {},
      expire: () => {},
      dot: () => 'stands',
      skip: () => 'advance',
      take: () => {},
      roundStart: () => {},
    },
  });
  assert.equal(turns.begin(), 'taken');
  assert.equal(turns.advance(), 'taken');
  assert.equal(turns.advance(), 'taken'); // wraps
});
