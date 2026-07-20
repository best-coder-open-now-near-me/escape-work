# Office ⇄ RPG Parallels

A working brainstorm for deriving mechanics from office life instead of
reskinning fantasy. Kept next to ARCHITECTURE.md because the best entries here
map straight onto existing engine hooks (surfaces, tiles, actions, talents,
enemy registry).

## The litmus test

A parallel earns its place if it passes one question: **would this mechanic
make sense to someone who has worked in an office but never played an RPG?**

- "Energy drink restores HP" — a potion in a can. Fine as flavor, but it's a
  reskin. Keep these light and rare.
- "The Manager's attack doesn't hurt you, it books a meeting into your next
  turn" — derived. Nobody needs Final Fantasy to understand why that's an
  attack.

The strongest entries below all attack something an office actually attacks:
your time, your morale, your standing.

---

## 1. The three currencies (core battle-system thesis)

Fantasy RPGs have one health bar. Office life drains three different things,
and different enemies specialize:

| Resource | Fantasy analogue | What drains it | Fail state |
|---|---|---|---|
| **Time** (AP / calendar) | action economy | managers, meetings, tickets | miss the deadline → floor failed |
| **Morale** (HP) | hit points | passive-aggression, HR, crunch | breakdown → run over |
| **Standing** (political capital) | reputation | blame, being CC'd, escalations | fired → run over |

We already model Time (AP) and Morale (HP). Standing is the missing third —
it can start as a soft meter (spent to power social moves, damaged by public
failures) and doesn't need to exist on day one. But the framing matters now:
**every attack should target one of the three**, and it should be obvious
which. The Manager attacks your time. HR attacks your standing. The printer
attacks your morale.

## 2. Attack the calendar, not the body

The single most office-derived combat idea: **damage to your action economy.**

- The Manager's "quick sync" doesn't (only) deal HP damage — it **books a slot
  in your next turn**, eating 2 AP before you act. The attack IS a calendar
  invite.
- `Decline the Invite` (already in the game as Middle Manager's defend)
  generalizes into the counter for this whole attack class: decline and the AP
  is saved — but declining costs Standing. You CAN say no to the meeting.
  There's just a price. That tension is the office.
- The **Micromanager** enemy doesn't attack at all: while adjacent (hovering
  over your shoulder), every action you take costs +1 AP.
- **Mandatory Compliance Training**: an attack that consumes your entire next
  turn. You stand there clicking Next.
- **"Let's put a pin in it"**: suspend an incoming attack; it returns 2 turns
  later, larger. (Delayed damage — the unanswered email grows interest.)
- **Overtime**: player option — keep acting after AP runs out by paying HP
  per action. Staying late costs your health. Derived, not decorated.
