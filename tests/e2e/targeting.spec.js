// Object picking, hover feedback, the persistent attack hotbar, and the
// minimal dialogue layer. These all ride on the picking layer (src/picking.js)
// that resolves a cursor to the interactable ENTITY under it, not the floor
// tile behind a tall mesh - the same fix that makes a click on the raised door
// panel actually open the door.
import { test, expect } from '@playwright/test';
import { bootAndPick, bootStash, clickWorld, onScreen, onCanvas, waitStill, combatOrWalkDone, stableProject, enterCombat, hoverDoorPanel, clickDoorPanel } from './helpers.js';

// Hover the on-screen position of a world point (a tall mesh, y > 0). Returns
// false if it projects off-screen so the caller can bail.
async function hover3(page, x, y, z) {
  const p = await page.evaluate(([wx, wy, wz]) => window.__game.project3(wx, wy, wz), [x, y, z]);
  if (!onScreen(p)) return false;
  await page.mouse.move(p.x, p.y);
  return true;
}

test('hovering the door mesh highlights it and shows the interact cursor', async ({ page }) => {
  await bootAndPick(page);
  // Aim at the door PANEL (mid-height on the h:8,5 edge), not the floor.
  await hoverDoorPanel(page, 8, 0.4, 4.5);
  expect(await page.evaluate(() => window.__game.cursor)).toBe('pointer');
  // Doors are direct-use controls, so their cyan mesh glow does not require
  // the inspect modifier that character highlighting does out of combat.
  expect(await page.evaluate(() => window.__game.hoverGlow)).toBe(true);
});

test('clicking the raised door mesh opens it (parallax fix)', async ({ page }) => {
  await bootAndPick(page);
  // Click the door's BODY, well above the floor - the ground point under this
  // pixel lands past the door, so only entity picking resolves it.
  await clickDoorPanel(page, 8, 0.55, 4.5);
  await expect.poll(
    () => page.evaluate(() => window.__game.doors.find((d) => d.key === 'h:8,5')?.open),
    { timeout: 60_000 },
  ).toBe(true);
});

// One coworker, mid-room, in a small arena - so the body projects into open
// screen well clear of the HUD. This used to hover whichever coworker Floor 1
// listed first, which made it a test of where that one happened to wander: the
// hotbar is a real element over the bottom of the frame and it eats the pointer,
// so a coworker projected behind it can never be hovered at all. Widening the
// bar (the full kit now lives on it) is what finally caught that.
const HOVER_ARENA = {
  name: 'Hover Room',
  tiles: { '#': 'wall', '.': 'floor' },
  actors: { '@': 'player', 'M': 'manager' },
  map: [
    '#########',
    '#.......#',
    '#.@...M.#',
    '#.......#',
    '#########',
  ],
};

const EMAIL_ARENA = {
  name: 'Email Range Lab',
  tiles: { '#': 'wall', '.': 'floor' },
  actors: { '@': 'player', 'M': 'manager' },
  map: [
    '############',
    '#..........#',
    '#@.....M...#',
    '#..........#',
    '############',
  ],
};

test('Passive-Aggressive Email fires at the six-tile maximum without walking in', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, EMAIL_ARENA, 'office-drone', { seed: 4 });
  await page.evaluate(() => {
    const foe = window.__god.enemies.find((enemy) => enemy.alive);
    foe.clearPath();
    foe.slideTo = null;
    const y = foe.entity.getPosition().y;
    foe.entity.setPosition(7, y, 2);
    foe.x = 7;
    foe.z = 2;
    foe.wanderTimer = Infinity;
  });
  const before = await page.evaluate(() => window.__game.playerPos);
  const foe = await page.evaluate(() => window.__game.enemies.find((enemy) => enemy.alive));
  expect(Math.hypot(foe.px - before.x, foe.pz - before.z)).toBeCloseTo(6, 1);

  await page.click('#hotbar-act-attack');
  expect(await page.evaluate(() => window.__game.armed)).toBe('attack');
  expect(await clickWorld(page, foe.x, foe.z)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__game.inCombat),
    { timeout: 20_000 }).toBe(true);

  const after = await page.evaluate(() => window.__game.playerPos);
  expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(0.1);
});

