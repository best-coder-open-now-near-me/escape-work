# Equipment Slots Plan

Loot you *wear*, not just loot you eat. Today items are pocket consumables
(`heal`/`ammo`), flavor archaeology (`examine`-only), and exactly one passive:
`bonusDmg`, where the best stapler in your pockets silently counts
(`stats.js damageBonus`). There is nothing to equip, no slots, no per-slot
stats, no trade-offs — which means the core reward loop of both BG3 and DOS2
(kill → loot → compare → equip → feel stronger) has no second half here. This
is a data-shaped add: `data/items.js` grows `slot`/`stats`, the sheet grows
`equipped`, and `stats.js` folds equipped bonuses into the derived numbers the
whole game already reads.

This document is the implementation plan: design decisions, module-by-module
changes, milestone order. No code yet. Shaped like `PROGRESSION_PLAN.md`,
honoring the `ARCHITECTURE.md` rule: **content is data, code is systems.**
After this lands, a new piece of equipment is one `ITEMS` entry plus a loot
table line.

**Sequencing note (the three combat plans):** land this **after**
`HIT_PLAN.md` (accuracy/dodge gear needs a hit roll to modify) and after
`STATUS_PLAN.md` if you want on-hit procs in the content pass (procs call its
`applyStatus`). The core of this plan (slots, dmg/soak/attr gear) has no hard
dependency on either — only the stretch content does.

## Where we are today

- **One passive, one rule.** `damageBonus(sheet)` scans the whole inventory
  for the best `bonusDmg` item — "you can only wield one stapler" is already
  equipment logic, just implicit and choiceless.
