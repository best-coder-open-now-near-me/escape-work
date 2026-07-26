# Shadowbane: research notes, and what fits

Research notes, not a plan. Shadowbane (Wolfpack Studios, 2003) has a reputation
for holding together as a balanced system despite an enormous build space, and
the question this document answers is *which of its structural choices would
transfer to this game* — a turn-based, party-based, single-player office
dungeon crawler with six classes and four attributes.

Sources are listed at the bottom. **Caveat on sourcing:** the two best community
references (Rivkah's Notes and the Morloch emulator wiki) are blocked by this
session's egress policy, so everything below comes from search-result extracts
of those pages rather than the pages themselves. The mechanics are consistent
across multiple sources, but treat exact numbers as "reported" rather than
verified — worth re-checking against the wiki directly before any of it becomes
a constant in `stats.js`.

## What Shadowbane actually was

A PvP MMO built around player-built cities and guild siege warfare. The parts
that are irrelevant here are the parts it's most famous for: city construction,
siege engines, guild politics, a persistent world where a losing guild's city
gets razed. None of that transfers.

What transfers is its **character system**, which is where the balance
reputation comes from. The shape:

- 12 races → 4 base classes (Fighter, Healer, Mage, Rogue) → 31 profession
  promotions at level 10 → 46 disciplines layered on top.
- Build expressed as **runes**: race, base class, and profession runes, plus up
  to **8 stat/trait runes** and **3 discipline runes** (a 4th discipline slot at
  level 70). ~13 player-chosen runes, 16 counting the fixed three.
- Attributes: Strength (damage + str-weapon focus + armor focus + carry),
  Dexterity (defense + dex-weapon focus), Constitution (health + stamina),
  Intelligence (max spell damage/heal, proc damage, and a small lift to *all*
  focus skills), Spirit (mana + min spell damage/heal).
- **Focus skills** underlie every power. Powers have focus-skill prerequisites
  to unlock and to train further. Training points customize potency.
- Attack rolls: attack rating vs defense rating, **floored at 5% hit chance** —
  no amount of defense makes you unhittable.

The reputation is specifically "rock-paper-scissors that kept rotating": each
class was counterable by some other, dominant templates emerged, players found
counters, and the meta moved. Bladeweaving mage assassins gave way to
sundancing Irekei mage assassins; the Templar went from "gimplar" to
overpowered.

### The honest counterpoint

It was not uniformly balanced, and remembering it that way is survivor bias.
Min-maxers made the Confessor effectively unkillable through stat manipulation
and gear. A shield-block exploit let players solo content meant for groups and
outlast anyone in a duel; the panic nerf to shields that followed left tanks
unable to survive fights at all. The individual numbers were repeatedly wrong
and repeatedly patched.

So the thing to copy is **not Shadowbane's numbers**. It's the four structures
that bounded how wrong any single number could be:

1. Hard slot caps, so power is a choice rather than an accumulation.
2. Escalating cost past a soft cap, so dumping into one stat self-limits.
3. Mandatory immunity windows, so no effect can be chained into a lock.
4. A hit-chance floor, so no defensive stack becomes absolute.

Every one of those is a *bound* on the damage a mistuned constant can do. That
is the actual lesson.

## Where our numbers already agree

Two of Shadowbane's four bounds are already in `stats.js`, which is worth
stating before proposing changes:

- **The hit floor exists.** `HIT.CLAMP_LO = 0.35` / `CLAMP_HI = 0.95` is the
  same idea as Shadowbane's 5% floor, considerably more generous. The comment
  on `CLAMP_HI` ("a universal 1-in-20 whiff") is verbatim the Shadowbane
  reasoning.
- **Cost-on-gear has precedent.** `warehouse-boots` carries `moveCost: 1.1`
  alongside its `slipProof` and `dodge` — a real drawback on a real upside. The
  multiplying `moveCost` seam in `equippedStats` is the machinery Shadowbane's
  armor-weight rule would need.

## On our attributes

Shadowbane spread offense across separate axes: damage from Strength /
Intelligence / Spirit, *hit chance* from skill trains, defense from Dexterity.
Attack and damage were different investments. Ours aren't — Savvy buys both.

**How many things a stat feeds is the wrong measure, though.** What matters is
per-point amplitude, and by that measure ours are closer than a tally suggests.
For a level-1 Drone (all 5s, 22 HP, 6 AP), one point is worth roughly:

| Attribute | Per point, in the output it feeds |
| --- | --- |
| Grit | +2 HP on 22 → **~9% effective HP** |
| Hustle | ~+0.25 AP (~4% of the pool) and ~+1.7% dodge (~2% effective HP) |
| Savvy | ~+0.33 damage (~11%) and ~+1.7% accuracy (~2% more swings land) |
| Composure | ~+0.25 deflect (~8% off a 3-point hit), plus status resist |

All in the 6–10% band. Grit, feeding one output, is not obviously behind.

Two things do survive the amplitude lens, and they're the ones worth acting on:

- **Offense compounds, defense mostly adds.** Savvy's two effects multiply into
  a single output — more damage on a swing that also lands more often — where
  Hustle's AP and dodge feed unrelated outputs. That's an argument for moving
  accuracy off Savvy (Composure is the thematic fit: poise as steadiness of
  hand), but it's a modest effect, worth measuring before acting on.
- **`floor()` granularity is the bigger practical problem.** At
  `COMP_PER_DEFLECT = 4`, three of every four points into Composure buy
  *nothing observable* — no number on the sheet moves. Same for Grit's
  neighbours at rate 3. A level-up that visibly does nothing is worse for the
  feel of progression than any of the amplitude gaps above, and it's the thing
  a player will actually notice.

Escalating cost (below) is independent of both and still worth having.

## Candidate borrowings, best fit first

### 1. Hard slot caps on the class track

Shadowbane's core scarcity device: **more options than slots.** 46 disciplines,
3 slots. The build is defined by what you gave up.

Our `track` arrays are 3–4 nodes each, every node pure upside, no node
mutually exclusive with another. By roughly level four a class has taken its
entire track and two characters of the same class are identical. There is no
opportunity cost anywhere in the system.

The change is small and lands entirely in existing seams: widen each class's
track to 8–10 nodes and add a **cap on how many may be taken** — a check in
`nodeAvailable` alongside the prereq and pool checks it already does. Class
points then buy *which* four, not *all* of them.

A second, larger version of the same idea: a **cross-class discipline pool**
that any class can draw 2–3 picks from (Notary, Fire Marshal, Union Rep,
Facilities), separate from the class's own track. That's Shadowbane's actual
structure — profession first, then disciplines that cut across professions —
and it's where the combinatorial variety came from without needing 31 classes.
It needs a new registry, so it's the bigger lift.

### 2. Escalating cost past a soft cap

Reported Shadowbane skill training: the first 10 trains give 2% each, then 1%
each, and **above a cap set by Intelligence and the skill's primary stat a
single point costs 2 trains, then 3**. Specialization stays possible and gets
progressively expensive.

`spendAttrPoint` is flat forever: +1 for one point, at any value. Combined with
the Savvy double-dip, the optimal play is to dump everything into one
attribute, and nothing in the system pushes back.

The fix is a cost curve in `spendAttrPoint` — 1 point up to some threshold, 2
above the next, 3 above the next. It's local to one function plus a `PROGRESSION`
block entry. Note this interacts with the class track's `attrBonus` nodes, which
bypass `spendAttrPoint` entirely via `bakeNodeEffect` — track nodes granting
attributes would dodge the curve unless that's deliberate (arguably it should
be: a track node being *cheaper than buying it raw* is a fine reason to spend a
class point).

