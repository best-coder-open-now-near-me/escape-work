// The looting subsystem: container rummaging, lootable bodies, loose floor
// items, the pockets (inventory panel) and the Alt loot overlay. Pulled out
// of main.js so the game flow only wires clicks to verbs; every rule about
// what loot does lives here.
//
// The host supplies world access and live queries (the sheet AND the actor
// are reassigned on class pick and on leader switches, so both come in as
// accessors): getActor, getSheet, isInCombat, isGameOver - plus approachAndDo
// so overlay clicks walk the leader in.
import { ITEMS, LOOT_TABLES, rollLoot } from './data/items.js';
import { PAPER_CAP, equipItem, unequipItem } from './stats.js';
import { placeDroppedItem } from './tile-renderer.js';
import * as ui from './ui.js';

// No carry limit. The cap only ever produced overflow-onto-the-floor and
// "pockets are full" refusals, which is friction without a decision attached -
// you never chose WHAT to leave behind, the tenth item just fell out. Kept as
// a named export (Infinity) so every guard site stays honest without each one
// growing a special case.
export const INV_CAP = Infinity;

// `extraEntries` (optional) lets the host add non-loot entries to the Alt
// overlay (doors) without this module knowing what they are.
export function createLooting({ app, grid, runtime, enemies, getActor, getSheet, isInCombat, isGameOver, approachAndDo, extraEntries = null, onGearChange = null, recipients = null, addCash = null, getCash = null, openShop = null, shopSoldOut = null }) {
  const containerLoot = new Map(); // "x,z" -> remaining item ids (rolled on first rummage)
  const looseItems = []; // { x, z, id, entity } - dropped/overflowed floor items
  const harvestedPaper = new Set(); // "x,z" of paper drifts already gathered for ammo

  const itemName = (id) => ITEMS[id]?.name || id;
  // A temporary drift that expires takes its harvested-here mark with it, so a
  // later drift on the same tile is gatherable again (main.js ageTempSurfaces).
  const forgetPaper = (x, z) => harvestedPaper.delete(x + ',' + z);
  const looseAt = (x, z) => looseItems.filter((li) => li.x === x && li.z === z);
  // Live, still-gatherable paper: a paper drift (not burning/burnt - runtime
  // reports 'fire'/null for those) that hasn't been picked clean yet. The
  // sheets stay and keep cutting after harvest; only the ammo is spent.
  const paperHarvestable = (x, z) =>
    runtime.surfaceAt(x, z) === 'paper' && !harvestedPaper.has(x + ',' + z);
  const corpseAt = (x, z) =>
    enemies.find((e) => !e.alive && e.loot?.length && e.x === x && e.z === z) || null;

  const invPanel = ui.createInventoryPanel(ITEMS, INV_CAP, {
    onUse: (i) => useItem(i),
    onDrop: (i) => dropItem(i),
    onExamine: (i) => ui.say(ITEMS[getSheet().inventory[i]]?.examine || 'It is what it is.'),
    onEquip: (i) => equip(i),
    onUnequip: (slot) => unequip(slot),
    onSend: (i, btn) => sendItem(i, btn),
    canSend: () => (recipients?.() || []).length > 0,
    getCash,
  });

  // Hand an item to another party member. Pockets are unlimited, so this can
  // never fail for space - the only reason it is unavailable is having nobody
  // to hand it TO, which is why the button hides itself when travelling alone.
  function sendItem(i, btn) {
    const sheet = getSheet();
    if (!sheet || i >= sheet.inventory.length) return;
    const to = recipients?.() || [];
    if (!to.length) { ui.say('There is nobody else to hand it to.'); return; }
    const id = sheet.inventory[i];
    const r = btn?.getBoundingClientRect?.();
    ui.showMenu(r ? r.right + 4 : 200, r ? r.top : 200, to.map((m) => ({
      label: `Give to ${m.name}`,
      action: () => {
        const at = sheet.inventory.indexOf(id);
        if (at < 0) return; // it moved while the menu was open
        sheet.inventory.splice(at, 1);
        m.take(id);
        ui.say(`You hand the ${itemName(id)} to ${m.name}.`);
        invPanel.refresh(sheet);
      },
    })));
  }
  const lootLabels = ui.createLootLabels();

  function dropLoose(x, z, id) {
    looseItems.push({ x, z, id, entity: placeDroppedItem(app, x, z) });
  }

  // Loot lands in the pockets; overflow hits the floor, where the Alt overlay
  // (and a click) can pick it back up.
  //
  // Money is the exception and it is deliberately the ONLY one: an item with a
  // `cash` field is banked here and never reaches the bag (ECONOMY_PLAN #3).
  // Cash is an item right up until the moment it is received, which is what
  // lets it ride the loot tables, corpse drops, the Alt overlay and loose floor
  // items with no second roll shape anywhere.
  function receiveItems(ids, from) {
    const sheet = getSheet();
    const taken = [];
    let overflowed = false;
    let banked = 0;
    for (const id of ids) {
      const money = ITEMS[id]?.cash;
      if (money) {
        banked += money;
        addCash?.(money);
        taken.push(`${itemName(id)} (${money}💵)`);
        continue;
      }
      if (sheet.inventory.length < INV_CAP) {
        sheet.inventory.push(id);
        taken.push(itemName(id));
      } else {
        dropLoose(getActor().x, getActor().z, id);
        overflowed = true;
      }
    }
    let msg = `${from}: ${taken.length ? taken.join(', ') : 'nothing'}.`;
    if (overflowed) msg += ' Pockets full - the rest hits the floor.';
    if (banked) msg += ` Banked ${banked}💵.`;
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

  // Gather a contiguous paper patch into throw ammo, once. Each still-loose
  // tile yields one sheet (up to the pocket cap); the tiles are marked spent so
  // the drift can't be farmed, but the sheets themselves stay on the floor and
  // keep cutting anyone who walks them.
  function harvestPaperPatch(patch) {
    const sheet = getSheet();
    if (!sheet || isInCombat() || isGameOver()) return;
    let sheets = 0;
    for (const [x, z] of patch) {
      if (!paperHarvestable(x, z)) continue;
      harvestedPaper.add(x + ',' + z);
      sheets += 1;
    }
    if (!sheets) return;
    const before = sheet.paper;
    sheet.paper = Math.min(PAPER_CAP, sheet.paper + sheets);
    const pocketed = sheet.paper - before;
    ui.say(`You gather the loose sheets. (+${pocketed} 📄)`);
    ui.updateStatsHud(sheet);
    if (lootLabels.visible) showLabels(); // that patch is spent now
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
      sheet.paper = Math.min(PAPER_CAP, sheet.paper + def.ammo);
    } else { ui.say(def.examine || 'It is what it is.'); return; } // flavor: not consumed
    sheet.inventory.splice(i, 1);
    ui.say(def.useLog || `You use the ${itemName(id)}.`);
    ui.updateStatsHud(sheet);
    invPanel.refresh(sheet);
  }

  // Equip the item at pocket index `i` into its slot; the incumbent (if any)
  // swaps back to the bag. Out of combat only - swapping gear mid-fight would
  // change your derived numbers under the initiative order (EQUIPMENT decision
  // #6). The stat fold is stats.js's job; here we gate, narrate, and refresh.
  function equip(i) {
    const sheet = getSheet();
    if (!sheet || i >= sheet.inventory.length) return;
    if (isInCombat()) { ui.say('Not mid-fight - swap your kit on your own time.'); return; }
    const id = sheet.inventory[i];
    if (equipItem(sheet, i)) {
      ui.say(`You equip the ${itemName(id)}.`);
      invPanel.refresh(sheet);
      onGearChange?.(); // derived stats + the basic weapon swing changed
    } else {
      ui.say('That is not something you can equip.');
    }
  }

  // Unequip a slot back to the pockets - refused politely when the bag is full
  // (INV_CAP), so gear never vanishes.
  function unequip(slot) {
    const sheet = getSheet();
    if (!sheet) return;
    if (isInCombat()) { ui.say('Not mid-fight - swap your kit on your own time.'); return; }
    const id = sheet.equipped?.[slot];
    if (!id) return;
    if (unequipItem(sheet, slot, INV_CAP)) {
      ui.say(`You stow the ${itemName(id)}.`);
      invPanel.refresh(sheet);
      onGearChange?.(); // derived stats + the basic weapon swing changed
    } else {
      ui.say('Pockets are full - nowhere to stow it.');
    }
  }

  function dropItem(i) {
    const sheet = getSheet();
    if (!sheet || i >= sheet.inventory.length) return;
    // Same combat gate as useItem - no rearranging pockets mid-brawl (a
    // dropped stapler would silently change your damage bonus).
    if (isInCombat()) { ui.say('Not while everyone is watching.'); return; }
    const [id] = sheet.inventory.splice(i, 1);
    dropLoose(getActor().x, getActor().z, id);
    ui.say(`You leave the ${itemName(id)} on the floor. Someone's problem now.`);
    invPanel.refresh(sheet);
    if (lootLabels.visible) showLabels(); // the floor just changed
  }

  // Everything lootable in the area, as clickable Alt-overlay entries.
  // Clicking a label walks you into reach and loots - same path as clicking
  // the object itself.
  function lootEntries() {
    const out = [];
    const me = getActor();
    const near = (x, z) => Math.max(Math.abs(x - me.x), Math.abs(z - me.z)) <= 10;
    // One label per TILE, not per item: picking up takes the whole tile anyway
    // (pickUpAt), and a stack of dropped items used to render a stack of chips
    // at the identical screen position, each hiding the one behind it. The
    // label lists what is actually down there.
    const byTile = new Map();
    for (const li of looseItems) {
      if (!near(li.x, li.z)) continue;
      const key = li.x + ',' + li.z;
      if (!byTile.has(key)) byTile.set(key, []);
      byTile.get(key).push(li);
    }
    for (const pile of byTile.values()) {
      const [first, ...rest] = pile;
      out.push({
        icon: ITEMS[first.id]?.icon,
        text: itemName(first.id),
        also: rest.map((li) => `${ITEMS[li.id]?.icon || '📦'} ${itemName(li.id)}`),
        // Floated above the item rather than through it - the chip is a tag on
        // the loot, not a lid over it.
        world: { x: first.x, y: 0.9, z: first.z },
        onClick: () => approachAndDo(first.x, first.z, () => pickUpAt(first.x, first.z)),
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
          // Keyed by loot table, so a new table needs an entry here or its
          // Alt label renders with no icon at all.
          icon: { trash: '🗑️', printer: '🖨️', desk: '🗄️', 'filing-cabinet': '📁' }[def.loot],
          text: def.label,
          world: { x, y: def.height + 0.8, z },
          onClick: () => approachAndDo(cx, cz, () => lootContainer(cx, cz)),
        });
      }
    }
    // Merchant props (ECONOMY_PLAN M2) label alongside the containers - a
    // machine you can't see from the corridor is a machine you never find. A
    // sold-out one still labels, saying so, rather than silently vanishing and
    // leaving you to walk over and discover it.
    if (openShop) {
      for (let z = 0; z < grid.height; z++) {
        for (let x = 0; x < grid.width; x++) {
          const def = grid.defAt(x, z);
          if (!def.shop || !near(x, z)) continue;
          const empty = shopSoldOut?.(x + ',' + z);
          const cx = x;
          const cz = z;
          out.push({
            icon: '🥤',
            text: empty ? `${def.label} (sold out)` : def.label,
            world: { x, y: def.height + 0.8, z },
            onClick: () => approachAndDo(cx, cz, () => openShop(cx, cz)),
          });
        }
      }
    }
    for (const en of enemies) {
      if (en.alive || !en.loot?.length || !en.entity || !near(en.x, en.z)) continue;
      out.push({
        icon: '💀',
        text: `${en.def.name} (body)`,
        world: { x: en.x, y: 0.9, z: en.z },
        onClick: () => approachAndDo(en.x, en.z, () => lootBody(en)),
      });
    }
    // Harvestable paper: one label per contiguous drift near the player
    // (4-connected flood fill, bounded to the near window). Clicking walks to
    // the patch's nearest tile and gathers the whole drift's ammo at once.
    const visited = new Set();
    for (let z = 0; z < grid.height; z++) {
      for (let x = 0; x < grid.width; x++) {
        if (visited.has(x + ',' + z) || !near(x, z) || !paperHarvestable(x, z)) continue;
        const patch = [];
        let sx = 0;
        let sz = 0;
        const stack = [[x, z]];
        visited.add(x + ',' + z);
        while (stack.length) {
          const [cx, cz] = stack.pop();
          patch.push([cx, cz]);
          sx += cx;
          sz += cz;
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = cx + dx;
            const nz = cz + dz;
            if (!visited.has(nx + ',' + nz) && near(nx, nz) && paperHarvestable(nx, nz)) {
              visited.add(nx + ',' + nz);
              stack.push([nx, nz]);
            }
          }
        }
        const n = patch.length;
        // Approach the patch tile nearest the player; label sits at its centre.
        let target = patch[0];
        let bestD = Infinity;
        for (const [px, pz] of patch) {
          const d = Math.max(Math.abs(px - me.x), Math.abs(pz - me.z));
          if (d < bestD) { bestD = d; target = [px, pz]; }
        }
        out.push({
          icon: '📄',
          text: n > 1 ? `Loose paper ×${n}` : 'Loose paper',
          world: { x: sx / n, y: 0.85, z: sz / n },
          onClick: () => approachAndDo(target[0], target[1], () => harvestPaperPatch(patch)),
        });
      }
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
    forgetPaper,
    // Read-only views for the window.__game debug/test surface.
    debug: {
      looseItems: () => looseItems.map((li) => ({ x: li.x, z: li.z, id: li.id })),
      containerLootAt: (x, z) => (containerLoot.has(x + ',' + z) ? [...containerLoot.get(x + ',' + z)] : null),
      harvestedPaper: () => [...harvestedPaper],
    },
  };
}
