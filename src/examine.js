// WHAT THE THING UNDER THE CURSOR IS CALLED.
//
// A slice off `startGame` (Q039), and the smallest seam in the file: no state,
// no bodies moved, nothing spent. A hit, a tile or a point goes in and a line of
// prose comes out. It is here because naming is a subject of its own - the
// ladder below is a list of decisions about what a player should be told, and
// those decisions were buried among the click handlers that happen to ask.
//
// Two of the rungs are load-bearing and easy to undo by accident:
//   - the floor is examined on TERRAIN, not walkability. `isWalkable` also
//     refuses a tile somebody is standing on, so examining the ground under a
//     coworker used to fall through the entire solid ladder and come out as
//     "a cubicle wall" - on plain carpet, because a floor def carries no label.
//   - "a cubicle wall" is the LAST resort. As the catch-all for everything
//     solid it introduced half the office - chairs, sofas, fridges, bookshelves
//     - as a cubicle wall. Naming a thing beats miscalling it.
export function createExamine(d) {
  function examineTile(tx, tz) {
    const def = d.grid.defAt(tx, tz);
    // TERRAIN, not walkability. `isWalkable` also refuses a tile somebody is
    // STANDING on, so examining the floor under a coworker fell through the
    // whole solid ladder below and came out as the last-resort "a cubicle
    // wall" - on plain carpet, because the floor def carries no label of its
    // own. What is underfoot does not change because somebody is on it.
    if (d.grid.terrainOpen(tx, tz)) {
      if (d.runtime.isBurning(tx, tz)) return d.FIRE.examine;
      if (d.grid.isElectrified(tx, tz)) return d.ELECTRIFIED.examine;
      const surfId = d.runtime.surfaceAt(tx, tz);
      return (surfId && d.SURFACES[surfId].examine) || 'Standard-issue office carpet. Faintly damp.';
    }
    // Burning first: a trash can on fire is a different object than a trash can.
    if (def.ignitable && d.runtime.isBurning(tx, tz)) {
      return 'The trash can is thoroughly on fire. Somewhere, an alarm should be going off.';
    }
    if (def.examine) return def.examine;
    if (def.ignitable) return 'A trash can. Sixty percent paper, forty percent regret.';
    if (def.explosive) return 'The printer. It has jammed 4 times today. It is waiting.';
    if (def.shop) return 'A snack machine, humming. Row E7 has been stuck since before you were hired.';
    if (def.loot) return `${def.label}. Probably contains secrets. Or staples.`;
    // Naming it beats miscalling it. The cubicle wall is the LAST resort now:
    // as the catch-all for everything solid it introduced half the furniture in
    // the office - chairs, sofas, fridges, bookshelves - as a cubicle wall.
    return def.label
      ? `${def.label}. Office issue, and not going anywhere.`
      : 'A cubicle wall. It has seen things.';
  }
  const doorExamine = (open) => (open
    ? 'An office door, ajar. A bold statement of availability.'
    : 'A closed office door. The universal sign for "do not perceive me."');
  // Whatever the cursor resolves to: a body first, then a door, then the tile.
  function examineAt(hit, tile, point) {
    if (hit?.kind === 'npc') return hit.ref.def.examine || 'A coworker. Non-hostile, for now.';
    if (hit?.kind === 'party') return hit.ref.def?.examine || 'One of yours. Holding up, mostly.';
    if (hit?.kind === 'enemy') return hit.ref.def.examine || 'A coworker, in the way.';
    const doorKey = hit?.kind === 'door' ? hit.ref : null;
    if (doorKey) return doorExamine(d.grid.doors.get(doorKey)?.open);
    return tile ? examineTile(tile.x, tile.z) : null;
  }

  return { examineTile, doorExamine, examineAt };
}
