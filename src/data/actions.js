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
//   buff   - the friendly-target verb (POWERS_PLAN M1). Aim at an ALLY (a
//            party member or one of your summons) within `range` with a clear
//            line, or at yourself: restores `amount` HP, clears their statuses
//            (`purge`), and/or lands `applies` on them. Rolls nothing - you do
//            not miss a colleague you are trying to help.
// Modifiers:
//   purge (on an attack) - hitting a target also wipes their status effects,
//   harmful and helpful alike; click your own tile while armed to self-cast
//   footwork - unusable while gum is stuck to the shoe (the 'gum' status)
//   cone { range, halfAngle } (on an attack) - aimed at any clicked point:
//   hits every enemy in the wedge (needs line of sight), rolls damage per
//   target. `leaves: '<tileType>'` carpets the wedge's plain floor with that
//   surface tile (Bulk Mail leaves paper - fuel, caltrops, and future ammo).
export const ACTIONS = {
  // --- Office Drone -----------------------------------------------------------
  attack: {
    type: 'attack',
    ap: 2,
    label: 'Passive-Aggressive Email',
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
    desc: 'Brace for the next hit. Incoming damage is halved until your next turn.',
    log: 'You pre-emptively deflect blame. Incoming damage halved.',
  },
  coffee: {
    type: 'heal',
    ap: 2,
    label: 'Coffee Break',
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
    desc: 'Block out the afternoon. Buys you back some action.',
    log: 'You decline their meeting invite. Incoming damage halved.',
  },
  espresso: {
    type: 'heal',
    ap: 2,
    label: 'Executive Espresso',
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
  // The reboot, aimed at a colleague instead of a target. `purge` on a `buff`
  // is a CLEANSE - the same one line of runtime, pointed at the other half of
  // the board - which is what IT Support has always been for and could never
  // do: the class whose whole identity is "have you tried turning it off and
  // on again" could power-cycle an enemy and itself, but not the teammate on
  // fire two tiles away.
  'remote-restart': {
    type: 'buff',
    ap: 2,
    label: 'Remote Restart',
    desc: 'Power-cycle a coworker from here. Clears every status they are carrying - their buffs too.',
    purge: true,
    range: 5,
    uses: 2,
    log: 'You remote in and power-cycle them.',
  },
  firewall: {
    type: 'defend',
    ap: 2,
    label: 'Blame the Firewall',
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
    desc: 'Bulk mail in a wide wedge. Carpets the floor with paper behind it.',
    min: 2,
    max: 4,
    log: 'You fan a fistful of envelopes downrange.',
  },
  'return-to-sender': {
    type: 'defend',
    ap: 2,
    label: 'Return to Sender',
    desc: 'Mark the abuse "addressee unknown". Incoming damage halved.',
    log: 'You mark the incoming abuse "addressee unknown". Damage halved.',
  },
  'snack-cart': {
    type: 'heal',
    ap: 2,
    label: 'Snack Cart Raid',
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
    desc: 'Plant yourself in the doorway. Incoming damage is halved until your next turn.',
    log: 'You plant yourself in the doorway. Nobody is getting past. Damage halved.',
  },
  'night-thermos': {
    type: 'heal',
    ap: 2,
    label: 'Night Thermos',
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
    desc: 'Technically for envelopes. Precise, if not heavy.',
    min: 2,
    max: 3,
    log: 'You stab with the letter opener. Crisp.',
    missLog: 'The opener slides off at a shallow angle.',
  },

  // --- applicants (player-controlled summons) -----------------------------------
  // A summoned applicant you control swings with this (its AI-summon twin on
  // the enemy side rolls from the class's `attacks` instead). Cheap and weak -
  // a disposable body, not a bruiser.
  'resume-slap': {
    type: 'attack',
    ap: 2,
    label: 'Résumé Slap',
    desc: 'A resume, delivered at speed.',
    min: 1,
    max: 3,
    log: 'The applicant slaps a résumé across the desk.',
    missLog: 'The applicant\'s résumé sails wide. Unqualified.',
  },

  // --- Human Resources ----------------------------------------------------------
  // HR's two friendly verbs (POWERS_PLAN M1). The class taglined itself
  // "doesn't fight so much as staff" and then shipped with Deflect Blame and
  // Coffee Break - the Office Drone's kit - so the support class supported
  // nobody but itself. These are the offensive and defensive halves of
  // actually helping someone else.
  'performance-review': {
    type: 'buff',
    ap: 2,
    label: 'Performance Review',
    desc: 'Tell a coworker in writing that they are doing great. They start connecting.',
    applies: 'commended',
    range: 5,
    uses: 2,
    log: 'You file a glowing review.',
  },
  onboarding: {
    type: 'buff',
    ap: 2,
    label: 'Onboarding',
    desc: 'Walk a coworker through the fire exits. They take less punishment, and pick up a little.',
    applies: 'onboarded',
    amount: 3,
    range: 5,
    uses: 2,
    log: 'You walk them through the fire exits and the espresso machine.',
  },
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
  'summon-applicants': {
    type: 'summon',
    ap: 4,
    archetype: 'applicant',
    count: 2,
    cap: 3,
    uses: 2,
    range: 5,
    lifetimeTurns: 6,
    label: 'Post the Role',
    desc: 'Post the req. Click where they should report - applicants fight on your side.',
    log: 'You open a req. Applicants flood in -',
  },

  // --- talent-granted -----------------------------------------------------------
  kick: {
    type: 'attack',
    ap: 2,
    label: 'Steel-Toe Kick',
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