### 3. Mandatory immunity windows on crowd control

The crispest number in the game, and the one I'd take first if only one:

> When a stun or power-block lands, the target gains immunity to further stuns
> (or power-blocks respectively) **lasting three times the length of the effect**.

Also: roots prevent movement and **break on any damage**; snares are a flat
percentage movement-speed reduction; power-blocks are their own category,
locking out powers and skills but not attacks.

`STATUS_PLAN`'s registry has `statusResist` shortening sticky effects, but
nothing prevents chain-application. In a turn-based game a stun-lock is
*worse* than in an MMO — losing three consecutive turns to three applications
is a lost fight with no counterplay, and the player watches it happen. The 3×
rule is a small addition to the status registry (an immunity flag with a
duration, checked at apply time) with an outsized fairness payoff.

**Landed** — `STATUS_PLAN.md` milestone 5. A status declares
`immunity: '<id>'`; landing grants that companion status for
`IMMUNITY_WINDOW_MULT` (3) × the duration actually applied, and it blocks
re-application while live. `stunned` → `training-credit`. Only turn-denying
effects get a window; the blocked application is narrated so the player sees the
bound work.

The root/snare distinction is also already half-built: a snare is exactly the
`moveCost` multiplier, and "breaks on damage" is a clean, readable rule that
gives the player an out.

