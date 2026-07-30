// Toppling (POWERS_PLAN M6): tall freestanding furniture goes over when
// shoved, and lands on whoever is behind it. The office stops being scenery
// you fight IN and becomes something you fight WITH.
import { test, expect } from '@playwright/test';
import {
  bootStash, waitForPlayerTurn, refillAp, clickAction,
  clickWorld, waitStill, combatState, onScreen,
} from './helpers.js';

// Player, cabinet, Manager in a row. Shoving the cabinet from the west lands
// it exactly on the Manager's tile - the whole point of the verb being
// direction-derived rather than aimed.
const TOPPLE_ROW = {
  name: 'Topple Row',
  tiles: { '#': 'wall', '.': 'floor', B: 'cabinet' },
  actors: { '@': 'player', M: 'manager' },
  map: [
    '#######',
    '#@BM..#',
    '#.....#',
    '#######',
  ],
};

test('a shoved cabinet lands on the coworker behind it, and leaves cover', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, TOPPLE_ROW, 'security');

  // Walk into the Manager's reach rather than clicking their body. This map
  // stands a TALL prop directly between us and them - that IS the map - so
  // `enterCombat`'s chest-height engage click lands on the cabinet mesh and no
  // fight starts: 7 attempts over 184s on run 30410302575, green on the retry.
  // The click was never off-screen or under the UI, so the helper's own
  // `onScreen`/`onCanvas` guards had nothing to report - the cabinet is on the
  // canvas too. Adjacency is what actually opens combat (`checkCombatTrigger`,
  // main.js), and a tile click resolves by TILE, so unlike a body click it
  // cannot be occluded. Prefer the tile in FRONT of the row (+z): it is nearer
  // the camera than the cabinet, so it never projects behind it either.
  // ORTHOGONAL neighbours first, and that ordering is the whole trick. Standing
  // diagonally beside the Manager is Chebyshev-adjacent but does NOT start the
  // fight: `adjacentEnemyToParty` also demands `canTakePart` (main.js:1002), a
  // line-of-sight segment through `terrainOpen`, and the diagonal from (2,2) to
  // the Manager at (3,1) clips the cabinet's own cell. The refusal is correct -
  // you cannot swing through a filing cabinet - so the test has to engage from
  // the tile SOUTH of them, where the sight line is clear floor.
  const BESIDE = [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]];
  for (let i = 0; i < BESIDE.length && !(await page.evaluate(() => window.__game.inCombat)); i++) {
    // Re-read the Manager every pass: out of combat they wander, so a tile
    // computed once can be beside where they used to be.
    const spot = await page.evaluate(([dx, dz]) => {
      const en = window.__game.enemies.find((e) => e.alive);
      if (!en) return null;
      return window.__game.walkable(en.x + dx, en.z + dz) ? { x: en.x + dx, z: en.z + dz } : null;
    }, BESIDE[i]);
    if (!spot) continue;
    await clickWorld(page, spot.x, spot.z);
    await waitStill(page, 20_000).catch(() => {});
  }
  expect(await page.evaluate(() => window.__game.inCombat),
    `never got adjacent to the Manager (${JSON.stringify(await combatState(page))})`).toBe(true);
  await waitForPlayerTurn(page);

  // We engaged from beside the cabinet. Get back west of it so the cabinet is
  // between us and them.
  await clickWorld(page, 1, 1);
  await waitStill(page);
  await waitForPlayerTurn(page);
  await refillAp(page);

  // Pin the Manager on the landing tile. Left to itself it walks toward us on
  // its turn, so the cabinet would come down on empty carpet - and this spec
  // is about what the prop does to a body, not about AI pathing. `detained`
  // is the root the control verb applies; the debug setter is the same
  // affordance forceHit is.
  // forceHit also pins the victim's GRIT SAVE (TACTICS_PLAN M6: true = the
  // drop fully lands = the save fails), so the damage/status assertions
  // below stay deterministic now that a body can dive clear.
  await page.evaluate(() => {
    window.__combat.forceHit = true;
    const m = window.__game.enemies.find((e) => e.alive);
    window.__game.debugPlaceEnemy(m.name, 3, 1);
    window.__combat.applyStatus('detained', 9, 0, m.name);
  });
  await page.waitForTimeout(300);

  const before = await page.evaluate(() => window.__combat.enemies.find((e) => e.alive));
  expect(before, 'a living Manager to drop it on').toBeTruthy();
  expect([before.x, before.z], 'the Manager is standing on the landing tile').toEqual([3, 1]);
  expect(await page.evaluate(() => window.__game.tileAt(2, 1))).toBe('cabinet');

  await clickAction(page, 'shove');
  const p = await page.evaluate(() => window.__game.project3(2, 0.4, 1));
  expect(onScreen(p), 'the cabinet projected off-screen').toBe(true);
  await page.mouse.click(p.x, p.y);

  // The prop LEFT its tile...
  await expect.poll(() => page.evaluate(() => window.__game.tileAt(2, 1)), { timeout: 20_000 })
    .toBe('floor');
  // ...and landed on the next one as its fallen twin, which is walkable cover
  // rather than a wall (a shove that spawned impassable terrain could seal a
  // doorway and strand the fight).
  expect(await page.evaluate(() => window.__game.tileAt(3, 1))).toBe('cabinet-fallen');

  // The Manager wore it.
  const after = await page.evaluate(() =>
    window.__combat.enemies.find((e) => e.name === 'The Manager'));
  expect(after.hp, `Manager took no topple damage (${JSON.stringify(await combatState(page))})`)
    .toBeLessThan(before.hp);
  // Toppling reuses the EXISTING stun, so it inherits the anti-chain window
  // rather than becoming a second way to lock somebody out of a fight.
  expect(after.alive ? after.statuses.some((s) => s.id === 'stunned') : true).toBe(true);
  // ...and a failed Grit save leaves them PINNED under it too (TACTICS_PLAN
  // M6): rooted, their turn still theirs - detained's semantics, under
  // furniture.
  expect(after.alive ? after.statuses.some((s) => s.id === 'pinned') : true).toBe(true);

  // Cover, not a wall: the landing tile is still WALKABLE. A shove that could
  // spawn impassable terrain could seal a doorway and strand a fight the enemy
  // can no longer reach - which is the failure the design refused, and the one
  // a `solid: true` twin would have reintroduced silently.
  expect(await page.evaluate(() => window.__game.walkable(3, 1))).toBe(true);
});
