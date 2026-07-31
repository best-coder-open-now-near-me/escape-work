// The door EDGE arithmetic - pure logic, no DOM, no grid. A door is an edge,
// not a tile, and every conversion between an edge key and the two tiles it
// divides used to be written inline at whichever of main.js's five call sites
// needed it.
//
// Separate from doors.js (the runtime) purely so it stays importable without
// the DOM: doors.js pulls in ui.js to narrate, and a module that touches
// `window` at load cannot be unit tested under node.

// What working a door costs when there is a fight on. Cheaper than a verb: the
// walk to reach it has already been billed as movement, and this is the
// handle, not the journey.
export const COMBAT_DOOR_AP = 1;

// The two tiles an edge key divides. 'h:x,z' runs along the top of (x, z), so
// it separates (x, z-1) from (x, z); 'v:x,z' separates (x-1, z) from (x, z).
export function doorSides(key) {
  const [x, z] = key.slice(2).split(',').map(Number);
  return key[0] === 'h' ? [[x, z - 1], [x, z]] : [[x - 1, z], [x, z]];
}

// Where the door IS in world space - the midpoint of the edge, which is half a
// tile off the tile the key names. Both the Alt overlay label and combat's door
// rings hang off this.
export function doorMidpoint(key) {
  const [x, z] = key.slice(2).split(',').map(Number);
  return key[0] === 'h' ? { x, z: z - 0.5 } : { x: x - 0.5, z };
}

// The edge key nearest a precise ground point, or null when the point is not
// near any edge. The 0.3 band is deliberately wide - you aim at a doorway, not
// at a line - which is also why the callers that use it in a fight require the
// clicker to already be standing beside the door (see `combatDoorAt`).
export function doorKeyNear(point) {
  if (!point) return null;
  const x = Math.round(point.x);
  const z = Math.round(point.z);
  const dx = point.x - x;
  const dz = point.z - z;
  if (0.5 - Math.max(Math.abs(dx), Math.abs(dz)) > 0.3) return null;
  return Math.abs(dx) >= Math.abs(dz)
    ? `v:${dx > 0 ? x + 1 : x},${z}`
    : `h:${x},${dz > 0 ? z + 1 : z}`;
}

// Is this body standing beside the door's handle? In a fight there is no
// walking-to-it - movement belongs to combat and is priced by the tile - so
// the rule is the tactical one: you work a door you are standing beside.
export function atDoor(key, actor) {
  return !!actor && doorSides(key).some(([x, z]) => actor.x === x && actor.z === z);
}
