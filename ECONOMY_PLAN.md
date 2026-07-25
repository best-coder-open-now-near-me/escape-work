# Office Economy Plan (Money, Merchants & Snack Machines)

Loot you *spend*. Today every item in the game arrives one way — you rummage a
desk, you loot a body, you gather a paper drift — and leaves one of three ways:
you eat it, you wear it, or you drop it on the floor. There is no currency, no
merchant, no price on anything, and therefore no *choice* about what a piece of
loot is worth to you. The third pillar of the CRPG loot loop (kill → loot →
**trade** → equip) is missing, and with it the reason to ever pick up a toner
cartridge.

This is a data-shaped add in the same mould as `EQUIPMENT_PLAN.md`: items grow
a `value`, a new `data/shops.js` registry holds stock lists, a tile type with
`shop: '<id>'` is a **snack machine**, an NPC with `shop: '<id>'` is a person
who sells things, and the party grows a shared purse. The transaction rules
live in one new pure module; everything else folds through seams that already
exist.

This document is the implementation plan: design decisions, module-by-module
changes, milestone order. No code yet. Shaped like `EQUIPMENT_PLAN.md`,
honoring the `ARCHITECTURE.md` rule: **content is data, code is systems.**
After this lands, a new merchant is one `SHOPS` entry plus one character in a
level legend, and a new price is one number on an item.

**Sequencing note:** this lands cleanly *after* `EQUIPMENT_PLAN.md` (shipped) —
gear is what makes a shop's inventory worth saving up for, and the `ITEMS`
registry already has the `slot`/`stats` vocabulary a merchant's stock list
needs. It has no dependency on `STATUS_PLAN` except in the stretch content
(a consumable that applies `caffeinated`).

## Where we are today

- **No currency exists.** `sheet` carries `hp`, `paper`, `inventory`,
  `equipped`, attributes and points. `paper` is the only fungible resource, and
  it is ammunition, not money — it has exactly one sink (throws).
- **Loot has no price.** `ITEMS` entries carry `heal` / `ammo` / `slot` /
  `stats` / `examine`. Four of them (`toner-cartridge`, `usb-stick`,
  `performance-review`, `hr-pamphlet`) are pure flavor — items whose entire
  purpose is to be read once and then take up a row in the pockets forever. The
  registry comment calls them "office archaeology," which is charming and also
  a dead end.
- **The acquisition plumbing is already right.** `looting.js` owns
  `receiveItems` (loot → pockets, one funnel), the pockets panel with its
  per-item verbs (use / examine / drop / equip / send), the Alt overlay, and
  the **out-of-combat gate** every one of those verbs shares. A shop is another
  verb on the same rails.
- **Props are already clickable merchants-in-waiting.** A tile type with
  `loot: '<table>'` is rummageable: `scene.js` registers it for picking as kind
  `prop`, `main.js dispatchHit` walks you up and calls `loot.lootContainer`,
  the Alt overlay labels it, the right-click menu offers the verb. A snack
  machine is that same shape with a different verb attached.
- **NPCs already branch on effects.** A dialogue option carrying
  `effect: { recruit: true }` is how a companion joins (`main.js
  renderDialogueNode`). `effect: { shop: true }` is the same seam.
- **The party is already the unit of ownership.** `party.members` share XP
  (`gainXpAll`), share the pockets (the `Give to <name>` verb), and share a
  save record. There is one obvious place for a purse and it isn't a sheet.

## What we're building

- **Petty Cash** — one integer currency (💵), held in a **shared party purse**
  (`party.cash`). Shown in the HUD-adjacent pockets panel next to the paper
  count, and in the shop panel.
- **Cash as loot.** Cash arrives as ordinary loot-table entries — items with a
  `cash` field that **auto-bank on pickup** rather than sitting in the bag. A
  crumpled fiver from a trash can, a petty-cash envelope from an executive's
  jacket. Zero new plumbing in loose items, the Alt overlay, or the panel.
