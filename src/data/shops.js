// Merchant registry (ECONOMY_PLAN.md). A merchant is a name, a greeting, a
// price posture, and a stock list. Adding one = adding an entry here and
// pointing something at it:
//
//   a TILE TYPE with `shop: '<id>'`      -> a machine merchant (the snack
//                                            machine); click it, walk up, buy
//   an NPC/COMPANION with `shop: '<id>'` -> a person; a dialogue option
//                                            carrying `effect: { shop: true }`
//                                            opens the same panel
//
// The shop itself never knows which one opened it - that is the whole point of
// having two shapes on one system.
//
// Fields:
//   name      - shown in the panel header
//   greeting  - one line under it (machines SHOUT, people talk)
//   markup    - multiplier on an item's `value` when selling TO the player.
//               Above 1 is a rip-off, which is what a vending machine is.
//   buys      - false: this merchant takes nothing off your hands (machines)
//   sellRate  - multiplier when buying FROM the player; defaults to
//               shop.js SELL_RATE
//   stock     - [{ item, qty, chance }]. `chance` gates whether the slot is
//               stocked at all when the instance is first visited; `qty` is
//               how many if it is. Stock is rolled ONCE per instance and
//               decrements as you buy, so a machine can sell out.
export const SHOPS = {
  vending: {
    name: 'Snack Machine',
    greeting: 'INSERT PETTY CASH. NO REFUNDS. NO EXCEPTIONS. NO.',
    // It is a rip-off and it knows it. This is the number that makes finding a
    // person to trade with feel like a discovery rather than a formality.
    markup: 1.6,
    buys: false, // it is a machine
    stock: [
      { item: 'candy-bar', qty: 3, chance: 1 },
      { item: 'vending-crisps', qty: 2, chance: 1 },
      { item: 'energy-drink', qty: 2, chance: 0.8 },
      { item: 'stale-danish', qty: 1, chance: 0.55 },
      // The machine-exclusive: the only place in the game it drops. A row that
      // is empty more often than not is what makes checking the next machine
      // worth the walk.
      { item: 'mystery-flavor', qty: 1, chance: 0.25 },
    ],
  },
  // The mail room companion's cart. Eleven years of corridors means he has
  // everything and owes nobody an explanation - a fair hand by office
  // standards, and the only merchant who will take your junk. (Named for the
  // cart, not for him: he has no name of his own - see data/companions.js.)
  'mail-cart': {
    name: 'The Mail Cart',
    greeting: '"Everything on here fell off something. Ask me nothing."',
    markup: 1.0,
    buys: true,
    sellRate: 0.45, // he rounds up, quietly
    stock: [
      { item: 'paper-ream', qty: 2, chance: 1 },
      { item: 'half-sandwich', qty: 2, chance: 0.8 },
      { item: 'company-fleece', qty: 1, chance: 0.5 },
      { item: 'running-shoes', qty: 1, chance: 0.4 },
      { item: 'letter-opener', qty: 1, chance: 0.35 },
    ],
  },
};
