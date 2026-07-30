// Take Cover (TACTICS_PLAN M6): the Gears turn. An entrenched target is
// IMMUNE to ranged attacks from the angles its shield blocks - not harder to
// hit, unhittable - and the counters are the point: flank for an angle, walk
// in swinging, or bring the furniture down. Both sides crouch by the same
// rules (decision #11), which is what these specs lean on: the AI's turtle
// beat is deterministic geometry, so a boxed-in Manager NEEDS no scripting
// to take cover - only nowhere better to be.
import { test, expect } from '@playwright/test';
import {
  bootStash, enterCombat, waitForPlayerTurn, refillAp, clickWorld, waitStill,
} from './helpers.js';

const setPaper = (page, n) => page.evaluate((v) => {
  window.__god.player.paper = v;
  window.__combat?.refresh();
}, n);
const lastLine = (page) => page.evaluate(() => window.__game.narration.at(-1) || '');
const clickManager = async (page) => {
  const p = await page.evaluate(() => {
    const en = window.__game.enemies.find((e) => e.alive);
    return window.__game.project3(en.px ?? en.x, 0.9, en.pz ?? en.z);
  });
  await page.mouse.click(p.x, p.y);
};

// A Manager boxed in by filing cabinets: low solids, so bodies are stuck but
// sight (and thrown paper) passes over. With nowhere to walk and nobody in
// reach, its turn has exactly one good beat - crouch behind the cabinet that
// faces its attacker - and the player's throw then has exactly one answer:
// walk around and take the angle the shield does not block.
const TURTLE_BOX = {
  name: 'Turtle Box',
  tiles: { '#': 'wall', '.': 'floor', B: 'cabinet' },
  actors: { '@': 'player', M: 'manager' },
  map: [
    '#########',
    '#@......#',
    '#..BBB..#',
    '#..BMB..#',
    '#..BBB..#',
    '#.......#',
    '#########',
  ],
};

test('a crouched foe refuses the shot, and flanking wins it back', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, TURTLE_BOX);
  await setPaper(page, 5);

  // Open the fight WITH a throw over the cabinets - proof in passing that a
  // not-yet-crouched target in the box is perfectly hittable.
  await page.click('#hotbar-act-paper-ball');
  await expect.poll(() => page.evaluate(() => window.__game.armed), { timeout: 10_000 })
    .toBe('paper-ball');
  await clickManager(page);
  await expect.poll(() => page.evaluate(() => window.__game.inCombat), { timeout: 30_000 }).toBe(true);
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => window.__god.player.paper)).toBe(4);
  await page.evaluate(() => { window.__combat.forceHit = true; });

  // Hand turns over until the Manager's beat comes up and it tucks in. It is
  // surprised (engaged from range), so the crouch lands on its SECOND turn.
  for (let i = 0; i < 4
    && !(await page.evaluate(() => window.__combat.crouched.length)); i++) {
    await waitForPlayerTurn(page);
    await page.click('#combat-end-turn');
    await page.waitForTimeout(1500);
  }
  await waitForPlayerTurn(page);
  const crouch = await page.evaluate(() => window.__combat.crouched);
  expect(crouch.length, 'the boxed Manager took cover').toBe(1);
  expect(crouch[0].human).toBe(false);
  // The AI picks a cell that actually stands between it and its target - the
  // west or north cabinet, facing the player's corner - never a far-side one.
  expect(`${crouch[0].x},${crouch[0].z}`).toMatch(/^(3,3|4,2)$/);

  // The same throw that opened the fight is now refused - for free.
  await refillAp(page);
  await setPaper(page, 4);
  await page.click('#hotbar-act-paper-ball');
  await expect.poll(() => page.evaluate(() => window.__combat.armed), { timeout: 10_000 })
    .toBe('paper-ball');
  await clickManager(page);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__god.player.paper), 'a refusal costs nothing').toBe(4);
  expect(await lastLine(page)).toMatch(/no shot/i);

  // Flank: walk to due south of the box, where the crouched shield (west or
  // north of the Manager) blocks nothing, and the throw lands again.
  const before = await page.evaluate(() =>
    window.__combat.enemies.find((e) => e.alive).hp);
  // A refusal deliberately keeps a user-armed throw up - lower it (the slot
  // toggles) or the walk click below would read as an invalid aim.
  await page.click('#hotbar-act-paper-ball');
  await expect.poll(() => page.evaluate(() => window.__combat.armed), { timeout: 10_000 })
    .toBe(null);
  await refillAp(page);
  await clickWorld(page, 4, 5);
  await waitStill(page, 20_000).catch(() => {});
  await refillAp(page);
  const pt = await page.evaluate(() => window.__game.playerTile);
  expect([pt.x, pt.z], 'made it to the flanking tile').toEqual([4, 5]);
  await page.click('#hotbar-act-paper-ball');
  await expect.poll(() => page.evaluate(() => window.__combat.armed), { timeout: 10_000 })
    .toBe('paper-ball');
  await clickManager(page);
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => window.__god.player.paper)).toBe(3);
  expect(await page.evaluate(() =>
    window.__combat.enemies.find((e) => e.alive).hp)).toBeLessThan(before);
});