- **The sheet is ready for it.** `sheet.inventory` (ids, `INV_CAP = 10`)
  persists across floors; the derived-stats seam (`recomputeDerived`,
  PROGRESSION decision #4) means anything that changes a stat source has an
  established, audited path into `maxHp`/`maxAp`/damage/deflect.
- **The UI is ready for it.** The pockets panel (`looting.js` +
  `ui.createInventoryPanel`) already routes per-item verbs (use / examine /
  drop); loot tables and enemy drops already deliver items; the character
  sheet panel (C) already lists derived stats.
- **The reward curve needs it.** Enemies scale with depth
  (`scaleEnemy`) and the party builds with points — but loot stopped
  mattering after the red stapler. Equipment is the third leg.

## What we're building

- **A basic weapon attack, at last** (see decision #7). Today every attack is a
  *class power* — there is no plain "swing." Equipment introduces one: a
  weapon grants a basic attack whose numbers it defines (bare hands are a weak
  default), built as a **computed** `sheet.actions + equippedAction(sheet)`
  list. This is the one genuine systems addition in the plan; the rest is data
  folding through existing seams. It's also what makes a looted weapon *feel*
  like a weapon rather than a stat stick.
- **Three slots** on every sheet: `weapon`, `outfit`, `trinket` — rendered in
  the UI as **In Hand / Dress Code / Flair**. Small on purpose: one damage
  choice, one defense choice, one wildcard.
- **Equipment items** in `data/items.js`: an entry gains `slot` plus a
  `stats` block drawn from a small engine-understood vocabulary —
  `dmg`, `soak`, `maxHp`, `maxAp`, `attrBonus: { grit… }`, and (post
  HIT_PLAN) `acc`/`dodge`.
- **`sheet.equipped = { weapon, outfit, trinket }`**, folded into the derived
  numbers by `recomputeDerived`/`damageBonus`/`deflect` — the same one-seam
  pattern attributes used, so combat and the HUD pick equipment up with
  near-zero changes.
- **Equip/unequip as inventory verbs** in the pockets panel, plus an equipped
  strip; outside combat only in v1.
- **The stapler rule retires honestly**: staplers become weapons; a save/load
  migration auto-equips your best carried `bonusDmg` item so no character
  loses a point of damage.
- **A content pass**: enough weapons/outfits/trinkets across loot tables and
  enemy drops that desks stay worth rummaging on floor 3.

## Design decisions (recommended, with alternatives considered)

| # | Decision | Choice | Why / alternatives |
|---|----------|--------|--------------------|
| 1 | Slot set | **Three**: weapon / outfit / trinket | BG3's seven-slot paper doll is inventory management as a hobby; three slots keep every drop a legible either/or against exactly one incumbent. A fourth (shoes — on-theme with all the floor hazards) was seriously considered and deliberately parked: gum/slip interactions belong to talents and statuses today, and a shoes slot would immediately fight both. Revisit post-STATUS_PLAN. |
| 2 | Where equipped items live | **In the slot, out of the bag**: equipping removes the id from `sheet.inventory`; unequipping pushes it back (blocked politely when pockets are full) | Keeps `INV_CAP` meaning what it says and the pockets list honest. The alternative (a flag on an inventory index) survives `splice` badly — drop/use verbs would need equipped-index bookkeeping forever. |
| 3 | Stats fold into the derived seam | `recomputeDerived` adds equipped `maxHp`/`maxAp`/`attrBonus`; `damageBonus` swaps its best-in-bag scan for the weapon's `dmg`; `deflect` adds outfit/trinket `soak`; `accuracy`/`dodge` (HIT_PLAN) add gear `acc`/`dodge` | One seam, already audited ("never assign maxHp directly"). Readers — combat, HUD, god — change zero lines. `attrBonus` on gear flows through *every* attribute derivation automatically (a +1 Savvy mug is damage AND accuracy), which is what makes trinkets interesting for free. |
| 4 | Gear attributes are computed, not baked | Equipment `attrBonus` is applied **inside** `recomputeDerived` from the live `equipped` map — unlike class-track nodes, which bake permanently at spend | Bake-and-unbake on unequip is the classic drift bug (PROGRESSION chose baking precisely because perks are permanent; equipment isn't). Computing from the worn set makes equip/unequip trivially symmetric and save-safe. The one cost: `recomputeDerived` now reads `ITEMS` — stats.js already imports it. |
| 5 | The stapler migration | Save bumps a version; on load (and once at migration) the best carried `bonusDmg` item **auto-equips to the weapon slot**; the passive-while-carried rule is deleted | Regression-preserving: every existing character keeps exactly its current damage, now visible in a slot. Keeping both rules ("equipped counts, but carried also counts") would make the slot cosmetic. After migration a *second* stapler in the bag does nothing — which is what the old rule effectively meant anyway (only the best counted). |
| 6 | When you can swap | **Outside combat only** in v1; the equip verb is disabled mid-fight | Dodges every mid-fight rebuild question (action bar, AP cost, uses counters) for a v1 that's about the loot loop, not swap tech. DOS2 free-swaps, BG3 charges an action — an `EQUIP_AP` cost is a clean later add; noted in open questions. |
| 7 | Weapons grant a basic attack (revised) | Equipping a weapon grants a **basic "swing" attack** whose `min`/`max` come from the weapon; `stats.dmg` still layers onto every attack via `damageBonus` | **Revised after a gameplay note: the game has no universal basic attack today — every attack verb is a *class power* (Passive-Aggressive Email, Reboot, Bulk Mail…).** So "loot a weapon, swing it" has nothing to attach to, and the original plan (weapon dmg silently buffs class powers) makes weapons stat-sticks, not weapons. The fix is the stretch design promoted to core: combat/hotbar build the action list as `sheet.actions + equippedAction(sheet)` — a **computed, never-baked** basic attack the weapon defines (bare hands = a weak default "Flail Ineffectually"). This is the one real systems addition equipment needs; it composes with procs (#8) and keeps class powers as the identity layer on top. Alternative kept in reserve: no basic attack, weapons only buff class powers (simpler, but the note is exactly the reason to reject it). |
| 8 | Procs are stretch, behind STATUS_PLAN | `proc: { applies: '<status>', chance }` on weapons — resolved in `performOn` after a landed hit via `applyStatus` | The full DOS2 feel (a gum-flick stapler!) with one field — but only once statuses are a framework. Shipping procs before STATUS_PLAN would mean hand-coding per-proc effects, exactly the hole that plan fills. |
| 9 | No item levels / rarity tiers | Flat, hand-authored items; power comes from explicit stats, scarcity from loot-table chances | Rarity color economies need generated affixes to justify themselves; at this content scale hand-authored uniques ("THE red stapler") carry more character. Deeper floors get better tables, not +1 versions of the same table. |

## The data

Item fields the engine will understand (extending the existing
`heal`/`ammo`/`examine` vocabulary):

```js
// data/items.js — equipment entries. `slot`: 'weapon' | 'outfit' | 'trinket'.
// `stats` keys: dmg, soak, maxHp, maxAp, acc, dodge, attrBonus:{...}
stapler: {
  name: 'Stapler', icon: '🖇️', slot: 'weapon',
  stats: { dmg: 1 },              // replaces bonusDmg: 1
  examine: 'A desk weapon of legitimate business. +1 damage in hand.',
},
'red-stapler': {
  name: 'Red Stapler', icon: '🧷', slot: 'weapon',
  stats: { dmg: 2 },
  examine: 'THE red stapler. Someone has been looking for this since 1999.',
},
'letter-opener': {
  name: 'Letter Opener', icon: '🗡️', slot: 'weapon',
  stats: { dmg: 1, acc: 0.05 },   // precise, polite
  examine: 'Technically for envelopes. Technically.',
},
'company-fleece': {
  name: 'Company Fleece', icon: '🧥', slot: 'outfit',
  stats: { soak: 1 },
  examine: 'Embroidered logo. Surprisingly padded. Morale not included.',
},
'interview-blazer': {
  name: 'Interview Blazer', icon: '🕴️', slot: 'outfit',
  stats: { attrBonus: { composure: 2 } },
  examine: 'You feel weirdly employable in it.',
},
'laminated-lanyard': {
  name: 'Laminated Lanyard', icon: '🪪', slot: 'trinket',
  stats: { attrBonus: { hustle: 1 } },
  examine: 'ALL-ACCESS. Doors do not care. You feel faster anyway.',
},
'stress-ball': {
  name: 'Stress Ball', icon: '🟡', slot: 'trinket',
  stats: { attrBonus: { composure: 1 } },
  examine: 'Squeezed to an oblate spheroid by three generations of grief.',
},
'worlds-okayest-mug': {
  name: "World's Okayest Mug", icon: '☕', slot: 'trinket',
  stats: { maxHp: 2 },
  examine: 'Its mediocrity is load-bearing.',
},
```

(Exact stats are proposals; the balance milestone owns the numbers. The
`toner-cartridge` and `usb-stick` stay flavor — not everything is gear.)

Loot tables grow entries (`desk` gets the letter opener; a new `cabinet`
table or the existing tables get the fleece); enemy drops get identity
pieces (`executive`/`regional-executive` drop the blazer, `hr` the lanyard).

## The sheet & the math

```js
// createSheetFrom adds:
equipped: { weapon: null, outfit: null, trinket: null },   // item ids

// stats.js — new pure helpers:
equipItem(sheet, inventoryIndex)  // validates slot, swaps incumbent back to
                                  // the bag, recomputeDerived + creditNewHp
unequipItem(sheet, slot)          // back to bag if room; recompute (hp clamps)
equippedStats(sheet)              // summed stats view of the three slots
```

`recomputeDerived` becomes: base + attr (own + gear `attrBonus`) + gear
`maxHp`/`maxAp`. `damageBonus` = `bonusDmg` + Savvy term + weapon `dmg`.
`deflect` = Composure term + gear `soak`. `accuracy`/`dodge` (HIT_PLAN) + gear
`acc`/`dodge`. Equipping Grit-flavored gear credits the new HP via the
existing `creditNewHp`; unequipping clamps `hp` down via the existing
recompute rule — both behaviors already specified and tested for attributes.

## Architecture: where it lands

### Pure modules (unit-tested)

**`src/data/items.js`** — `slot`/`stats` on equipment entries; `bonusDmg`
deleted from staplers (the field's last two users). New content entries +
loot-table lines.

**`src/stats.js`** — `equipped` on the sheet; `equipItem`/`unequipItem`/
`equippedStats`; the derivation folds (decision #3). The best-in-bag scan in
`damageBonus` dies here.

**`src/party.js`** — save bumps to **v5** (STATUS_PLAN took v4);
`normalizeSheet` seeds `equipped` and runs the stapler auto-equip migration
(decision #5).

### PlayCanvas / DOM modules

**`src/looting.js`** — the equip verb: for an item with a `slot`, the pockets
panel offers **Equip** (swapping any incumbent back to the bag) instead of
Use; unequip via the equipped strip. Both disabled while `inCombat` (the
panel already receives game-state callbacks). Loot pickup unchanged — gear
arrives in the bag like anything else.

**`src/ui.js`** — `createInventoryPanel` grows an equipped strip (three
labeled slots above the grid, stable ids `#equip-slot-<slot>` for e2e);
the character sheet (C) lists equipped items beside the derived stats they
feed; HUD untouched (it reads derived numbers, which is the point).

**`src/combat.js`** — **one change**, for the basic weapon attack (decision
#7): the action bar builds from `sheet.actions + equippedAction(sheet)` (a
computed list, never baked) so the equipped weapon's swing appears alongside
the class powers, and `performOn` resolves its weapon-defined `min`/`max`.
Everything *numeric* it reads — `damageBonus`, `deflect`, `maxAp`, and (post
HIT_PLAN) `accuracy`/`dodge` — already includes gear via decision #3, so the
stat folding stays zero-change; only the new verb needs wiring. The same
computed-list seam is where `hotbar` picks the swing up out of combat.

**`src/god.js`** — the Player card shows `equipped`; `__god.equip(memberIdx,
itemId)` for testing; ITEMS stats join the live-editable set.

**Debug surface** — `__game.party[i].equipped` snapshot for e2e.

### Persistence

Save version bump; sheets serialize `equipped` (ids only — stats are always
re-derived from the registry on load, so item rebalances retroactively apply,
same rule as attributes). Migration: seed empty slots, auto-equip best
`bonusDmg` carry (decision #5). Older saves' inventories are otherwise
untouched.

## Milestones (each a PR that keeps `npm test` + e2e green)

1. **The seam, behavior-preserved.** ✅ Landed. `slot: 'weapon'` + `stats: {dmg}`
   on both staplers (their `bonusDmg` retired); `equipped: {weapon, outfit,
   trinket}` on the sheet; `equipItem`/`unequipItem`/`equippedStats`/
   `effectiveAttr` in `stats.js`; the derivation folds gear through
   `recomputeDerived` (attrBonus + maxHp/maxAp), `damageBonus` (weapon dmg,
   best-in-bag scan deleted), `deflect` (soak), and `accuracy`/`dodge`
   (acc/dodge) — all no-ops without gear, so the attribute math is unchanged.
   Save **v5**; `normalizeSheet` auto-equips the best carried weapon so a
   migrated character keeps the exact damage the old best-in-bag rule gave
   (unit-guarded). Unit 140→147; e2e 12/12 (looting + combat + save migration).
   - **Intended change (decision #5):** the "carried stapler auto-boosts" rule
     is *deleted*, not just moved — a weapon only counts **in hand**. Saved
     characters are made whole by the migration; a freshly-looted weapon does
     nothing until it's equipped, which the M2 verb enables. No UI this
     milestone.
2. **The verbs.** ✅ Landed. The pockets panel grows an **equipped strip**
   (three labeled slots, `#equip-slot-<slot>` + a `Stow` button
   `#equip-unequip-<slot>`) and an **Equip** verb on any gear row
   (`#inv-equip-<i>`); `looting.js` gates both to out-of-combat, narrates, and
   refreshes. The character sheet (C) gained an EQUIPPED section. e2e
   (`equipment.spec.js`): equip a weapon from the pockets → it lands in the
   slot and leaves the bag → stow it back; and a full-bag unstow is refused
   politely (the weapon stays, nothing vanishes). Unit 147/147; e2e 6/6
   (equipment + looting + char-sheet regressions).
3. **The basic weapon attack** ✅ Landed (promoted from stretch, decision #7,
   at a gameplay note). `equippedAction(sheet)` names the equipped weapon's
   swing action, or bare-hands `punch` when unarmed — always an id, so
   **everyone always has a basic attack** (including HR, which had no attack
   action at all). Both the combat bar (`combat.js actionIdsOf`) and the hotbar
   (`main.js offensiveActionIds`) splice it in beside the class powers; a real
   `ACTIONS` entry, so `performOn` resolves it with zero special-casing. The
   staplers grant `staple-jab`; the weapon's `stats.dmg` still folds through
   `damageBonus`, so a better stapler swings harder. Equipping rebuilds the
   bars via a new `onGearChange` host hook. Unit 148/148; e2e: the basic punch
   is always on the bar, equipping a stapler swaps it for `staple-jab`, stowing
   it reverts to punch.
4. **The content pass.** ✅ Landed. Six new pieces across all three slots: the
   `letter-opener` (weapon: dmg 1 + acc 0.05, a quick 2-AP `letter-opener-stab`
   swing), `company-fleece` (outfit: soak 1), `interview-blazer` (outfit:
   +2 Composure), `laminated-lanyard` (trinket: +1 Hustle), `stress-ball`
   (trinket: +1 Composure), and the `okayest-mug` (trinket: +2 maxHp). Placed
   in the desk loot table and on enemy bodies (Executives/Regional Execs drop
   the blazer, HR the lanyard, Managers the fleece). This is the content that
   finally exercises the M1 folds — unit tests now cover soak→deflect,
   maxHp→cap+credit, weapon acc→accuracy, and attrBonus flowing through dodge
   and deflect, plus a registry lint (every gear item's slot/stat-keys/weapon
   swing is valid). Unit 148→153; e2e adds an outfit/trinket slot test (each
   fills its own slot, the mug lifts maxHp in-game). e2e 6/6 (equipment +
   looting).
   - **Deferred to playtest (the numbers pass):** the exact stat values and
     drop chances want feel-testing, same posture as HIT's whiff and STATUS's
     fire tuning. The knobs are all data; the god panel makes it a live session.
5. **Stretch — on-hit procs + the shoes slot.** ✅ Landed. **Procs** (decision
   #8, unblocked by STATUS): a weapon may carry `proc: { applies, chance,
   appliesLog? }`; `stats.weaponProc` exposes it, and `combat.js performOn`
   rolls it after the weapon's own landed swing (pinnable via
   `__combat.forceProc`). The red stapler is the promised gum-flick stapler
   (35% to gum on a Staple Jab). **The shoes slot** (decision #1, now that
   statuses/gear can express floor traction): `EQUIP_SLOTS` gains `shoes`, a new
   `slipProof` gear stat folds through `equippedStats` and into `main.js`'s
   slip check, and Warehouse Boots (slipProof + a little dodge) drop from the
   trash. `EQUIP_SLOTS`-driven seeding means the strip, char sheet, and save
   migration pick the fourth slot up for free. Unit 153→155; e2e adds a proc
   test (pinned swing gums the Manager) and a shoes-slot equip test.
   - **Still open (lower demand):** in-combat weapon swap for an `EQUIP_AP`
     cost (decision #6), and the cross-cutting numbers/balance pass all three
     plans defer to playtest.

6. **Starting gear.** ✅ Landed. The equipment listing was furnished by loot
   only, so a freshly-picked class showed four empty slots — the system was
   invisible until you found something. Each playable class now declares a
   `startGear: { slot: itemId }` (data/classes.js), seeded by
   `stats.createSheetFrom` into the sheet's `equipped` at creation. One
   signature piece each: the Drone's grief-squeezed **stress ball**, the
   Manager's padded **company fleece**, the Mail Room's **warehouse boots** (the
   Dock Boots its own track doubles down on), IT's precise **letter opener**,
   and HR's **interview blazer** (poise you can wear). Kept deliberately
   **curve-neutral** — every piece avoids Grit/Hustle/maxHp/maxAp, so the
   headline HP/AP the class picker advertises stay *exact* (the "reproduce every
   class" invariant is untouched); the piece flavours a slot, it doesn't buff
   the sheet. `startGear` lives only on the picked-class path: migrations
   (`party.normalizeSheet`) and companions/summons reach `createSheetFrom`
   without it, so old saves and recruits are unchanged. Unit adds a
   startGear-per-class test (valid item, right slot, on-curve); no e2e change —
   every existing spec that boots a class still passes, the chosen pieces sit in
   slots the specs don't assert against.

## Testing

- **Unit** (`tests/unit/stats.test.js`): equip validates slot and swaps the
  incumbent; unequip respects `INV_CAP`; derived folds (gear `attrBonus`
  reaches maxHp AND damage AND initiative-mod paths); equip-Grit credits HP,
  unequip clamps; `equippedStats` sums; migration reproduces legacy damage
  exactly (the M1 invariant); a registry lint — every `slot` is one of the
  three, every `stats` key is in the vocabulary (the levels-lint pattern).
- **e2e** (`tests/e2e/looting.spec.js` grows): the loot→equip→number-goes-up
  loop through real clicks on `#equip-slot-*`; the in-combat gate (verb
  disabled during a fight); drop of an unequipped incumbent.
- **Regression invariant:** after milestone 1 every existing spec passes
  unchanged — the stapler in the bag hits exactly as hard as it did
  yesterday, it just has a name for where it's held.

## Risks and open questions

- **`recomputeDerived` now depends on the ITEMS registry.** Any future item
  rename breaks equipped saves silently (ids are persisted). Rule: equipment
  ids are as immutable as action ids (the `energy-drink` namesake note in
  items.js already establishes the discipline). The registry lint helps.
- **Gear `attrBonus` vs the attribute economy.** A +2 Composure blazer is two
  level-ups' worth of a stat for free. That's *intended* (loot must compete
  with progression to matter) but the content pass must price it — gear
  bonuses should cap around 1–2 points and never stack past interesting.
  Watch the god panel numbers in M3.
- **Pockets pressure.** Three slots effectively add three carried items
  outside `INV_CAP`. That's strictly more room — fine — but unequip-when-full
  needs the polite refusal path tested, since it's the one place the verbs
  can dead-end.
- **In-combat swap (open).** V1's gate is clean but DOS2 players will reach
  for mid-fight weapon swaps. `EQUIP_AP: 2` and a combat-side refresh is a
  contained add once the action-bar rebuild question (does a swap re-arm?) is
  answered. Do it on demand.
- **Editor/loot round-trip.** None — equipment rides existing loot plumbing.
  The only authoring surface is items.js + tables, which is the point.
