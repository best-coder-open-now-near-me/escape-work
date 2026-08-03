// The enemy KIT, in bespoke arenas: the two coworkers whose whole point is a
// verb the base Manager does not have, and the two AI beats that had no test at
// any level (Q005).
//
// Q024 asked for this and was half right by the time it was reached. The
// Executive IS fought - `ai.spec.js`'s Range Hall pins that he shoots from
// across the room instead of closing - so the enemy RANGED kit is covered.
// What genuinely had nothing was the Security Guard: every `'security'` in the
// suite is the PLAYER's class, and the one arena named for him fights a
// Manager. His distinguishing feature is reach, and a reach nobody ever
// measured is a number, not a mechanic.
//
// The other two tests are the arena gaps Q005's measurement named: no arena
// ever wounded a colleague below the heal threshold, so `aiSupportPlan`
// returned null and the `support` arm was never reached; and the Executive
// appeared in exactly one arena, a bare corridor with no shielded face, so
// `entrench` could not fire there either. Both are asserted on the chosen-beat
// histogram, like the rest of the AI suite: a beat that fires leaves a count,
// and a beat that stops gating leaves zero however healthy the HP numbers look.
import { test, expect } from '@playwright/test';
import {
  bootStash, enterCombat, waitForPlayerTurn, refillAp,
  combatState, endTurnUntilPlayer,
} from './helpers.js';

const beats = (page) => page.evaluate(() => window.__combat?.bout?.beats ?? {});

// Hand the AI a few turns, keeping the last LIVE histogram - `__combat` is
// deleted on victory or defeat, and a fight that ended reports {}, which is the
// same answer a beat that stopped firing gives. (Same helper as ai.spec.js;
// duplicated rather than shared because the two files stage different fights
// and a shared driver would have to grow options for both.)
async function playRounds(page, n) {
  let seen = {};
  for (let i = 0; i < n; i++) {
    if (!(await page.evaluate(() => window.__game.inCombat))) break;
    await refillAp(page);
    await endTurnUntilPlayer(page).catch(() => {});
    const b = await beats(page);
    if (Object.keys(b).length) seen = b;
  }
  return seen;
}

const enemyAt = (page, name) => page.evaluate((n) => {
  const e = (window.__god.enemies || []).find((x) => x.def?.name === n);
  return e ? { x: e.x, z: e.z, hp: e.hp, alive: e.alive } : null;
}, name);

// --- the Security Guard's reach ----------------------------------------------

// The guard stands TWO tiles off, orthogonally. That gap is the whole test:
// his maglite reaches 2.1, which clears a full orthogonal tile (2.0), and the
// player's bare hands reach REACH.DEFAULT (1.5), which does not. So he can hit
// from a tile the player cannot answer from - "escorts you toward the door"
// as a rule rather than a line of flavour text.
//
// `__god.fight()` rather than a walk-in: engaging by walking ends with the
// player adjacent, which is the one geometry this test cannot use.
const ESCORT_HALL = {
  name: 'Escort Hall',
  tiles: { '#': 'wall', '.': 'floor' },
  actors: { '@': 'player', s: 'security-guard' },
  map: [
    '#######',
    '#@.s..#',
    '#######',
  ],
};

test('the Security Guard strikes from a tile bare hands cannot answer', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, ESCORT_HALL, 'office-drone');
  expect(await page.evaluate(() => window.__god.fight()), 'the fight opened in place').toBe(true);
  await waitForPlayerTurn(page);

  const before = await page.evaluate(() => window.__god.player.hp);
  const gapBefore = await enemyAt(page, 'Security Guard');
  expect(gapBefore.x - 1, 'he starts two tiles off').toBe(2);

  const b = await playRounds(page, 3);

  // He swung, which at this distance is only possible on his reach.
  expect(b.attack ?? 0,
    `the guard never took the attack beat (${JSON.stringify(await combatState(page))})`,
  ).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__god.player.hp),
    'and it landed on the player from over there').toBeLessThan(before);

  // The point of the reach is that he does NOT have to close to use it. If he
  // ends up adjacent the test still sees damage, so this is the assertion that
  // makes it about reach rather than about a coworker walking up.
  const after = await enemyAt(page, 'Security Guard');
  expect(after.x - 1, 'he never had to close the gap').toBeGreaterThanOrEqual(2);
});

