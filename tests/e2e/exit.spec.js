// The way OUT - the one thing the whole game is about, and the seam the suite
// never crossed. Reaching an exit tile is what ends a floor, writes the
// campaign save, carries the party to the next floor, and (on the last floor)
// wins the run; a party wipe is the only way to lose one. None of it had a
// test: `gameOver` was only ever asserted FALSE, so a bug in the exit branch
// would have corrupted every campaign save with the suite green.
//
// The campaign test drives the REAL level1, because the branch under test is
// "this floor has a `next`" and only a registered floor does. It reads the exit
// tile out of the level JSON rather than hard-coding coordinates that a layout
// edit would stale.
import { test, expect } from '@playwright/test';
import level1 from '../../levels/level1.json' with { type: 'json' };
import { TILE_TYPES } from '../../src/data/tiles.js';
import { bootStash, bootAndPick, waitStill, enterCombat } from './helpers.js';

const PROGRESS_KEY = 'escape-work.progress';

// Where the exit stands on a level, straight out of its own map + legend.
function exitTile(level) {
  for (let z = 0; z < level.map.length; z++) {
    const row = level.map[z];
    for (let x = 0; x < row.length; x++) {
      if (level.tiles[row[x]] === 'exit') return { x, z };
    }
  }
  throw new Error('level has no exit tile');
}

// Every tile you could stand on, read from the level's own legend and the tile
// registry. Used to pick walk targets that are actually walkable - clicking a
// desk does nothing, and a test that silently clicks furniture makes no
// progress while looking like it tried.
function walkableTiles(level) {
  const out = [];
  for (let z = 0; z < level.map.length; z++) {
    const row = level.map[z];
    for (let x = 0; x < row.length; x++) {
      const def = TILE_TYPES[level.tiles[row[x]]];
      if (def && !def.solid) out.push([x, z]);
    }
  }
  return out;
}

// A one-room floor whose exit is two steps away. A stashed playtest level is
// never part of the campaign, so its exit ends the run - which is exactly the
// win branch.
const EXIT_ROOM = {
  name: 'Exit Room',
  tiles: { '#': 'wall', '.': 'floor', '>': 'exit' },
  actors: { '@': 'player' },
  map: [
    '######',
    '#.@.>#',
    '######',
  ],
};

// A cell with one coworker and no way out - for the wipe.
const LAST_STAND = {
  name: 'Last Stand',
  tiles: { '#': 'wall', '.': 'floor' },
  actors: { '@': 'player', M: 'manager' },
  map: [
    '#####',
    '#.@M#',
    '#####',
  ],
};

const progress = (page) => page.evaluate((k) => {
  const raw = localStorage.getItem(k);
  return raw ? JSON.parse(raw) : null;
}, PROGRESS_KEY);

// Click a tile and let the walk play out. The exit fires on DELIBERATE arrival
// (the end of a path), so a walk cut short by a slip has to be re-issued -
// hence the retries rather than a single click.
async function walkOnto(page, x, z, tries = 6) {
  for (let i = 0; i < tries; i++) {
    const p = await page.evaluate(([wx, wz]) => window.__game.project(wx, wz), [x, z]);
    if (p && p.x > 10 && p.x < 1270 && p.y > 10 && p.y < 790) {
      await page.mouse.click(p.x, p.y);
      await waitStill(page);
    }
    if (await page.evaluate(() => window.__game.gameOver)) return true;
    await page.waitForTimeout(500);
  }
  return page.evaluate(() => window.__game.gameOver);
}

// Cross a whole floor in HOPS. A shipped level is bigger than the viewport:
// its far corner does not project on screen from the spawn, and a click aimed
// off-screen is a silent no-op - so aiming straight at a distant exit makes no
// progress at all while looking exactly like a walk that failed.
//
// Instead: each round, click the walkable tile NEAREST the target that is
// currently on screen. The camera follows, more of the floor comes into view,
// and pathfinding does the routing for each hop. A hop that moves nobody means
// that tile is unreachable from here (a sealed closet can be on screen and
// closer to the goal than anywhere useful), so it is struck off and the next
// round picks another.
async function walkAcross(page, target, walkables, rounds = 16) {
  const banned = new Set();
  const tileNow = () => page.evaluate(() => window.__game.playerTile);
  for (let i = 0; i < rounds; i++) {
    if (await page.evaluate(() => window.__game.gameOver)) return true;
    const options = walkables.filter(([x, z]) => !banned.has(`${x},${z}`));
    const shots = await page.evaluate((list) => list.map(([x, z]) => {
      const p = window.__game.project(x, z);
      return { x, z, sx: p.x, sy: p.y };
    }), options);
    // Keep well clear of the fixed UI: the hotbar sits bottom-centre and would
    // swallow a click meant for the floor behind it.
    const visible = shots.filter((p) => p.sx > 40 && p.sx < 1240 && p.sy > 70 && p.sy < 660);
    if (!visible.length) return false;
    visible.sort((a, b) => Math.hypot(a.x - target.x, a.z - target.z) - Math.hypot(b.x - target.x, b.z - target.z));
    const aim = visible[0];
    const before = await tileNow();
    await page.mouse.click(aim.sx, aim.sy);
    await waitStill(page);
    if (await page.evaluate(() => window.__game.gameOver)) return true;
    const after = await tileNow();
    if (before.x === after.x && before.z === after.z) banned.add(`${aim.x},${aim.z}`);
  }
  return page.evaluate(() => window.__game.gameOver);
}

