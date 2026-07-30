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

// A legend value is `<id>` or `<id>@<level>` - "a Manager, but at tier 3".
//
// This is how a floor asks for a TOUGHER one of somebody without a second
// registry entry existing to be tougher. It used to take one: `senior-manager`
// and `regional-executive` were hand-written copies of the Manager and the
// Executive with bigger numbers, which meant two ways to make a harder enemy
// that disagreed with each other - the hand-written Senior Manager paid 50%
// more XP than a Manager scaled to the same level, and which one a floor got
// depended on which id somebody typed. `stats.scaleEnemy` was always the one
// that could do this from a number; it just had no way to be TOLD the number
// per placement, only per floor (`depth`). Now it does.
//
// Parsing lives here, once, because three callers need to agree about it:
// grid.js (spawning), editor.js (round-tripping a level), and the lint.
export function parseActorRef(value) {
  const raw = String(value ?? '');
  const at = raw.lastIndexOf('@');
  if (at <= 0) return { id: raw, level: null };
  const level = Number(raw.slice(at + 1));
  // A trailing '@' or a non-number is a typo, not a tier. Returning the whole
  // string as the id lets the caller's own "unknown actor" error name it,
  // which points at the level file instead of failing somewhere downstream.
  if (!Number.isInteger(level) || level < 1) return { id: raw, level: null };
  return { id: raw.slice(0, at), level };
}

// The canonical map char for an actor id, or null if nothing declares one.
// Accepts a tiered ref: every tier of an actor is still that actor's body.
export function actorChar(id) {
  const { id: base } = parseActorRef(id);
  for (const reg of ACTOR_REGISTRIES) if (reg[base]?.char) return reg[base].char;
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
