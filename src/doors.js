// Doors: the one piece of terrain a fight can change. Shaped like
// shopping.js/looting.js - the host supplies live accessors and the things
// only it can do (walk somebody over, spend AP, refresh the scene), and this
// module owns the door rules and the narration.
//
// A door is an EDGE, not a tile, and that is the whole reason it needed its
// own file rather than a few helpers in main.js: everything that finds one,
// stands beside one, or lists one has to convert between edge keys and the two
// tiles they divide, and those conversions were scattered across five call
// sites in main.js's closure.
//
// The edge arithmetic itself lives in door-edges.js, which stays free of the
// DOM so a test can reach it; this file narrates and touches the world.

import * as ui from './ui.js';
import { COMBAT_DOOR_AP, doorSides, doorMidpoint, doorKeyNear, atDoor } from './door-edges.js';

// Re-exported so callers keep one import for "doors". The rules are next door
// in door-edges.js, where a test can reach them.
export { COMBAT_DOOR_AP, doorSides, doorMidpoint, doorKeyNear, atDoor };

export function createDoors({
  grid, scene, loot,
  isInCombat, isGameOver, getCombat, getPlayer,
  isWalkable, approachAndDo, onWorldChanged,
}) {
  // Only a key the grid actually has is a door. Kept separate from the pure
  // `doorKeyNear` so the arithmetic stays testable without a grid.
  //
  // An OPEN door is not claimed from the ground at all. An open doorway is a
  // gap you walk through - it is the tile you most want to click ON - and
  // letting the floor there resolve to the door meant a step through a
  // doorway pulled it shut instead (designer, 2026-07-31). Closing it is
  // still one click: the swung-open panel is a registered pick target, so
  // aiming at the door itself works, as do the right-click menu and the Alt
  // overlay. Every ground-point surface reads this - the cursor, the focus
  // banner, the click - so they cannot disagree about what the floor means.
  const doorNearPoint = (point) => {
    const key = doorKeyNear(point);
    if (!key) return null;
    const door = grid.doors.get(key);
    return door && !door.open ? key : null;
  };

  // The door a click or a hover means IN COMBAT, or null. One predicate, read
  // by both the cursor and the click, so the pointer can never promise a swing
  // of the handle that the click then declines.
  //
  // Doors were reachable in a fight only through the right-click menu: the
  // left-click path had no door branch at all, so clicking one fell through to
  // handleTileClick and walked you at it, and the hover path never asked, so
  // the cursor stayed a plain arrow over the one piece of terrain you can
  // change.
  //
  // Hitting the door MESH always counts - you aimed at the door, there is
  // nothing else you could have meant. A ground point merely NEAR a door edge
  // only counts when you are already standing beside it, because
  // `doorNearPoint` claims a band either side of the edge and movement is
  // the expensive thing in a fight: a click on the floor by a doorway has to
  // stay a step, not become a refusal - or, worse, a 2 AP door swing.
  const combatDoorAt = (hit, point) => {
    if (hit?.kind === 'door') return hit.ref;
    const key = point ? doorNearPoint(point) : null;
    return key && atDoor(key, getCombat()?.actingActor) ? key : null;
  };

  function toggleDoor(key) {
    if (isGameOver()) return;
    // Doors used to be refused outright while in combat, with no comment - and
    // a closed door is the game's ONLY true line-of-sight blocker, so the half
    // of the game that is about positioning was the half where the one piece of
    // terrain you can change was untouchable.
    if (isInCombat()) {
      const combat = getCombat();
      if (!atDoor(key, combat?.actingActor)) {
        ui.say('Too far - step up to the door first.');
        return;
      }
      if (!(combat?.spendAp(COMBAT_DOOR_AP) ?? false)) {
        ui.say(`Not enough AP - working a door costs ${COMBAT_DOOR_AP}.`);
        return;
      }
    }
    const open = !grid.doors.get(key).open;
    grid.setDoorOpen(key, open);
    scene.refreshDoor(key);
    // Every route in the level may have just changed - theirs and yours.
    onWorldChanged();
    ui.say(open ? 'The door swings open.' : 'You pull the door shut.');
    if (loot.labelsVisible) loot.showLabels();
  }

  const approachDoor = (key) => {
    const sides = doorSides(key);
    const [ax, az] = isWalkable(sides[0][0], sides[0][1]) ? sides[0] : sides[1];
    approachAndDo(ax, az, () => toggleDoor(key));
  };

  // Doors join the Alt overlay through the looting module's extraEntries hook
  // (doors aren't loot, so the door logic stays here).
  function overlayEntries() {
    const out = [];
    const player = getPlayer();
    const near = (x, z) => Math.max(Math.abs(x - player.x), Math.abs(z - player.z)) <= 10;
    for (const [key, d] of grid.doors) {
      const { x: wx, z: wz } = doorMidpoint(key);
      if (!near(Math.round(wx), Math.round(wz))) continue;
      out.push({
        icon: '🚪',
        text: d.open ? 'Door (open)' : 'Door',
        world: { x: wx, y: 0.95, z: wz },
        onClick: () => approachDoor(key),
      });
    }
    return out;
  }

  // Doors the given tile is standing at, as edge midpoints, so combat can ring
  // them. Doors are the only terrain a fight can change and the only true
  // line-of-sight blocker, but they sit on EDGES rather than tiles - so combat
  // cannot find them the way it finds a prop, and until it could, the one thing
  // worth walking over to use had no affordance at all. The price rides along
  // rather than being re-declared in combat.js: one number, owned by the rule
  // that charges it.
  function doorsBeside(x, z) {
    const out = [];
    for (const key of grid.doors.keys()) {
      if (!doorSides(key).some(([sx, sz]) => sx === x && sz === z)) continue;
      out.push({ ...doorMidpoint(key), ap: COMBAT_DOOR_AP });
    }
    return out;
  }

  return {
    doorNearPoint, combatDoorAt, toggleDoor, approachDoor, overlayEntries, doorsBeside, atDoor,
  };
}
