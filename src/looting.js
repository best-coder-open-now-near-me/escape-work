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
import { PAPER_CAP, equipItem, unequipItem, inventoryCapOf } from './stats.js';
import { placeDroppedItem } from './tile-renderer.js';
import * as ui from './ui.js';
import { CARDINAL_DIRS } from './directions.js';

// The carry limit is effective Grit [ratified] (designer, 2026-08-05), so it is
// asked of the sheet at every guard site rather than read from a constant here -
// and the sheet in question is whoever is leading right now, which changes.
//
// A bag already over its changed cap remains intact. These are admission gates:
// they refuse the next pickup or stow until the player drains the excess.

// Atomically move one item between party sheets. Capacity is an admission rule:
// a recipient at or above their live Grit-derived cap refuses the hand-off, and
// the sender keeps what they were holding. Kept pure so the inventory panel is
// presentation over the same rule the tests can exercise directly.
export function handoffItem(sender, recipient, id) {
  const at = sender?.inventory?.indexOf(id) ?? -1;
  if (at < 0 || !recipient?.inventory) return 'missing';
  if (recipient.inventory.length >= inventoryCapOf(recipient)) return 'full';
  sender.inventory.splice(at, 1);
  recipient.inventory.push(id);
  return 'sent';
}

// Contiguous paper drifts, 4-connected, as { tiles, cx, cz } - the tiles the
// patch covers and its centre, which is where its Alt label floats.
//
// Pure, and at module scope on purpose: the rest of this file is a closure that
// builds DOM panels the moment it is constructed, so nothing inside it can be
// reached from node. The flood fill is the one part of the overlay that is an
// algorithm rather than a wiring diagram, and it is the part most able to be
// quietly wrong - a patch that stops at the window edge, a tile counted twice,
// a centre that drifts off the drift. The caller supplies the leaf facts: how
// big the grid is, which tiles are in the near window, and which of those still
// hold gatherable paper.
//
// `inWindow` gates the fill as well as the seed, so a drift running out of the
// window is labelled as the part you can actually see - the same bound the
// label's own reach check uses.
// One paper patch as the overlay shows it: where the chip floats, and where a
// click on it actually walks.
//
// These are deliberately two DIFFERENT points, which is the part worth pinning.
// The chip floats at the patch's centre so it reads as one label for the whole
// drift rather than sitting on an arbitrary corner of it - but a centre is an
// average, and the average of a horseshoe or an L is a tile nobody can stand on
// (or one that is not even paper). So the walk goes to the patch tile NEAREST
// the walker, by the same Chebyshev step the rest of movement uses.
//
// Lifted to module scope for the same reason `paperPatches` was: the rest of
// looting.js builds DOM the moment it is constructed and cannot be reached from
// node, and the arm that picks a walk target is worth more than a comment.
export function paperLabel({ tiles, cx, cz }, me) {
  let target = tiles[0];
  let bestD = Infinity;
  for (const [px, pz] of tiles) {
    const d = Math.max(Math.abs(px - me.x), Math.abs(pz - me.z));
    if (d < bestD) { bestD = d; target = [px, pz]; }
  }
  const n = tiles.length;
  return {
    text: n > 1 ? `Loose paper ×${n}` : 'Loose paper',
    world: { x: cx, y: 0.85, z: cz },
    target,
  };
}

export function paperPatches({ width, height }, inWindow, harvestable) {
  const patches = [];
  const visited = new Set();
  const key = (x, z) => x + ',' + z;
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      if (visited.has(key(x, z)) || !inWindow(x, z) || !harvestable(x, z)) continue;
      const tiles = [];
      let sx = 0;
      let sz = 0;
      const stack = [[x, z]];
      visited.add(key(x, z));
      while (stack.length) {
        const [cx, cz] = stack.pop();
        tiles.push([cx, cz]);
        sx += cx;
        sz += cz;
        for (const [dx, dz] of CARDINAL_DIRS) {
          const nx = cx + dx;
          const nz = cz + dz;
          if (!visited.has(key(nx, nz)) && inWindow(nx, nz) && harvestable(nx, nz)) {
            visited.add(key(nx, nz));
            stack.push([nx, nz]);
          }
        }
      }
      patches.push({ tiles, cx: sx / tiles.length, cz: sz / tiles.length });
    }
  }
  return patches;
}