// --- HR's triage (AI_PLAN M6, the `support` beat) ----------------------------

// HR and one Manager, both inside ENGAGE_RADIUS (4) of the player. That is the
// staging lever and it is easy to get wrong: `aiAllies()` is the ENGAGED list,
// so a colleague standing outside the radius is not somebody HR can triage - he
// is not in the fight at all. The first draft of this arena put the Manager six
// tiles out, and HR spent every turn posting employees instead, which reads
// exactly like a broken support arm and is really a broken arena. The test
// asserts the fight it means to stage before it asserts anything about the AI.
//
// The Manager is wounded below the heal threshold (AI.HEAL_AT, half HP) BEFORE
// the fight opens - the other half of the staging no arena in the suite had:
// with every colleague healthy `aiSupportPlan` returns null, the arm is
// unreachable, and a zero in the histogram looks deliberate.
const TRIAGE_ROOM = {
  name: 'Triage Room',
  tiles: { '#': 'wall', '.': 'floor' },
  actors: { '@': 'player', H: 'hr', M: 'manager' },
  map: [
    '##########',
    '#@.M.H...#',
    '##########',
  ],
};

test('HR triages a wounded colleague before it wades in', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, TRIAGE_ROOM, 'security');
  // Below half, and not so low that the next hit retires him mid-experiment.
  const hurt = await page.evaluate(() => {
    const m = (window.__god.enemies || []).find((e) => e.def?.name === 'The Manager');
    m.hp = Math.max(2, Math.floor(m.maxHp * 0.3));
    return m.hp;
  });
  expect(await page.evaluate(() => window.__god.fight()), 'the fight opened in place').toBe(true);
  await waitForPlayerTurn(page);
  // The staging, asserted: both coworkers are IN the fight. Without this a
  // colleague parked outside the engage radius silently turns this into a test
  // that HR summons, which is what the first draft actually proved.
  expect(await page.evaluate(() => window.__combat.order.map((s) => s.name)),
    'HR and the wounded colleague both took the floor')
    .toEqual(expect.arrayContaining(['HR Representative', 'The Manager']));

  const b = await playRounds(page, 4);

  expect(b.support ?? 0,
    `HR never took the support beat (${JSON.stringify(await combatState(page))})`,
  ).toBeGreaterThan(0);
  // The beat fired AND the healing arrived - the histogram alone would not
  // notice a triage that spent its use on nothing.
  const after = await enemyAt(page, 'The Manager');
  expect(after.hp, 'the wounded colleague is better off than we left him')
    .toBeGreaterThan(hurt);
});

// --- the Executive entrenches (AI_PLAN M5, the `entrench` beat) --------------

// The ranged kit's second half, and the arm the one existing Executive arena
// could never reach: Range Hall is a bare two-row corridor, so there is nothing
// to tuck in behind and `canCrouch` is false every frame.
//
// Here he stands beside a filing cabinet, on the face between him and the
// player - a low solid, so the shot passes over it (which is what keeps him
// able to fire) while the same height rule makes it cover. With a shot in hand
// AND cover to take, the ladder puts entrench above the plain shot: he tucks
// in on one beat and fires on a later one.
const DEADLINE_OFFICE = {
  name: 'Deadline Office',
  tiles: { '#': 'wall', '.': 'floor', B: 'cabinet' },
  actors: { '@': 'player', E: 'executive' },
  map: [
    '#########',
    '#.......#',
    '#@..BE..#',
    '#.......#',
    '#########',
  ],
};

test('the Executive takes cover before he sets the deadline', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, DEADLINE_OFFICE, 'security'); // 26 hp: outlast the shooting
  expect(await page.evaluate(() => window.__god.fight()), 'the fight opened in place').toBe(true);
  await waitForPlayerTurn(page);

  const b = await playRounds(page, 4);

  expect(b.entrench ?? 0,
    `the Executive never entrenched (${JSON.stringify(await combatState(page))})`,
  ).toBeGreaterThan(0);
  // Entrench is TWO beats by design - the crouch, then the shot on a later
  // ladder run. A crouch that never becomes a shot is a unit hiding, not a
  // unit entrenching, so both halves are asserted.
  expect(b.shoot ?? 0, 'and then he fired from behind it').toBeGreaterThan(0);
});