- **A value on everything.** Every `ITEMS` entry gains `value` — what the thing
  is worth. Merchants apply their own markup (buying) and markdown (selling) on
  top, so one number per item drives both directions.
- **Snack machines** — the headline. A tile type with `shop: 'vending'`,
  painted into a level like any other prop, on the map character `$`. Click it,
  walk up, and a shop panel opens: a short, **finite**, per-machine stock of
  consumables at machine prices (which is to say: a rip-off). It sells; it does
  not buy. Break rooms suddenly matter.
- **Person merchants** — an NPC (or companion) whose dialogue offers
  "Let's talk business." Same panel, better prices, and they **buy your junk** —
  which is what finally makes the toner cartridge worth carrying out.
- **One shop panel, one set of rules.** `src/shop.js` (pure) owns the
  arithmetic: price, sell yield, affordability, the stock decrement.
  `src/shopping.js` owns the panel and the world wiring. A machine and a person
  differ only by their data.
- **A content pass**: cash in every loot table, a value on every item, a machine
  on every floor, and a supply-closet clerk who will take that USB stick off
  your hands and ask no questions.

## Design decisions (recommended, with alternatives considered)

| # | Decision | Choice | Why / alternatives |
|---|----------|--------|--------------------|
| 1 | The currency | **One integer, "Petty Cash" (💵)**. No denominations, no second currency | A second currency (vending tokens) is a tax on comprehension for a game whose whole joke is that it's an office, not a fantasy market. One number the player can read at a glance and one price per item keeps every purchase a legible either/or. Rejected: cash + tokens (two economies to balance, one of which is only spendable at one merchant type). |
| 2 | Who owns the money | **A shared party purse** — `party.cash`, not `sheet.cash` | Per-member wallets would mean switching leaders to afford a sandwich, and shuffling money between members with a `Give` verb. That is exactly the friction `INV_CAP = Infinity` was deleted to remove ("friction without a decision attached"). The party already shares XP and hands items around freely; money is the same social contract. Cost: the purse lives at the party level in the save, not on a sheet — see decision #11. |
| 3 | How cash arrives | **As loot-table entries** — an item with a `cash: n` field, **auto-banked** in `receiveItems` instead of entering the bag | One branch in the single funnel every acquisition already passes through. Loose floor items, the Alt overlay, corpse loot, container rolls and god-mode drops all work with no changes, because a fiver *is* an item right up until the moment it's received. Rejected: a `cash: [min,max]` field on loot-table rows (a second, parallel roll shape in every table, plus new handling in `rollLoot`, `receiveItems`, the overlay, and loose items — more code for the same result). |
| 4 | One number per item | **`value: n`** on the item; markup/markdown live on the **merchant** | Two fields (`price` for buying, `value` for selling) drift apart the moment content is authored in a hurry, and encode the merchant's greed in the item — so a vending machine and a clerk can't disagree about a candy bar. One value plus a per-shop `markup` / `sellRate` means "vending machines are a rip-off" is a *shop* property, which is where the joke belongs. |
| 5 | Merchants are data, in two shapes, on one system | A `SHOPS` registry (`data/shops.js`). A **tile type** with `shop: '<id>'` is a machine; an **NPC/companion** with `shop: '<id>'` is a person. Both open the same panel | The two shapes already have separate approach verbs in `main.js` (`dispatchHit` kind `prop` vs. kind `npc` → dialogue), and both already walk you into reach. The shop itself doesn't care which one opened it. This is what makes "a snack machine" and "a guy in the supply closet" the same feature. |
| 6 | Stock is finite, rolled once per instance | Per-instance stock, keyed like container loot (`"x,z"` for a machine, the npc id for a person), rolled on first visit and decremented by purchases. No restock within a run | Mirrors `containerLoot` exactly — same memory shape, same "rolled once, remembers" contract, and the player already understands it from rummaging. A machine that sells out is a reason to go looking for another one, which is the only thing that makes a *placed* merchant more interesting than a menu. Rejected: infinite stock (removes any reason to explore for a second machine, and makes healing a pure cash check). |
| 7 | Machines don't buy | `buys: false` on a machine shop; person merchants buy at `sellRate` | In-fiction and mechanically useful: it means the two merchant shapes have genuinely different roles rather than one being a worse version of the other. A snack machine is a *sink*; a clerk is a *sink and a source*. It also keeps the absurd case ("you sold your red stapler to a vending machine") out of the game. |
| 8 | Selling is at a markdown | `SELL_RATE = 0.4` (a shop-level override), floored at 1 | The universal answer to "why not just buy everything back". 40% is the genre-standard "junk is worth carrying, round-tripping is not". Exact number is a playtest knob, same posture as HIT's whiff rate. |
| 9 | No haggling in v1 | Prices are flat; **no** Savvy/Composure discount | Tempting — the attribute economy and the money economy *should* touch eventually — but a stat that shifts every price turns the balance milestone into a moving target on the same PR that first introduces prices. Deferred to the stretch milestone, where it's a one-line multiplier in `shop.priceOf` and nothing else. |
| 10 | Out of combat only | The shop verb is gated exactly like use / drop / equip | Consistency with every other pockets verb, and it dodges the "I bought a sandwich with the Manager mid-swing" question entirely. The gate already exists as a host callback (`isInCombat`); this is a reuse, not a rule. |
| 11 | Where the purse persists | **Save v6**: `cash` at the top level of the progress record, beside `levelId` / `party` / `active` | The purse is party state, and `serializeProgress(party, levelId)` is already the party-level seam. `parseProgress` returns it alongside `sheets`; older saves seed `0`. Rejected: stashing it on `party.members[0].sheet` (invents an owner, breaks the moment the leader changes or member 0 goes down). |
| 12 | The machine's map character | **`$`**, reassigning `rug-round` (its current owner) to one of the six remaining free characters | The printable-ASCII legend namespace is **86/95 used** — `ARCHITECTURE.md` already names this as the real ceiling on prop count. `$` is the one character in the set that means "money" to every human alive, and it is currently spent on a *round rug*. No shipped level uses `$` (verified against `levels/*.json`), so the swap is free today and impossible later. Do it in the same milestone as the machine. |
| 13 | Shaking the machine | **Stretch.** A right-click verb: free snack / nothing / it tips on you | Pure upside as flavor, and it composes with plumbing that already exists (`applyDamage`, the right-click menu, the `explosive`/`ignitable` prop precedent). Deliberately not core: it's a risk verb on a system that has to be *legible* first. |
| 14 | No rarity tiers, no generated prices | Hand-authored `value` per item, same as `EQUIPMENT_PLAN` #9 | Consistent with the equipment plan's reasoning, and at this content scale a hand-priced red stapler ("someone has been looking for this since 1999" — 40💵) carries more character than a formula. |

