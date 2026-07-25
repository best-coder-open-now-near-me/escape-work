// The transaction rules (ECONOMY_PLAN.md). shop.js is pure, so the whole money
// model is testable without a browser - prices, the markdown, the once-per-
// instance stock roll, and above all the ATOMICITY of a purchase: cash, stock
// and bag move together or not at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SELL_RATE, valueOf, priceOf, sellYield, rollStock, canAfford, buy, sell, inStock,
} from '../../src/shop.js';
import { ITEMS } from '../../src/data/items.js';
import { SHOPS } from '../../src/data/shops.js';

// A merchant with round numbers, so the assertions are about the RULES rather
// than about whatever the shipped content happens to be priced at today.
const MACHINE = { name: 'Test Machine', markup: 2, buys: false, stock: [{ item: 'candy-bar', qty: 2, chance: 1 }] };
const PERSON = { name: 'Test Person', markup: 1, buys: true, sellRate: 0.5, stock: [] };

test('priceOf marks an item up and rounds in the house\'s favour', () => {
  assert.equal(valueOf('candy-bar'), 4);
  assert.equal(priceOf({ markup: 1 }, 'candy-bar'), 4);
  assert.equal(priceOf(MACHINE, 'candy-bar'), 8);
  // 4 * 1.6 = 6.4 -> 7. The house never eats the fraction.
  assert.equal(priceOf({ markup: 1.6 }, 'candy-bar'), 7);
});

test('a price is never zero, however cheap the item', () => {
  assert.equal(priceOf({ markup: 0.01 }, 'hr-pamphlet'), 1); // value 1 * 0.01 -> floored at 1
});

test('sellYield marks down, and is zero for a merchant that does not buy', () => {
  assert.equal(sellYield(PERSON, 'toner-cartridge'), 6); // 12 * 0.5
  assert.equal(sellYield(MACHINE, 'toner-cartridge'), 0); // buys: false
  assert.equal(sellYield({ buys: true }, 'toner-cartridge'), Math.floor(12 * SELL_RATE));
});

test('a merchant will not take something with no value', () => {
  // Cash items never reach the bag, so they never reach a sell button either -
  // but the rule that guards it is "no value, no sale", and it must hold for
  // anything the registry leaves unpriced.
  assert.equal(ITEMS['crumpled-fiver'].value, undefined);
  assert.equal(sellYield(PERSON, 'crumpled-fiver'), 0);
  assert.equal(sellYield(PERSON, 'no-such-item'), 0);
});

test('a sale a merchant WILL make always pays at least 1', () => {
  // 1 * 0.4 = 0.4, which floors to 0 - that would be a button that takes your
  // pamphlet and gives you nothing.
  assert.equal(sellYield({ buys: true, sellRate: 0.4 }, 'hr-pamphlet'), 1);
});

test('rollStock respects chance and carries qty', () => {
  const shop = {
    stock: [
      { item: 'candy-bar', qty: 3, chance: 1 },
      { item: 'energy-drink', qty: 1, chance: 0 },
      { item: 'stale-danish', qty: 2, chance: 0.5 },
    ],
  };
  const always = rollStock(shop, () => 0); // every roll passes
  assert.deepEqual(always, [{ item: 'candy-bar', qty: 3 }, { item: 'stale-danish', qty: 2 }]);
  const never = rollStock(shop, () => 0.99); // only the chance-1 row survives
  assert.deepEqual(never, [{ item: 'candy-bar', qty: 3 }]);
});

test('buying moves cash, stock and bag together', () => {
  const stock = rollStock(MACHINE, () => 0);
  const purse = { cash: 20 };
  const bag = [];
  const res = buy(MACHINE, stock, 0, purse, bag);
  assert.equal(res.ok, true);
  assert.equal(res.item, 'candy-bar');
  assert.equal(res.price, 8);
  assert.equal(purse.cash, 12);
  assert.equal(stock[0].qty, 1);
  assert.deepEqual(bag, ['candy-bar']);
});

test('an unaffordable purchase changes NOTHING - the atomicity invariant', () => {
  const stock = rollStock(MACHINE, () => 0);
  const purse = { cash: 3 };
  const bag = [];
  const res = buy(MACHINE, stock, 0, purse, bag);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'too-expensive');
  assert.equal(res.price, 8); // it still tells you what it would have cost
  assert.equal(purse.cash, 3); // ...and takes none of it
  assert.equal(stock[0].qty, 2);
  assert.deepEqual(bag, []);
});

