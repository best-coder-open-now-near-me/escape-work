// Non-hostile actor registry: coworkers you TALK to instead of fight, and who
// can never join you - recruitable coworkers live in data/companions.js. An
// NPC is a name, a character .glb (assets/characters/<model>.glb, reused from
// the enemy/class roster for now), and a `dialogue` tree. Give it a character
// in a level's `actors` legend and it stands on the map, blocks movement like
// any body, and opens its dialogue when left-clicked (walk up, then talk -
// the same verb path as looting a container).
//
// Dialogue shape:
//   dialogue: { start: '<nodeId>', nodes: { <nodeId>: node, ... } }
//   node:     { text, options: [{ label, next }] }
// `next` names the node to advance to; `next: null` ends the conversation.
// Linear trees just give each node one option; branches give several. Keep it
// small - this is the minimal talking layer, not a quest engine.
// (The Nervous IT Intern moved to data/companions.js when he got a stat block
// and an exit strategy.)
export const NPCS = {};