test('hovering a coworker shows the attack cursor and enemy highlight', async ({ page }) => {
  await bootStash(page, HOVER_ARENA);
  await page.evaluate(() => window.__game.debugStillEnemies());
  // Hover the body (~0.8 up) rather than its tile, and re-read the live position
  // each attempt: a coworker caught mid-step is still under the cursor that way.
  // NB `__game.enemies` is a projection, not the live actors: it exposes px/pz
  // for exactly this, and has no `entity` to read a position off.
  await expect.poll(async () => {
    const p = await page.evaluate(() => {
      const en = window.__game.enemies.find((e) => e.alive && e.px !== undefined);
      return en ? window.__game.project3(en.px, 0.8, en.pz) : null;
    });
    if (!onScreen(p)) return null;
    await page.mouse.move(p.x, p.y);
    return page.evaluate(() => window.__game.hoverKind);
  }, { timeout: 20_000 }).toBe('enemy');
  expect(await page.evaluate(() => window.__game.cursor)).toBe('crosshair');
  // Out of combat the body glow stays an INSPECT verb: dark until Ctrl (or
  // Alt) is held, and lit the moment it is, without needing a fresh mouse
  // move. Combat ungates it - see the in-combat click test below.
  expect(await page.evaluate(() => window.__game.hoverGlow)).toBe(false);
  await page.keyboard.down('Alt');
  expect(await page.evaluate(() => window.__game.hoverGlow)).toBe(true);
  await page.keyboard.up('Alt');
  expect(await page.evaluate(() => window.__game.hoverGlow)).toBe(false);

  // Damage can land while the cursor remains perfectly still. The focus
  // banner must follow live HP on the next frame, without a leave/re-enter
  // dance to provoke another pointer event.
  const health = await page.evaluate(() => {
    const en = window.__god.enemies.find((enemy) => enemy.alive);
    return { before: en.hp, max: en.maxHp };
  });
  await expect(page.locator('#focus-banner')).toContainText(`HP ${health.before}/${health.max}`);
  await page.evaluate(() => window.__god.enemies.find((enemy) => enemy.alive).takeDamage(1));
  await expect(page.locator('#focus-banner')).toContainText(`HP ${health.before - 1}/${health.max}`);
});

test('the persistent hotbar shows attacks and arming targets a coworker', async ({ page }) => {
  // The engage loop below is allowed 14 attempts, and a single attempt can
  // spend 20s settling the camera plus 25s waiting on the walk - so the
  // default 120s is less than three attempts' worth. Same budget the other
  // walk-up-and-fight specs take.
  test.setTimeout(300_000);
  await bootAndPick(page);
  await expect(page.locator('#hotbar')).toBeVisible();
  // Office Drone: attack + shove + two thrown weapons target a coworker.
  await expect(page.locator('#hotbar-act-attack')).toBeVisible();

  await page.click('#hotbar-act-attack');
  expect(await page.evaluate(() => window.__game.armed)).toBe('attack');

  // The kit is listed in full, but a power a FIGHT owns still refuses to arm -
  // it says why instead, and leaves the armed slot alone.
  await expect(page.locator('#hotbar-act-defend')).toBeVisible();
  await page.click('#hotbar-act-defend');
  expect(await page.evaluate(() => window.__game.narration.at(-1))).toMatch(/swinging at you/i);
  expect(await page.evaluate(() => window.__game.armed)).toBe('attack');

  // Arming, then clicking a coworker, opens combat with that attack as the
  // opener (melee walks up first). Mirror the hardened enterCombat: target
  // only REACHABLE coworkers (some spawn sealed behind doors), nearest first,
  // aim at the settled body, and re-arm if a stray click lowered the attack.
  let inCombat = false;
  for (let i = 0; i < 14 && !inCombat; i++) {
    const pt = await page.evaluate(() => window.__game.playerTile);
    const ens = await page.evaluate(() => window.__game.enemies.filter((e) => e.alive && e.reachable));
    if (!ens.length) { await page.waitForTimeout(700); continue; }
    ens.sort((a, b) => Math.max(Math.abs(a.x - pt.x), Math.abs(a.z - pt.z))
      - Math.max(Math.abs(b.x - pt.x), Math.abs(b.z - pt.z)));
    const en = ens[0];
    const pp = await page.evaluate(() => window.__game.playerPos);
    await stableProject(page, pp.x, pp.z).catch(() => {}); // settle the camera
    // On-screen is not enough: the hotbar this test is DRIVING is fixed to the
    // bottom-centre, and a coworker projecting behind it takes the click as a
    // slot press. That reads as the loop mysteriously arming things and never
    // engaging - "That slot is empty", fourteen times - because the click never
    // reached the world at all. Same onCanvas guard enterCombat takes, and the
    // same fallback order: body point first, ground tile second, skip the
    // attempt only when neither is reachable.
    let p = await page.evaluate(([x, z]) => window.__game.project3(x, 0.9, z), [en.px ?? en.x, en.pz ?? en.z]);
    if (!onScreen(p) || !(await onCanvas(page, p))) {
      p = await page.evaluate(([x, z]) => window.__game.project(x, z), [en.x, en.z]);
    }
    if (!onScreen(p) || !(await onCanvas(page, p))) continue;
    // combatOrWalkDone can report "walk finished" on the same poll that combat
    // is starting, so re-check before doing anything else - and never click the
    // hotbar once a fight owns the screen. Combat hides the out-of-combat
    // hotbar, and Playwright waits on a hidden button until the test times out.
    if (await page.evaluate(() => window.__game.inCombat)) { inCombat = true; break; }
    if (await page.evaluate(() => window.__game.armed) !== 'attack') {
      if (!(await page.locator('#hotbar-act-attack').isVisible())) break;
      await page.click('#hotbar-act-attack');
    }
    await page.mouse.click(p.x, p.y);
    inCombat = await combatOrWalkDone(page, 25_000);
  }
  expect(inCombat).toBe(true);
});

