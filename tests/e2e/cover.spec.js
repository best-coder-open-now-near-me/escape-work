// Take Cover (TACTICS_PLAN M6, revised 2026-07-31): the Gears turn. A crouch
// is a POSITION - you tuck in where you stand, and whatever shields the faces
// of that tile covers you along those faces, uncapped. An entrenched target is
// IMMUNE to ranged attacks down every covered face - not harder to hit,
// unhittable - and the counters are the point: take an uncovered angle, walk
// in swinging, bring the furniture down, or haul them over it.
//
// Both sides crouch by the same rules (decision #11), which is what these
// specs lean on: the AI's turtle beat is deterministic geometry, so a boxed-in
// Manager NEEDS no scripting to take cover - only nowhere better to be.
import { test, expect } from '@playwright/test';
import {
  bootStash, enterCombat, waitForPlayerTurn, refillAp, clickWorld, waitStill, clickAction, onScreen,
  clickEnemyBody,
} from './helpers.js';

const setPaper = (page, n) => page.evaluate((v) => {
  window.__god.player.paper = v;
  window.__combat?.refresh();
}, n);
const lastLine = (page) => page.evaluate(() => window.__game.narration.at(-1) || '');


// A Manager boxed in by filing cabinets: low solids, so bodies are stuck but
// sight (and thrown paper) passes over. With nowhere to walk and nobody in
// reach, its turn has exactly one good beat - tuck in where it stands.
//
// Under the old rule a crouch committed to ONE cabinet, so three angles stayed
// open and the answer was to walk around. Cover is uncapped now `[stated]`
// (designer, 2026-07-31: "if the environment allows it thats a design issue
// more than anything, plus we have the counters"), so a body enclosed on all
// four faces is covered on all four and there IS no angle. That is the
// accepted consequence, and this spec now tests it directly, along with the
// counter the designer named: take a face away and the shot on that face
// opens - and only that one.
//
// (Flanking a PARTIALLY covered target is the common case and is pinned in
// tests/unit/tactics.test.js, where the geometry can be stated exactly. It
// cannot be staged here: an immobile target needs four solids around it, and
// four solids is four covered faces.)
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

test('a boxed crouch refuses every angle, and breaking a face opens that one', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, TURTLE_BOX);
  await setPaper(page, 40);

  // Open the fight WITH a throw over the cabinets - proof in passing that a
  // not-yet-crouched target in the box is perfectly hittable.
  await page.click('#hotbar-act-paper-ball');
  await expect.poll(() => page.evaluate(() => window.__game.armed), { timeout: 10_000 })
    .toBe('paper-ball');
  await clickEnemyBody(page);
  await expect.poll(() => page.evaluate(() => window.__game.inCombat), { timeout: 30_000 }).toBe(true);
  await page.waitForTimeout(700);
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
  // The crouch is a POSITION: it tucks in WHERE IT STANDS, and every face of
  // that tile is a cabinet.
  expect([crouch[0].x, crouch[0].z], 'crouched on its own tile').toEqual([4, 3]);
  expect(crouch[0].faces.sort(), 'all four faces shielded')
    .toEqual(['-1,0', '0,-1', '0,1', '1,0']);

  // Every angle refuses - for free. Walking round is no longer an answer, so
  // the spec asserts the thing that used to be one leg of a flank.
  for (const [wx, wz] of [[1, 1], [4, 5]]) {
    await refillAp(page);
    if (wx !== 1) {
      await clickWorld(page, wx, wz);
      await waitStill(page, 20_000).catch(() => {});
      await refillAp(page);
    }
    await setPaper(page, 40);
    await page.click('#hotbar-act-paper-ball');
    await expect.poll(() => page.evaluate(() => window.__combat.armed), { timeout: 10_000 })
      .toBe('paper-ball');
    await clickEnemyBody(page);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.__god.player.paper),
      `a refusal from ${wx},${wz} costs nothing`).toBe(40);
    expect(await lastLine(page)).toMatch(/no shot/i);
    await page.click('#hotbar-act-paper-ball'); // a refusal keeps it up - lower it
    await expect.poll(() => page.evaluate(() => window.__combat.armed), { timeout: 10_000 })
      .toBe(null);
  }

  // Now the counter: break the cabinet on the face you are standing at. The
  // player is south at (4,5), so (4,4) is the face between them.
  let guard = 20;
  while (guard-- > 0
    && await page.evaluate(() => window.__game.tileAt(4, 4)) !== 'floor') {
    await refillAp(page);
    await setPaper(page, 40);
    await clickAction(page, 'paper-ball');
    const p = await page.evaluate(() => window.__game.project3(4, 0.4, 4));
    expect(onScreen(p)).toBe(true);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(250);
  }
  expect(await page.evaluate(() => window.__game.tileAt(4, 4)), 'the cabinet came apart')
    .toBe('floor');

  // That face - and ONLY that face - stopped covering. The crouch itself
  // survives, because three cabinets are still standing.
  await expect.poll(() => page.evaluate(() =>
    (window.__combat.crouched[0]?.faces || []).sort().join('|')), { timeout: 20_000 })
    .toBe('-1,0|0,-1|1,0');

  // ...and the shot from the opened face lands.
  const before = await page.evaluate(() =>
    window.__combat.enemies.find((e) => e.alive).hp);
  await refillAp(page);
  await setPaper(page, 40);
  await page.click('#hotbar-act-paper-ball');
  await expect.poll(() => page.evaluate(() => window.__combat.armed), { timeout: 10_000 })
    .toBe('paper-ball');
  await clickEnemyBody(page);
  await page.waitForTimeout(700);
  if (await page.evaluate(() => window.__game.inCombat)) {
    expect(await page.evaluate(() =>
      window.__combat.enemies.find((e) => e.alive).hp)).toBeLessThan(before);
  } else {
    expect(await lastLine(page)).toMatch(/floor is yours/i);
  }
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
  // Click the tile you want to STAND on, not the desk. That inversion is the
  // point: naming the shield left the side you ended up on to the code, so
  // there was no way to say "the other side of it" (designer, 2026-07-31).
  // (4,1) is north of the desk at (4,2), so the desk shields the south face.
  await clickWorld(page, 4, 1);
  // The crouch resolves on ARRIVAL (the pendingMelee pattern) - wait out the walk.
  await expect.poll(() => page.evaluate(() => window.__combat.crouched.length),
    { timeout: 30_000 }).toBe(1);
  const crouch = await page.evaluate(() => window.__combat.crouched[0]);
  expect([crouch.x, crouch.z], 'crouched where you aimed').toEqual([4, 1]);
  expect(crouch.faces, 'the desk shields the south face').toContain('0,1');
  expect(crouch.covers, 'and the narration names it').toMatch(/desk/i);
  const pt = await page.evaluate(() => window.__game.playerTile);
  expect([pt.x, pt.z], 'standing where you clicked').toEqual([4, 1]);

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
  // The crouch is a POSITION, and the partition is simply what shields one of
  // its faces - no mode, no committed object. What a spec can assert is the
  // face list, which is exactly what the next shot resolves against.
  expect(crouch.faces.length, 'at least one face is shielded').toBeGreaterThan(0);
  expect([crouch.x, crouch.z], 'crouched ON the tile you aimed at').toEqual([4, 2]);
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
  // Aim at the tile you will STAND on - (2,1), with the desk at (3,1) on its
  // east face. Out of combat runs the same rule as in it, including the part
  // that used to differ: a PERSON shields a face here too now.
  await clickWorld(page, 2, 1);
  await expect.poll(() => page.evaluate(() => !!window.__game.oocCrouch), { timeout: 30_000 })
    .toBe(true);
  expect(await page.evaluate(() => window.__game.oocCrouch)).toMatchObject({ at: { x: 2, z: 1 } });

  // Open the fight WITH a throw, from the crouch - attacking never breaks it.
  await page.click('#hotbar-act-paper-ball');
  await expect.poll(() => page.evaluate(() => window.__game.armed), { timeout: 10_000 })
    .toBe('paper-ball');
  await clickEnemyBody(page);
  await expect.poll(() => page.evaluate(() => window.__game.inCombat), { timeout: 30_000 }).toBe(true);
  await page.waitForTimeout(500);
  // The fight starts with the leader already crouched behind the desk cell.
  const crouch = await page.evaluate(() => window.__combat.crouched);
  expect(crouch.length, 'the crouch survived the combat handoff').toBe(1);
  expect([crouch[0].x, crouch[0].z]).toEqual([2, 1]);
  expect(crouch[0].faces, 'the desk still shields the east face').toContain('1,0');
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