### 4. Armor weight as a real tradeoff

Reported: `(total armor weight) × 0.004 × (unarmored Dexterity) = dexterity
penalty`. Heavy armor costs the defense stat, which is why dex builds wore
light armor and why Elven heavy armor — same protection, less weight — was
worth seeking.

Our `outfit` slot is additive upside: `soak`, sometimes `maxHp`, no cost. The
best outfit is whoever's numbers are biggest, which is not a decision.

Giving outfits weight — scaling `dodge` down, or feeding `moveCost` the way
shoes already do — makes the tank/skirmisher split a genuine choice and gives
Composure-and-soak builds something to trade against Hustle-and-dodge builds.
The seam exists; `equippedStats` already multiplies `moveCost` and sums `dodge`.

### 5. Defense as a composite, and stances as multipliers

Reported Shadowbane defense:

```
((Dex × 2) + (armor defense × armor skill × .03) + (shield × shield skill × .03)
 + ((primary weapon skill + secondary weapon skill) / 2)) × (1 + stance modifier)
```

Two things stand out. First, defense draws on *five* sources — a defensive
build is assembled, not bought. Second, **stance is a multiplier on the whole
composite**, not a flat add.

That second point is directly relevant: `defend`, `stand-post`, and `firewall`
are our stance-shaped actions, and a multiplier on assembled defense scales
correctly with investment (rewarding the character who built for it) where a
flat bonus is worth relatively more to the character who didn't. Also
mechanically pleasing: dual-wield gives +5% parry chance, two-handed +10% —
weapon *class* affecting defense, not just damage.

### 6. Counter-archetypes instead of one scaling curve

The rock-paper-scissors reputation rests on counters actually existing. Ours is
PvE, so the axis isn't class-vs-class — it's **enemy archetype vs player build**.

`ENEMY_SCALING` is currently one uniform curve: HP, damage, AP, and a capped
accuracy nudge. A floor-9 Manager is a floor-1 Manager with bigger numbers, so
it tests the same build axis at every depth, and whatever build is strongest is
strongest everywhere.

Enemies that *counter specific build axes* would be the cheapest way to get
Shadowbane's rotation into a single-player game — and one such counter already
exists by accident. `deflect` is **flat subtraction** off each incoming hit,
which means many-small-hits builds are structurally punished by high-deflect
enemies while few-big-hits builds barely notice. That's a real counter axis
sitting unused in the numbers. Others fall out naturally: a high-dodge enemy
punishes accuracy-light builds; a power-blocker punishes ability-dependent IT
Support far more than the basic-attack classes; a swarm punishes single-target
kits.

### 7. Death: worn gear is safe, carried gear is not

Reported: on death a lootable grave holds everything in your *inventory*;
**equipped items can't be taken**, only carried ones. Equipment takes damage,
reduced or none at low level. Dying to a mob costs experience; dying to a
player doesn't. A "deathshroud" for several minutes blocks powers and leaves
you vulnerable.

The first rule is the good one, and `equipped` vs `inventory` are already
separate fields on the sheet. Dropping the bag but never the worn gear is a
risk lever that **cannot spiral** — you can never lose your ability to fight,
so a bad run costs loot, not the character. That property is what makes it
usable in a game with permanent party members.

### 8. Pet command modes

Reported: pets take attack / rest / stop orders, plus **assist mode** (attack
anything that attacks you or that you attack) and **standby** (attack only on
command).

`SUMMON_PLAN`'s applicants are player-controlled summons that swing from an
action bar. Assist mode is a small quality addition — a summoned applicant that
follows your target selection without needing individual orders — and standby
gives the player a reason to hold summons back rather than always swinging.