// The player's side of the verb: aim it at a desk, walk over, tuck in - and
// the first deliberate step breaks it.
const CROUCH_LAB = {
  name: 'Crouch Lab',
  tiles: { '#': 'wall', '.': 'floor', D: 'desk' },
  actors: { '@': 'player', M: 'manager' },
  map: [
    '########',
    '#@M....#',
    '#...D..#',
    '#......#',
    '########',
  ],
};

test('take cover walks you in behind the desk, and moving breaks it', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, CROUCH_LAB);
  // Available OUT of a fight too (designer, 2026-07-30), and still lit the
  // moment one starts with no other press - the bar rebuild used to wait for
  // the next button, which read as "take cover never becomes active".
  await expect(page.locator('#hotbar-act-take-cover')).toHaveAttribute('data-affordable', 'true');
  await enterCombat(page); // the adjacent Manager opens the fight
  await waitForPlayerTurn(page);
  await expect(page.locator('#hotbar-act-take-cover')).toHaveAttribute('data-affordable', 'true');
  await refillAp(page);

  await page.click('#hotbar-act-take-cover');
  await expect.poll(() => page.evaluate(() => window.__combat.armed), { timeout: 10_000 })
    .toBe('take-cover');
  // Click the DESK's tile. Armed tile clicks resolve by tile (the topple spec
  // leans on the same fact), so the desk mesh cannot occlude its own cell.
  await clickWorld(page, 4, 2);
  // The crouch resolves on ARRIVAL (the pendingMelee pattern) - wait out the walk.
  await expect.poll(() => page.evaluate(() => window.__combat.crouched.length),
    { timeout: 30_000 }).toBe(1);
  const crouch = await page.evaluate(() => window.__combat.crouched[0]);
  expect([crouch.x, crouch.z], 'crouched behind the desk cell').toEqual([4, 2]);
  expect(crouch.human).toBe(false);
  // ...and standing on one of the desk's faces, not somewhere diagonal.
  const pt = await page.evaluate(() => window.__game.playerTile);
  expect(Math.abs(pt.x - 4) + Math.abs(pt.z - 2), 'orthogonally adjacent').toBe(1);

  // The first deliberate move ends it - the commitment breaks when the walk
  // BEGINS, not when it lands somewhere.
  await refillAp(page);
  await clickWorld(page, 1, 3);
  await expect.poll(() => page.evaluate(() => window.__combat.crouched.length),
    { timeout: 20_000 }).toBe(0);
});

// The office's first cover is its cubicle walls - EDGES, not cells - and the
// verb has to speak them too (designer, playtesting 2026-07-30): aim at the
// tile against the partition, crouch ON it, and the edges decide which shots
// are blocked, live.
const PARTITION_LAB = {
  name: 'Partition Lab',
  tiles: { '#': 'wall', '.': 'floor' },
  actors: { '@': 'player', M: 'manager' },
  walls: ['V 4 2 1'], // a partition on the west face of (4,2)
  map: [
    '########',
    '#@M....#',
    '#......#',
    '#......#',
    '########',
  ],
};

