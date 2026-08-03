// Item + loot registry. Adding an item = adding an entry here; making
// something lootable = giving its tile type a `loot: '<table>'` (tiles.js) or
// an enemy a `loot` list (enemies.js). No engine code changes needed.
//
// Item fields the code understands:
//   name, icon - shown in the inventory panel and Alt loot labels
//   heal       - using it restores HP (consumed)
//   revive     - brings a DOWNED party member up at this much HP (consumed).
//                Not used from the pockets on yourself: a character at 0 HP is
//                out of action and cannot use anything, which is the point. It
//                is spent by walking to a fallen colleague and choosing "Help
//                <name> up" (main.js helpUp). Since the designer struck the
//                automatic heals (TODO.md, 2026-08-02), this is the ONLY way a
//                downed character gets back up - so an item with `revive` is a
//                run-critical object, not a snack.
//   ammo       - using it adds paper ammo, capped at PAPER_CAP in stats.js
//                (consumed)
//   cash       - picking it up BANKS this much Petty Cash instead of pocketing
//                it (looting.js receiveItems). It is an item only so it can
//                ride the loot tables; it never reaches the bag.
//   value      - what the thing is worth in 💵 (ECONOMY_PLAN.md). Merchants
//                mark it up when selling to you (`markup`) and mark it down
//                when buying from you (`sellRate`); the item just states worth.
//                No `value` = nobody will take it, and it can't be stocked.
//   slot       - equippable slot: 'weapon' | 'outfit' | 'trinket' | 'shoes'
//                (the full set is EQUIP_SLOTS in stats.js). Equipping
//                moves the item out of the bag into sheet.equipped[slot].
//   stats      - equipped bonuses folded into derived numbers (stats.js
//                equippedStats): dmg, soak, maxHp, maxAp, acc, dodge, reach,
//                slipProof, moveCost, attrBonus:{grit,hustle,savvy,composure}
//                moveCost multiplies the AP a tile costs - under 1 is faster
//                reach ADDS tile-units to REACH.DEFAULT (a long handle). Keep
//                it positive: below 1.41 a weapon can't hit a diagonally
//                adjacent target and reads as broken, so shortness is
//                expressed through dmg/acc instead (TACTICS_PLAN revision).
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
  // --- the revive economy (no-auto-healing, designer 2026-08-02) ---------------
  // Downed colleagues used to get up for free: after every won fight, in every
  // stairwell, and on any walk-over "hand up". All three are gone, so getting
  // somebody back on their feet is now a thing you have to be CARRYING. That
  // makes this the most important object in the game and it is deliberately not
  // generous - one use, a modest 4 HP, and you have to have thought ahead.
  'first-aid': {
    name: 'Expired First-Aid Kit',
    icon: '🩹',
    revive: 4,
    useLog: 'You crack the seal on the first-aid kit. Most of it is 2009 aspirin.',
    value: 14,
    examine: 'Mounted by the fire door. The inspection tag stops three managers ago.',
  },

  // --- the retired class heals (POWERS_PLAN M9) --------------------------------
  // Five classes each carried a self-heal on the action bar: Coffee Break,
  // Executive Espresso, Snack Cart Raid, Night Thermos, Energy Drink. Six
  // drinkable objects, 2 AP each, 15-18 HP a fight, none of them touching
  // another system - the same "every kit's third button is the same button"
  // problem the `defend` sweep fixed one layer up. Healing is HR's now
  // (`triage`), and these are what everybody else lives on.
  //
  // They are LOOT rather than deletions on purpose. The flavour was the good
  // part; what was wrong was that each class started every fight holding one.
  // As objects you have to find, the same cup of break-room coffee becomes a
  // floor-level resource instead of a per-fight reset.
  //
  // `energy-drink` was ALREADY an item (below) as well as an action - the two
  // registries never share a lookup, so the namesake was harmless. Retiring the
  // action leaves the item as the only survivor, which is the right one.
  'coffee-break': {
    name: 'Break-Room Coffee',
    icon: '☕',
    heal: 6,
    useLog: 'You chug lukewarm coffee. +6 HP.',
    value: 4,
    examine: 'The break-room worst, and the most reliable thing on this floor.',
  },
  'executive-espresso': {
    name: 'Executive Espresso',
    icon: '⚡',
    heal: 8,
    useLog: 'You down a double espresso from the good machine. +8 HP.',
    value: 9,
    examine: 'From the machine on the floor you are not badged for.',
  },
  'snack-cart-pastry': {
    name: 'Liberated Pastry',
    icon: '🛒',
    heal: 5,
    useLog: 'You liberate a pastry from the cart. +5 HP.',
    value: 5,
    examine: 'Nobody counts these. Nobody has ever counted these.',
  },
  'night-thermos': {
    name: 'Night Thermos',
    icon: '🍶',
    heal: 5,
    useLog: 'You pour from the thermos. It is still, somehow, hot. +5 HP.',
    value: 7,
    examine: 'It has seen every 3am on this floor.',
  },
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
  // --- reach content (TACTICS_PLAN revision, M5) ------------------------------
  // The first weapon whose point is WHERE it hits from rather than how hard.
  // reach 0.7 takes it to 2.2 tile-units, which clears a full orthogonal tile
  // (2.0) - so you can swing from outside a bare-handed reply, and you zone a
  // wider ring for opportunity attacks. Paid for on both other axes: no damage
  // bonus at all, and a penalty to accuracy, because a metre of aluminium
  // between your hand and the business end is not precision equipment.
  'reach-grabber': {
    name: 'Reach Extender',
    icon: '🦯',
    slot: 'weapon',
    stats: { reach: 0.7, acc: -0.05 },
    attack: 'grabber-swipe',
    // Priced like the letter opener: the two weapons that buy something other
    // than raw damage. Without a value the economy merge left it unfenceable -
    // the one weapon no merchant would touch.
    value: 14,
    examine: 'Facilities uses it for litter and high shelves. Telescopes to a metre and a bit.',
  },
  // --- ranged content ---------------------------------------------------------
  // Weapons whose point is that you never walk up. Both grant a ranged attack
  // (actions.js `range`) that costs nothing to fire - no ammo, the way a bow
  // needs none - and both pay for it in damage alone: `stats.dmg: 0`, where
  // every melee weapon in the list adds at least +1 on top of a bigger roll.
  // Ammo is reserved for the specialty shots (the wad, the airplane).
  'staple-gun': {
    name: 'Staple Gun',
    icon: '📌',
    slot: 'weapon',
    stats: { dmg: 0 }, // explicit: the whole cost of shooting is the damage you don't get
    attack: 'staple-gun-fire',
    // Priced above the stapler it can't out-hit: range is worth paying for
    // even when the numbers on it are worse.
    value: 26,
    examine: 'Heavy-duty, borrowed from Facilities and never returned. Reaches four desks over. Hits like an argument, not a punch.',
  },
  'spitball-straw': {
    name: 'Spitball Straw',
    icon: '🥤',
    slot: 'weapon',
    stats: { dmg: 0 },
    attack: 'spitball-shot',
    // The cheapest weapon in the game, and the one you outgrow fastest - it is
    // an opener, not a career.
    value: 6,
    examine: 'From the break room. Reaches the far wall. Does almost nothing when it gets there.',
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
    { item: 'snack-cart-pastry', chance: 0.2 }, // liberated once already, then abandoned
    { item: 'warehouse-boots', chance: 0.2 },
    { item: 'running-shoes', chance: 0.18 },
    { item: 'usb-stick', chance: 0.15 },
    { item: 'reach-grabber', chance: 0.15 }, // the litter picker, left by the bins
    { item: 'spitball-straw', chance: 0.3 }, // it came off a drink, and it went in the bin
  ],
  printer: [
    { item: 'toner-cartridge', chance: 1 },
    { item: 'paper-ream', chance: 0.6 },
  ],
  // The break-room table (POWERS_PLAN M9). The five retired class heals had to
  // land SOMEWHERE the moment the class bars stopped carrying them, and a
  // break room is where a floor's healing actually lives - so this is the one
  // table worth walking to rather than looting in passing.
  'break-room': [
    { item: 'coffee-break', chance: 1 },
    { item: 'snack-cart-pastry', chance: 0.6 },
    { item: 'night-thermos', chance: 0.35 },
    { item: 'energy-drink', chance: 0.35 },
    // The good machine is on a floor you are not badged for. It gets here by
    // somebody carrying it down, which is rare and worth finding.
    { item: 'executive-espresso', chance: 0.15 },
    { item: 'half-sandwich', chance: 0.5 },
    // The kit off the wall by the fire door. A break room is where it hangs,
    // and with the automatic revives gone this is the roll that decides whether
    // a wipe was survivable - so it is uncommon rather than rare.
    { item: 'first-aid', chance: 0.4 },
  ],
  desk: [
    { item: 'cold-coffee', chance: 1 },
    // Somebody's afternoon, saved for later and then forgotten.
    { item: 'coffee-break', chance: 0.25 },
    { item: 'crumpled-fiver', chance: 0.4 }, // the drawer everyone keeps money in
    { item: 'stapler', chance: 0.4 },
    { item: 'performance-review', chance: 0.35 },
    { item: 'okayest-mug', chance: 0.3 },
    { item: 'letter-opener', chance: 0.25 },
    { item: 'stress-ball', chance: 0.2 },
    // Borrowed from Facilities, filed in a drawer, never given back.
    { item: 'staple-gun', chance: 0.12 },
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
    // Filed rather than mounted, because somebody in Facilities took it down.
    { item: 'first-aid', chance: 0.15 },
    { item: 'letter-opener', chance: 0.15 },
  ],
};

// Roll a table into a list of item ids.
export function rollLoot(table, rng = Math.random) {
  const out = [];
  for (const { item, chance } of table || []) {
    if (rng() < chance) out.push(item);
  }
  return out;
}