## The data

### Currency items (`data/items.js`)

Items with a `cash` field never reach the bag — `receiveItems` banks them and
narrates. They exist as items purely so they can ride the loot tables.

```js
// New item field:
//   cash  - picking this up banks N Petty Cash instead of pocketing the item
//   value - what the thing is worth (💵). Merchants mark up when selling to
//           you and mark down when buying from you; the item just states worth.
'crumpled-fiver': {
  name: 'Crumpled Fiver', icon: '💵', cash: 5,
  useLog: 'Five dollars, softened by a decade in a coat pocket. Banked.',
  examine: 'Someone folded this into a triangle. Why.',
},
'petty-cash-envelope': {
  name: 'Petty Cash Envelope', icon: '🧧', cash: 15,
  examine: 'Marked FOR TEAM MORALE, unopened since the reorg.',
},
'coin-return': { name: 'Coin Return', icon: '🪙', cash: 2, examine: 'The machine owed you this.' },
```

### Values on the existing registry

The flavor items stop being dead weight — this is the single biggest payoff of
the plan and costs one field each:

```js
'toner-cartridge':    { …, value: 12 },  // "worth more than your monitor" — now literally
'usb-stick':          { …, value: 6  },  // the clerk asks no questions
'performance-review': { …, value: 2  },
'hr-pamphlet':        { …, value: 1  },
'okayest-mug':        { …, value: 8  },
'red-stapler':        { …, value: 40 },  // THE red stapler
'letter-opener':      { …, value: 14 },
'company-fleece':     { …, value: 16 },
'half-sandwich':      { …, value: 3  },
```

