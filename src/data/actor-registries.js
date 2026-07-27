// Every registry that can put a BODY on a map, in one list.
//
// It exists because forgetting one is silent and destructive. The editor
// round-trips a level through canonical registry chars - load remaps each map
// char to the one its registry declares, export writes the legend back from the
// same source - so a registry missing from this list means its actors normalise
// to floor on the way in and get no legend entry on the way out. Both shipped
// floors place a companion, and both lost one that way, in the tool
// ARCHITECTURE.md points at for editing levels/.
//
// Importing it from the test suite as well as from editor.js is the point: the
// guard in tests/unit/levels.test.js checks THIS list, so a new actor registry
// that nobody adds here fails the build instead of quietly eating content.
//
// (Like data/levels.js, this is the deliberate exception to "data/* imports
// nothing" - it composes sibling registries and adds no data of its own.)
import { ENEMY_TYPES } from './enemies.js';
import { NPCS } from './npcs.js';
import { COMPANIONS } from './companions.js';

export const ACTOR_REGISTRIES = [ENEMY_TYPES, NPCS, COMPANIONS];

// The canonical map char for an actor id, or null if nothing declares one.
export function actorChar(id) {
  for (const reg of ACTOR_REGISTRIES) if (reg[id]?.char) return reg[id].char;
  return null;
}

// char -> actor id, across every registry. The shape a level's `actors` legend
// takes; `levels.test.js` pins that no two registries claim the same char.
export function actorLegend() {
  const out = {};
  for (const reg of ACTOR_REGISTRIES) {
    for (const [id, def] of Object.entries(reg)) if (def.char) out[def.char] = id;
  }
  return out;
}