test('a tile against a partition is a legal crouch', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, PARTITION_LAB);
  await enterCombat(page);
  await waitForPlayerTurn(page);
  await refillAp(page);

  await page.click('#hotbar-act-take-cover');
  await expect.poll(() => page.evaluate(() => window.__combat.armed), { timeout: 10_000 })
    .toBe('take-cover');
  await clickWorld(page, 4, 2);
  await expect.poll(() => page.evaluate(() => window.__combat.crouched.length),
    { timeout: 30_000 }).toBe(1);
  const crouch = await page.evaluate(() => window.__combat.crouched[0]);
  expect(crouch.edges, 'an edge-mode crouch, not a cell one').toBe(true);
  const pt = await page.evaluate(() => window.__game.playerTile);
  expect([pt.x, pt.z], 'crouched ON the partition tile itself').toEqual([4, 2]);
});

// Both verbs work with no fight on (designer, 2026-07-30) - and the whole
// point of an early crouch is that the fight STARTING does not stand you up:
// beginCombat hands the crouch to startCombat (preCrouch) and the leader
// opens the fight already tucked in.
const OOC_LAB = {
  name: 'OOC Lab',
  tiles: { '#': 'wall', '.': 'floor', D: 'desk', B: 'cabinet' },
  actors: { '@': 'player', M: 'manager' },
  // The partition stands in the open west corridor - the desk and the
  // cabinet box wall off the map's east half, so anything the player must
  // WALK to has to live on their own side.
  walls: ['V 2 3 1'], // between (1,3) and (2,3)
  map: [
    '#########',
    '#@.D....#',
    '#..BBB..#',
    '#..BMB..#',
    '#..BBB..#',
    '#########',
  ],
};

test('a crouch taken before the fight rides into it', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, OOC_LAB);
  await setPaper(page, 5);

  // Crouch behind the desk with no fight on.
  await page.click('#hotbar-act-take-cover');
  await expect.poll(() => page.evaluate(() => window.__game.armed), { timeout: 10_000 })
    .toBe('take-cover');
  await clickWorld(page, 3, 1);
  await expect.poll(() => page.evaluate(() => !!window.__game.oocCrouch), { timeout: 30_000 })
    .toBe(true);
  expect(await page.evaluate(() => window.__game.oocCrouch)).toMatchObject({ x: 3, z: 1, edges: false });

  // Open the fight WITH a throw, from the crouch - attacking never breaks it.
  await page.click('#hotbar-act-paper-ball');
  await expect.poll(() => page.evaluate(() => window.__game.armed), { timeout: 10_000 })
    .toBe('paper-ball');
  await clickManager(page);
  await expect.poll(() => page.evaluate(() => window.__game.inCombat), { timeout: 30_000 }).toBe(true);
  await page.waitForTimeout(500);
  // The fight starts with the leader already crouched behind the desk cell.
  const crouch = await page.evaluate(() => window.__combat.crouched);
  expect(crouch.length, 'the crouch survived the combat handoff').toBe(1);
  expect([crouch[0].x, crouch[0].z]).toEqual([3, 1]);
  expect(await page.evaluate(() => window.__game.oocCrouch), 'combat owns it now').toBe(null);
});

test('a partition topples with no fight on, and no fight starts', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, OOC_LAB);

  await page.click('#hotbar-act-shove');
  await expect.poll(() => page.evaluate(() => window.__game.armed), { timeout: 10_000 })
    .toBe('shove');
  // Click the far side of the partition: the player walks to the near side
  // and puts a shoulder into it.
  await clickWorld(page, 2, 3);
  await expect.poll(() => page.evaluate(() => window.__game.tileAt(2, 3)), { timeout: 30_000 })
    .toBe('partition-fallen');
  expect(await page.evaluate(() => window.__game.stepOpenAt(1, 3, 2, 3))).toBe(true);
  expect(await page.evaluate(() => window.__game.walkable(2, 3)), 'a board, not a wall').toBe(true);
  expect(await page.evaluate(() => window.__game.inCombat), 'nobody noticed').toBe(false);
});
