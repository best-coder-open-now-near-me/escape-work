// The jut regression (DEGRID_PLAN M1): after a walk-up parks the body at a
// free point beside the target's blocked tile, the NEXT click must walk a
// straight line - not dart to a tile centre planned from the rounded tile and
// jut back. The unit suite pins the smoothing geometry; this pins the thing
// the designer actually saw, by sampling the body every frame and bounding
// how far it strays from its own chord.
import { test, expect } from '@playwright/test';
import { bootStash, clickWorld } from './helpers.js';

// An open room with one desk. Rummaging it walks the leader to an approach
// point at the desk's elbow - by construction within BODY_RADIUS of the
// desk's blocked tile, the exact stance that used to break every span the
// smoother tried from the body.
const ROOM = {
  name: 'Jut Lab',
  tiles: { '#': 'wall', '.': 'floor', d: 'desk' },
  actors: { '@': 'player' },
  map: [
    '##################',
    '#...@............#',
    '#................#',
    '#....d...........#',
    '#................#',
    '#................#',
    '##################',
  ],
};

test('the walk after a desk rummage runs straight - no tile-centre dart', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, ROOM, 'office-drone');

  // Rummage the desk (5,3): approachAndDo walks up and parks at its elbow.
  expect(await clickWorld(page, 5, 3)).toBe(true);
  await expect.poll(
    () => page.evaluate(() => window.__game.narration.some((l) => /^Desk:/.test(l))),
    { timeout: 60_000 },
  ).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__game.playerMoving)).toBe(false);

  const start = await page.evaluate(() => window.__game.playerPos);
  // Diagonal-ish destination across the room: the raw route from the ROUNDED
  // tile is a staircase of centres, so any smoothing failure shows up as
  // lateral wander from the chord.
  expect(await clickWorld(page, 12, 1.4)).toBe(true);

  // Sample the body every frame until it stops.
  const samples = await page.evaluate(() => new Promise((resolve) => {
    const out = [];
    let still = 0;
    const tick = () => {
      const p = window.__game.playerPos;
      out.push([p.x, p.z]);
      const n = out.length;
      const moved = n > 1
        && Math.hypot(out[n - 1][0] - out[n - 2][0], out[n - 1][1] - out[n - 2][1]) > 1e-4;
      still = moved ? 0 : still + 1;
      if ((still > 40 && n > 40) || n > 4000) return resolve(out);
      return requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));

  const end = samples[samples.length - 1];
  const chord = [end[0] - start.x, end[1] - start.z];
  const len = Math.hypot(...chord);
  expect(len).toBeGreaterThan(3); // sanity: the walk actually happened
  let maxLateral = 0;
  let maxBackstep = 0;
  let along = -Infinity;
  for (const [px, pz] of samples) {
    const vx = px - start.x;
    const vz = pz - start.z;
    const t = (vx * chord[0] + vz * chord[1]) / len; // progress along the chord
    const lat = Math.abs(vx * (chord[1] / len) - vz * (chord[0] / len));
    maxLateral = Math.max(maxLateral, lat);
    maxBackstep = Math.max(maxBackstep, along - t);
    along = Math.max(along, t);
  }
  // A straight run wanders by rendering epsilon only; the pre-fix dart to a
  // neighbouring tile centre measured ~0.5+ lateral with real backtracking.
  expect(maxLateral).toBeLessThan(0.35);
  expect(maxBackstep).toBeLessThan(0.1);
});