test('walking out of a PLAYTEST level wins it and leaves the campaign save alone', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, EXIT_ROOM);
  // A campaign save belonging to a real run, sitting in the same browser.
  const save = { version: 6, levelId: 'level2' };
  await page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [PROGRESS_KEY, save]);

  expect(await walkOnto(page, 4, 1)).toBe(true);
  await expect(page.locator('#win-screen')).toBeVisible();
  expect(await page.locator('#win-screen').textContent()).toMatch(/YOU ESCAPED WORK/);

  // This assertion is INVERTED from what it used to be, deliberately. A level
  // launched from the editor is standalone - its own party, no floor chain -
  // and finishing one is not finishing a campaign run. The old behaviour let a
  // playtest delete somebody's progress just by reaching the exit in it, which
  // is a tool costing a player their save.
  expect(await progress(page)).toEqual(save);
});

test('the exit mid-campaign banks the save and carries the party to the next floor', async ({ page }) => {
  test.setTimeout(300_000);
  await bootAndPick(page); // the REAL level1 - the only kind with a `next`
  // Clear the floor first: this test is about the stairwell, not about fighting
  // through to it, and a fight on the way would make the walk a coin flip.
  expect(await page.evaluate(() => window.__god.fight())).toBe(true);
  expect(await page.evaluate(() => window.__god.summonAlly('employee', 1, 999))).toBe(1);
  await page.evaluate(() => window.__god.enemies.forEach((e) => { if (e.alive) e.die(); }));
  await expect.poll(() => page.evaluate(() => window.__game.inCombat),
    { timeout: 20_000 }).toBe(false);
  // Wounded on the way out. Wounds CARRY now: the stairwell breather was struck
  // 2026-08-02 with the rest of the automatic healing ("i also never asked for
  // auto healing between floors"), so this is what a floor transition must NOT
  // change.
  await page.evaluate(() => { window.__god.player.hp = 4; });

  const exit = exitTile(level1);
  expect(await walkAcross(page, exit, walkableTiles(level1))).toBe(true);

  await expect(page.locator('#floor-clear')).toBeVisible();
  expect(await page.locator('#floor-clear').textContent()).toMatch(/FLOOR CLEAR/);

  // The save names the NEXT floor, carries the roster, and is at the current
  // version - the three things a resume depends on.
  const saved = await progress(page);
  expect(saved).not.toBe(null);
  expect(saved.levelId).toBe('level2');
  expect(saved.party.length).toBeGreaterThanOrEqual(1);
  expect(saved.version).toBeGreaterThanOrEqual(6);
  expect(saved.temporaryAllies).toHaveLength(1);
  expect(saved.temporaryAllies[0]).toMatchObject({ archetypeId: 'employee', hp: 5 });
  expect(saved.temporaryAllies[0].turnsLeft).toBeGreaterThan(0);
  // INVERTED 2026-08-02. This used to assert the stairwell breather healed the
  // party on the way out. There is no breather - you take a floor's damage to
  // the next floor, and casualties with it.
  expect(saved.party[0].hp).toBe(4);

  // Keep Climbing actually arrives on the next floor, with the sheet intact.
  await page.click('#next-floor');
  await page.waitForFunction(() => window.__game && window.__game.stats, null, { timeout: 90_000 });
  expect(await page.evaluate(() => window.__game.levelId)).toBe('level2');
  expect(await page.evaluate(() => window.__god.player.hp)).toBe(4);
  await expect.poll(() => page.evaluate(() => window.__game.summons.length),
    { timeout: 20_000 }).toBe(1);
  expect(await page.evaluate(() => window.__game.summons[0].turnsLeft)).toBeGreaterThan(0);
});

test('a party WIPE is the only way to lose the run', async ({ page }) => {
  test.setTimeout(300_000);
  // Solo: with no second member, the leader going down is the whole roster.
  // (party.spec pins the other half of this rule - with a teammate standing,
  // the same fall is not a loss.)
  await bootStash(page, LAST_STAND);
  await enterCombat(page);
  expect(await page.evaluate(() => window.__combat.party.length)).toBe(1);

  await page.evaluate(() => { window.__combat.forceHit = true; });
  await page.evaluate(() => { window.__god.player.hp = 1; window.__combat.refresh(); });

  // End turns until the Manager lands the blow that finishes the roster.
  await expect.poll(async () => {
    if (await page.evaluate(() => window.__combat?.phase) === 'player') {
      await page.click('#combat-end-turn').catch(() => {});
    }
    return page.evaluate(() => window.__game.gameOver);
  }, { timeout: 180_000, intervals: [900] }).toBe(true);

  await expect(page.locator('#lose-screen')).toBeVisible();
  expect(await page.locator('#lose-screen').textContent()).toMatch(/STUCK AT WORK/);
});
