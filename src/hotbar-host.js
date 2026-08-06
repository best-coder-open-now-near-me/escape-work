// The HOTBAR HOST: the DOM side of the one bar the whole game uses, and the
// four variables only it touches.
//
// `hotbar-model.js` has owned the RULES for a while - what belongs on the bar,
// how a layout pads, what a slot looks like. What stayed behind in
// `startGame`'s 4,200-line closure (Q039) was the binding: which sheet's bar is
// on screen, when to rebuild it, and the pager. That binding kept `hotbar`,
// `hotbarRow`, `hotbarBagKey` and `hotbarPaper` in a scope shared with 87 other
// functions, and all four are written by exactly one of them.
//
// Everything else arrives on `d`. The mutable bindings are getters because the
// bar is rebuilt across leader switches and turn handoffs; main.js supplies
// its one steering-aware sheet accessor rather than this host re-deriving it.
import {
  actionIdsFor, itemCountsFor, layoutFor, assignInto,
  slotViewModel, combatSlotViewModel,
} from './hotbar-model.js';
import { ACTIONS } from './data/actions.js';
import { ITEMS } from './data/items.js';

export function createHotbarHost(d) {
  // Written by `buildHotbar` and nothing else - which is what made this a
  // subsystem rather than four more variables in a shared scope.
  let hotbar = null;
  let hotbarRow = 0; // which row is showing - survives a bar rebuild
  let hotbarBagKey = '';
  let hotbarPaper = 0;

  const barSheet = () => d.steeredSheet();
  // The bar's rules live in hotbar-model.js; these bind them to whoever's bar
  // is on screen. The DOM, the arming and the pager stay here.
  const hotbarActionIds = () => actionIdsFor(barSheet());
  const hotbarItemIds = () => itemCountsFor(barSheet());
  const layoutOf = (s) => layoutFor(s, d.ui.HOTBAR_ROW_SLOTS);
  // In a fight the numbers are combat's - the acting member's AP, uses and
  // paper. Out of one they are this file's. Same slot, same fields, two
  // rule-owners, which is the point of the bar being one widget instead of two
  // that drift.
  const slotVm = (entry) => ((d.inCombat && d.combat && entry?.kind === 'action')
    ? combatSlotViewModel(entry, d.combat.actionState(entry.id), barSheet().name)
    : slotViewModel(entry, barSheet()));

  // What the bar's item slots are counting, as one string - the gate that keeps
  // a per-frame DOM repaint off the hot path (like hotbarPaper for ammo).
  const bagKey = () => (barSheet()?.inventory || []).join(',');
  // Re-read the slots against live pocket contents: an assigned item can run
  // out, refill, or change count, and the count is in the label. The slot
  // view-models carry it, so this is a rebuild - cheap, and it is the same path
  // a gear change or a level-up already takes.
  const refreshHotbarSlots = () => { if (hotbar && d.sheet) buildHotbar(); };
  // The slots the bar shows, in the order it shows them. In a fight the reorg
  // status (`confused`) can shuffle that order - the same disorientation it
  // always applied, now landing on the player's own arrangement instead of on
  // a separate list combat kept for itself.
  const barLayout = () => {
    const entries = layoutOf(barSheet());
    return d.inCombat && d.combat ? d.combat.scrambleEntries(entries) : entries;
  };
  // The slot a visible position REALLY is. While the reorg is on, the bar
  // draws and presses a shuffled order but the layout being rearranged is the
  // player's own - so right-clicking slot 3 used to open the assign menu for
  // whatever sat at true index 3, which under a scramble is a different slot
  // from the one under the cursor. Press and assign now agree on what "this
  // slot" means: press already read the drawn order, and assign maps through
  // the same permutation before it writes.
  const trueSlot = (i) => {
    if (!d.inCombat || !d.combat) return i;
    const order = d.combat.scrambleOrder(layoutOf(barSheet()).length);
    return order ? order[i] ?? i : i;
  };
  function buildHotbar() {
    hotbarRow = hotbar?.row ?? hotbarRow;
    hotbar?.destroy(); // a leader switch rebuilds it for the new sheet
    hotbar = d.ui.createHotbar(barLayout().map(slotVm), {
      onPress: pressHotbarSlot,
      onAssign: openAssignMenu,
      startRow: hotbarRow, // the row you were on survives the rebuild
    });
    // A rebuild starts with no slot lit, but `armedOoc` survives it - spending
    // a level-up point mid-aim left the bar looking unarmed while the rings,
    // the crosshair and the next click all still acted on the armed action.
    // The bar shows what is actually armed, or nothing is.
    hotbar.setArmed(d.inCombat && d.combat ? d.combat.armed : d.armedOoc);
    hotbarPaper = barSheet().paper;
    hotbarBagKey = bagKey();
  }
  // Pressing a slot: arm the power, or use the item. An empty slot says what it
  // is for rather than nothing at all - a dead button teaches nothing.
  //
  // In a fight the press goes to combat, which owns arming, AP and the confirm
  // step. That routing is the only thing that differs - the slot, its icon, its
  // number key and its position are the player's either way.
  function pressHotbarSlot(i) {
    const entry = barLayout()[i];
    if (!entry) { d.ui.say('That slot is empty - right-click it to assign a power or an item.'); return; }
    if (entry.kind === 'item') { d.loot.useItemById(entry.id); return; }
    if (d.inCombat && d.combat) { d.combat.pressAction(entry.id); return; }
    d.toggleOocArm(entry.id);
  }
  // Right-click a slot: everything that can go in it, in the bar's own order,
  // with what is already placed marked as such. Assigning something already on
  // the bar SWAPS the two slots - that is how the bar gets rearranged, and it
  // means the same power can never end up in two places.
  // Rearranging works in a fight too. The layout is the same layout either way,
  // and "you may not touch your own bar while it matters" was an artefact of
  // combat owning a different widget, not a rule anybody chose.
  function openAssignMenu(i, x, y) {
    if (!d.sheet || d.gameOver || d.modalOpen()) return;
    // `i` is a position on the BAR; `slot` is the layout entry it stands for.
    // Everything the menu shows is read off the drawn order (so a hint sends
    // the player to the slot they can actually see), and only the write goes
    // through `trueSlot`.
    const layout = barLayout();
    const slot = trueSlot(i);
    const here = layout[i];
    const placedAt = (kind, id) => layout.findIndex((s) => s && s.kind === kind && s.id === id);
    const rowOf = (at) => Math.floor(at / d.ui.HOTBAR_ROW_SLOTS) + 1;
    const slotHint = (kind, id) => {
      const at = placedAt(kind, id);
      if (at < 0) return null;
      return at === i ? 'in this slot' : `on ${rowOf(at)}·${(at % d.ui.HOTBAR_ROW_SLOTS) + 1}`;
    };
    const items = [{ label: `Slot ${rowOf(i)}·${(i % d.ui.HOTBAR_ROW_SLOTS) + 1}`, header: true }];
    if (here) items.push({ label: 'Clear this slot', action: () => assignHotbarSlot(slot, null) });
    items.push({ label: 'Powers', header: true });
    for (const id of hotbarActionIds()) {
      items.push({
        // Iconed like the slot it would fill, so the menu and the bar name the
        // same thing the same way.
        label: `${ACTIONS[id].icon || '❔'}  ${ACTIONS[id].label}`,
        hint: slotHint('action', id),
        action: () => assignHotbarSlot(slot, { kind: 'action', id }),
      });
    }
    const carried = hotbarItemIds();
    items.push({ label: 'From your pockets', header: true });
    if (!carried.size) items.push({ label: 'Nothing usable in there' });
    for (const [id, n] of carried) {
      items.push({
        label: `${ITEMS[id].icon || '❔'}  ${ITEMS[id].name}`,
        hint: slotHint('item', id) || (n > 1 ? `×${n}` : null),
        action: () => assignHotbarSlot(slot, { kind: 'item', id }),
      });
    }
    d.ui.showMenu(x, y, items);
  }
  function assignHotbarSlot(i, entry) {
    if (!d.sheet) return;
    barSheet().hotbar = assignInto(layoutOf(barSheet()), i, entry);
    buildHotbar();
    d.ui.say(entry
      ? `${entry.kind === 'item' ? ITEMS[entry.id].name : ACTIONS[entry.id].label} moves to slot ${Math.floor(i / d.ui.HOTBAR_ROW_SLOTS) + 1}·${(i % d.ui.HOTBAR_ROW_SLOTS) + 1}.`
      : 'You clear the slot.');
  }

  // The per-frame sync, which was six lines in the update loop reading four of
  // this module's variables. `show` is the caller's - whether the bar can act
  // at all is a game question, not a bar question - and everything downstream
  // of it is ours: visibility, the ammo count, and the pocket contents. Both
  // comparisons are gates that keep DOM writes off the hot path.
  function syncFrame(show) {
    if (!hotbar) return;
    hotbar.setVisible(show);
    const bs = barSheet();
    if (show && bs && bs.paper !== hotbarPaper) buildHotbar();
    // Item slots count the pockets, and the pockets change from places that do
    // not route through onBagChange (god mode, a shop, an overflow drop).
    if (show && bagKey() !== hotbarBagKey) refreshHotbarSlots();
  }

  return { buildHotbar, refreshHotbarSlots, barLayout, barSheet, layoutOf, syncFrame,
    // The number keys press a slot from main.js's key handler.
    pressSlot: pressHotbarSlot,
    get hotbar() { return hotbar; } };
}
