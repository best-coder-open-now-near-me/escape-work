// The new action verbs (POWERS_PLAN.md), driven through the real game.
//
// The unit suite (tests/unit/powers.test.js) owns the rules; these specs own
// the WIRING - that arming a friendly verb points the click at the other half
// of the board, that the payload actually lands on the sheet it named, and
// that the AP and the use are spent exactly once.
import { test, expect } from '@playwright/test';
import {
  bootStash, enterCombat, waitForPlayerTurn, refillAp, clickAction,
  combatState, onScreen, clickWorld, waitStill,
} from './helpers.js';

// Every test here plays a class whose kit is verbs rather than a swing - IT
// Support and HR have no attack of their own. That makes the WAY IN to a fight
// the expensive part: a class with an attack opens combat from range, but for
// these the same click resolves as "move adjacent", so the entire walk has to
// finish before the fight can even start.
//
// On the shipped level1 that walk is long, across a furnished floor, with the
// camera re-settling between engage attempts - and under CI's software GL it
// did not fit in the 120s budget. That is exactly how three of these specs
// failed on main, all with the same "Test timeout of 120000ms exceeded" inside
// enterCombat.
//
// So none of them boot level1 any more. They engage in a bespoke arena instead
// (the summons.spec idiom): one coworker, two tiles away, open floor. The
// walk-up is KEPT - it is what the specs mean, and removing it is what broke
// Detain when the startFightNow fast path tried it - it is just one step now
// instead of twenty.
//
// There is deliberately NO test.slow() here. The arena fix landed alongside
// one, as insurance, and it is gone because insurance against a fixed problem
// only buys a slower way to learn about the next one: a genuine hang now fails
// in 120s instead of grinding for 360s before saying so. Measured on the
// slowest environment available, the three arena specs come in at 60s, 55s and
// 49s - half the default budget, not the edge of a tripled one.
//
// If one of these ever times out again, that is a real signal. Read it as one
// rather than reaching for the budget dial.

// Just you and one Manager, two tiles apart, open room: enterCombat walks one
// step and the fight opens against the Manager alone. Nothing here depends on
// level1's furniture - these specs are about what a VERB does once a fight is
// running - and a lone figure on clear floor also projects far more reliably
// than one in a cluttered office, which is the case enterCombat needs its
// project3 -> project fallback for.
const VERB_ARENA = {
  name: 'Verb Arena',
  tiles: { '#': 'wall', '.': 'floor' },
  actors: { '@': 'player', M: 'manager' },
  map: [
    '###########',
    '#.........#',
    '#.........#',
    '#...@.M...#',
    '#.........#',
    '#.........#',
    '###########',
  ],
};

// A long room, so the Manager has to WALK to reach the guard - overwatch fires
// on somebody entering covered ground, which needs somebody who moves.
const WATCH_HALL = {
  name: 'Watch Hall',
  tiles: { '#': 'wall', '.': 'floor' },
  actors: { '@': 'player', M: 'manager' },
  map: [
    '##########',
    '#.@.....M#',
    '##########',
  ],
};

// The acting member's live status ids, straight off the combat surface.
const myStatuses = (page) => page.evaluate(() =>
  (window.__combat.party.find((m) => m.active)?.statuses ?? []).map((s) => s.id));

// Click the acting member's OWN body. project3 aims at a world point at a
// given height, which is what makes a click land on a tall mesh rather than
// the floor tile behind it.
async function clickSelf(page) {
  const p = await page.evaluate(() => {
    const a = window.__combat.actingAt;
    return window.__game.project3(a.x, 0.6, a.z);
  });
  expect(onScreen(p), `own body projected off-screen at ${JSON.stringify(p)}`).toBe(true);
  await page.mouse.click(p.x, p.y);
}

test('Reboot self-cast clears every status', async ({ page }) => {
  await bootStash(page, VERB_ARENA, 'it-support');
  await enterCombat(page);
  await waitForPlayerTurn(page);
  await refillAp(page);

  // Put something on ourselves to clear. `bleed` is a step-clock status, so it
  // will not tick away underneath the test while the click resolves.
  await page.evaluate(() => window.__combat.applyStatus('bleed', 4));
  expect(await myStatuses(page)).toContain('bleed');

  const apBefore = await page.evaluate(() => window.__combat.ap);
  await clickAction(page, 'reboot');
  expect(await page.evaluate(() => window.__combat.armed)).toBe('reboot');

  await clickSelf(page);

  // The purge landed on the sheet...
  await expect.poll(() => myStatuses(page), { timeout: 15_000 }).not.toContain('bleed');
  // ...the AP was spent once...
  const apAfter = await page.evaluate(() => window.__combat.ap);
  expect(apBefore - apAfter).toBeCloseTo(2, 1);
  // ...and the action lowered itself, the way every committed action does.
  expect(await page.evaluate(() => window.__combat.armed)).toBe(null);
});

