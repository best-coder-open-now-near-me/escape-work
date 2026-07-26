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
| 5 | Merchants are data, in two shapes, on one system | A `SHOPS` registry (`data/shops.js`). A **tile type** with `shop: '<id>'` is a machine; an **NPC/companion** with `shop: '<id>'` is a person. Both open the same panel | The two shapes already have separate approach verbs in `main.js` (`dispatchHit` kind `prop` vs. kind `npc` → dialogue), and both already walk you into reach. The shop itself doesn't care which one opened it. This is what makes "a snack machine" and "a guy in the supply closet" the same feature. | **Revised in implementation:** the person merchant is the **Mail Room Veteran**, not a new Supply Closet Clerk. The map legend had three usable characters left (#12), and a merchant who already stands on the map costs none of them - spending a third of the game's entire remaining content budget on one shopkeeper was not a trade worth making. It is also the better story: he has pushed a cart down every corridor in this building for eleven years, he already carries a `snack-cart` combat action, and when he signs on he takes the cart with him - so the party's fence becomes a member of the party. The coffee machine (a second machine selling one item) was cut for the same reason.
| 6 | Stock is finite, rolled once per instance | Per-instance stock, keyed like container loot (`"x,z"` for a machine, the npc id for a person), rolled on first visit and decremented by purchases. No restock within a run | Mirrors `containerLoot` exactly — same memory shape, same "rolled once, remembers" contract, and the player already understands it from rummaging. A machine that sells out is a reason to go looking for another one, which is the only thing that makes a *placed* merchant more interesting than a menu. Rejected: infinite stock (removes any reason to explore for a second machine, and makes healing a pure cash check). |
| 7 | Machines don't buy | `buys: false` on a machine shop; person merchants buy at `sellRate` | In-fiction and mechanically useful: it means the two merchant shapes have genuinely different roles rather than one being a worse version of the other. A snack machine is a *sink*; a clerk is a *sink and a source*. It also keeps the absurd case ("you sold your red stapler to a vending machine") out of the game. |
| 8 | Selling is at a markdown | `SELL_RATE = 0.4` (a shop-level override), floored at 1 | The universal answer to "why not just buy everything back". 40% is the genre-standard "junk is worth carrying, round-tripping is not". Exact number is a playtest knob, same posture as HIT's whiff rate. |
| 9 | No haggling in v1 | Prices are flat; **no** Savvy/Composure discount | Tempting — the attribute economy and the money economy *should* touch eventually — but a stat that shifts every price turns the balance milestone into a moving target on the same PR that first introduces prices. Deferred to the stretch milestone, where it's a one-line multiplier in `shop.priceOf` and nothing else. |
| 10 | Out of combat only | The shop verb is gated exactly like use / drop / equip | Consistency with every other pockets verb, and it dodges the "I bought a sandwich with the Manager mid-swing" question entirely. The gate already exists as a host callback (`isInCombat`); this is a reuse, not a rule. |
| 11 | Where the purse persists | **Save v6**: `cash` at the top level of the progress record, beside `levelId` / `party` / `active` | The purse is party state, and `serializeProgress(party, levelId)` is already the party-level seam. `parseProgress` returns it alongside `sheets`; older saves seed `0`. Rejected: stashing it on `party.members[0].sheet` (invents an owner, breaks the moment the leader changes or member 0 goes down). |
| 12 | The machine's map character | **`$`**, reassigning `rug-round` to `"` | The printable-ASCII legend namespace is the binding constraint on all content, and it got tighter during implementation: 86/95 used when this plan was written, 90/95 by the time it was built, leaving `"`, `'`, `\` and the player's own `@`. `$` is the one character in the set that means "money" to every human alive, and it was spent on a *round rug* that no shipped level had ever painted - so the swap was free the day it was made and would have been impossible the day after the first level painted one. |
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

## Milestones

**All six landed in one pass.** The notes record what shipped and where it
departed from the plan.

1. **The purse.** ✅ Landed. `party.cash` + `party.addCash` (clamped at zero,
   the backstop under `shop.js`'s own refusals), save **v6**, and the `cash`
   item field with its auto-bank branch in `looting.receiveItems`. Three
   currency items (`crumpled-fiver`, `petty-cash-envelope`, `coin-return`)
   ride the existing loot tables - money in the trash and the desk drawer, an
   envelope filed under M for Morale in the cabinets. The pockets grew an
   `#inv-cash` readout beside the paper ammo, and `__game.cash` exposes it.
   Playable outcome on its own: you find money and watch a number go up.
