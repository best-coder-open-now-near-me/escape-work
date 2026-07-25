// Which walls actually stand between the camera and the character - the math
// behind the "ghost the wall in front of you" effect (scene.js updateWallFade).
//
// Pure, so it can be unit tested: this used to be a 2D test done inline, and
// being 2D is exactly what made it wrong. It asked "is this wall along the
// player->camera direction?" and nothing else, so:
//
//   * it had no far limit. The direction is a ray, not a segment, so a wall
//     fifteen tiles past the character - or behind the camera entirely - faded
//     as readily as the one they were standing against.
//   * it ignored height. Office walls here are SHORT (0.6-0.72) and the camera
//     looks down from 18-80 degrees. At a steep pitch the sightline clears a
//     waist-high partition within half a tile and hides nothing at all; at a
//     shallow one the same partition blocks several tiles' worth. A flat test
//     cannot tell those apart, so it ghosted a wall that was never in the way.
//
// The fix is to treat the sightline as what it is: a segment from the camera to
// the character's feet, in three dimensions. A wall occludes when the segment
// passes through the volume it actually occupies.

// Height of the sightline above the floor at horizontal distance `s` from the
// character, along the ground track from the character toward the camera.
// Anchored at the FEET: a wall that clears the feet hides part of the body, and
// that is the moment ghosting earns its keep.
const sightlineY = (s, footY, camY, camDist) =>
  footY + (camY - footY) * (s / camDist);

/**
 * Does `wall` stand between the camera and the character?
 *
 * @param wall   { x, z, top }  world position of the wall's centre and the
 *               world Y of its top face.
 * @param eye    { x, y, z }    camera position.
 * @param feet   { x, y, z }    the character's feet (y = the floor's top face).
 * @param radius how far off the sightline's ground track a wall can sit and
 *               still cover the body - roughly half a tile plus the body's
 *               own width.
 */
export function occludes(wall, eye, feet, radius = 1.15) {
  // Ground track from the character toward the camera.
  let dx = eye.x - feet.x;
  let dz = eye.z - feet.z;
  const camDist = Math.hypot(dx, dz);
  if (camDist < 1e-6) return false; // straight overhead - nothing can be in front
  dx /= camDist;
  dz /= camDist;

  const vx = wall.x - feet.x;
  const vz = wall.z - feet.z;
  const s = vx * dx + vz * dz; // distance along the track
  // BETWEEN the two, not merely "that way": behind the character (s <= 0) is
  // out of shot, and past the camera (s >= camDist) is behind the lens. The
  // 0.3 keeps the tile the character is standing on from ghosting itself.
  if (s <= 0.3 || s >= camDist) return false;

  // Lateral offset from the track.
  const px = vx - s * dx;
  const pz = vz - s * dz;
  if (Math.hypot(px, pz) >= radius) return false;

  // The height test. If the sightline is already above the wall's top by the
  // time it gets there, the character is visible over it and there is nothing
  // to ghost.
  return sightlineY(s, feet.y, eye.y, camDist) < wall.top;
}
