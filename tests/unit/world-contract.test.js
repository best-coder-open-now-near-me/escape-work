// What the pure plan modules actually need off the host's `world`.
//
// Four exports used to take a parameter named `world` and forward it whole, so
// the contract between combat.js's 35-key facade and the rules was duck-typed:
// nothing anywhere said which keys a given rule reads, and a facade that
// stopped carrying one would fail as `undefined is not a function` deep inside
// a plan, on the frame a coworker happened to try that verb (Q041).
//
// The signatures name their needs now. These tests are what stop that being
// decorative: for each rule, a bag that works, and then the same bag with one
// required key removed, which must throw. A key quietly dropped from the facade
// is caught here rather than in a fight.
//
// They deliberately assert NEEDS, not the facade's contents - main.js is the
// entry point and importable.test.js excludes it on purpose, so the provider
// side cannot be reached from node. That half is Q900's, and it is why these
// four lists are worth writing down where a test can see them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { aiTopplePlan, aiShovePlan } from '../../src/combat-plans.js';
import { hasSwingSpot } from '../../src/combat-geometry.js';

const body = (x, z) => ({ x, z, actor: { x, z } });

// `aiPullPlan` is the fourth rule whose needs are now in its signature
// ({ stepOpen, open, bodyAt, nameOf }) and it is deliberately NOT driven here:
// reaching pullPlan's interior takes a valid shield geometry - a crouch whose
// face stands between the two bodies - and a bag that fails to build one tests
// the early return instead of the contract, which is the trap the rest of this
// file exists to avoid. Its defaults (`bodyAt`, `nameOf`) are also absorbed
// rather than thrown on, so the missing-key check would need the answer-changed
// arm and a scenario that reaches it. Worth doing; not done.

// Each entry: the rule, a bag it can run against, and how to call it. The bags
// answer "nothing is there" wherever they can, so a rule that runs to
// completion returns null rather than throwing - which is what makes a THROWN
// error mean "a key was missing" and nothing else.
const RULES = [
  {
    name: 'aiTopplePlan',
    needs: ['tileDefAt', 'terrainOpen', 'stepOpen'],
    // Drives all the way to a returned plan: a toppleable def, a landing that
    // is open, and a victim standing on it. A bag that lets the rule return
    // early proves nothing - the key you deleted was never reached.
    bag: { tileDefAt: () => ({ topple: true }), terrainOpen: () => true, stepOpen: () => true },
    call: (w) => aiTopplePlan(1, 1, w, () => ({ id: 'victim' })),
  },
  {
    name: 'aiShovePlan',
    needs: ['isWalkable', 'stepOpen', 'occupied'],
    // `occupied` false and `isWalkable` true on purpose: displacePlan ORs the
    // three, so a bag that says "occupied" short-circuits before the other two
    // are ever called.
    bag: { isWalkable: () => true, stepOpen: () => true, occupied: () => false },
    call: (w) => aiShovePlan(1, 1, w, () => ({ id: 'victim' }), { disengage: true }),
  },
  {
    name: 'hasSwingSpot',
    needs: ['isWalkable', 'approach', 'stepOpen', 'bodyClear'],
    bag: {
      isWalkable: () => true,
      approach: (x, z) => [x, z],
      stepOpen: () => false,
      bodyClear: () => true,
    },
    call: (w) => hasSwingSpot(body(0, 0), body(1, 1), w),
  },
];

for (const r of RULES) {
  test(`${r.name} runs on a bag carrying exactly what it asks for`, () => {
    assert.deepEqual(Object.keys(r.bag).sort(), [...r.needs].sort(),
      'the bag is the declared need, not a superset - a superset would hide a key the rule reads but does not name');
    r.call(r.bag); // must not throw
  });

  // Dropping a declared key has to SHOW. Two ways it can, and the second is the
  // one this finding is about: some keys throw when missing, and some are
  // absorbed by a default or a `typeof` guard further down and quietly change
  // the answer instead. `hasSwingSpot` without `stepOpen` is the live example -
  // `tactics.reachOpen` returns true for a non-function edgeOpen, so every
  // swing spot starts looking reachable and nothing anywhere complains. A test
  // that only accepted a throw would call that key optional and be wrong.
  for (const key of r.needs) {
    test(`${r.name} cannot quietly run without \`${key}\``, () => {
      const full = r.call(r.bag);
      const short = { ...r.bag };
      delete short[key];
      let threw = false;
      let answer;
      try { answer = r.call(short); } catch { threw = true; }
      assert.ok(threw || JSON.stringify(answer) !== JSON.stringify(full),
        `dropping \`${key}\` neither threw nor changed the answer, so nothing would notice a facade that stopped carrying it`);
    });
  }
}

// The host hands these rules its whole 35-key facade, so every one of them has
// to tolerate a superset - which is exactly what makes the duck-typing invisible
// in production and worth pinning here.
test('a rule ignores keys it did not ask for', () => {
  for (const r of RULES) {
    r.call({ ...r.bag, somethingElse: () => { throw new Error('a rule reached for a key it never named'); } });
  }
});
