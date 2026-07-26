// The merchant runtime (ECONOMY_PLAN.md): per-instance stock, the shop panel,
// and the buy/sell verbs. Shaped like looting.js on purpose - the host supplies
// live accessors (the sheet and the party are both reassigned on class pick and
// leader switches), this module gates, narrates and refreshes, and every rule
// about what money DOES lives in the pure shop.js beside it.
//
// A machine and a person are the same merchant here. They arrive as different
// instance KEYS - a tile's "x,z" or an actor's id - and that is the only thing
// this module knows about the difference.
import { ITEMS } from './data/items.js';
import { SHOPS } from './data/shops.js';
import { buy, sell, priceOf, sellYield, rollStock, inStock } from './shop.js';
import * as ui from './ui.js';

export function createShopping({ getSheet, getParty, isInCombat, isGameOver, onBought = null, onSold = null }) {
  // instance key -> rolled stock rows. Rolled ONCE on first visit and kept for
  // the life of the floor, the same contract container loot has: a machine
  // remembers what it had, and can be emptied.
  const stocks = new Map();
  let openKey = null;
  let openShop = null;

  const itemName = (id) => ITEMS[id]?.name || id;

  const panel = ui.createShopPanel({
    onBuy: (i) => buyRow(i),
    onSell: (i) => sellRow(i),
    onClose: () => close(),
  });

  function stockFor(key, shopDef) {
    if (!stocks.has(key)) stocks.set(key, rollStock(shopDef));
    return stocks.get(key);
  }

  // Resolve the live state into the flat view the panel renders. Recomputed on
  // every transaction, so prices, affordability and sold-out rows can never
  // drift from the purse.
  function view() {
    const party = getParty();
    const sheet = getSheet();
    const cash = party?.cash || 0;
    const rows = inStock(stocks.get(openKey));
    return {
      name: openShop.name,
      greeting: openShop.greeting,
      cash,
      buys: !!openShop.buys,
      stock: rows.map((r) => {
        const price = priceOf(openShop, r.item);
        return {
          item: r.item,
          name: itemName(r.item),
          icon: ITEMS[r.item]?.icon,
          qty: r.qty,
          price,
          affordable: cash >= price,
        };
      }),
      // Only what they'd actually take, but carrying the REAL pocket index -
      // the sell verb has to address the bag, not this filtered view, or
      // selling one thing would sell another.
      sellable: (sheet?.inventory || [])
        .map((id, index) => ({ id, index, paid: sellYield(openShop, id) }))
        .filter((s) => s.paid > 0)
        .map((s) => ({ ...s, name: itemName(s.id), icon: ITEMS[s.id]?.icon })),
    };
  }

  const render = () => panel.show(view());

  // Open a merchant. `key` identifies the INSTANCE (a machine at a tile, a
  // person by id); `shopId` names the SHOPS entry. Gated exactly like every
  // other pockets verb - no shopping mid-fight.
  function open(key, shopId) {
    const shopDef = SHOPS[shopId];
    if (!shopDef || isInCombat() || isGameOver() || !getSheet()) return false;
    stockFor(key, shopDef);
    openKey = key;
    openShop = shopDef;
    render();
    return true;
  }

  function close() {
    openKey = null;
    openShop = null;
    panel.hide();
  }

  function buyRow(i) {
    if (!openShop) return;
    // The panel renders only the in-stock rows, so its index is an index into
    // THAT list - map it back to the row in the real stock before spending
    // anything.
    const rows = inStock(stocks.get(openKey));
    const row = rows[i];
    if (!row) return;
    const res = buy(openShop, [row], 0, getParty(), getSheet().inventory);
    if (!res.ok) {
      ui.say(res.reason === 'too-expensive'
        ? `Not enough Petty Cash. That is ${res.price}💵.`
        : 'That slot is empty.');
      return;
    }
    ui.say(`You buy the ${itemName(res.item)}. (-${res.price}💵)`);
    onBought?.();
    render();
  }

  function sellRow(index) {
    if (!openShop) return;
    const sheet = getSheet();
    const id = sheet?.inventory?.[index];
    const res = sell(openShop, sheet.inventory, index, getParty());
    if (!res.ok) {
      ui.say(res.reason === 'not-buying'
        ? 'It is a machine. It does not want your things.'
        : `Nobody is going to pay for a ${itemName(id)}.`);
      return;
    }
    ui.say(`You hand over the ${itemName(res.item)}. (+${res.paid}💵)`);
    onSold?.();
    render();
  }

  return {
    open,
    close,
    get visible() { return panel.visible; },
    // Empty an instance outright - "what does a cleaned-out machine look
    // like?" without buying it dry a row at a time. The end state is exactly
    // what nine purchases reach, so god mode and the e2e suite can both get
    // there in one step. Works on a machine nobody has visited yet (the stock
    // is simply never rolled).
    emptyStock(key) {
      if (stocks.has(key)) for (const r of stocks.get(key)) r.qty = 0;
      else stocks.set(key, []);
      if (openKey === key) render();
    },
    // A shop whose rows are all spent - the Alt overlay and the focus banner
    // both want to say so rather than promising a walk to an empty machine.
    soldOut: (key) => stocks.has(key) && inStock(stocks.get(key)).length === 0,
    // Read-only views for the window.__game debug/test surface.
    debug: {
      stockAt: (key) => (stocks.has(key) ? inStock(stocks.get(key)).map((r) => ({ ...r })) : null),
    },
  };
}
