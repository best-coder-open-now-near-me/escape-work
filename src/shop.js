// The transaction rules (ECONOMY_PLAN.md). Pure logic - no PlayCanvas, no DOM,
// unit tested like stats.js. Everything a merchant can do to your money lives
// here; shopping.js only gates, narrates and refreshes.
//
// The money model in one paragraph: an item states what it is WORTH
// (`ITEMS[id].value`), and a merchant states how greedy it is (`markup` when
// selling to you, `sellRate` when buying from you). One number per item drives
// both directions, so a vending machine and a person can disagree about a
// candy bar without the candy bar knowing.
import { ITEMS } from './data/items.js';

// The default markdown when a merchant buys from you. The universal answer to
// "why not just buy it all back": a round trip costs you more than half.
export const SELL_RATE = 0.4;

// What an item is worth before any merchant touches it. Cash pickups are
// banked immediately rather than sold from inventory, so they carry no value.
export const valueOf = (itemId) => ITEMS[itemId]?.value || 0;

// What the merchant charges YOU. Rounded up (the house never eats the
// fraction) and floored at 1, so nothing is ever free by rounding.
export function priceOf(shop, itemId) {
  const value = valueOf(itemId);
  if (!value) return 0; // unsaleable; the stock lint keeps these out of shops
  return Math.max(1, Math.ceil(value * (shop?.markup ?? 1)));
}

// What the merchant pays you. 0 - meaning "I won't take it" - for a merchant
// that doesn't buy at all, and for anything with no value. Rounded down, and
// floored at 1 for anything it WILL take, so a sale is never an insult.
export function sellYield(shop, itemId) {
  if (!shop?.buys) return 0;
  const value = valueOf(itemId);
  if (!value) return 0;
  return Math.max(1, Math.floor(value * (shop.sellRate ?? SELL_RATE)));
}

// Roll a shop definition into one instance's stock: each row is stocked or not
// (its `chance`), and a stocked row carries its `qty`. Rolled ONCE per
// instance, the same contract container loot has - a machine remembers what it
// had, and can run out.
export function rollStock(shop, rng = Math.random) {
  const out = [];
  for (const row of shop?.stock || []) {
    if (rng() >= (row.chance ?? 1)) continue;
    out.push({ item: row.item, qty: row.qty ?? 1 });
  }
  return out;
}

export const canAfford = (cash, price) => (cash || 0) >= price;

// Buy stock row `index` into `bag`, paid from `purse.cash`.
//
// ATOMIC: cash, stock and bag move together or not at all. Every refusal
// returns before the first mutation, so there is no partial state to unwind -
// the invariant the unit suite pins hardest, because a half-applied purchase
// is the one bug in an economy that players notice instantly and can farm.
export function buy(shop, stock, index, purse, bag) {
  const row = stock?.[index];
  if (!row || row.qty <= 0) return { ok: false, reason: 'out-of-stock' };
  const price = priceOf(shop, row.item);
  if (!price) return { ok: false, reason: 'unsaleable' };
  if (!canAfford(purse?.cash, price)) return { ok: false, reason: 'too-expensive', price };
  purse.cash -= price;
  row.qty -= 1;
  bag.push(row.item);
  return { ok: true, item: row.item, price };
}

// Sell the item at `bag[index]` to the merchant, crediting `purse.cash`.
// Same atomicity rule: every refusal precedes every mutation.
export function sell(shop, bag, index, purse) {
  const id = bag?.[index];
  if (id === undefined) return { ok: false, reason: 'no-such-item' };
  if (!shop?.buys) return { ok: false, reason: 'not-buying' };
  const paid = sellYield(shop, id);
  if (!paid) return { ok: false, reason: 'worthless' };
  bag.splice(index, 1);
  purse.cash = (purse.cash || 0) + paid;
  return { ok: true, item: id, paid };
}

// Drop sold-out rows. The panel renders what is left; a machine whose rows are
// all gone reads as "SOLD OUT" rather than a list of zeroes.
export const inStock = (stock) => (stock || []).filter((r) => r.qty > 0);
