// Item + loot registry. Adding an item = adding an entry here; making
// something lootable = giving its tile type a `loot: '<table>'` (tiles.js) or
// an enemy a `loot` list (enemies.js). No engine code changes needed.
//
// Item fields the code understands:
//   name, icon - shown in the inventory panel and Alt loot labels
//   heal       - using it restores HP (consumed)
//   ammo       - using it adds paper ammo, capped at PAPER_CAP in stats.js
//                (consumed)
//   slot       - equippable slot: 'weapon' | 'outfit' | 'trinket'. Equipping
//                moves the item out of the bag into sheet.equipped[slot].
//   stats      - equipped bonuses folded into derived numbers (stats.js
//                equippedStats): dmg, soak, maxHp, maxAp, acc, dodge,
//                attrBonus:{grit,hustle,savvy,composure}
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
    examine: 'Egg salad, probably. Provenance unknown.',
  },
  'cold-coffee': {
    name: 'Cold Coffee',
    icon: '☕',
    heal: 2,
    useLog: 'You drink someone\'s cold coffee. It helps, somehow. +2 HP.',
    examine: 'A mug that says WORLD\'S OKAYEST EMPLOYEE. Still half full.',
  },
  // NB: there is also an `energy-drink` ACTION (data/actions.js, IT's heal).
  // Same id, separate registry, never cross-looked-up - see the note there.
  'energy-drink': {
    name: 'Loose Energy Drink',
    icon: '🥫',
    heal: 4,
    useLog: 'You crack the warm energy drink. Your heart objects. +4 HP.',
    examine: 'Room temperature. Neon. Technically legal.',
  },
  'paper-wad': {
    name: 'Paper Wad',
    icon: '📄',
    ammo: 1,
    useLog: 'You smooth out the wad and refold it. +1 paper.',
    examine: 'Pre-crumpled ammunition. Efficient.',
  },
  'paper-ream': {
    name: 'Ream of Paper',
    icon: '📦',
    ammo: 3,
    useLog: 'Five hundred sheets of pure potential. +3 paper.',
    examine: '92 bright. Letter. The good stuff from the locked cabinet.',
  },
  stapler: {
    name: 'Stapler',
    icon: '🖇️',
    slot: 'weapon',
    stats: { dmg: 1 },
    attack: 'staple-jab', // the basic swing this weapon grants (data/actions.js)
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
    examine: 'THE red stapler. Someone has been looking for this since 1999. +2 damage in hand.',
  },
  // --- equipment content (EQUIPMENT_PLAN M4) ---------------------------------
  'letter-opener': {
    name: 'Letter Opener',
    icon: '🗡️',
    slot: 'weapon',
    stats: { dmg: 1, acc: 0.05 }, // less punch than a stapler, but precise
    attack: 'letter-opener-stab',
    examine: 'Technically for envelopes. Technically.',
  },
  'company-fleece': {
    name: 'Company Fleece',
    icon: '🧥',
    slot: 'outfit',
    stats: { soak: 1 }, // a flat point off every hit
    examine: 'Embroidered logo. Surprisingly padded. Morale not included.',
  },
  'interview-blazer': {
    name: 'Interview Blazer',
    icon: '🕴️',
    slot: 'outfit',
    stats: { attrBonus: { composure: 2 } }, // poise you can wear
    examine: 'You feel weirdly employable in it.',
  },
  'laminated-lanyard': {
    name: 'Laminated Lanyard',
    icon: '🪪',
    slot: 'trinket',
    stats: { attrBonus: { hustle: 1 } }, // faster on your feet, harder to pin
    examine: 'ALL-ACCESS. Doors do not care. You feel faster anyway.',
  },
  'stress-ball': {
    name: 'Stress Ball',
    icon: '🟡',
    slot: 'trinket',
    stats: { attrBonus: { composure: 1 } },
    examine: 'Squeezed to an oblate spheroid by three generations of grief.',
  },
  'okayest-mug': {
    name: "World's Okayest Mug",
    icon: '🏆',
    slot: 'trinket',
    stats: { maxHp: 2 }, // its mediocrity is load-bearing
    examine: 'WORLD\'S OKAYEST EMPLOYEE. You have never felt so seen.',
  },
  'warehouse-boots': {
    name: 'Warehouse Boots',
    icon: '🥾',
    slot: 'shoes',
    stats: { slipProof: true, dodge: 0.05 }, // the floor holds no fear (and light on your feet)
    examine: 'Steel-toed, oil-resistant, 021 tread. Wet floors are a rumor.',
  },
  'toner-cartridge': {
    name: 'Toner Cartridge',
    icon: '🖨️',
    examine: 'Worth more than your monitor. The printer guards these jealously.',
  },
  'performance-review': {
    name: 'Performance Review',
    icon: '📋',
    examine: '"Meets some expectations." It isn\'t even yours. You keep it anyway.',
  },
  'hr-pamphlet': {
    name: 'HR Pamphlet',
    icon: '📘',
    examine: '"Five Ways To Smile Through It." Glossy. Laminated. Chilling.',
  },
  'usb-stick': {
    name: 'Mystery USB',
    icon: '💾',
    examine: 'Unlabeled. Found in the trash. Absolutely do not plug this in.',
  },
  matches: {
    name: 'Book of Matches',
    icon: '🔥',
    // A one-shot fire source for the classes that lack the Smoker's lighter -
    // main.js consumes one per light (see igniteAt / canIgnite).
    examine: 'From a bar nobody admits going to. Enough for a fire or two.',
  },
};

// Container loot tables (see tiles.js `loot` field). Each entry rolls
// independently; chance 1 entries guarantee rummaging is never pointless.
export const LOOT_TABLES = {
  trash: [
    { item: 'paper-wad', chance: 1 },
    { item: 'half-sandwich', chance: 0.5 },
    { item: 'matches', chance: 0.4 },
    { item: 'energy-drink', chance: 0.25 },
    { item: 'warehouse-boots', chance: 0.2 },
    { item: 'usb-stick', chance: 0.15 },
  ],
  printer: [
    { item: 'toner-cartridge', chance: 1 },
    { item: 'paper-ream', chance: 0.6 },
  ],
  desk: [
    { item: 'cold-coffee', chance: 1 },
    { item: 'stapler', chance: 0.4 },
    { item: 'performance-review', chance: 0.35 },
    { item: 'okayest-mug', chance: 0.3 },
    { item: 'letter-opener', chance: 0.25 },
    { item: 'stress-ball', chance: 0.2 },
    { item: 'red-stapler', chance: 0.06 },
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