- **Comp time**: bank unused AP into next turn. Flex hours as AP banking.
  Natural talent territory (and its inverse: the Office Drone's "hard 9-to-5
  boundary" — can't bank, but immune to forced overtime).

Engine fit: AP is already the combat spine (`combat.js`); "steal/eat AP next
turn" is one status field on the sheet.

## 3. Bureaucracy is the magic system

Spellcasting, translated honestly:

- **Casting time = approvals.** Big effects require a form to work through
  channels: submit now, effect lands in N turns. An IT ticket is a summon
  with a 1d4-turn arrival window and a chance the summon just asks if you've
  tried restarting.
- **Counterspell = "wrong form."** Legal/Compliance enemies can reject your
  submitted action on a technicality.
- **AoE = company-wide memo.** Hits everyone, INCLUDING your allies. All
  broadcast attacks should be double-edged — that's what reply-all means.
- **The Reply-All Storm**: a chain-reaction hazard. One triggered attack
  spawns two more next turn, growing until someone spends their action to
  "take it offline." An office wildfire — and it composes with the fire
  system's spread mechanics we already have.
- **Out-of-Office = counter stance.** While active, anyone who attacks you
  (emails you) gets an automatic reply — a free retaliation hit. It's
  literally an auto-responder.
- **"Take this offline"**: forcibly convert a group fight into a 1v1 — pull
  one enemy into a side room, everyone else disengages. Derived from real
  conflict de-escalation; functions as an isolate/duel mechanic no fantasy
  game has a natural excuse for.
- **Document Everything**: the combo/charge meter. Landing hits builds *paper
  trail* stacks; spend them all on **Escalate** (the HR complaint, the
  receipts) for a finisher. Counterplay exists: an enemy reaching the
  **shredder** prop destroys your stacks. Suddenly furniture is tactical.

## 4. Aggro is visibility, stealth is looking busy

Threat, translated: **how visible are you to management?**

- Walking fast **with a clipboard** = invisibility. Nobody questions it.
- Alt-tabbed to a spreadsheet at any desk = stealth while stationary.
- Headphones on = enemies won't initiate conversation (engagement) — but you
  also don't hear them coming (no approach warnings).
- Cubicle partitions are already chest-height LOS cover — this is why. The
  open-plan floor is the high-aggro zone; the maze of cubicles is the
  stealth route. Level design writes itself.
- **Tailgating**: slip through a badge door behind an enemy who has access.
  Stealth and key-gating in one office-native move.
- **The all-hands / birthday cake in the break room**: scripted events that
  pull every enemy on the floor to one room. Crowd control via sheet cake.
  (Fire drill: the chaotic version — evacuates and reshuffles everyone.)

## 5. Status effects that already exist at work

| Office reality | Mechanical effect |
|---|---|
| The office cold | contagion: spreads by adjacency between ALL actors, enemies included. Patient zero came in sick "to be a team player." |
| Caffeine crash | haste now, slow later — every coffee heal could carry this curve |
| Burnout | stacking AP-max reduction from repeated overtime |
| CC'd | marked: enemies prioritize you; being looped in can pull you into combats you weren't part of |
| PIP (Performance Improvement Plan) | countdown curse; cleansed only by "exceeding expectations" (deal X damage in Y turns) |
| Imposter syndrome | attack down |
| Called out in the all-hands | defense down, Standing damage |
| Glitter (from the party-supplies cabinet) | permanent mark — cannot be cleansed, ever, and everyone can see where you've been |
| Post-lunch slump | global slow, 2pm (see §6) |
| Back pain | wear-over-time unless you hold the Good Chair (see §8) |

## 6. The workday clock is the weather system

Combat modifiers shouldn't come from rain and fog — they come from the clock
and the thermostat:

- **9am Monday**: enemies aggressive, player AP -1 until first coffee.
- **Lunch hour**: truce window — the break room is a sanctuary tile where
  combat can't start. You and the Manager, silently microwaving side by side.
- **2pm slump**: everything slows.
- **4:55 Friday**: enemies stop pursuing beyond short range. They also want
  to leave.
- **Thermostat wars**: hot/cold zones with effects; whoever holds the
  thermostat key (loot!) sets the battlefield weather.
- The **deadline as level timer** is the endgame of this idea: some floors
  aren't "kill enemies," they're "ship the deliverable by 5pm" — enemies are
  obstacles to the real boss, which is a due date.

## 7. Enemies aren't killed — they're resolved

Office violence is (mostly) not literal. Enemy "HP" is really their
**persistence / attention on you**, and zero means they lose interest, get
satisfied ("per my last email" finally answered), or get redirected. This
opens non-fantasy win conditions:

- **Delegate an enemy away**: give them something else to do (single-target
  removal that returns later, busier and angrier).
- **Get them promoted**: expensive, removes them permanently, but their
  replacement inherits the role — the org chart refills itself.
- **The Nepotism Hire**: an enemy that CANNOT be damaged, for political
  reasons. You route around him. An invincible obstacle-enemy is a real
  tactical wrinkle, and the office is the one setting where it needs zero
  explanation.
- **The org chart is the bestiary.** Enemies exist in a reporting hierarchy;
  resolving a manager triggers a **reorg** — their reports scatter, change
  behavior, or merge under a survivor. Killing the leader has never had a
  more natural systemic consequence.
- An enemy left alone long enough **gets promoted mid-fight** (levels up).
  Ignoring problems makes them stronger.

Player defeat mirrors this: you're not killed. Worst ending isn't death —
it's **conforming**. You become one of them. (For a game called Escape Work,
assimilation is scarier than a game-over screen.)

## 8. Loot, economy, gear

- **Currency**: petty cash and **gift cards** ("$5 coffee card" as coin
  drops). Shop = the vending machine. Chest = the supply closet (locked;
  Facilities has the key). Mimic = the forgotten tupperware in the fridge.
- **Rarity tiers everyone already understands**: the bad scissors → the good
  scissors → the GOOD stapler (red, Swingline, legendary — someone will
  burn the building down over it).
- **The Good Chair**: when any actor is removed from the fight, their chair
  drops as loot. Dibs is a game mechanic now.
- **Weapons that stay derived**: rubber-band sling, binder-clip caltrops,
  whiteboard-marker throwing knives (they stain = mark the target), the
  fire extinguisher (AoE + leaves a slippery foam surface — it's a surface
  generator, engine-ready), hot coffee splash (area denial + creates the
  coffee surface we already have).
- **The rolling chair is a mount.** Sit, kick off, ram. Chair jousting down
  the long corridor. The mail cart is the siege version.
- Armor is dress code: the blazer (+Standing, "dress for the job you want"),
  the lanyard (access tiers = key ring), noise-cancelling headphones (see
  §4), rubber-soled shoes (already a talent — this is the pattern).

## 9. Consumables and crafting