test('a friendly verb does not arm a swing at a coworker', async ({ page }) => {
  // Driven through HR's Performance Review rather than an IT verb: Reboot is
  // an ANY-target purge now, so it legitimately DOES promise a swing at a
  // coworker, and can no longer carry a rule about friends-only verbs.
  // Performance Review is the only friends-only verb in any base kit.
  await bootStash(page, VERB_ARENA, 'human-resources');
  await enterCombat(page);
  await waitForPlayerTurn(page);
  await refillAp(page);

  await clickAction(page, 'performance-review');

  const en = await page.evaluate(() => {
    const e = window.__game.enemies.find((x) => x.alive);
    return e ? { x: e.x, z: e.z, hp: e.hp } : null;
  });
  expect(en, 'a living enemy to aim at').not.toBe(null);
  const p = await page.evaluate(([x, z]) => window.__game.project3(x, 0.6, z), [en.x, en.z]);
  expect(onScreen(p), 'enemy projected off-screen').toBe(true);

  // The crosshair is the click's own promise (ARCHITECTURE, hover.js): with a
  // buff armed, hovering a coworker must NOT claim a swing, because the click
  // would refuse one. Driven through a REAL mouse move so the whole hover
  // path runs - main.js's pick, combat.handleHover, hover.setCursor.
  const before = await combatState(page);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__game.cursor)).not.toBe('crosshair');

  // And the enemy takes no damage from a click aimed at them.
  await page.mouse.click(p.x, p.y);
  const after = await page.evaluate(([x, z]) =>
    window.__game.enemies.find((e) => e.x === x && e.z === z)?.hp ?? null, [en.x, en.z]);
  expect(after, `enemy HP changed after a buff-armed click (${JSON.stringify(before.enemies)})`)
    .toBe(en.hp);
});

test('Performance Review is HR\'s, and it lands the Commended status', async ({ page }) => {
  await bootStash(page, VERB_ARENA, 'human-resources');
  await enterCombat(page);
  await waitForPlayerTurn(page);
  await refillAp(page);

  await clickAction(page, 'performance-review');
  await clickSelf(page);

  await expect.poll(() => myStatuses(page), { timeout: 15_000 }).toContain('commended');
});

test('Stand Post holds an overwatch, and it fires once on somebody crossing the line', async ({ page }) => {
  // The one test here that keeps an explicit budget, the one it always had.
  // Unlike the three above it does not just walk in and act: it holds an
  // overwatch and then needs the Manager to cross the WHOLE hall to trip it, so
  // its cost is a full walk by somebody else. Measured at ~1.4m, comfortably
  // over the 120s default.
  test.setTimeout(300_000);
  await bootStash(page, WATCH_HALL, 'security');
  await enterCombat(page);
  await waitForPlayerTurn(page);
  await refillAp(page);
  await page.evaluate(() => { window.__combat.forceHit = true; });

  // enterCombat walks you INTO the enemy to trigger the fight, so by now the
  // Manager is adjacent and has no reason to move - and overwatch only fires
  // on somebody who moves. Back off down the hall first so there is an
  // approach to catch. (This provokes the Manager's own opportunity attack on
  // the way out, which spends THEIR reaction, not ours.)
  await clickWorld(page, 2, 1);
  await waitStill(page);

  const foeBefore = await page.evaluate(() => window.__combat.enemies.find((e) => e.alive));
  expect(foeBefore, 'a living Manager to walk at us').toBeTruthy();
  expect(
    Math.max(Math.abs(foeBefore.x - 2), Math.abs(foeBefore.z - 1)),
    'the Manager should be far enough away that it has to walk',
  ).toBeGreaterThan(1);

  // The stance's AP is spent up front; the retreat above already ate some, and
  // this spec is about the reaction, not the AP economy.
  await refillAp(page);
  const apBefore = await page.evaluate(() => window.__combat.ap);
  // A stance is an instant self-action: first press arms, second commits.
  await clickAction(page, 'stand-post');
  await page.click('#act-stand-post');

  // It registers as held, and it cost the AP up front.
  await expect.poll(() => page.evaluate(() => window.__combat.watching), { timeout: 10_000 })
    .not.toHaveLength(0);
  expect(apBefore - (await page.evaluate(() => window.__combat.ap))).toBeCloseTo(2, 1);

  // Hand the floor over. The Manager has to cross the hall to reach us, which
  // means crossing the watched radius.
  await page.click('#combat-end-turn');

  // The payoff lands on somebody ELSE's turn: either the Manager took the free
  // swing on the way in, or the stance lapsed at our next turn without them
  // ever entering the radius. The first is the feature; assert it.
  await expect.poll(async () => {
    const f = await page.evaluate(() => window.__combat.enemies.find((e) => e.alive));
    return f ? f.hp : 0;
  }, { timeout: 60_000 }).toBeLessThan(foeBefore.hp);

  // ...and firing SPENDS it. An overwatch that re-armed itself off one turn's
  // AP would cover the rest of the fight for free.
  expect(await page.evaluate(() => window.__combat.watching)).toHaveLength(0);
});
