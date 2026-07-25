// Item + loot registry. Adding an item = adding an entry here; making
// something lootable = giving its tile type a `loot: '<table>'` (tiles.js) or
// an enemy a `loot` list (enemies.js). No engine code changes needed.
//
// Item fields the code understands:
//   name, icon - shown in the inventory panel and Alt loot labels
//   heal       - using it restores HP (consumed)
//   ammo       - using it adds paper ammo, capped at PAPER_CAP in stats.js
//                (consumed)
//   cash       - picking it up BANKS this much Petty Cash instead of pocketing
//                it (looting.js receiveItems). It is an item only so it can
//                ride the loot tables; it never reaches the bag.
//   value      - what the thing is worth in 💵 (ECONOMY_PLAN.md). Merchants
//                mark it up when selling to you (`markup`) and mark it down
//                when buying from you (`sellRate`); the item just states worth.
//                No `value` = nobody will take it, and it can't be stocked.
//   slot       - equippable slot: 'weapon' | 'outfit' | 'trinket'. Equipping
//                moves the item out of the bag into sheet.equipped[slot].
//   stats      - equipped bonuses folded into derived numbers (stats.js
//                equippedStats): dmg, soak, maxHp, maxAp, acc, dodge,
//                slipProof, moveCost, attrBonus:{grit,hustle,savvy,composure}
//                moveCost multiplies the AP a tile costs - under 1 is faster
//   attack     - (weapons) the basic-swing action id this weapon grants
//                (data/actions.js), read by stats.equippedAction
//   examine    - flavor line (items with no use are pure office archaeology)
//   useLog     - said when the item is consumed
export const ITEMS = {
  'half-sandwich': {
    name: 'Half a Sandwich',
    icon: '🥪',
    heal: 3,
    useLog: 'You eat the mystery half-sandwich. Bold. +3 HP.',
    value: 4,
    examine: 'Egg salad, probably. Provenance unknown.',
  },
  'cold-coffee': {
    name: 'Cold Coffee',
    icon: '☕',
    heal: 2,
    useLog: 'You drink someone\'s cold coffee. It helps, somehow. +2 HP.',
    value: 3,
    examine: 'A mug that says WORLD\'S OKAYEST EMPLOYEE. Still half full.',
  },
  // NB: there is also an `energy-drink` ACTION (data/actions.js, IT's heal).
  // Same id, separate registry, never cross-looked-up - see the note there.
  'energy-drink': {
    name: 'Loose Energy Drink',
    icon: '🥫',
    heal: 4,
    useLog: 'You crack the warm energy drink. Your heart objects. +4 HP.',
    value: 6,
    examine: 'Room temperature. Neon. Technically legal.',
  },
  'paper-wad': {
    name: 'Paper Wad',
    icon: '📄',
    ammo: 1,
    useLog: 'You smooth out the wad and refold it. +1 paper.',
    value: 1,
    examine: 'Pre-crumpled ammunition. Efficient.',
  },
  'paper-ream': {
    name: 'Ream of Paper',
    icon: '📦',
    ammo: 3,
    useLog: 'Five hundred sheets of pure potential. +3 paper.',
    value: 5,
    examine: '92 bright. Letter. The good stuff from the locked cabinet.',
  },
  stapler: {
    name: 'Stapler',
    icon: '🖇️',
    slot: 'weapon',
    stats: { dmg: 1 },
    attack: 'staple-jab', // the basic swing this weapon grants (data/actions.js)
    value: 10,
    examine: 'A desk weapon of legitimate business. +1 damage in hand.',
  },
  'red-stapler': {
    name: 'Red Stapler',
    icon: '🧷',
    slot: 'weapon',
    stats: { dmg: 2 },
    attack: 'staple-jab',
    // On-hit proc (EQUIPMENT_PLAN #8): its Staple Jab has a chance to fling gum
    // onto the target - the "gum-flick stapler" the plan promised. Resolved in
    // combat after the swing lands (stats.weaponProc).
    proc: { applies: 'gum', chance: 0.35, appliesLog: 'A stray staple flings gum onto their shoe.' },
    value: 40,
    examine: 'THE red stapler. Someone has been looking for this since 1999. +2 damage in hand.',
  },
  // --- equipment content (EQUIPMENT_PLAN M4) ---------------------------------
  'letter-opener': {
    name: 'Letter Opener',
    icon: '🗡️',
    slot: 'weapon',
    stats: { dmg: 1, acc: 0.05 }, // less punch than a stapler, but precise
    attack: 'letter-opener-stab',
    value: 14,
    examine: 'Technically for envelopes. Technically.',
  },
  'company-fleece': {
    name: 'Company Fleece',
    icon: '🧥',
    slot: 'outfit',
    stats: { soak: 1 }, // a flat point off every hit
    value: 16,
    examine: 'Embroidered logo. Surprisingly padded. Morale not included.',
  },
  'interview-blazer': {
    name: 'Interview Blazer',
    icon: '🕴️',
    slot: 'outfit',
    stats: { attrBonus: { composure: 2 } }, // poise you can wear
    value: 22,
    examine: 'You feel weirdly employable in it.',
  },
  'laminated-lanyard': {
    name: 'Laminated Lanyard',
    icon: '🪪',
    slot: 'trinket',
    stats: { attrBonus: { hustle: 1 } }, // faster on your feet, harder to pin
    value: 12,
    examine: 'ALL-ACCESS. Doors do not care. You feel faster anyway.',
  },
  'stress-ball': {
    name: 'Stress Ball',
    icon: '🟡',
    slot: 'trinket',
    stats: { attrBonus: { composure: 1 } },
    value: 9,
    examine: 'Squeezed to an oblate spheroid by three generations of grief.',
  },
  'okayest-mug': {
    name: "World's Okayest Mug",
    icon: '🏆',
    slot: 'trinket',
    stats: { maxHp: 2 }, // its mediocrity is load-bearing
    value: 8,
    examine: 'WORLD\'S OKAYEST EMPLOYEE. You have never felt so seen.',
  },
  'warehouse-boots': {
    name: 'Warehouse Boots',
    icon: '🥾',
    slot: 'shoes',
    // The floor holds no fear - but steel toes are not light. Sure-footed and
    // evasive, at a small movement premium: the trade that makes the slot a
    // decision rather than a default.
    stats: { slipProof: true, dodge: 0.05, moveCost: 1.1 },
    value: 15,
    examine: 'Steel-toed, oil-resistant, 021 tread. Wet floors are a rumor.',
  },
  'running-shoes': {
    name: 'Lunchtime Runners',
    icon: '👟',
    slot: 'shoes',
    // Nothing but speed: every tile costs a fifth less. No traction, so a wet
    // floor is still exactly as dangerous as it looks.
    stats: { moveCost: 0.8 },
    value: 15,
    examine: 'Somebody actually uses the lunch hour. Suspicious.',
  },
  'toner-cartridge': {
    name: 'Toner Cartridge',
    icon: '🖨️',
    value: 12,
    examine: 'Worth more than your monitor. The printer guards these jealously.',
  },
  'performance-review': {
    name: 'Performance Review',
    icon: '📋',
    value: 2,
    examine: '"Meets some expectations." It isn\'t even yours. You keep it anyway.',
  },
  'hr-pamphlet': {
    name: 'HR Pamphlet',
    icon: '📘',
    value: 1,
    examine: '"Five Ways To Smile Through It." Glossy. Laminated. Chilling.',
  },
  'usb-stick': {
    name: 'Mystery USB',
    icon: '💾',
    value: 6,
    examine: 'Unlabeled. Found in the trash. Absolutely do not plug this in.',
  },
  matches: {
    name: 'Book of Matches',
    icon: '🔥',
    // A one-shot fire source for the classes that lack the Smoker's lighter -
    // main.js consumes one per light (see igniteAt / canIgnite).
    value: 2,
    examine: 'From a bar nobody admits going to. Enough for a fire or two.',
  },

  // --- money (ECONOMY_PLAN M1) ------------------------------------------------
  // Items with `cash` never reach the bag: receiveItems banks them on the spot.
  // They exist as items purely so cash can ride the loot tables and enemy drop
  // lists like anything else, with no second roll shape to maintain.
  'crumpled-fiver': {
    name: 'Crumpled Fiver',
    icon: '💵',
    cash: 5,
    examine: 'Somebody folded this into a tight triangle. Why. Who does that.',
  },
  'petty-cash-envelope': {
    name: 'Petty Cash Envelope',
    icon: '🧧',
    cash: 15,
    examine: 'Marked FOR TEAM MORALE. Unopened since the reorg. Morale pending.',
  },
  'coin-return': {
    name: 'Coin Return',
    icon: '🪙',
    cash: 2,
    examine: 'The machine owed you this and you both know it.',
  },

  // --- vending stock (ECONOMY_PLAN M2) ---------------------------------------
  // The heal economy you can BUY. Deliberately shallow numbers: a machine
  // should top you up between fights, never replace finding things.
  'candy-bar': {
    name: 'Candy Bar',
    icon: '🍫',
    heal: 3,
    value: 4,
    useLog: 'You eat the candy bar in four bites. +3 HP.',
    examine: 'Row B. Reliable. Slightly bloomed with age, but aren\'t we all.',
  },
  'vending-crisps': {
    name: 'Bag of Crisps',
    icon: '🥔',
    heal: 2,
    value: 3,
    useLog: 'Mostly air, but the salt helps. +2 HP.',
    examine: 'The bag is 80% nitrogen. You are paying for the nitrogen.',
  },
  'stale-danish': {
    name: 'Stale Danish',
    icon: '🥐',
    heal: 4,
    value: 5,
    useLog: 'It fights back, then gives in. +4 HP.',
    examine: 'Slot E7. It has been stuck there since before you were hired.',
  },
  'mystery-flavor': {
    name: 'Mystery Flavour',
    icon: '❓',
    heal: 6,
    value: 9,
    useLog: 'Unlabelled, unhesitating, unexpectedly excellent. +6 HP.',
    examine: 'No branding. No ingredients. No barcode. It hums very faintly.',
  },
};

