// The looting subsystem: container rummaging, lootable bodies, loose floor
// items, the pockets (inventory panel) and the Alt loot overlay. Pulled out
// of main.js so the game flow only wires clicks to verbs; every rule about
// what loot does lives here.
//
// The host supplies world access and three live queries (the sheet is
// reassigned on class pick, combat/game-over toggle): getSheet, isInCombat,
// isGameOver - plus approachAndDo so overlay clicks walk the player in.
import { ITEMS, LOOT_TABLES, rollLoot } from './data/items.js';
import { PAPER_CAP } from './stats.js';
import { placeDroppedItem } from './tile-renderer.js';
import * as ui from './ui.js';

export const INV_CAP = 10;

// `extraEntries` (optional) lets the host add non-loot entries to the Alt
// overlay (doors) without this module knowing what they are.
export function createLooting({ app, grid, runtime, player, enemies, getSheet, isInCombat, isGameOver, approachAndDo, extraEntries = null }) {
  const containerLoot = new Map(); // "x,z" -> remaining item ids (rolled on first rummage)
  const looseItems = []; // { x, z, id, entity } - dropped/overflowed floor items

  const itemName = (id) => ITEMS[id]?.name || id;
  const looseAt = (x, z) => looseItems.filter((li) => li.x === x && li.z === z);
  const corpseAt = (x, z) =>
    enemies.find((e) => !e.alive && e.loot?.length && e.x === x && e.z === z) || null;

  const invPanel = ui.createInventoryPanel(ITEMS, INV_CAP, {
    onUse: (i) => useItem(i),
    onDrop: (i) => dropItem(i),
    onExamine: (i) => ui.say(ITEMS[getSheet().inventory[i]]?.examine || 'It is what it is.'),
  });
  const lootLabels = ui.createLootLabels();

  function dropLoose(x, z, id) {
    looseItems.push({ x, z, id, entity: placeDroppedItem(app, x, z) });
  }

  // Loot lands in the pockets; overflow hits the floor, where the Alt overlay
  // (and a click) can pick it back up.
  function receiveItems(ids, from) {
    const sheet = getSheet();
    const taken = [];
    let overflowed = false;
    for (const id of ids) {
      if (sheet.inventory.length < INV_CAP) {
        sheet.inventory.push(id);
        taken.push(itemName(id));
      } else {
        dropLoose(player.x, player.z, id);
        overflowed = true;
      }
    }
    let msg = `${from}: ${taken.length ? taken.join(', ') : 'nothing'}.`;
    if (overflowed) msg += ' Pockets full - the rest hits the floor.';
    ui.toast(msg);
    invPanel.refresh(sheet);
  }

  // Containers roll their table once, on first rummage; after that they're
  // just furniture with a memory of better days.
  function lootContainer(x, z) {
    const def = grid.defAt(x, z);
    if (!def.loot || isInCombat() || isGameOver()) return;
    if (runtime.isBurning(x, z)) { ui.say('It is actively on fire. Rummage later.'); return; }
    const key = x + ',' + z;
    if (!containerLoot.has(key)) containerLoot.set(key, rollLoot(LOOT_TABLES[def.loot]));
    const items = containerLoot.get(key);
    if (!items.length) { ui.toast(`${def.label}: nothing left but disappointment.`); return; }
    containerLoot.set(key, []);
    receiveItems(items, def.label);
  }

  function lootBody(en) {
    if (!en || en.alive || isInCombat() || isGameOver()) return;
    const items = en.loot || [];
    if (!items.length) { ui.toast(`${en.def.name} has nothing left to give. Fitting.`); return; }
    en.loot = [];
    receiveItems(items, `${en.def.name}'s pockets`);
  }

  function pickUpAt(x, z) {
    if (isInCombat() || isGameOver()) return;
    const here = looseAt(x, z);
    if (!here.length) return;
    const ids = [];
    for (const li of here) {
      li.entity?.destroy();
      looseItems.splice(looseItems.indexOf(li), 1);
      ids.push(li.id);
    }
    receiveItems(ids, 'Picked up');
  }

  function useItem(i) {
    const sheet = getSheet();
    if (!sheet || i >= sheet.inventory.length) return;
    if (isInCombat()) { ui.say('Not while everyone is watching.'); return; }
    const id = sheet.inventory[i];
    const def = ITEMS[id] || {};
    if (def.heal) {
      // Don't burn a consumable that can't help right now.
      if (sheet.hp >= sheet.maxHp) { ui.say('You are already at full health. Ration the snacks.'); return; }
      sheet.hp = Math.min(sheet.maxHp, sheet.hp + def.heal);
    } else if (def.ammo) {
      if (sheet.paper >= PAPER_CAP) { ui.say('Your pockets hold no more paper.'); return; }
      sheet.paper = Math.min(PAPER_CAP, sheet.paper + def.ammo);
    } else { ui.say(def.examine || 'It is what it is.'); return; } // flavor: not consumed
    sheet.inventory.splice(i, 1);
    ui.say(def.useLog || `You use the ${itemName(id)}.`);
    ui.updateStatsHud(sheet);
    invPanel.refresh(sheet);
  }

  function dropItem(i) {
    const sheet = getSheet();
    if (!sheet || i >= sheet.inventory.length) return;
    // Same combat gate as useItem - no rearranging pockets mid-brawl (a
    // dropped stapler would silently change your damage bonus).
    if (isInCombat()) { ui.say('Not while everyone is watching.'); return; }
    const [id] = sheet.inventory.splice(i, 1);
    dropLoose(player.x, player.z, id);
    ui.say(`You leave the ${itemName(id)} on the floor. Someone's problem now.`);
    invPanel.refresh(sheet);
    if (lootLabels.visible) showLabels(); // the floor just changed
  }

  // Everything lootable in the area, as clickable Alt-overlay entries.
  // Clicking a label walks you into reach and loots - same path as clicking
  // the object itself.
  function lootEntries() {
    const out = [];
    const near = (x, z) => Math.max(Math.abs(x - player.x), Math.abs(z - player.z)) <= 10;
    for (const li of looseItems) {
      if (!near(li.x, li.z)) continue;
      out.push({
        icon: ITEMS[li.id]?.icon,
        text: itemName(li.id),
        world: { x: li.x, y: 0.35, z: li.z },
        onClick: () => approachAndDo(li.x, li.z, () => pickUpAt(li.x, li.z)),
      });
    }
    for (let z = 0; z < grid.height; z++) {
      for (let x = 0; x < grid.width; x++) {
        const def = grid.defAt(x, z);
        if (!def.loot || !near(x, z)) continue;
        const rolled = containerLoot.get(x + ',' + z);
        if (rolled && !rolled.length) continue; // already cleaned out
        const cx = x;
        const cz = z;
        out.push({
          icon: { trash: '🗑️', printer: '🖨️', desk: '🗄️' }[def.loot],
          text: def.label,
          world: { x, y: def.height + 0.4, z },
          onClick: () => approachAndDo(cx, cz, () => lootContainer(cx, cz)),
        });
      }
    }
    for (const en of enemies) {
      if (en.alive || !en.loot?.length || !en.entity || !near(en.x, en.z)) continue;
      out.push({
        icon: '💀',
        text: `${en.def.name} (body)`,
        world: { x: en.x, y: 0.4, z: en.z },
        onClick: () => approachAndDo(en.x, en.z, () => lootBody(en)),
      });
    }
    if (extraEntries) out.push(...extraEntries());
    return out;
  }
  function showLabels() { lootLabels.show(lootEntries()); }

  return {
    itemName, looseAt, corpseAt,
    lootContainer, lootBody, pickUpAt,
    refreshPanel: (sheet) => invPanel.refresh(sheet),
    togglePanel: (sheet) => invPanel.toggle(sheet),
    showLabels,
    hideLabels: () => lootLabels.hide(),
    repositionLabels: (project) => lootLabels.reposition(project),
    get labelsVisible() { return lootLabels.visible; },
    // Spawn a loose floor item at a tile (god mode's "drop on ground").
    dropAt: (x, z, id) => dropLoose(x, z, id),
    // Read-only views for the window.__game debug/test surface.
    debug: {
      looseItems: () => looseItems.map((li) => ({ x: li.x, z: li.z, id: li.id })),
      containerLootAt: (x, z) => (containerLoot.has(x + ',' + z) ? [...containerLoot.get(x + ',' + z)] : null),
    },
  };
}