// `extraEntries` (optional) lets the host add non-loot entries to the Alt
// overlay (doors) without this module knowing what they are.
// `onBagChange` fires after any mutation of the pockets (use, drop, equip,
// hand-over, pick-up). Anything ELSE on screen that addresses the bag by index
// - the shop's sell column is the one today - has to hear about it, or it goes
// on offering a button bound to a pocket that has since moved.
export function createLooting({ app, grid, runtime, enemies, getActor, getSheet, isInCombat, isGameOver, approachAndDo, extraEntries = null, onGearChange = null, onBagChange = null, recipients = null, addCash = null, getCash = null, openShop = null, shopSoldOut = null, spendCombatAp = null }) {
  const containerLoot = new Map(); // "x,z" -> remaining item ids (rolled on first rummage)
  const looseItems = []; // { x, z, id, entity } - dropped/overflowed floor items
  const harvestedPaper = new Set(); // "x,z" of paper drifts already gathered for ammo

  const itemName = (id) => ITEMS[id]?.name || id;

  // Every looting event goes to BOTH readouts, on purpose. The toast is the
  // glance - top-left, one nowrap line, gone in under three seconds - which is
  // right for "you got X" and wrong for everything else about it: a five-item
  // desk ellipsised away mid-list, the banked cash fell off the end, and there
  // was nowhere to read what you missed. ui.say() files the same line in the
  // narrator box, which wraps, keeps the last several lines, and stays up in
  // combat, so the loot you took is readable back alongside the drops, equips
  // and paper-gathers that already narrate there.
  //
  // Same text in both places rather than two phrasings of one event - a loot
  // line that reads one way in the corner and another way in the box is two
  // events as far as the player can tell.
  function lootNews(msg) {
    ui.toast(msg);
    ui.say(msg);
  }
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

  const invPanel = ui.createInventoryPanel(ITEMS, inventoryCapOf, {
    onUse: (i) => useItem(i),
    onDrop: (i) => dropItem(i),
    onExamine: (i) => ui.say(ITEMS[getSheet().inventory[i]]?.examine || 'It is what it is.'),
    onEquip: (i) => equip(i),
    onUnequip: (slot) => unequip(slot),
    onSend: (i, btn) => sendItem(i, btn),
    canSend: () => (recipients?.() || []).length > 0,
    getCash,
  });

  // Hand an item to another party member. The recipient's live capacity is an
  // admission gate just like pickup and stow: refusal leaves the sender's bag
  // unchanged. The button still hides when there is nobody to hand it to.
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
        const result = handoffItem(sheet, m.sheet, id);
        if (result === 'missing') return; // it moved while the menu was open
        if (result === 'full') {
          ui.say(`${m.name}'s pockets are full - they cannot take the ${itemName(id)}.`);
          return;
        }
        ui.say(`You hand the ${itemName(id)} to ${m.name}.`);
        invPanel.refresh(sheet);
        onBagChange?.();
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
      if (sheet.inventory.length < inventoryCapOf(sheet)) {
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
    lootNews(msg);
    invPanel.refresh(sheet);
    onBagChange?.();
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
    if (!items.length) { lootNews(`${def.label}: nothing left but disappointment.`); return; }
    containerLoot.set(key, []);
    receiveItems(items, def.label);
  }

  function lootBody(en) {
    if (!en || en.alive || isInCombat() || isGameOver()) return;
    const items = en.loot || [];
    if (!items.length) { lootNews(`${en.def.name} has nothing left to give. Fitting.`); return; }
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

  // What a consumable costs when there is a fight on. Everything else in a turn
  // is billed, so this is too - and 2 AP is the shove's price, the cheapest
  // real verb in the game.
  const COMBAT_USE_AP = 2;

  // Using something from your pockets. This used to refuse outright while
  // `isInCombat()`, which switched off the entire consumable economy in the one
  // place it means anything: all eight items are heals, and healing exists to
  // survive fights. The gate carried no comment, unlike its two neighbours
  // (dropItem and equip) which state their reasons - it read as copied
  // alongside them rather than decided, and it was.
  function useItem(i) {
    const sheet = getSheet();
    if (!sheet || i >= sheet.inventory.length) return;
    const id = sheet.inventory[i];
    const def = ITEMS[id] || {};
    // A revive is not used FROM the pockets: the person who needs it is at 0 HP
    // and cannot act, so it is spent by walking to them and choosing the hand
    // up (main.js helpUp). Say so rather than letting it read as inert flavour -
    // it is the one item whose whole point is easy to miss.
    if (def.revive && !def.heal && !def.ammo) {
      ui.say(`${def.name} is for somebody who is down. Walk to them and offer a hand up.`);
      return;
    }
    // Flavor first: something with no heal and no ammo is not consumed, costs
    // nothing, and can be read at any time.
    if (!def.heal && !def.ammo) { ui.say(def.examine || 'It is what it is.'); return; }
    // Don't burn a consumable that can't help right now - checked BEFORE the
    // AP, so a refused snack is also a free one.
    if (def.heal && sheet.hp >= sheet.maxHp) {
      ui.say('You are already at full health. Ration the snacks.'); return;
    }
    // In a fight it costs a turn's worth of AP, and the refusal that follows is
    // about the AP rather than about the fight existing.
    if (isInCombat()) {
      if (!spendCombatAp) { ui.say('Not while everyone is watching.'); return; }
      if (!spendCombatAp(COMBAT_USE_AP)) {
        ui.say(`Not enough AP - using something costs ${COMBAT_USE_AP}.`); return;
      }
    }
    if (def.heal) sheet.hp = Math.min(sheet.maxHp, sheet.hp + def.heal);
    else sheet.paper = Math.min(PAPER_CAP, sheet.paper + def.ammo);
    sheet.inventory.splice(i, 1);
    ui.say(def.useLog || `You use the ${itemName(id)}.`);
    ui.updateStatsHud(sheet);
    invPanel.refresh(sheet);
    onBagChange?.();
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
      onBagChange?.();
      onGearChange?.(); // derived stats + the basic weapon swing changed
    } else {
      ui.say('That is not something you can equip.');
    }
  }

  // Unequip a slot back to the pockets - refused politely when the bag is full,
  // so gear never vanishes.
  function unequip(slot) {
    const sheet = getSheet();
    if (!sheet) return;
    if (isInCombat()) { ui.say('Not mid-fight - swap your kit on your own time.'); return; }
    const id = sheet.equipped?.[slot];
    if (!id) return;
    if (unequipItem(sheet, slot, inventoryCapOf(sheet))) {
      ui.say(`You stow the ${itemName(id)}.`);
      invPanel.refresh(sheet);
      onBagChange?.();
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
    onBagChange?.();
    if (lootLabels.visible) showLabels(); // the floor just changed
  }

  // Everything lootable in the area, as clickable Alt-overlay entries.
  // Clicking a label walks you into reach and loots - same path as clicking
  // the object itself.
  //
  // Five scans, one per kind of lootable thing, and the ORDER they concatenate
  // in is the order the labels were built in before they were named - loose
  // piles, containers, machines, bodies, paper, then whatever the host adds.
  // Kept, because the overlay renders in list order and nothing has said which
  // way it should be.

  // One label per TILE, not per item: picking up takes the whole tile anyway
  // (pickUpAt), and a stack of dropped items used to render a stack of chips at
  // the identical screen position, each hiding the one behind it. The label
  // lists what is actually down there.
  function looseEntries(near) {
    const byTile = new Map();
    for (const li of looseItems) {
      if (!near(li.x, li.z)) continue;
      const key = li.x + ',' + li.z;
      if (!byTile.has(key)) byTile.set(key, []);
      byTile.get(key).push(li);
    }
    return [...byTile.values()].map(([first, ...rest]) => ({
      icon: ITEMS[first.id]?.icon,
      text: itemName(first.id),
      also: rest.map((li) => `${ITEMS[li.id]?.icon || '📦'} ${itemName(li.id)}`),
      // Floated above the item rather than through it - the chip is a tag on
      // the loot, not a lid over it.
      world: { x: first.x, y: 0.9, z: first.z },
      onClick: () => approachAndDo(first.x, first.z, () => pickUpAt(first.x, first.z)),
    }));
  }

  // Containers and merchant machines share ONE grid sweep - they ask the same
  // tile the same question - but stay two lists, because containers labelled
  // ahead of machines before this was split and the overlay renders in order.
  //
  // Merchant props (ECONOMY_PLAN M2) label alongside the containers: a machine
  // you can't see from the corridor is a machine you never find. A sold-out one
  // still labels, saying so, rather than silently vanishing and leaving you to
  // walk over and discover it.
  function propEntries(near) {
    const containers = [];
    const shops = [];
    for (let z = 0; z < grid.height; z++) {
      for (let x = 0; x < grid.width; x++) {
        if (!near(x, z)) continue;
        const def = grid.defAt(x, z);
        const cx = x;
        const cz = z;
        // `rolled && !rolled.length` is "already cleaned out" - an unrolled
        // container has no entry yet and still labels.
        const rolled = def.loot ? containerLoot.get(x + ',' + z) : null;
        if (def.loot && !(rolled && !rolled.length)) {
          containers.push({
            // Keyed by loot table, so a new table needs an entry here or its
            // Alt label renders with no icon at all.
            icon: { trash: '🗑️', printer: '🖨️', desk: '🗄️', 'filing-cabinet': '📁' }[def.loot],
            text: def.label,
            world: { x, y: def.height + 0.8, z },
            onClick: () => approachAndDo(cx, cz, () => lootContainer(cx, cz)),
          });
        }
        if (def.shop && openShop) {
          const empty = shopSoldOut?.(x + ',' + z);
          shops.push({
            icon: '🥤',
            text: empty ? `${def.label} (sold out)` : def.label,
            world: { x, y: def.height + 0.8, z },
            onClick: () => approachAndDo(cx, cz, () => openShop(cx, cz)),
          });
        }
      }
    }
    return [...containers, ...shops];
  }

  function bodyEntries(near) {
    const out = [];
    for (const en of enemies) {
      if (en.alive || !en.loot?.length || !en.entity || !near(en.x, en.z)) continue;
      out.push({
        icon: '💀',
        text: `${en.def.name} (body)`,
        world: { x: en.x, y: 0.9, z: en.z },
        onClick: () => approachAndDo(en.x, en.z, () => lootBody(en)),
      });
    }
    return out;
  }

  // One label per contiguous drift near the player. The fill itself is the pure
  // `paperPatches` above; what is left here is the label - it floats at the
  // patch's centre, and clicking walks to the patch tile NEAREST the player
  // rather than to that centre, which may be a tile you cannot stand on.
  function paperEntries(near, me) {
    return paperPatches(grid, near, paperHarvestable).map((patch) => {
      const { text, world, target } = paperLabel(patch, me);
      return {
        icon: '📄',
        text,
        world,
        onClick: () => approachAndDo(target[0], target[1], () => harvestPaperPatch(patch.tiles)),
      };
    });
  }

  function lootEntries() {
    const me = getActor();
    const near = (x, z) => Math.max(Math.abs(x - me.x), Math.abs(z - me.z)) <= 10;
    return [
      ...looseEntries(near),
      ...propEntries(near),
      ...bodyEntries(near),
      ...paperEntries(near, me),
      ...(extraEntries ? extraEntries() : []),
    ];
  }
  function showLabels() { lootLabels.show(lootEntries()); }

  return {
    itemName, looseAt, corpseAt,
    lootContainer, lootBody, pickUpAt,
    // Use one of an item BY ID rather than by pocket index - what a hotbar slot
    // holds is "a cold coffee", not "pocket 4", and the pockets shuffle every
    // time anything is picked up or spent. Refuses out loud when the last one is
    // gone, because a slot the player is still pressing has to say something.
    useItemById: (id) => {
      const i = getSheet()?.inventory.indexOf(id) ?? -1;
      if (i < 0) { ui.say(`No ${itemName(id)} left in your pockets.`); return; }
      useItem(i);
    },
    refreshPanel: (sheet) => invPanel.refresh(sheet),
    togglePanel: (sheet) => invPanel.toggle(sheet),
    showLabels,
    hideLabels: () => lootLabels.hide(),
    repositionLabels: (project) => lootLabels.reposition(project),
    get labelsVisible() { return lootLabels.visible; },
    // Spawn a loose floor item at a tile (god mode's "drop on ground").
    dropAt: (x, z, id) => dropLoose(x, z, id),
    forgetPaper,
    // Mark a drift picked-clean WITHOUT anyone gathering it. Powers that lay
    // paper call this as they paint, so a cone or a zone can never become a
    // renewable ammo pile: ammo comes from the world, not from spending AP.
    // The sheets themselves stay - they still burn, cut and fuel.
    markPaperSpent: (x, z) => harvestedPaper.add(x + ',' + z),
    // Read-only views for the window.__game debug/test surface.
    debug: {
      looseItems: () => looseItems.map((li) => ({ x: li.x, z: li.z, id: li.id })),
      containerLootAt: (x, z) => (containerLoot.has(x + ',' + z) ? [...containerLoot.get(x + ',' + z)] : null),
      harvestedPaper: () => [...harvestedPaper],
    },
  };
}
