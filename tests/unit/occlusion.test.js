// The wall-ghosting test (src/occlusion.js). This was a flat 2D check inline in
// scene.js and it ghosted far more than it should have: no far limit, and no
// idea how tall anything was. These lock both halves of the fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { occludes } from '../../src/occlusion.js';
import { wallFadeMaterial } from '../../src/scene.js';

// The real rig (controls.js): pitch degrees off the ground plane, dist along
// the boom. Yaw is irrelevant here, so put the camera due +Z of the character.
const EDGE_WALL = 0.72; // tile-renderer EDGE_HEIGHT
const FOOT_Y = 0.1;     // floor box is 0.2 tall, centred at 0 -> top face at 0.1

function eyeAt(pitchDeg, dist = 26, feet = { x: 0, y: FOOT_Y, z: 0 }) {
  const rad = (pitchDeg * Math.PI) / 180;
  return { x: feet.x, y: feet.y + dist * Math.sin(rad), z: feet.z + dist * Math.cos(rad) };
}
const feet = { x: 0, y: FOOT_Y, z: 0 };
// A wall `d` tiles toward the camera, dead on the sightline's ground track.
const wallAt = (d, top = EDGE_WALL) => ({ x: 0, z: d, top });

test('a wall the character is standing against is ghosted', () => {
  assert.equal(occludes(wallAt(0.5), eyeAt(18), feet), true);
});

test('a wall far down the sightline is NOT ghosted - the view has risen over it', () => {
  // The old 2D test ghosted this: it is "toward the camera", which was the
  // whole test. At any pitch the sightline is metres above a 0.72 wall by here.
  for (const pitch of [18, 40, 55, 80]) {
    assert.equal(occludes(wallAt(9), eyeAt(pitch), feet), false,
      `a wall 9 tiles away must not ghost at pitch ${pitch}`);
  }
});

test('a wall past the camera is never ghosted', () => {
  const eye = eyeAt(18);
  const beyond = Math.hypot(eye.x - feet.x, eye.z - feet.z) + 3;
  assert.equal(occludes(wallAt(beyond), eye, feet), false);
});

test('a wall BEHIND the character is never ghosted', () => {
  assert.equal(occludes(wallAt(-2), eyeAt(18), feet), false);
});

test('pitch decides the reach: a shallow camera ghosts further than a steep one', () => {
  // The point of making the test 3D. Looking along the floor, a waist-high
  // partition blocks a couple of tiles; looking down at it, almost nothing.
  const reach = (pitch) => {
    let far = 0;
    for (let d = 0.4; d < 12; d += 0.05) if (occludes(wallAt(d), eyeAt(pitch), feet)) far = d;
    return far;
  };
  const shallow = reach(18);
  const steep = reach(80);
  assert.ok(shallow > steep, `shallow (${shallow.toFixed(2)}) reaches further than steep (${steep.toFixed(2)})`);
  assert.ok(shallow < 4, `even the shallowest camera stays local (got ${shallow.toFixed(2)})`);
  assert.ok(steep < 1, `looking straight down ghosts almost nothing (got ${steep.toFixed(2)})`);
});

test('a taller wall occludes from further away than a short one', () => {
  const eye = eyeAt(18);
  assert.equal(occludes(wallAt(1.6, 0.4), eye, feet), false); // knee-high: cleared
  assert.equal(occludes(wallAt(1.6, 2.0), eye, feet), true);  // full height: blocks
});

test('a wall off to the side is not ghosted, however close', () => {
  assert.equal(occludes({ x: 4, z: 0.6, top: EDGE_WALL }, eyeAt(18), feet), false);
});

test('a camera directly overhead ghosts nothing (no ground track to be in front of)', () => {
  const overhead = { x: 0, y: 20, z: 0 };
  assert.equal(occludes(wallAt(0.5), overhead, feet), false);
});

test('a faded custom solid returns to its own opaque material', () => {
  const custom = { id: 'custom-solid' };
  const ghost = { id: 'ghost' };
  const wall = { solidMat: custom, ghostMat: ghost };

  assert.equal(wallFadeMaterial(wall, true), ghost);
  assert.equal(wallFadeMaterial(wall, false), custom);
});
