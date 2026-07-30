// Shipped-level validation: every level in levels/ must parse, agree with the
// registries, and use the registries' canonical characters (the editor
// round-trips on those). Catches a bad hand edit before it ships.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parseLevel } from '../../src/grid.js';
import { findPath } from '../../src/pathfinding.js';
import { existsSync } from 'node:fs';
import { TILE_TYPES, blocksSight } from '../../src/data/tiles.js';
import { ENEMY_TYPES, ENEMY_KITS } from '../../src/data/enemies.js';
import { parseActorRef } from '../../src/data/actor-registries.js';
import { NPCS } from '../../src/data/npcs.js';
import { COMPANIONS, COMPANION_KITS } from '../../src/data/companions.js';
import { CLASSES, MERGED_PER_KEY } from '../../src/data/classes.js';
import { ACTIONS, summonSpec } from '../../src/data/actions.js';
import { ITEMS, LOOT_TABLES } from '../../src/data/items.js';
import { SHOPS } from '../../src/data/shops.js';
import { LEVELS, FIRST_LEVEL } from '../../src/data/levels.js';
import { ACTOR_REGISTRIES, actorChar, actorLegend } from '../../src/data/actor-registries.js';
import { STATUSES } from '../../src/data/statuses.js';
import { SURFACES, ELECTRIFIED, FIRE } from '../../src/data/surfaces.js';

const files = readdirSync('levels').filter((f) => f.endsWith('.json'));
const load = (f) => JSON.parse(readFileSync(`levels/${f}`, 'utf8'));

test('there are shipped levels', () => {
  assert.ok(files.length >= 1);
});