// A tiny arena with a talkable NPC right next to the spawn, so the walk-up is
// short and deterministic.
const TALK_LEVEL = {
  name: 'talk-test',
  tiles: { '#': 'wall', '.': 'floor', '>': 'exit' },
  actors: { '@': 'player', 'N': 'it-support' },
  map: [
    '########',
    '#@.N..>#',
    '########',
  ],
};

test('clicking an NPC walks up and opens a dialogue you can advance and close', async ({ page }) => {
  await bootStash(page, TALK_LEVEL);
  const npc = await page.evaluate(() => window.__game.npcs[0]);
  // Named for the job, like every unnamed coworker who does one (companions.js).
  expect(npc.name).toBe('IT Support');

  // Talk cursor on hover.
  await hover3(page, npc.x, 0.8, npc.z);
  await expect.poll(() => page.evaluate(() => window.__game.hoverKind), { timeout: 15_000 }).toBe('npc');
  expect(await page.evaluate(() => window.__game.cursor)).toBe('help');

  // Click walks up and opens the conversation.
  const p = await page.evaluate(() => window.__game.project3(window.__game.npcs[0].x, 0.4, window.__game.npcs[0].z));
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('#dialogue-panel')).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => window.__game.dialogueOpen), { timeout: 30_000 }).toBe(true);

  // Advancing a branch keeps the panel up; the last option closes it.
  await expect(page.locator('#dialogue-option-0')).toBeVisible();
  await page.click('#dialogue-option-0');
  await expect(page.locator('#dialogue-panel')).toBeVisible();
  // Walk the tree to an end - click the last option until the panel closes.
  for (let i = 0; i < 6; i++) {
    if (!(await page.evaluate(() => window.__game.dialogueOpen))) break;
    const count = await page.locator('.dialogue-option').count();
    await page.click(`#dialogue-option-${count - 1}`);
    await page.waitForTimeout(150);
  }
  expect(await page.evaluate(() => window.__game.dialogueOpen)).toBe(false);
});

// A single coworker two tiles off, in an open room - close enough that the
// walk-up is one step, so a click resolves inside a turn.
const DUEL_ARENA = {
  name: 'Duel',
  tiles: { '#': 'wall', '.': 'floor', '>': 'exit' },
  actors: { '@': 'player', 'M': 'manager' },
  map: [
    '#########',
    '#.......#',
    '#.@.M..>#',
    '#.......#',
    '#########',
  ],
};