// The CONTINUOUS half of the 2026-07-31 revision: "what we need is something
// that is continuous and smooth for starters". Aiming at a position made the
// side choosable; these pin that the position is honoured PRECISELY - the
// walk ends on the point you clicked (clamped to body clearance), not on the
// tile's dead centre. Bodies in this engine rest at free points everywhere
// else (movement, walk-ups, dashes); the crouch was the one deliberate
// destination that still teleport-parked you.
test('the crouch walk parks you on the point you clicked, not the tile centre', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, CROUCH_LAB);
  await enterCombat(page);
  await waitForPlayerTurn(page);
  await refillAp(page);

  await page.click('#hotbar-act-take-cover');
  await expect.poll(() => page.evaluate(() => window.__combat.armed), { timeout: 10_000 })
    .toBe('take-cover');
  // A point deliberately OFF the centre of (4,1): east of centre, tucked
  // toward the desk on (4,2). Clamping pushes it to body clearance of the
  // desk edge (z <= 1.2) and leaves the chosen x alone.
  expect(await clickWorld(page, 4.3, 1.3)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__combat.crouched.length),
    { timeout: 30_000 }).toBe(1);

  const at = await page.evaluate(() => window.__combat.actingAt);
  const pt = await page.evaluate(() => window.__game.playerTile);
  expect([pt.x, pt.z], 'the logical tile is the one aimed at').toEqual([4, 1]);
  expect(Math.abs(at.x - 4.3), 'x is the clicked x, not the centre').toBeLessThan(0.15);
  expect(at.z, 'z clamped off the desk edge, still south of centre').toBeGreaterThan(1.0);
  expect(Math.abs(at.x - 4) > 0.2, 'demonstrably NOT centre-parked').toBe(true);
});

test('the out-of-combat crouch parks on the clicked point too', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, OOC_LAB);

  await page.click('#hotbar-act-take-cover');
  await expect.poll(() => page.evaluate(() => window.__game.armed), { timeout: 10_000 })
    .toBe('take-cover');
  // Off-centre on (2,1), tucked toward the desk on (3,1): clamping pushes x
  // to clearance of the desk face (x <= 2.2) and keeps the chosen z.
  expect(await clickWorld(page, 2.3, 1.2)).toBe(true);
  await expect.poll(() => page.evaluate(() => !!window.__game.oocCrouch), { timeout: 30_000 })
    .toBe(true);

  const pos = await page.evaluate(() => window.__game.playerPos);
  const pt = await page.evaluate(() => window.__game.playerTile);
  expect([pt.x, pt.z], 'the logical tile is the one aimed at').toEqual([2, 1]);
  expect(pos.x, 'x clamped to the desk face, east of centre').toBeGreaterThan(2.05);
  expect(Math.abs(pos.z - 1.2), 'z is the clicked z').toBeLessThan(0.15);
});