test('every registry cross-reference resolves', () => {
  // Class/companion action ids and their track grants must exist in ACTIONS.
  for (const [regName, reg] of [['CLASSES', CLASSES], ['COMPANIONS', COMPANIONS]]) {
    for (const [id, def] of Object.entries(reg)) {
      for (const a of def.actions || []) assert.ok(ACTIONS[a], `${regName}.${id} action "${a}" exists`);
      for (const node of def.track || []) {
        const grant = node.effect?.grantsAction;
        if (grant) assert.ok(ACTIONS[grant], `${regName}.${id} track grants real action "${grant}"`);
      }
    }
  }
  // A companion or an enemy that IS one of the classes names it and inherits
  // it. The class must resolve...
  const ARCHETYPE_KITS = [
    ['COMPANIONS', COMPANION_KITS],
    ['ENEMY_TYPES', ENEMY_KITS],
  ];
  for (const [regName, kits] of ARCHETYPE_KITS) {
    for (const [id, kit] of Object.entries(kits)) {
      if (!kit.classId) continue; // a standalone archetype with no class twin
      assert.ok(CLASSES[kit.classId], `${regName}.${id} classId "${kit.classId}" is a real class`);
    }
  }
  // ...and must never re-state something the class already says. That
  // restatement is what let the mail room companion keep the old rig and the old
  // kit after the Mail Room class moved on - a silent copy that drifts. An
  // override is for DEPARTING from the class; matching it means delete the line.
  // `maxHp` is exempt: enemies spell it `hp` and fromClass drops the inherited
  // one, so an enemy's own value can legitimately equal the class's.
  // `name` is NOT exempt any more: it is inherited like everything else, so a
  // kit that restates the class's own label is the same silent copy as any
  // other - and the two companions that used to carry invented names are
  // exactly where that copy was hiding.
  const IDENTITY = new Set([
    'classId', 'char', 'examine', 'dialogue', 'recruitedDialogue',
    'level', 'hp', 'xp', 'loot', 'attacks', 'attackAp', 'aggression', 'summon',
  ]);
  // The check's granularity follows the MERGE's: a field merged per key (attr)
  // is checked per key, or three verbatim attributes hide behind one that
  // differs - which is exactly how the intern kept copying IT Support's grit,
  // hustle and composure while only savvy made him an intern.
  for (const [regName, kits] of ARCHETYPE_KITS) {
    for (const [id, kit] of Object.entries(kits)) {
      if (!kit.classId) continue;
      const base = CLASSES[kit.classId];
      for (const [key, val] of Object.entries(kit)) {
        if (IDENTITY.has(key) || !(key in base)) continue;
        if (MERGED_PER_KEY.includes(key)) {
          for (const [sub, v] of Object.entries(val)) {
            assert.notDeepEqual(v, base[key]?.[sub],
              `${regName}.${id}.${key}.${sub} just repeats ${kit.classId}.${key}.${sub} - delete it and inherit`);
          }
          continue;
        }
        assert.notDeepEqual(val, base[key],
          `${regName}.${id}.${key} just repeats ${kit.classId}.${key} - delete it and inherit`);
      }
    }
  }

  // The check above compares a `track` override against the class's AS A WHOLE
  // ARRAY, and two arrays of different length are trivially unequal - so it
  // passes any override that renames a node, which is exactly how the IT
  // companion's `intern-fast-learner` (a relabelled `it-root`, same +1 savvy)
  // survived the lint that was written to catch it. Compare EFFECTS, which is
  // the part the rules actually read: an id and a name are free to differ, a
  // duplicated effect is a second copy of a class node under a new label.
  //
  // Overriding a track at all is also worth a hard look - it REPLACES rather
  // than merges, so a shorter override silently deletes the class nodes it
  // omits. That is how an IT person who joined the party lost the ability to
  // ever learn two of IT Support's own actions.
  for (const [regName, kits] of ARCHETYPE_KITS) {
    for (const [id, kit] of Object.entries(kits)) {
      if (!kit.classId || !kit.track) continue;
      const classTrack = CLASSES[kit.classId].track || [];
      for (const node of kit.track) {
        const twin = classTrack.find((b) => JSON.stringify(b.effect) === JSON.stringify(node.effect));
        assert.ok(!twin,
          `${regName}.${id}.track "${node.id}" has the same effect as ${kit.classId}'s `
          + `"${twin?.id}" - it is that node renamed, so delete it and inherit the track`);
      }
    }
  }

  // Every `applies` names a real status. applyStatus() returns false for an
  // unknown id without a peep, so a typo here ships an attack, surface or
  // weapon proc whose rider silently never fires - the exact bug class a lint
  // is for. Walks every registry that can carry one.
  const statusSites = [];
  for (const [id, a] of Object.entries(ACTIONS)) {
    if (a.applies) statusSites.push([`ACTIONS.${id}.applies`, a.applies]);
  }
  for (const [id, def] of Object.entries(ENEMY_TYPES)) {
    for (const [i, atk] of (def.attacks || []).entries()) {
      if (atk.applies) statusSites.push([`ENEMY_TYPES.${id}.attacks[${i}].applies`, atk.applies]);
    }
  }
  for (const [id, def] of Object.entries(CLASSES)) {
    for (const [i, atk] of (def.attacks || []).entries()) {
      if (atk.applies) statusSites.push([`CLASSES.${id}.attacks[${i}].applies`, atk.applies]);
    }
  }
  for (const [id, it] of Object.entries(ITEMS)) {
    if (it.proc?.applies) statusSites.push([`ITEMS.${id}.proc.applies`, it.proc.applies]);
  }
  for (const [id, s] of Object.entries(SURFACES)) {
    if (s.onEnter?.applies) statusSites.push([`SURFACES.${id}.onEnter.applies`, s.onEnter.applies]);
  }
  for (const [name, s] of [['ELECTRIFIED', ELECTRIFIED], ['FIRE', FIRE]]) {
    if (s.onEnter?.applies) statusSites.push([`${name}.onEnter.applies`, s.onEnter.applies]);
  }
  for (const [where, statusId] of statusSites) {
    assert.ok(STATUSES[statusId], `${where} = "${statusId}" is a real status`);
  }
  assert.ok(statusSites.length > 0, 'the lint actually found status references to check');

  // Summon archetypes resolve to a class or an enemy type (class-side + enemy-side).
  for (const [id, a] of Object.entries(ACTIONS)) {
    if (a.type === 'summon') assert.ok(CLASSES[a.archetype] || ENEMY_TYPES[a.archetype], `action "${id}" summons a real archetype`);
  }
  // Every playable class is FOR something, and no two are for the same thing
  // (POWERS_PLAN M8). This is the lint that stops the roster converging back
  // into six vocabularies over one character - which is exactly what it was
  // before the verb vocabulary grew, and which no test could have caught
  // because every kit was individually valid.
  const primaries = new Map();
  for (const [id, def] of Object.entries(CLASSES)) {
    if (def.playable === false) continue;
    assert.ok(def.primary, `class "${id}" declares a primary verb`);
    assert.ok(!primaries.has(def.primary),
      `class primary "${def.primary}" is unique (${id} collides with ${primaries.get(def.primary)})`);
    primaries.set(def.primary, id);
    // ...and the kit has to actually contain it. A class whose primary is a
    // verb it cannot perform is a promise on the résumé card and nowhere else.
    const kit = (def.actions || []).map((a) => ACTIONS[a]?.type);
    assert.ok(kit.includes(def.primary),
      `class "${id}" primary "${def.primary}" appears in its kit (has: ${kit.join(', ')})`);
  }
  // No orphaned actions. `firewall` sat in the registry unreferenced after IT
  // Support's kit was re-cut - dead content that still costs a reader's time
  // and still looks like something the game does.
  const reachable = new Set(['shove', 'punch', 'take-cover', 'pull']); // universal
  for (const regs of [CLASSES, COMPANIONS]) {
    for (const def of Object.values(regs)) {
      for (const a of def.actions || []) reachable.add(a);
      for (const n of def.track || []) if (n.effect?.grantsAction) reachable.add(n.effect.grantsAction);
      if (def.talent?.effects?.grantsAction) reachable.add(def.talent.effects.grantsAction);
    }
  }
  for (const def of Object.values(ENEMY_TYPES)) {
    for (const a of def.actions || []) reachable.add(a);
    if (def.talent?.effects?.grantsAction) reachable.add(def.talent.effects.grantsAction);
  }
  for (const it of Object.values(ITEMS)) if (it.attack) reachable.add(it.attack);
  for (const [id, a] of Object.entries(ACTIONS)) {
    if (a.ammoCost) reachable.add(id); // throwables join the bar automatically
  }
  for (const id of Object.keys(ACTIONS)) {
    assert.ok(reachable.has(id), `action "${id}" is reachable by somebody`);
  }
  // Anything that paints the floor names a real tile type - the cone's
  // `leaves` and the zone verb's alike (POWERS_PLAN M3). A typo here is
  // invisible until someone fires the power in a real fight and the surface
  // silently fails to land: grid.setType would take a name nothing renders.
  for (const [id, a] of Object.entries(ACTIONS)) {
    if (!a.leaves) continue;
    assert.ok(TILE_TYPES[a.leaves], `action "${id}" leaves a real tile type ("${a.leaves}")`);
    assert.ok(TILE_TYPES[a.leaves].surface,
      `action "${id}" leaves "${a.leaves}", which must carry a surface to be worth painting`);
  }
  for (const [id, def] of Object.entries(ENEMY_TYPES)) {
    // summonSpec, because a descriptor may inherit its archetype from the
    // ACTION it is the AI-side twin of rather than restating it.
    const arch = summonSpec(def.summon)?.archetype;
    if (def.summon) assert.ok(CLASSES[arch] || ENEMY_TYPES[arch], `enemy "${id}" summons a real archetype`);
  }
  // Tile loot tables exist, and every table entry names a real item.
  for (const [id, def] of Object.entries(TILE_TYPES)) {
    if (def.loot) assert.ok(LOOT_TABLES[def.loot], `tile "${id}" loot table "${def.loot}" exists`);
  }
  // Merchants (ECONOMY_PLAN.md). Anything that can open a shop names a real
  // one, and a shop only stocks things a merchant could actually price - an
  // item with no `value` would render a "Buy - 0" row that shop.js then
  // refuses, which is a dead button rather than an error anyone would see.
  const shopSites = [];
  for (const [id, def] of Object.entries(TILE_TYPES)) {
    if (def.shop) shopSites.push([`TILE_TYPES.${id}`, def.shop]);
  }
  for (const [regName, reg] of [['NPCS', NPCS], ['COMPANIONS', COMPANIONS]]) {
    for (const [id, def] of Object.entries(reg)) {
      if (def.shop) shopSites.push([`${regName}.${id}`, def.shop]);
    }
  }
  for (const [where, shopId] of shopSites) {
    assert.ok(SHOPS[shopId], `${where} shop "${shopId}" is a real merchant`);
  }
  assert.ok(shopSites.length > 0, 'the lint actually found merchants to check');
  for (const [id, shop] of Object.entries(SHOPS)) {
    assert.ok(shop.stock?.length, `shop "${id}" stocks something`);
    for (const row of shop.stock) {
      assert.ok(ITEMS[row.item], `shop "${id}" stock item "${row.item}" exists`);
      assert.ok(ITEMS[row.item].value > 0, `shop "${id}" stock item "${row.item}" has a value`);
      assert.ok((row.qty ?? 1) > 0, `shop "${id}" stock item "${row.item}" has a positive qty`);
    }
    assert.ok((shop.markup ?? 1) > 0, `shop "${id}" markup is positive`);
  }
  // Every item can actually be OBTAINED. An entry nothing drops, stocks or
  // starts you with is dead data that no other lint can see - it type-checks,
  // it prices, it just never reaches a player. (This caught a `coin-return`
  // authored for a machine-shaking verb that was then deliberately not built.)
  const obtainable = new Set();
  for (const entries of Object.values(LOOT_TABLES)) for (const e of entries) obtainable.add(e.item);
  for (const def of Object.values(ENEMY_TYPES)) for (const e of def.loot || []) obtainable.add(e.item);
  for (const shop of Object.values(SHOPS)) for (const r of shop.stock || []) obtainable.add(r.item);
  for (const reg of [CLASSES, COMPANIONS]) {
    for (const def of Object.values(reg)) {
      for (const id of Object.values(def.startGear || {})) obtainable.add(id);
    }
  }
  for (const id of Object.keys(ITEMS)) {
    assert.ok(obtainable.has(id),
      `item "${id}" is unobtainable - no loot table, enemy, shop or startGear produces it`);
  }

  // Money and worth are integers. A fractional `value` would put a price like
  // "7.2" in a button and a fraction in the purse, and cash is counted, not
  // measured.
  for (const [id, it] of Object.entries(ITEMS)) {
    if (it.value !== undefined) {
      assert.ok(Number.isInteger(it.value) && it.value > 0, `item "${id}" value is a positive integer`);
    }
    if (it.cash !== undefined) {
      assert.ok(Number.isInteger(it.cash) && it.cash > 0, `item "${id}" cash is a positive integer`);
      assert.ok(!it.value, `cash item "${id}" has no resale value - it never reaches the bag`);
      assert.ok(!it.slot && !it.heal && !it.ammo, `cash item "${id}" is only money`);
    }
  }
  // A level's map is one CHARACTER per cell and the editor exports canonical
  // registry chars, so a duplicate `char` silently makes one prop unpaintable
  // and corrupts the load -> export round trip. With a large furniture kit
  // this is the easiest mistake to make, so pin it.
  //
  // `runtimeOnly` tiles are EXEMPT (POWERS_PLAN M6): nobody paints them and
  // nobody exports them - they only ever arrive through grid.setType - so they
  // consume none of the character budget, which is what makes the fallen twins
  // affordable at all with 92 of 94 characters already spoken for. They must
  // therefore also carry NO char, or they would silently spend one anyway.
  const byChar = new Map();
  for (const [id, def] of Object.entries(TILE_TYPES)) {
    if (def.runtimeOnly) {
      assert.equal(def.char, undefined,
        `runtimeOnly tile "${id}" must not claim a character - that is the point of the flag`);
      continue;
    }
    assert.ok(typeof def.char === 'string' && def.char.length === 1, `tile "${id}" has a single-char code`);
    assert.ok(!byChar.has(def.char),
      `tile char "${def.char}" is unique (${id} collides with ${byChar.get(def.char)})`);
    byChar.set(def.char, id);
  }
  // Toppling (POWERS_PLAN M6, revised TACTICS_PLAN M6): a prop that goes over
  // must name a fallen twin that exists, and that twin must be runtimeOnly -
  // a paintable one would be spending a character nobody asked it to spend.
  // A twin may be SOLID now (an object on its side - designer, 2026-07-30),
  // but a solid twin must stay LOW: the M6a sight rule is what keeps a sealed
  // pocket a shooting gallery instead of the stalemate the original
  // non-solid rule guarded against, so a twin that blocked sight would
  // reintroduce that failure by data alone.
  for (const [id, def] of Object.entries(TILE_TYPES)) {
    if (!def.topple) continue;
    const twin = TILE_TYPES[def.topple.becomes];
    assert.ok(twin, `tile "${id}" topples into a real tile ("${def.topple.becomes}")`);
    assert.equal(twin.runtimeOnly, true, `"${def.topple.becomes}" is runtimeOnly`);
    assert.equal(blocksSight(twin), false,
      `"${def.topple.becomes}" is shot over, whatever it blocks on foot`);
    const [lo, hi] = def.topple.damage || [];
    assert.ok(lo > 0 && hi >= lo, `tile "${id}" topple damage is a sane range`);
  }
  // Every referenced model actually ships - a typo here renders an invisible
  // prop that still blocks movement, which is near-impossible to spot in play.
  for (const [id, def] of Object.entries(TILE_TYPES)) {
    if (!def.model) continue;
    assert.ok(existsSync(new URL(`../../assets/${def.model}.glb`, import.meta.url)),
      `tile "${id}" model assets/${def.model}.glb exists`);
    if (def.scale !== undefined) {
      assert.ok(def.scale > 0 && def.scale <= 3, `tile "${id}" scale ${def.scale} is sane`);
    }
  }
  for (const [table, entries] of Object.entries(LOOT_TABLES)) {
    for (const e of entries) assert.ok(ITEMS[e.item], `loot table "${table}" item "${e.item}" exists`);
  }
  // Enemy body-loot lists name real items too.
  for (const [id, def] of Object.entries(ENEMY_TYPES)) {
    for (const e of def.loot || []) assert.ok(ITEMS[e.item], `enemy "${id}" loot item "${e.item}" exists`);
  }
  // Every CHARACTER rig a registry names actually ships. Character models are
  // reassigned as roles change hands (the Mail Room clerk and the Security
  // Guard swapped rigs), and a typo there loads nothing at all - an invisible
  // enemy that still blocks, fights and kills you.
  for (const [regName, reg] of [['ENEMY_TYPES', ENEMY_TYPES], ['CLASSES', CLASSES],
    ['NPCS', NPCS], ['COMPANIONS', COMPANIONS]]) {
    for (const [id, def] of Object.entries(reg)) {
      if (!def.model) continue;
      assert.ok(existsSync(new URL(`../../assets/characters/${def.model}.glb`, import.meta.url)),
        `${regName}.${id} model assets/characters/${def.model}.glb exists`);
    }
  }
  // Actor characters live in the same one-char-per-cell map as tile chars, and
  // actors win the lookup (grid.js), so a shared char makes a tile unpaintable
  // wherever that actor is legal. Keep the actor namespace clean of both.
  const actorChars = new Map();
  const tileChars = new Set(Object.values(TILE_TYPES).map((d) => d.char));
  for (const [regName, reg] of [['ENEMY_TYPES', ENEMY_TYPES], ['NPCS', NPCS], ['COMPANIONS', COMPANIONS]]) {
    for (const [id, def] of Object.entries(reg)) {
      assert.ok(typeof def.char === 'string' && def.char.length === 1, `${regName}.${id} has a single-char code`);
      assert.ok(def.char !== '@', `${regName}.${id} does not claim the player's char`);
      assert.ok(!actorChars.has(def.char),
        `actor char "${def.char}" is unique (${id} collides with ${actorChars.get(def.char)})`);
      assert.ok(!tileChars.has(def.char),
        `actor char "${def.char}" (${id}) does not shadow a tile char`);
      actorChars.set(def.char, id);
    }
  }
});

