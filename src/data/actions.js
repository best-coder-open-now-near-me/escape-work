// Combat action registry. Buttons in the combat panel are generated from the
// player's action list (from their class; later modified by weapons/items).
// The id doubles as the DOM id suffix (#act-<id>), so keep ids stable.
//
// Types the combat runner understands:
//   attack - rolls min..max (+ the character sheet's bonusDmg)
//
// AP NOTE (MOVEMENT_PLAN M5): attacks cost 2, not 3. Against a 5-7 AP pool
// that gives a turn THREE beats instead of two, which is what lets movement
// sit between actions instead of replacing one. Costs are deliberately coarse
// - 2 for most things - so the arithmetic stays readable mid-fight.
//   defend - halves the next incoming hit
//   heal   - restores `amount` HP, limited to `uses` per fight
//   summon - conjures `count` allies of `archetype` (a class id) on your side,
//            up to a live `cap`; instant, `uses` per fight. Each one serves
//            `lifetimeTurns` of its own turns and then files out (SUMMON_PLAN)
// Modifiers:
//   purge (on an attack) - hitting a target also wipes their status effects,
//   harmful and helpful alike; click your own tile while armed to self-cast
//   footwork - unusable while gum is stuck to the shoe (the 'gum' status)
//   cone { range, halfAngle } (on an attack) - aimed at any clicked point:
//   hits every enemy in the wedge (needs line of sight), rolls damage per
//   target. `leaves: '<tileType>'` carpets the wedge's plain floor with that
//   surface tile (Bulk Mail leaves paper - fuel, caltrops, and future ammo).
//   range (on an attack) - fired from `range` tiles away (Chebyshev) instead
//   of walked into reach: needs a clear line, refuses past it, and never walks
//   you in. `ammoCost` is now only a COST - an attack can be ranged and free
//   (the staple gun), or cost ammo and be ranged (the paper throws, which
//   default to THROW_RANGE without declaring one). See stats.rangeOf.
//   ammoCost - sheets of paper the attack spends from `sheet.paper`.
//
// `icon` is the face the power wears on the hotbar, which is an icon grid: one
// emoji, the same way items and loot labels are iconed. It is not decoration.
// The bar carries a whole kit now, and spelled out in words a full row grew
// wide enough to sit under the bottom-left HUD rail - which made the leftmost
// slots literally unclickable - and to slide beneath the narrator box. An icon
// row fits between them with the label in the tooltip. A new action without one
// renders as ❔, which is a visible bug rather than a blank button.
export const ACTIONS = {
  // --- Office Drone -----------------------------------------------------------
  attack: {
    type: 'attack',
    ap: 2,
    label: 'Passive-Aggressive Email',
    icon: '✉️',
    desc: 'Your basic swing. No frills, no cost beyond the AP.',
    min: 3,
    max: 5,
    log: 'You send a passive-aggressive email.',
    missLog: 'Your passive-aggressive email lands in their spam folder.',
  },
  defend: {
    type: 'defend',
    ap: 2,
    label: 'Deflect Blame',
    icon: '🛡️',
    desc: 'Brace for the next hit. Incoming damage is halved until your next turn.',
    log: 'You pre-emptively deflect blame. Incoming damage halved.',
  },
  coffee: {
    type: 'heal',
    ap: 2,
    label: 'Coffee Break',
    icon: '☕',
    desc: 'A cup of the break-room worst. Small heal, always available.',
    amount: 6,
    uses: 3,
    log: 'You chug lukewarm coffee. +6 HP.',
  },

  // --- Middle Manager ---------------------------------------------------------
  delegate: {
    type: 'attack',
    ap: 2,
    label: 'Delegate Ruthlessly',
    icon: '📤',
    desc: 'Make it someone else\'s problem. Hits hard for a manager.',
    min: 2,
    max: 4,
    log: 'You delegate the problem back to them.',
    missLog: 'They delegate it right back. Nothing lands.',
  },
  'own-calendar': {
    type: 'defend',
    ap: 2,
    label: 'Decline the Invite',
    icon: '📅',
    desc: 'Block out the afternoon. Buys you back some action.',
    log: 'You decline their meeting invite. Incoming damage halved.',
  },
  espresso: {
    type: 'heal',
    ap: 2,
    label: 'Executive Espresso',
    icon: '⚡',
    desc: 'A double shot. Bigger lift than drip coffee.',
    amount: 8,
    uses: 2,
    log: 'You down a double espresso from the good machine. +8 HP.',
  },

  // --- IT Support ---------------------------------------------------------------
  reboot: {
    type: 'attack',
    ap: 2,
    label: 'Turn It Off And On Again',
    icon: '🔌',
    desc: 'Turn yourself off and on again. Clears EVERY status - your buffs too.',
    min: 4,
    max: 7,
    // purge: a reboot wipes the target's status effects - helpful AND harmful
    // alike (a surprised enemy wakes up; rebooting YOURSELF clears paper-cut
    // bleeding but also drops your Deflect). Click your own tile while it's
    // armed to self-cast.
    purge: true,
    log: 'You power-cycle their whole workflow.',
    missLog: 'The reboot hangs on a spinning beach ball. Nothing happens.',
  },
  firewall: {
    type: 'defend',
    ap: 2,
    label: 'Blame the Firewall',
    icon: '🧱',
    // Says what it DOES: a defend action halves incoming damage until your
    // next turn. It used to promise "blocks the lane behind it" - a
    // lane-blocking mechanic that has never existed in the code, so the only
    // thing the line ever did was make a working ability look broken.
    desc: 'Drop a barrier of policy. Halves incoming damage until your next turn.',
    log: '"That\'s a firewall issue." Incoming damage halved.',
  },
  // NB: there is also an `energy-drink` ITEM (data/items.js) - a lootable
  // consumable. They are distinct ids in separate registries and never share a
  // lookup, so the namesake is harmless; do NOT rename either (both action ids
  // in sheet.actions and item ids in sheet.inventory are persisted in saves).
  'energy-drink': {
    type: 'heal',
    ap: 2,
    label: 'Energy Drink',
    icon: '🥤',
    desc: 'Warm, neon, and technically legal. Solid self-heal.',
    amount: 4,
    uses: 4,
    log: 'You crack open something neon. +4 HP.',
  },

  // --- Mail Room ----------------------------------------------------------------
  'mail-cone': {
    type: 'attack',
    ap: 2,
    cone: { range: 4, halfAngle: 35 },
    leaves: 'paper',
    // The drifts are litter, not terrain - they clear this many rounds later
    // (main.js ageTempSurfaces), so a cone cannot permanently repaint a room
    // or leave a renewable ammo pile behind it.
    leavesTurns: 4,
    label: 'Bulk Mail',
    icon: '📬',
    desc: 'Bulk mail in a wide wedge. Carpets the floor with paper behind it.',
    min: 2,
    max: 4,
    log: 'You fan a fistful of envelopes downrange.',
  },
  'return-to-sender': {
    type: 'defend',
    ap: 2,
    label: 'Return to Sender',
    icon: '↩️',
    desc: 'Mark the abuse "addressee unknown". Incoming damage halved.',
    log: 'You mark the incoming abuse "addressee unknown". Damage halved.',
  },
  'snack-cart': {
    type: 'heal',
    ap: 2,
    label: 'Snack Cart Raid',
    icon: '🛒',
    // 5 HP over 3 raids: a shade under the Office Drone's coffee (6), which the
    // registry itself calls a "small heal". It read "Strong heal" while healing
    // less than the heal it was being compared against.
    desc: 'Liberate a pastry. Steady heal, limited raids per fight.',
    amount: 5,
    uses: 3,
    log: 'You liberate a pastry from the cart. +5 HP.',
  },

  // --- Security -------------------------------------------------------------------
  detain: {
    type: 'attack',
    ap: 3,
    label: 'Detain',
    icon: '🔒',
    desc: 'Write them up on the spot. Solid damage, and they lose their next turn to the paperwork.',
    min: 3,
    max: 5,
    uses: 2, // an incident report is a big enough hammer to ration it
    applies: 'stunned',
    appliesLog: 'They are detained for a statement - they lose a turn to it.',
    log: 'You open an incident report. Name, badge number, time of entry.',
    missLog: 'They produce a lanyard from somewhere. It even scans.',
  },
  'stand-post': {
    type: 'defend',
    ap: 2,
    label: 'Stand Post',
    icon: '🚧',
    desc: 'Plant yourself in the doorway. Incoming damage is halved until your next turn.',
    log: 'You plant yourself in the doorway. Nobody is getting past. Damage halved.',
  },
  'night-thermos': {
    type: 'heal',
    ap: 2,
    label: 'Night Thermos',
    icon: '🍶',
    desc: 'The thermos that has seen every 3am on this floor. Steady heal.',
    amount: 5,
    uses: 3,
    log: 'You pour from the thermos. It is still, somehow, hot. +5 HP.',
  },

  // --- universal ----------------------------------------------------------------
  shove: {
    type: 'shove',
    ap: 2,
    label: 'Shove',
    icon: '👐',
    desc: 'Two-handed push. Into a wall it stuns; into a hazard, it hurts.',
    log: 'You shove them.',
  },

  // --- basic weapon attack (EQUIPMENT_PLAN) -------------------------------------
  // Everyone always has a basic swing, resolved from the equipped weapon
  // (stats.equippedAction): a weapon names its own attack action; bare hands
  // fall back to 'punch'. It sits on the bar alongside the class powers, and
  // scales with the weapon's `stats.dmg` (folded through damageBonus). This is
  // also the only attack a non-attacking class (HR) gets.
  punch: {
    type: 'attack',
    ap: 2,
    label: 'Throw a Punch',
    icon: '👊',
    desc: 'Bare hands. Everyone always has this.',
    min: 1,
    max: 2,
    log: 'You throw a punch. Unarmed, unafraid, underwhelming.',
    missLog: 'Your fist finds only stale air.',
  },
  'staple-jab': {
    type: 'attack',
    ap: 2,
    label: 'Staple Jab',
    icon: '📎',
    desc: 'The stapler, used as intended by nobody.',
    min: 2,
    max: 4,
    log: 'You jab with the stapler. Ka-chunk.',
    missLog: 'The stapler jams. Naturally.',
  },
  'grabber-swipe': {
    type: 'attack',
    ap: 2,
    label: 'Grabber Swipe',
    icon: '🦾',
    desc: 'Swipe at arm\'s length plus a metre. Reaches further than it hurts.',
    min: 1,
    max: 3,
    log: 'You swipe with the extender. It telescopes alarmingly.',
    missLog: 'The extender flexes, and the pincer closes on air.',
  },
  'letter-opener-stab': {
    type: 'attack',
    ap: 2, // no longer the cheap one now every attack is 2 - its edge is accuracy
    label: 'Letter Opener Stab',
    icon: '🗡️',
    desc: 'Technically for envelopes. Precise, if not heavy.',
    min: 2,
    max: 3,
    log: 'You stab with the letter opener. Crisp.',
    missLog: 'The opener slides off at a shallow angle.',
  },

  // --- ranged weapons -----------------------------------------------------------
  // The first attacks that are fired rather than swung and cost NOTHING to
  // fire. Every previous ranged option was a paper throw billed against
  // `sheet.paper`; these are weapons, and a weapon you have to feed is a
  // weapon you stop carrying. Ammo stays where it earns its keep - the wad and
  // the airplane, which are specialty shots, not a basic attack.
  //
  // What they pay instead is DAMAGE, and only damage. A staple gun rolls 1-3
  // where the stapler in the same hand jabs 2-4 with +1 on top, so the melee
  // kit stays the one that ends a fight and the ranged kit is the one that
  // opens it. There is deliberately no penalty for firing point-blank: an
  // adjacency rule is a second thing to learn, and the damage gap is already
  // the whole argument for closing the distance.
  'staple-gun-fire': {
    type: 'attack',
    ap: 2,
    range: 4,
    label: 'Staple Gun',
    icon: '📌',
    desc: 'Fires staples across the room. Hits softer than a stapler swung in anger.',
    min: 1,
    max: 3,
    log: 'You fire the staple gun. Ka-chunk, from over here.',
    missLog: 'A staple pings off a filing cabinet.',
  },
  // The longest reach in the game and the weakest hit in it: the straw is for
  // starting a fight from across the floor, or chipping the last point off
  // something you would rather not walk up to.
  'spitball-shot': {
    type: 'attack',
    ap: 2,
    range: 6,
    label: 'Spitball',
    icon: '🥤',
    desc: 'A spitball, across the whole floor. Costs nothing, achieves nearly as much.',
    min: 1,
    max: 2,
    log: 'You put a spitball on the back of their neck. They turn around slowly.',
    missLog: 'The spitball arcs wide and sticks to a monitor.',
  },

  // --- applicants (player-controlled summons) -----------------------------------
  // A summoned applicant you control swings with this (its AI-summon twin on
  // the enemy side rolls from the class's `attacks` instead). Cheap and weak -
  // a disposable body, not a bruiser.
  'resume-slap': {
    type: 'attack',
    ap: 2,
    label: 'Résumé Slap',
    icon: '📋',
    desc: 'A resume, delivered at speed.',
    min: 1,
    max: 3,
    log: 'The applicant slaps a résumé across the desk.',
    missLog: 'The applicant\'s résumé sails wide. Unqualified.',
  },

  // --- Human Resources ----------------------------------------------------------
  // The HR class's power (SUMMON_PLAN.md): post the role and applicants report
  // for duty on your side. `archetype` is the unit (the applicant class),
  // `count` how many per post, `cap` how many may be live at once, `uses` how
  // many posts per fight, `lifetimeTurns` how many turns each one gets before
  // the contract runs out and it walks (in combat that is its own initiative
  // turns; out of combat the world clock spends them). TARGETED: arm it, then click where they should
  // report - `range` is how far from the summoner that spot may be (needs line
  // of sight, like a throw). They land on the clicked tile and the free tiles
  // ringing outward from it. An enemy `summon` descriptor carries no `range`
  // and drops its reinforcements beside the summoner instead.
  //
  // ONE per post. It shipped at two, and a posting that drops a pair reads as a
  // batch rather than a hire: you point at a spot and two bodies appear, one of
  // them on a tile you didn't choose. `count` stays the knob - the placement
  // path fills a ring outward from the click for any count, so a talent (or a
  // second-tier req) that posts three is a data change and nothing else. What
  // is deliberately NOT flexible is the click: one placement resolves one post,
  // however many report to it.
  'summon-applicants': {
    type: 'summon',
    ap: 4,
    archetype: 'applicant',
    count: 1,
    cap: 3,
    uses: 2,
    range: 5,
    lifetimeTurns: 6,
    label: 'Post the Role',
    icon: '📢',
    desc: 'Post the req. Click where they should report - the applicant fights on your side.',
    log: 'You open a req.',
  },

  // --- talent-granted -----------------------------------------------------------
  kick: {
    type: 'attack',
    ap: 2,
    label: 'Steel-Toe Kick',
    icon: '🥾',
    desc: 'Steel-toe boot. Needs footing - gum on your shoe prevents it.',
    min: 2,
    max: 4,
    footwork: true, // disabled while gum is on the shoe
    log: 'You deliver OSHA-approved footwear at speed.',
    missLog: 'The steel toe whistles past. A near miss, OSHA-wise.',
  },
  cigarette: {
    type: 'heal',
    ap: 2,
    label: 'Smoke Break',
    icon: '🚬',
    desc: 'A smoke break steadies the nerves. Heals and calms.',
    amount: 3,
    uses: 2,
    log: 'You step "outside" without going anywhere. Nerves steadied. +3 HP.',
  },

  // --- thrown weapons (any class; consume paper ammo picked up from paper
  // spills; see sheet.paper) -----------------------------------------------------
  'paper-ball': {
    type: 'attack',
    ap: 2,
    ammoCost: 1,
    label: 'Paper Ball',
    icon: '📄',
    desc: 'A crumpled wad, thrown. Cheap ranged chip damage.',
    min: 2,
    max: 4,
    log: 'You wad up a TPS report and bean them.',
    missLog: 'The wad sails past their ear and into a cubicle.',
  },
  'paper-airplane': {
    type: 'attack',
    ap: 2,
    ammoCost: 2,
    label: 'Paper Airplane',
    icon: '✈️',
    desc: 'A folded dart to the eyes - blinds them. Origami Specialists only.',
    // Gated on a talent effect (combat.throwablesFor): folding a dart that
    // lands in an eye is a craft. The Drone's Origami Specialist talent
    // already advertises it ("airplanes fold for 1 sheet").
    needsTalent: 'foldsAirplanes',
    min: 4,
    max: 6,
    // A dart to the eyes: the target is blinded (accMod), aiming worse until it
    // wears off - the player-action `applies` vector (STATUS_PLAN M4).
    applies: 'blinded',
    appliesLog: 'Right in the eyes - they can\'t see straight.',
    log: 'You fold a dart and send it. Right in the lanyard.',
    missLog: 'The dart banks left and augers into a monitor.',
  },
};

// How a posting's arrivals are announced. One line, shared by the in-combat
// posting (combat.js placeSummon) and the out-of-combat one (main.js
// postSummonAt): the same event said two ways reads as two different events,
// and "1 reports for duty" is how you get a number where a person should be.
export const arrivalLine = (n) => (n === 1
  ? 'One applicant reports for duty.'
  : `${n} applicants report for duty.`);