test('buying the last one empties the row, and the row refuses from then on', () => {
  const stock = [{ item: 'candy-bar', qty: 1 }];
  const purse = { cash: 100 };
  const bag = [];
  assert.equal(buy(MACHINE, stock, 0, purse, bag).ok, true);
  assert.equal(stock[0].qty, 0);
  assert.deepEqual(inStock(stock), []); // the panel stops rendering it
  const second = buy(MACHINE, stock, 0, purse, bag);
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'out-of-stock');
  assert.equal(purse.cash, 92); // and the refusal cost nothing
  assert.equal(bag.length, 1);
});

test('buying a row that does not exist is a refusal, not a crash', () => {
  const purse = { cash: 100 };
  assert.equal(buy(MACHINE, [], 0, purse, []).ok, false);
  assert.equal(buy(MACHINE, undefined, 3, purse, []).ok, false);
  assert.equal(purse.cash, 100);
});

test('selling moves the item out of the bag and the money in', () => {
  const purse = { cash: 0 };
  const bag = ['toner-cartridge', 'usb-stick'];
  const res = sell(PERSON, bag, 0, purse);
  assert.equal(res.ok, true);
  assert.equal(res.paid, 6);
  assert.equal(purse.cash, 6);
  assert.deepEqual(bag, ['usb-stick']);
});

test('a refused sale changes NOTHING - the same atomicity invariant', () => {
  const purse = { cash: 5 };
  const bag = ['toner-cartridge'];
  const machine = sell(MACHINE, bag, 0, purse); // machines do not buy
  assert.equal(machine.ok, false);
  assert.equal(machine.reason, 'not-buying');
  assert.deepEqual(bag, ['toner-cartridge']);
  assert.equal(purse.cash, 5);

  const worthless = sell(PERSON, ['matches-that-are-not-real'], 0, purse);
  assert.equal(worthless.ok, false);
  assert.equal(purse.cash, 5);

  assert.equal(sell(PERSON, [], 0, purse).reason, 'no-such-item');
  assert.equal(purse.cash, 5);
});

test('a round trip through a merchant always loses money', () => {
  // The universal answer to "why not buy it all back". Asserted over every
  // shipped merchant that buys, and every item they stock, so a future
  // markup/sellRate edit that opened an infinite-money loop would fail here.
  for (const [id, shop] of Object.entries(SHOPS)) {
    if (!shop.buys) continue;
    for (const row of shop.stock) {
      const paid = priceOf(shop, row.item);
      const back = sellYield(shop, row.item);
      assert.ok(back < paid, `${id}: buying "${row.item}" for ${paid} and selling it back for ${back} must lose money`);
    }
  }
});

test('cash stays a non-negative integer through any sequence of trades', () => {
  const shop = { markup: 1, buys: true, sellRate: 0.45, stock: [{ item: 'candy-bar', qty: 9, chance: 1 }] };
  const stock = rollStock(shop, () => 0);
  const purse = { cash: 7 };
  const bag = ['toner-cartridge', 'usb-stick', 'hr-pamphlet'];
  // Alternate buying and selling until both sides run dry; the purse must never
  // go negative or fractional at any point.
  for (let i = 0; i < 30; i++) {
    buy(shop, stock, 0, purse, bag);
    sell(shop, bag, 0, purse);
    assert.ok(Number.isInteger(purse.cash), `cash is an integer after step ${i} (${purse.cash})`);
    assert.ok(purse.cash >= 0, `cash is non-negative after step ${i} (${purse.cash})`);
  }
});

test('canAfford is inclusive - exact change buys the thing', () => {
  assert.equal(canAfford(8, 8), true);
  assert.equal(canAfford(7, 8), false);
  assert.equal(canAfford(undefined, 1), false);
  const purse = { cash: 8 };
  assert.equal(buy(MACHINE, rollStock(MACHINE, () => 0), 0, purse, []).ok, true);
  assert.equal(purse.cash, 0);
});

test('every shipped merchant prices its whole stock above zero', () => {
  for (const [id, shop] of Object.entries(SHOPS)) {
    for (const row of shop.stock) {
      assert.ok(priceOf(shop, row.item) >= 1, `${id} prices "${row.item}"`);
    }
  }
});

test('the vending machine really is a rip-off, and the cart really is not', () => {
  // The content claim the design rests on: a machine costs meaningfully more
  // than the same snack from a person. If this ever inverts, finding a merchant
  // stops being a reward.
  const both = 'energy-drink';
  assert.ok(SHOPS.vending.stock.some((r) => r.item === both));
  assert.ok(priceOf(SHOPS.vending, both) > priceOf(SHOPS['mail-cart'], both));
  assert.equal(SHOPS.vending.buys, false);
  assert.equal(SHOPS['mail-cart'].buys, true);
});