2. **The machine.** ✅ Landed. `data/shops.js`, the pure `src/shop.js`, the
   `snack-machine` tile on `$` (with `rug-round` moved to `"`), the shop panel
   (`ui.createShopPanel`), the merchant runtime (`src/shopping.js`) with
   per-instance stock, and the wiring: `dispatchHit` on a `shop` prop,
   `scene.js`'s `interactive` test, an Alt-overlay label, a right-click verb,
   and a focus-banner line that says `Sold out` when it is. One machine in
   Floor 1's left break room, one in Floor 2's.
   - **Fixed in review:** the machine first shipped at `scale: 0.5`, copied
     from the older non-kit props - the kit's models are authored for scale 1,
     so it rendered as a mini-fridge and its pick box topped out below half a
     tile. A vending machine has to read as TALL from across a break room;
     `scale: 1.0` / `height: 1.2` is what a machine looks like, and the e2e
     click that caught it now aims at the body it actually has.
3. **Selling & the person merchant.** ✅ Landed. `value` on all 20 pre-existing
   items, `SELL_RATE`, the `buys` flag, the sell column, and the
   `effect: { shop: true }` dialogue branch - which **replaces** the
   conversation rather than stacking a second modal over it. The merchant is
   the Mail Room Veteran (decision #5 as revised), reachable before recruiting
   him and after. The four flavor items - toner cartridge, mystery USB,
   performance review, HR pamphlet - stop being archaeology and become the
   reason to keep rummaging.
4. **The content pass.** ✅ Landed. Four machine consumables (`candy-bar`,
   `vending-crisps`, `stale-danish`, and the machine-exclusive
   `mystery-flavor`), cash across the trash/desk/filing-cabinet tables, and the
   registry lint: every `shop` id resolves, every stocked item exists and
   carries a `value`, every `value`/`cash` is a positive integer, and a cash
   item is *only* money (no value, no slot, no heal - it never reaches the bag,
   so anything else on it would be dead data).
   - **Caught while placing content:** the `petty-cash-envelope` was authored
     into the `filing-cabinet` loot table, and no shipped level paints a filing
     cabinet - the biggest find in the game was unreachable. Money now also
     drops from BODIES, scaled by seniority: a fiver off Managers, HR and
     Security, an envelope off Executives, Senior Managers and Regional
     Executives. The one who signs for petty cash is the one carrying it.
5. **The numbers.** ✅ First pass set, playtest pending - the same posture the
   equipment, hit and status plans took. Values are hand-authored (junk 1-12,
   gear 8-40), the machine charges `markup: 1.6`, the cart charges list and
   pays `0.45`. A unit test pins the shape rather than the values: **a round
   trip through any merchant that buys must always lose money**, asserted over
   every shipped shop and every item it stocks, so a future markup edit that
   opened an infinite-money loop fails the suite instead of the balance.
   `__god.setCash` and a Petty Cash card in the god panel make the tuning a
   live session.
6. **Stretch.** Not taken, deliberately. *Shake It* (#13), the Savvy discount
   (#9) and a `caffeinated` consumable are all still one-function adds on the
   seams this milestone built; none of them should land before the core has
   been felt in a real run, because each one bends the price curve the numbers
   pass has not yet validated.

## Testing

Shipped: **unit 212 -> 236** (`npm test`), **e2e +4** (all green), plus the
full existing e2e suite re-run for regressions.

- **Unit** (`tests/unit/shop.test.js`, 17 tests): price rounding and the
  floor-at-1 rule in both directions; `rollStock` respecting `chance`/`qty`;
  and above all **atomicity** - an unaffordable buy and a refused sale each
  assert that cash, stock and bag are all *exactly* as they were. Plus two
  content invariants that outlive the current numbers: no merchant round trip
  can profit, and cash stays a non-negative integer across a 30-step
  buy/sell loop.
- **Unit** (`tests/unit/party.test.js`, +7): the purse is party state and
  survives a leader switch; v6 round-trips it; a pre-v6 save loads with 0 and
  is otherwise byte-identical; a corrupted `cash` (`null`, `'lots'`, `NaN`,
  negative, fractional) reads as 0 or floors rather than poisoning the
  arithmetic.
- **Unit** (`tests/unit/levels.test.js`, extended): the merchant registry lint
  described in milestone 4, alongside the existing char-uniqueness check that
  now also covers `$`.
- **e2e** (`tests/e2e/economy.spec.js`, 4 tests): a dropped fiver picked up
  through a real ground click banks itself and leaves the bag empty; a real
  click on the machine's body opens it, and buying moves cash, stock and
  pockets together; an emptied machine says SOLD OUT and still labels itself
  spent in the Alt overlay; and on Floor 2 the Veteran's
  dialogue opens the cart, closes the conversation, and buys a toner cartridge
  at exactly the marked-down price.
  - **On draining the machine:** that test buys nothing. It used to clear the
    stock with a real click per item, which cost the entire 300s test budget on
    CI - ~9 purchases, each rebuilding the panel under software GL - to
    re-prove coverage that already exists twice: the UI buy path is the test
    before it, and `shop.test.js` pins "buying the last one empties the row,
    and the row refuses after" with real atomicity assertions. The e2e's job is
    the STATE a cleaned-out machine presents, so it drains in one step
    (`__god.emptyShop`, a god-mode mutator in its own right) and asserts that.
- **Regression:** the full e2e suite re-run unchanged. Cash is additive state
  nothing else reads - a character who never finds a dollar plays exactly the
  game they played yesterday.
- **Caught by an existing lint, worth recording:** the first cut of the
  Veteran's trade options had no `next`, and `party.test.js`'s "every option
  leads somewhere" check failed them. It was right to: a shop option *does*
  end the conversation, and `next: null` is how this codebase says so.

## Risks and open questions

- **The legend namespace is now FULL, and this is the binding constraint on
  all future content.** 92 of the 94 printable non-space characters are taken.
  What remains is the player's own `@` and a single backslash, which has to be
  escaped inside a level's JSON map rows - so in practice, nothing. This plan
  spent one character (`$`), displaced one (`rug-round` to `"`), and
  deliberately declined to spend two more (decision #5). **There is no next
  one.** A content pass that wants a prop must retire a tile type or decouple
  the map from single characters first: multi-char cells, or an object layer
  beside the ASCII grid. Both notes in `data/tiles.js` now say so at the point
  someone would reach for a character, along with the allocation rule this plan
  followed - give the JSON-awkward characters to props nothing paints.
- **Healing you can buy vs. healing you find.** A purchasable snack is a
  regeneration valve the difficulty curve has never had to account for. Finite
  per-machine stock is the intended brake. Watch cash earned per floor against
  heal value stocked per floor in the numbers pass; if it drifts, **cut income,
  not stock** - a sold-out machine is a good story, an unaffordable one is just
  a locked door.
- **Gear in a shop competes with gear as a reward.** The cart stocks the low
  end (fleece, runners, letter opener) and never the identity pieces. A
  merchant should never sell the thing someone has been looking for since 1999.
- **`value` and item ids are load-bearing together.** Same discipline the
  equipment plan established: item ids are as immutable as action ids, since
  shop stock lists persist nothing but ids. Renaming an item silently empties a
  shop; the lint catches only what the registries can see.
- **Stock does not persist across floors, by design** - a new floor has new
  machines. But it also does not persist across a *reload* on the same floor,
  which is a mild exploit: quitting and resuming re-rolls a machine you had
  emptied. Fixing it means putting instance stock in the save, which is real
  state for a small gain; noted rather than done.
- **Open: should a fresh run start with a stipend?** Cash is party state and
  the save carries it, so a continued run keeps its money. Whether a *new* run
  should open with a plausible 10💵 last paycheck is a design call the numbers
  pass should make deliberately rather than inherit from "the field defaults to
  zero".