for (const f of files) {
  test(`${f} parses and has a player spawn and an exit`, () => {
    const data = load(f);
    const g = parseLevel(data); // throws on unknown tile types
    const playerChar = Object.entries(data.actors).find(([, v]) => v === 'player')?.[0];
    assert.ok(playerChar, 'actors legend names a player');
    assert.ok(data.map.some((row) => row.includes(playerChar)), 'player is on the map');
    let hasExit = false;
    for (let z = 0; z < g.height; z++) {
      for (let x = 0; x < g.width; x++) if (g.typeAt(x, z) === 'exit') hasExit = true;
    }
    assert.ok(hasExit, 'level has an exit');
  });

  test(`${f} every map character is declared in a legend`, () => {
    // parseLevel silently defaults an unknown tile char to 'floor' (grid.js), so
    // a typo'd map char would ship as invisible walkable floor. Guard the map
    // against any char that isn't in the tiles OR actors legend (space = void).
    const data = load(f);
    const declared = new Set([...Object.keys(data.tiles || {}), ...Object.keys(data.actors || {})]);
    for (let z = 0; z < data.map.length; z++) {
      for (const ch of data.map[z]) {
        if (ch === ' ') continue;
        assert.ok(declared.has(ch), `map char "${ch}" (row ${z}) is declared in a legend`);
      }
    }
  });

  test(`${f} the exit is reachable from the player spawn`, () => {
    // A walled-off exit would make the floor uncompletable while passing every
    // other check. Doors are openable, so they count as passable for reach.
    const data = load(f);
    const g = parseLevel(data);
    let exit = null;
    for (let z = 0; z < g.height && !exit; z++) {
      for (let x = 0; x < g.width; x++) if (g.typeAt(x, z) === 'exit') { exit = { x, z }; break; }
    }
    assert.ok(exit, 'level has an exit tile');
    const stepPassable = (x, z, nx, nz) => g.edgeOpen(x, z, nx, nz) || !!g.doorBetween(x, z, nx, nz);
    const route = findPath(g.terrainOpen, g.playerSpawn.x, g.playerSpawn.z, exit.x, exit.z, null, stepPassable);
    assert.ok(route, 'a walk-up route from the spawn to the exit exists (doors count as openable)');
  });

  test(`${f} legend matches the registries' canonical characters`, () => {
    const data = load(f);
    for (const [ch, type] of Object.entries(data.tiles)) {
      assert.ok(TILE_TYPES[type], `tile type "${type}" exists`);
      assert.equal(TILE_TYPES[type].char, ch,
        `char "${ch}" is canonical for "${type}" (the editor round-trips on canonical chars)`);
    }
    for (const [ch, ref] of Object.entries(data.actors)) {
      if (ref === 'player') continue;
      const { id: actor, level: tier } = parseActorRef(ref);
      const reg = ENEMY_TYPES[actor] || NPCS[actor] || COMPANIONS[actor]; // enemies, NPCs, or recruits
      assert.ok(reg, `actor type "${actor}" exists`);
      if (tier == null) {
        assert.equal(reg.char, ch, `char "${ch}" is canonical for "${actor}"`);
        continue;
      }
      // A TIERED placement must NOT use the canonical char: that char already
      // means "this actor at the floor's depth", so sharing it would make the
      // two indistinguishable on the map and collapse them on an editor round
      // trip. It just has to be a char nothing else in this level has claimed.
      assert.notEqual(reg.char, ch,
        `char "${ch}" is canonical for "${actor}" - a tiered placement needs its own`);
      assert.ok(!data.tiles[ch], `char "${ch}" is already a tile in ${f}`);
      assert.equal(Object.keys(data.actors).filter((c) => c === ch).length, 1);
    }
  });

  test(`${f} wall and door runs stay inside the map`, () => {
    const data = load(f);
    const width = Math.max(...data.map.map((r) => r.length));
    const height = data.map.length;
    for (const spec of [...(data.walls || []), ...(data.doors || [])]) {
      const [o, xs, zs, ls] = spec.split(/\s+/);
      const x = Number(xs);
      const z = Number(zs);
      const len = Number(ls ?? 1);
      if (o === 'H') {
        assert.ok(x >= 0 && x + len <= width && z >= 0 && z <= height, `${spec} in bounds`);
      } else {
        assert.ok(x >= 0 && x <= width && z >= 0 && z + len <= height, `${spec} in bounds`);
      }
    }
  });

  test(`${f} "next" points at a real level`, () => {
    const data = load(f);
    if (data.next) {
      assert.ok(files.includes(`${data.next}.json`), `next="${data.next}" ships`);
    }
  });

  // A file on disk is not enough: the exit reads LEVELS (data/levels.js), so a
  // level that ships but was never registered there ends the campaign with the
  // WIN screen instead of loading the next floor.
  test(`${f} is registered in data/levels.js`, () => {
    const id = f.replace(/\.json$/, '');
    assert.ok(LEVELS[id], `levels/${f} is registered as LEVELS["${id}"]`);
  });

  test(`${f} "next" is registered in data/levels.js`, () => {
    const data = load(f);
    if (data.next) {
      assert.ok(LEVELS[data.next],
        `next="${data.next}" is in LEVELS, or the exit silently ends the run`);
    }
  });

  test(`${f} depth, if set, is a positive integer`, () => {
    const data = load(f);
    if ('depth' in data) {
      assert.ok(Number.isInteger(data.depth) && data.depth >= 1, 'depth is a positive integer');
    }
  });
}