- Keep the caffeine line (coffee → espresso → something neon) but give it the
  **crash curve** (§5) so it stops being a mana potion with a lid.
- **The microwave is the cauldron.** Break-room alchemy: combine snack-drawer
  ingredients. Microwaving fish produces an area-denial stench cloud that
  clears a room. This is chemical warfare and every office knows it.
- **The laminator is the forge**: laminate a document to make it permanent —
  fireproof paper ammo, un-shreddable paper-trail stacks.
- Birthday cake: party-wide morale heal, sugar-rush haste, inevitable crash.
- The potluck: random buff/debuff lottery. You don't know whose casserole
  that was.

## 10. Progression

- Leveling = **promotions**; the skill tree is the career ladder, and it
  branches exactly where careers do: **IC track vs management track** —
  deepen your own powers vs gain the ability to delegate/summon.
- The level-up screen is a **performance review**: allocate stats via
  self-evaluation ("rate yourself on Impact").
- Titles as progression flavor: the "Senior" prefix does nothing and everyone
  wants it.
- **Two Weeks' Notice** as an endgame ultimate: become untouchable — nothing
  at work can hurt you anymore — but the run ends in N turns. You'd better
  be near the exit. It's the escape the title promises.

## 11. Dungeon geography (floors we haven't used yet)

- **Server room**: cold zone (thermostat weather), loud (stealth penalty),
  badge-gated, and the one place IT Support is at full power.
- **Archives / basement**: the deep dungeon. Paper everywhere = flammable
  surface heaven + ammo economy paradise.
- **The roof smokers' spot**: rest zone / campfire. The Smoker talent already
  points here.
- **Executive floor**: final zone. Thick carpet (silent movement — for
  everyone), closed doors, an Executive Assistant gatekeeper miniboss whose
  whole fight is about whether you have an appointment.
- **Elevator vs stairs**: fast travel with a random-encounter chance (elevator
  small talk) vs slow and safe.
- **Watercooler**: rumor node — intel on enemy positions and loot ("did you
  hear Facilities lost the closet key in the break room?").

## 12. Enemy roster candidates (beyond Manager & HR)

| Enemy | Derived mechanic |
|---|---|
| The Micromanager | aura: adjacent player actions cost +1 AP |
| The Consultant | summoned by managers; buffs enemies, drains your budget (currency damage!) |
| The Auditor | inspects your inventory; confiscates "borrowed" items |
| Reply-All Guy | triggers the Reply-All Storm (§3) |
| Speakerphone Guy / Loud Chewer | annoyance auras — morale DoT in a radius, no attack needed |
| The Overachiever | "raises the bar": buffs floor objectives mid-run |
| Passive-Aggressive Note Writer | leaves glyph traps on tiles (kitchen notes) |
| The Fax Machine | the ancient lich; nobody knows why it still works |
| Sentient Printer | recurring miniboss; PC LOAD LETTER is its battle cry; already explosive |
| The Executive Assistant | gatekeeper: controls initiative, reschedules your actions |
| The CEO | final boss you can't reach: the fight is getting a meeting. He keeps rescheduling. Phases = getting on the calendar at all. |

## 13. Save / rest

- Saving is **Ctrl+S at your workstation** — the save point is a desk, and
  everyone already fears what happens when you don't save.
- Long rest = the weekend. Full reset = PTO, rare and precious. The
  cigarette/coffee heals are short rests.

## 14. The forced pile (tempting — resist)

Ideas that are reskins wearing a lanyard. Not banned, but they never lead:

- Letter opener = dagger, keyboard = club, monitor = tower shield. (Props are
  fine as furniture/loot flavor; as a *weapon system* they're just a fantasy
  loadout from the supply closet.)
- Mana as a blue bar named "Focus." If it acts like mana, it is mana. Focus
  should come out of the Time/calendar system or not exist.
- Elemental damage types with office paint (fire=stress, ice=aircon...).
  Damage types should be *social* categories: passive-aggressive (chip DoT),
  bureaucratic (delayed, unavoidable), public (hits Standing), physical
  (rare, and shocking precisely because it's an office).
- Goblins-in-ties. Every enemy must be a person or an appliance you have met.

## Priority shortlist (if we build three things next)

1. **Calendar attacks** (§2): Manager's sync eats next-turn AP; Decline the
   Invite generalizes into its counter with a cost. Smallest diff, biggest
   thesis payoff — combat immediately stops feeling like reskinned fantasy.
2. **Paper trail / Escalate** (§3): stacks-to-finisher gives combat a
   build-and-spend rhythm using the theme's strongest verb, and the shredder
   counter makes props tactical.
3. **Break-room truce + workday clock modifiers** (§6): cheap to implement
   (tile flag + global modifier), massive flavor payoff, and it makes floors
   feel like *days* instead of dungeons.