// Container loot tables (see tiles.js `loot` field). Each entry rolls
// independently; chance 1 entries guarantee rummaging is never pointless.
export const LOOT_TABLES = {
  trash: [
    { item: 'paper-wad', chance: 1 },
    // Loose change goes in the bin with the receipt it was wrapped in.
    { item: 'crumpled-fiver', chance: 0.3 },
    { item: 'half-sandwich', chance: 0.5 },
    { item: 'matches', chance: 0.4 },
    { item: 'energy-drink', chance: 0.25 },
    { item: 'warehouse-boots', chance: 0.2 },
    { item: 'running-shoes', chance: 0.18 },
    { item: 'usb-stick', chance: 0.15 },
  ],
  printer: [
    { item: 'toner-cartridge', chance: 1 },
    { item: 'paper-ream', chance: 0.6 },
  ],
  desk: [
    { item: 'cold-coffee', chance: 1 },
    { item: 'crumpled-fiver', chance: 0.4 }, // the drawer everyone keeps money in
    { item: 'stapler', chance: 0.4 },
    { item: 'performance-review', chance: 0.35 },
    { item: 'okayest-mug', chance: 0.3 },
    { item: 'letter-opener', chance: 0.25 },
    { item: 'stress-ball', chance: 0.2 },
    { item: 'red-stapler', chance: 0.06 },
  ],
  // Paperwork, not desk clutter. A filing cabinet reusing the `desk` table
  // would hand out cold coffee and a novelty mug, which belong on a desk's
  // surface rather than filed in a drawer - so this is the same expected haul
  // (~2.4 items) drawn from what an office actually files. The Mystery USB is
  // the interesting one: `trash` is currently the only other place it drops.
  'filing-cabinet': [
    { item: 'performance-review', chance: 1 },
    // Filed under M, for Morale. The single biggest find in the game.
    { item: 'petty-cash-envelope', chance: 0.25 },
    { item: 'hr-pamphlet', chance: 0.5 },
    { item: 'paper-ream', chance: 0.4 },
    { item: 'laminated-lanyard', chance: 0.2 },
    { item: 'usb-stick', chance: 0.2 },
    { item: 'letter-opener', chance: 0.15 },
  ],
};

// Roll a table into a list of item ids.
export function rollLoot(table) {
  const out = [];
  for (const { item, chance } of table || []) {
    if (Math.random() < chance) out.push(item);
  }
  return out;
}