// The editor round-trips a level through CANONICAL registry chars: loading
// remaps every map char to the one its registry declares, and exporting writes
// the legend back from those same registries. An actor id that no registry can
// name is therefore dropped to floor on the way in and has no legend entry on
// the way out - deleted from the file, silently, by the tool ARCHITECTURE.md
// points at for editing levels.
//
// This is the cheap half of that guarantee (editor.spec.js drives the real
// round trip). It is worth having separately because it fails the moment a new
// actor registry appears and nobody adds it to the editor's list.

test('every actor a shipped level places can be named by a registry', () => {
  for (const [levelId, level] of Object.entries(LEVELS)) {
    const used = new Set(level.map.flatMap((r) => r.split('')));
    for (const [ch, id] of Object.entries(level.actors || {})) {
      if (!used.has(ch) || id === 'player') continue;
      assert.ok(
        actorChar(id),
        `${levelId}: places '${id}' as '${ch}', but no actor registry declares a char for it `
        + '- the editor would drop it on a load -> export round trip',
      );
    }
  }
});

test('actor chars are unique across every registry the editor exports', () => {
  // The export legend is one char -> one id map built from all the registries;
  // two registries claiming the same char would silently overwrite, and a
  // level using it would reload as the wrong actor. `actorLegend` collapses
  // them, so compare its size against the number of declared chars.
  const owner = new Map();
  for (const reg of ACTOR_REGISTRIES) {
    for (const [id, def] of Object.entries(reg)) {
      if (!def.char) continue;
      assert.ok(!owner.has(def.char),
        `char '${def.char}' is claimed by both '${owner.get(def.char)}' and '${id}'`);
      owner.set(def.char, id);
    }
  }
  assert.ok(!owner.has('@'), 'the player char must stay reserved');
  // Nothing was lost collapsing them into the legend the editor writes.
  assert.equal(Object.keys(actorLegend()).length, owner.size);
});