test('clicking a coworker in combat attacks with the basic swing - no action armed first', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, DUEL_ARENA, 'office-drone');
  await enterCombat(page);

  // Nothing is armed: this is the whole point of the test. The click below is
  // the only input, and it has to mean "hit them".
  //
  // Entering combat can leave a swing QUEUED: the engaging click walks you in
  // and strikes on arrival, and `armed` stays set for the length of that walk
  // (it is what lights the swing on the bar). So settle for the opening to
  // finish rather than sampling once - the wait is about combat entry, not
  // about anything this test does.
  const idle = () => expect.poll(
    () => page.evaluate(() => (window.__combat?.phase === 'player' ? window.__combat.armed : 'busy')),
    { timeout: 60_000 },
  ).toBe(null);
  await idle();
  await page.evaluate(() => { window.__combat.forceHit = true; });

  const foe = await page.evaluate(() => window.__combat.enemies.find((e) => e.alive));
  expect(foe).toBeTruthy();
  const foeHp = () => page.evaluate(() => window.__combat.enemies.find((e) => e.alive)?.hp);

  // The swing has to be VISIBLE before it's clickable. With nothing armed,
  // hovering a coworker must show the aiming cursor and the to-hit readout -
  // shipping the attack without these made it look like the feature was
  // missing, because nothing on screen said a click would land.
  // Re-read the coworker's LIVE position each attempt - he takes turns and
  // moves, so his opening tile stops covering his body - and nudge the pointer
  // by a pixel, because a mouse.move to the position it is already at
  // dispatches no event and the hover never re-runs.
  // Sweep a few heights up the body rather than guessing one. Looking down at
  // this pitch, a point 0.9 above the tile projects well ABOVE the mesh, so the
  // pick ray sails over the coworker's head - only low points land on him. The
  // click below needs the same sweep: a body miss falls through to the ground
  // BEHIND them, which next to a wall resolves to nothing at all.
  // Aim at px/pz - the CONTINUOUS body position - because a coworker caught
  // mid-step between tiles is not standing on his tile centre.
  let jiggle = 0;
  await expect.poll(async () => {
    for (const y of [0.2, 0.45, 0.7]) {
      const p = await page.evaluate((yy) => {
        const en = window.__game.enemies.find((e) => e.alive && e.px !== undefined);
        return en ? window.__game.project3(en.px, yy, en.pz) : null;
      }, y);
      if (!onScreen(p)) continue;
      // A move to the pixel the pointer already occupies dispatches no event,
      // so the hover would never re-run - nudge it.
      jiggle = 1 - jiggle;
      await page.mouse.move(p.x + jiggle, p.y);
      if (await page.evaluate(() => window.__game.cursor) === 'crosshair') return 'crosshair';
    }
    return null;
  }, { timeout: 40_000 }).toBe('crosshair');
  const chance = await page.evaluate(() => window.__combat.hoverHitChance);
  expect(chance).toBeGreaterThan(0); // the odds of the swing a click would make
  // The cursor is on a coworker, so the glow has a target...
  expect(await page.evaluate(() => window.__game.hoverKind)).toBe('enemy');
  // ...and IN COMBAT that target is lit with no modifier at all: the cursor is
  // only ever aiming here, so who you're about to swing at is never a question
  // worth holding a key for. (Out of combat the same glow stays behind Ctrl or
  // Alt - asserted in the coworker-hover test above.)
  expect(await page.evaluate(() => window.__game.hoverGlow)).toBe(true);
  // Holding and releasing Ctrl doesn't take it away.
  await page.keyboard.down('Control');
  expect(await page.evaluate(() => window.__game.hoverGlow)).toBe(true);
  await page.keyboard.up('Control');
  expect(await page.evaluate(() => window.__game.hoverGlow)).toBe(true);
  // ...and hovering it did NOT quietly arm anything - the default stays implicit.
  await idle();
  // The to-hit readout REPLACES the movement trail. It used to draw both: the
  // trail from the last patch of floor the cursor crossed stayed on screen,
  // hanging off the character while they were plainly aiming at someone.
  expect(await page.evaluate(() => window.__combat.movePreview)).toBe(false);

  // Click the body. The camera keeps easing after the walk-up, so settle and
  // retry a couple of times rather than trusting one projection.
  // Each attempt states its own preconditions rather than hoping for them:
  //   - our turn, with nothing queued (`idle`), because a click on an AI turn
  //     is correctly ignored;
  //   - AP topped up, because entering combat spends it walking in, and this
  //     test is about the click-to-swing binding, not the AP economy;
  //   - the coworker's LIVE position, because aiming at the tile they occupied
  //     when the test started is a click on empty floor once they have moved.
  // Then wait for the swing to LAND rather than for a fixed beat - out of reach
  // the click walks you in first, and that takes as long as it takes.
  for (let i = 0; i < 4 && (await foeHp()) >= foe.hp; i++) {
    await idle();
    await page.evaluate(() => { window.__combat.ap = window.__combat.maxAp; });
    const at = await page.evaluate(() => {
      const en = window.__game.enemies.find((e) => e.alive && e.px !== undefined);
      return en ? { x: en.px, z: en.pz } : null;
    });
    if (!at) continue;
    // Sweep low heights up the body and click the first one the CURSOR agrees
    // is on them, exactly like the hover poll above. A point 0.9 up projects
    // over the mesh, and the ray then falls through to the ground behind the
    // coworker - which, standing next to them in a small room, is a wall, so
    // the click resolved to nothing at all and the test blamed the swing.
    let clicked = false;
    for (const y of [0.2, 0.45, 0.7]) {
      const p = await page.evaluate(([x, yy, z]) => window.__game.project3(x, yy, z), [at.x, y, at.z]);
      if (!onScreen(p)) continue;
      jiggle = 1 - jiggle;
      // Verify and click the SAME pixel. This used to hover p.x + jiggle but
      // click p.x - one pixel to the left of the spot the cursor had vouched
      // for, which at a mesh edge is a different resolution entirely.
      const cx = p.x + jiggle;
      await page.mouse.move(cx, p.y);
      if (await page.evaluate(() => window.__game.cursor) !== 'crosshair') continue;
      await page.mouse.click(cx, p.y);
      clicked = true;
      break;
    }
    if (!clicked) continue;
    await expect.poll(foeHp, { timeout: 15_000 }).toBeLessThan(foe.hp).catch(() => {});
  }
  expect(await foeHp()).toBeLessThan(foe.hp);
  // It swung the equipped weapon's action (bare-handed here), not a class power.
  expect(await page.evaluate(() => window.__combat.lastRoll)).not.toBe(null);

  // Right-click during a fight opens the context menu - the Examine verb had
  // no way in mid-combat at all - and asking twice SHOWS twice: an identical
  // line used to be swallowed as a stutter, which read as a dead button.
  const menu = page.locator('#context-menu');
  const examineHere = async () => {
    const p = await page.evaluate(() => {
      const t = window.__game.playerTile;
      return window.__game.project3(t.x, 0.05, t.z + 1);
    });
    await page.mouse.click(p.x, p.y, { button: 'right' });
    await expect(menu).toBeVisible({ timeout: 10_000 });
    await menu.getByText('Examine').click();
  };
  await examineHere();
  const said = await page.evaluate(() => window.__game.narration.at(-1));
  expect(said).toBeTruthy();
  // How many times that line has been narrated - as a repeat count on one row,
  // or as separate rows if something else narrated in between. Either is fine;
  // what must NOT happen is the second ask vanishing.
  const timesSaid = () => page.evaluate((t) => window.__game.narration
    .filter((l) => l === t || l.startsWith(`${t} (×`))
    .reduce((n, l) => n + (l === t ? 1 : Number(/\(×(\d+)\)$/.exec(l)[1])), 0), said);
  expect(await timesSaid()).toBe(1);
  await examineHere();
  await expect.poll(timesSaid, { timeout: 10_000 }).toBe(2);
  expect(await page.evaluate(() => window.__game.inCombat)).toBe(true); // menu didn't end the fight
  // Examine names what it is looking at. Every solid prop used to report as a
  // cubicle wall, because the menu's catch-all branch hardcoded that line.
  expect(await page.evaluate(() => window.__game.examineTile(0, 0))).toMatch(/cubicle wall/i);
});