(Proposals — the balance milestone owns the numbers. Rule of thumb: a
consumable is one fight's worth of cash, a piece of gear is several.)

### The shop registry (`data/shops.js`, new)

```js
// A merchant is a name, a greeting, a price posture, and a stock list. A TILE
// TYPE with `shop: '<id>'` is a machine merchant; an NPC/COMPANION with
// `shop: '<id>'` is a person. Stock is rolled ONCE per instance and decrements
// as you buy - a machine can sell out.
//
//   markup    - multiplier on an item's `value` when selling TO the player
//   buys      - false: this merchant will not take anything off your hands
//   sellRate  - multiplier when buying FROM the player (default SELL_RATE)
//   stock     - [{ item, qty, chance }] - chance gates whether the slot is
//               stocked at all, qty is how many if it is
export const SHOPS = {
  vending: {
    name: 'Snack Machine',
    greeting: 'ROW E. INSERT PETTY CASH. NO REFUNDS.',
    markup: 1.6,      // it is a rip-off and it knows it
    buys: false,      // it is a machine
    stock: [
      { item: 'candy-bar',     qty: 3, chance: 1 },
      { item: 'vending-crisps',qty: 2, chance: 1 },
      { item: 'energy-drink',  qty: 2, chance: 0.8 },
      { item: 'stale-danish',  qty: 1, chance: 0.5 },  // E7. It is always stuck.
      { item: 'mystery-flavor',qty: 1, chance: 0.25 }, // machine-exclusive
    ],
  },
  'break-room-coffee': {
    name: 'Coffee Machine', greeting: 'SELECT STRENGTH. (ONLY ONE OPTION.)',
    markup: 1.3, buys: false,
    stock: [{ item: 'hot-coffee', qty: 4, chance: 1 }],
  },
  'supply-clerk': {
    name: "Supply Closet", greeting: '"You didn\'t get this from me."',
    markup: 1.0, buys: true, sellRate: 0.45,   // a fair hand, by office standards
    stock: [
      { item: 'paper-ream',    qty: 2, chance: 1 },
      { item: 'letter-opener', qty: 1, chance: 0.7 },
      { item: 'company-fleece',qty: 1, chance: 0.5 },
      { item: 'running-shoes', qty: 1, chance: 0.4 },
    ],
  },
};
```

### The machine, as a tile (`data/tiles.js`)

```js
'snack-machine': {
  char: '$', category: 'furniture',
  solid: true, height: 0.9, scale: 0.5,
  color: [0.75, 0.2, 0.24],
  model: 'furniture/kit/kitchenFridgeLarge', // a tall lit box; stands in well
  label: 'Snack Machine',
  shop: 'vending',
},
'coffee-machine': {
  char: '{', category: 'furniture',
  solid: true, height: 0.45, scale: 0.5,
  model: 'furniture/kit/kitchenCoffeeMachine',
  label: 'Coffee Machine', shop: 'break-room-coffee',
},
// and `rug-round` moves off '$' onto one of "'`|} (decision #12)
```

The `.glb` kit has no bespoke vending machine. `kitchenFridgeLarge` is a
tall, door-fronted box that reads correctly at this camera angle once tinted
machine-red; a purpose-built model (or a `primitive: 'vending'` builder beside
`addTrash`/`addPrinter` in `tile-renderer.js`) is a polish item, not a blocker.

### The person, as an NPC (`data/npcs.js`)

```js
'supply-clerk': {
  char: '|', name: 'Supply Closet Clerk', model: 'worker',
  shop: 'supply-clerk',
  dialogue: { start: 'hi', nodes: {
    hi: { text: '"Badge? …No, don\'t. I didn\'t see you. What do you need?"',
      options: [
        { label: "Let's talk business.", effect: { shop: true }, next: 'hi' },
        { label: 'Nothing. Sorry.', next: null },
      ] },
  } },
},
```

`effect: { shop: true }` mirrors `effect: { recruit: true }` exactly — one more
branch in `renderDialogueNode`. Any companion can carry `shop` too (the Mail
Room Veteran running a cart out of the party is a natural later add).

## The purse & the math

```js
// src/shop.js - PURE. No DOM, no PlayCanvas. Unit-tested like stats.js.
export const SELL_RATE = 0.4;      // default markdown when a merchant buys

priceOf(shopDef, itemId)           // ceil(value * markup), floored at 1
sellYield(shopDef, itemId)         // floor(value * (shopDef.sellRate ?? SELL_RATE)), floored at 1
canAfford(cash, price)
rollStock(shopDef)                 // [{ item, qty }] - the once-per-instance roll
buy(purse, stockRow, shopDef)      // validates cash + qty; returns the delta, or null
sell(shopDef, itemId)              // validates `buys` + a value; returns the yield, or null
```

Everything above is a pure function of its inputs and the registries — the
same posture as `stats.hitChance` / `stats.equippedStats`, so the god panel can
pin the constants and the unit suite can assert the arithmetic without a
browser.

**Not-negotiable invariants** (each gets a unit test):

- Cash is a non-negative integer at all times; no transaction can drive it
  below zero or leave a fraction.
- A purchase is atomic: stock decrements **iff** cash decrements **iff** the
  item lands in a bag. There is no partial state to leave behind.
- An item with no `value` cannot be sold (a merchant politely declines) and
  cannot be stocked (registry lint catches it at test time, not runtime).

## Architecture: where it lands

### Pure modules (unit-tested)

**`src/data/shops.js`** *(new)* — the `SHOPS` registry. Imports nothing, like
every other `data/*` module.

**`src/data/items.js`** — `value` on every item worth anything; `cash` on the
three currency items; new consumables for the machines (`candy-bar`,
`vending-crisps`, `stale-danish`, `hot-coffee`, `mystery-flavor`). Loot tables
grow the currency entries.

**`src/data/tiles.js`** — the two machine props (`shop: '<id>'`); `rug-round`
moves off `$`.

**`src/data/npcs.js`** — the Supply Closet Clerk (the registry is currently
empty — this is its first resident since the IT intern graduated to
`companions.js`).

**`src/shop.js`** *(new)* — the transaction rules above.

**`src/party.js`** — `createParty` seeds `cash: 0`; `serializeProgress` writes
it; `parseProgress` reads it and seeds `0` for older saves. `SAVE_VERSION` → **6**.
No `normalizeSheet` change: the purse is not sheet state (decision #11).

### PlayCanvas / DOM modules

**`src/shopping.js`** *(new)* — the merchant runtime, shaped exactly like
`looting.js`: built with host accessors (`getSheet`, `getPurse`/`addCash`,
`isInCombat`, `isGameOver`, `refreshPockets`, `onGearChange`), owning the
per-instance stock map (`"tile:x,z"` / `"npc:<id>"` → rolled rows) and the
panel's callbacks. Kept out of `looting.js` because that module is already the
second-largest DOM module in the tree and the two systems share only the
pockets refresh.

**`src/ui.js`** — `createShopPanel(ITEMS, { onBuy, onSell, onClose })`: two
columns (their stock / your pockets), a cash readout, stable ids for e2e
(`#shop`, `#shop-cash`, `#shop-buy-<i>`, `#shop-sell-<i>`, `#shop-close`).
The pockets panel gains a `#inv-cash` row beside the existing `#inv-paper` row —
same treatment, same place, so money reads as a resource like ammo.

**`src/main.js`** — three wirings, all on existing seams:
1. `dispatchHit`, kind `prop`: a def with `shop` walks you up and opens the
   shop instead of rummaging (`loot` still wins for props that only have loot).
2. `renderDialogueNode`: an option with `effect: { shop: true }` opens the
   NPC's shop, mirroring the `recruit` branch.
3. The right-click menu and the focus banner name the verb ("Buy from the Snack
   Machine") next to the existing Rummage / Talk entries.

**`src/scene.js`** — one line: a prop is interactive when it has
`def.loot || def.shop || def.ignitable || def.explosive`. Picking, hover
highlight, and the Alt overlay follow for free.

**`src/looting.js`** — `receiveItems` gains the auto-bank branch for `cash`
items (decision #3) and exports `receiveItems` so `shopping.js` can hand a
purchase into the same funnel. The Alt overlay's `lootEntries` grows a label
for shop props (icon 🥤, "Snack Machine"), clicking which walks you up and
opens it — identical to the container path.

**`src/god.js`** — `__god.setCash(n)` and a purse row on the Party card; the
`SHOPS` markup/sellRate constants join the live-editable set, which is what
makes the numbers milestone a live session rather than a rebuild loop.

**Debug surface** — `__game.cash`, `__game.shopOpen`, and
`__game.shopStockAt(x, z)` (mirroring the existing
`loot.debug.containerLootAt`), so the e2e specs can assert a sold-out machine
without reading the DOM.

### Persistence

Save **v6**. The record grows one top-level integer:
`{ version, levelId, party: [sheets], active, cash }`. `parseProgress` seeds
`cash: 0` for anything older — the purse is new state, not migrated state, so
there is no "invents state on every load" hazard of the kind `party.js` already
warns about for the v5 auto-equip. Purchased items persist because they are
ordinary inventory; **stock does not persist across floors**, which is correct:
a new floor has new machines.

## Milestones (each a PR that keeps `npm test` + e2e green)

1. **The purse.** Currency exists and does nothing yet. `party.cash`, save v6,
   the `cash` item field + the `receiveItems` auto-bank branch, the three
   currency items in the trash/desk/enemy tables, the `#inv-cash` row, and
   `__game.cash`. Playable outcome: you find money and watch a number go up.
   Deliberately shipping the resource before the sink, so the sink milestone
   is a pure UI/verb change against a proven, saved, tested number.
2. **The machine.** `data/shops.js`, `src/shop.js` (+ its unit tests), the
   `$` snack machine tile (and the `rug-round` character swap), the shop panel,
   buy-only, finite per-instance stock, the `dispatchHit`/`scene.js`/Alt-overlay
   wiring. Place one in Floor 1's break room (`k` tiles, already painted) and
   one on Floor 2. **This is the milestone the whole plan is for.**
3. **Selling & the person merchant.** `value` on every existing item,
   `SELL_RATE`, the `buys` flag, the sell column in the panel, the
   `effect: { shop: true }` dialogue branch, and the Supply Closet Clerk in
   `data/npcs.js` + a level legend. Outcome: the four flavor items become
   the reason to keep rummaging.
4. **The content pass.** Machine-exclusive consumables, cash entries across
   every loot table and enemy drop list, a machine per floor, gear in the
   clerk's stock deep enough that saving up beats spending immediately, and
   the registry lint (every `shop` id resolves, every stocked item exists and
   has a `value`, every `value` is a positive integer) alongside the existing
   levels lint.
5. **The numbers.** Prices, markups, drop rates and the sell rate, tuned in a
   live god-panel session. Same posture the equipment, hit and status plans all
   took: the knobs are data, the feel is playtest.
6. **Stretch.** *Shake It* (decision #13) as a right-click verb on a machine;
   a Savvy discount in `shop.priceOf` (decision #9); a `caffeinated` consumable
   once `STATUS_PLAN`'s registry can carry it; a companion who runs a cart
   (`shop` on a `COMPANIONS` entry — the Mail Room Veteran already has a
   `snack-cart` combat action and eleven years of corridor knowledge).

## Testing

- **Unit** (`tests/unit/shop.test.js`, new): `priceOf`/`sellYield` rounding and
  the floor-at-1 rule; `canAfford`; `rollStock` respects `chance`/`qty`;
  a purchase is atomic (cash, stock and bag move together or not at all); a
  buy with insufficient cash changes nothing; selling to a `buys: false`
  merchant is refused; an item with no `value` cannot be sold; cash never goes
  negative or fractional.
- **Unit** (`tests/unit/party.test.js` grows): v6 round-trips `cash`; a v5 save
  loads with `cash: 0` and everything else byte-identical; a legacy v1 save
  still loads (the existing invariant).
- **Unit** (`tests/unit/levels.test.js` grows): the registry lint of milestone 4
  — every `shop` id in `TILE_TYPES`/`NPCS`/`COMPANIONS` resolves in `SHOPS`;
  every stocked item id exists in `ITEMS` and carries a `value`; every map
  character is still globally unique after the `$` swap.
- **e2e** (`tests/e2e/economy.spec.js`, new): the loop, through real clicks —
  loot a fiver and watch `__game.cash` rise; click a snack machine, get walked
  up, buy a candy bar (cash falls by the marked-up price, the item is in the
  pockets, the stock row decrements); buy the last one and the row is gone;
  the panel is refused mid-combat; talk to the clerk, sell the toner cartridge,
  cash rises by the marked-down value.
- **Regression invariant:** after milestone 1, every existing spec passes
  unchanged. Cash is additive state that nothing else reads — a character who
  never finds a dollar plays exactly the game they played yesterday.

## Risks and open questions

- **The legend namespace is nearly full — this is the binding constraint, not
  a footnote.** 86 of the 95 printable characters are taken; the free set is
  `"`, `'`, `` ` ``, `{`, `|`, `}`. This plan spends up to three of them (the
  coffee machine, the clerk, and whatever `rug-round` moves to). After that the
  next content plan has three characters left in the entire game. The real fix
  is decoupling the map from single characters (multi-char cells, or a separate
  object layer beside the ASCII grid) — out of scope here, but this plan is the
  one that makes it urgent, and it should be said out loud in the milestone-4 PR.
- **Healing you can buy vs. healing you find.** A purchasable snack is a
  regeneration valve the difficulty curve has never had to account for. The
  finite per-machine stock (decision #6) is the intended brake, but if cash
  income outpaces it the fight economy softens invisibly. Watch total cash
  earned per floor against total heal value stocked per floor in the numbers
  milestone; if it drifts, cut income, not stock (a sold-out machine is a good
  story, an unaffordable one is just a locked door).
- **A shop is a wall of numbers in a game that has been about verbs.** Every
  other interaction in this game is "click the thing, the thing happens." The
  panel is the first screen that asks the player to *compare*. Keep it to two
  short columns, name the price in the button (`Buy — 8💵`), and let the Alt
  overlay label the machine so it never has to be hunted for. If it needs a
  scrollbar, the stock list is too long.
- **Gear in a shop competes with gear as a reward.** If the clerk stocks a
  letter opener, finding one in a desk is worth less. Mitigation: merchants
  stock *consumables and utility*, and only ever the low end of the gear curve.
  The identity pieces (the red stapler, the interview blazer) stay drops —
  a merchant should never sell the thing someone has been looking for since 1999.
- **`value` and item ids are now load-bearing together.** Same discipline the
  equipment plan established: item ids are as immutable as action ids, since
  shop stock lists persist nothing but ids and the lint only catches what the
  registries can see. Renaming an item silently empties a shop.
- **Editor round-trip.** Machines are ordinary tile entries, so the editor
  palette picks them up automatically (registries drive the palette) — but the
  editor still normalises unknown *actor* characters to floor, so a level with
  the Supply Closet Clerk re-exported from the editor loses him, exactly as it
  loses NPCs today. Pre-existing, worth naming in the milestone-3 PR.
- **Open: does the party keep its money on a wipe?** The run ends on a party
  wipe and the campaign save is what carries forward. Cash is party state, so
  today's answer falls out as "the save holds it." Whether a *fresh run* should
  start with a small stipend (a plausible 10💵 "last paycheck") is a design
  call the numbers milestone should make deliberately rather than inherit.