// --- registry id hygiene (TODO Phase 6) ------------------------------------
test('no id is shared between the class and enemy registries', () => {
  // They are looked up from the same legends and the same archetype fields
  // (summons name a CLASS id; level legends name an ENEMY id), so a collision
  // silently resolves to whichever registry is consulted first.
  for (const id of Object.keys(CLASSES)) {
    assert.equal(ENEMY_TYPES[id], undefined,
      `"${id}" is both a class and an enemy type - one of them will be shadowed`);
  }
});

test('every enemy type is placed on some shipped floor, or is explicitly a summon', () => {
  // An archetype nobody can meet is content that costs a reader's time and
  // silently rots. Summoned-only types are exempt - they arrive by action, not
  // by legend.
  const placed = new Set();
  for (const level of Object.values(LEVELS)) {
    // Through parseActorRef, so a tiered placement ("manager@3") counts as
    // placing the Manager - it is the same enemy at a point on the curve.
    for (const v of Object.values(level.actors || {})) placed.add(parseActorRef(v).id);
  }
  const summonable = new Set(
    Object.values(ACTIONS).map((a) => a.archetype).filter(Boolean));
  // No standing exemptions. There used to be one - a level-4 boss authored
  // ahead of the floor that would use it - and it was a hand-written tier
  // variant of the Executive, so it went when the curve learned to be asked
  // for a tier directly. If a new orphan needs an exemption, ask whether it is
  // a real enemy or another variant first.
  for (const id of Object.keys(ENEMY_TYPES)) {
    assert.ok(placed.has(id) || summonable.has(id) || ENEMY_TYPES[id].summonOnly,
      `enemy type "${id}" is never placed on a floor and never summoned`);
  }
});