## What doesn't fit

- **City building and sieges.** No analogue, and no single-player one.
- **The combinatorics.** 12 × 31 × 46 works because tens of thousands of
  players explore the space in parallel and the meta is a social process. Six
  classes and one player can't discover a rotating meta; variety has to be
  *authored* here, which is what the counter-archetypes idea in §6 is for.
- **No-respec permanence.** Shadowbane's build commitment was load-bearing for
  its PvP economy (and it eventually added a gold-cost refiner anyway). With a
  level-up screen and party members you're attached to, permanence here is just
  a punishment for not having read a wiki first.
- **Separate mana and stamina pools.** We have one AP pool shared with
  movement, deliberately (`MOVE.COST_PER_TILE`, and the reasoning above it).
  Splitting resources would undo the movement economy that plan settled.

## If I were picking

Three, in order, on the grounds that each is a *bound* rather than a tuning
pass, and each lands in a seam that already exists:

1. **CC immunity windows (§3)** — smallest change, biggest fairness gain, and
   turn-based combat needs it more than an MMO does. ✅ Landed.
2. **Attribute granularity, then escalating cost (§2 and the attribute section
   above)** — the `floor()` rates mean most single points buy nothing
   observable, which players feel long before they feel an amplitude gap.
3. **Slot caps on the class track (§1)** — turns progression from accumulation
   into choice, and makes two characters of one class differ.

Armor weight (§4) and counter-archetypes (§6) are the next tier: both are real
improvements, both want a design pass rather than a constant.

## Sources

- [What Is Shadowbane? — MMORPG.com developer journal](https://www.mmorpg.com/developer-journals/what-is-shadowbane-2000113957)
- [Shadowbane — Wikipedia](https://en.wikipedia.org/wiki/Shadowbane)
- [Character Creation — Morloch Wiki](https://morloch.shadowbaneemulator.com/index.php/Character_Creation)
- [Character Builds — Morloch Wiki](https://morloch.shadowbaneemulator.com/index.php/Character_Builds)
- [Category:Disciplines — Morloch Wiki](https://morloch.shadowbaneemulator.com/index.php/Category:Disciplines)
- [Skill — Morloch Wiki](https://morloch.shadowbaneemulator.com/index.php/Skill)
- [Training Point — Morloch Wiki](https://morloch.shadowbaneemulator.com/index.php/Training_Point)
- [Power — Morloch Wiki](https://morloch.fandom.com/wiki/Power)
- [Hit Roll — Morloch Wiki](https://morloch.shadowbaneemulator.com/index.php?title=Hit_Roll)
- [Passive Defense — Morloch Wiki](https://morloch.shadowbaneemulator.com/index.php/Passive_Defense)
- [Formulas — Morloch Wiki](https://morloch.shadowbaneemulator.com/index.php/Formulas)
- [Crowd Control — Morloch Wiki](https://morloch.shadowbaneemulator.com/index.php/Crowd_Control)
- [Death — Morloch Wiki](https://morloch.shadowbaneemulator.com/index.php/Death)
- [Pet — Morloch Wiki](https://morloch.fandom.com/wiki/Pet)
- [Stats Overview — Rivkah's Shadowbane Notes](https://www.anybrowser.org/shadowbane/stats.html)
- [Armor Types and Dexterity Penalties — Rivkah's Shadowbane Notes](https://anybrowser.org/shadowbane/armor_weights.html)
- [Frequently Asked Questions — Rivkah's Shadowbane Notes](http://www.anybrowser.org/shadowbane/faq/)
- [Character Basic Attributes — Magic Game World](https://www.magicgameworld.com/shadowbane-character-basic-attributes/)
- [Ultimate Class? — MMORPG.com forums](https://forums.mmorpg.com/discussion/34154/ultimate-class)
- [This is the reason Shadowbane was the best game on the market — MMORPG.com forums](https://forums.mmorpg.com/discussion/256472/this-is-the-reason-shadowbane-was-the-best-game-on-the-market)
- [Templar Templates — ShadowBane Templates](https://shadowbanetemplates.weebly.com/templar-templates.html)