test('the tactical camera button sits on the HUD rail and looks straight down', async ({ page }) => {
  await bootAndPick(page);

  // The bottom-left cluster reads left to right: profile card, bag, tactical.
  const box = async (sel) => page.locator(sel).boundingBox();
  const [stats, bag, tac] = await Promise.all(
    ['#stats', '#inventory-btn', '#tactical-btn'].map(box));
  expect(stats).not.toBeNull();
  expect(bag.x).toBeGreaterThan(stats.x + stats.width - 1); // clear of the card
  expect(tac.x).toBeGreaterThan(bag.x + bag.width - 1);     // and right of the bag
  // All three share the bottom edge - it's one row, not a stack.
  expect(Math.abs((bag.y + bag.height) - (tac.y + tac.height))).toBeLessThan(2);

  // Off by default; the button turns it on and looks straight down.
  expect(await page.evaluate(() => window.__game.tactical)).toBe(false);
  await page.click('#tactical-btn');
  await expect.poll(() => page.evaluate(() => window.__game.tactical),
    { timeout: 10_000 }).toBe(true);

  // Straight down means the camera sits (almost) directly over what it follows,
  // so the ground point under screen centre is the point it is focused on.
  const overhead = await page.evaluate(() => {
    const c = window.__game.cameraPos;
    const p = window.__game.playerPos;
    return Math.hypot(c.x - p.x, c.z - p.z);
  });
  expect(overhead).toBeLessThan(1.5); // horizontal offset collapses when looking down

  // Toggling back restores the angled view rather than leaving you overhead.
  await page.click('#tactical-btn');
  await expect.poll(() => page.evaluate(() => window.__game.tactical),
    { timeout: 10_000 }).toBe(false);
  const angled = await page.evaluate(() => {
    const c = window.__game.cameraPos;
    const p = window.__game.playerPos;
    return Math.hypot(c.x - p.x, c.z - p.z);
  });
  expect(angled).toBeGreaterThan(5);
});
