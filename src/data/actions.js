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
//   control- the no-damage verb (POWERS_PLAN M2). Aim at an ENEMY and land
//            `applies` on them and/or push them `displace` tiles. It ROLLS TO
//            HIT like any attack (a guaranteed stun at 2 AP is the degenerate
//            case) but deals no damage - a power that stuns AND hits is two
//            powers, and the AP economy cannot price both. Touch-range by
//            default (a click walks you in, like a melee swing); `range` makes
//            it thrown, `cone` makes it a wedge.
//   stance - a posture held until your NEXT TURN (POWERS_PLAN M5).
//            `mode: 'watch'` covers `radius` tiles: the first enemy to move
//            within it takes a free swing, paid for out of the same
//            once-per-round REACTION budget opportunity attacks spend - so the
//            two can never stack into two free swings on one mover, and
//            holding a stance is a real cost rather than a free extra. Firing
//            SPENDS the stance; it does not re-arm when the budget refills.
//   mobility- repositioning the AP economy cannot buy (POWERS_PLAN M4).
//            `mode: 'dash'` carries you `distance` tile-lengths toward a
//            clicked point for a FLAT `ap` (terrain's `slow` does not tax it -
//            a dash that got shorter through coffee would be a walk with extra
//            steps). `mode: 'swap'` trades places with a teammate within
//            `range`. Neither provokes an opportunity attack: they skip
//            beginMove, so notifyStep has no record to punish - the same seam
//            forced movement already uses.
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
  // The Drone's track zone (POWERS_PLAN M3), replacing a grant of `kick` that
  // the Mail Room and Security also handed out. Paper is the most useful
  // surface in the game to be able to PLACE: it is fuel for anything burning,
  // it cuts bare feet, and it is the ammo the Drone's own throws run on.
  'paper-storm': {
    type: 'zone',
    ap: 2,
    label: 'Paper Storm',
    icon: '🗞️',
    desc: 'Empty the recycling over an area. Fuel, caltrops, and a fire waiting to happen.',
    leaves: 'paper',
    // Litter, not terrain - the same rule Bulk Mail follows. Without this the
    // drifts were never handed to the ager at all (leaveSurface only registers
    // a tile when turns > 0), so every cast permanently repainted ~9 tiles of
    // floor with something that cuts anyone crossing it, for the rest of the
    // level. Longer than the cone's because a zone is the slower, aimed verb.
    leavesTurns: 6,
    radius: 1.5,
    range: 5,
    uses: 2,
    log: 'You upend the recycling.',
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
  // The Manager's primary verb is CONTROL (POWERS_PLAN M2): he does not out-hit
  // anybody, he takes their turn away. Delegate used to be a 2-4 damage swing -
  // the Office Drone's attack with a worse spread and a better name - which is
  // what made the tankiest class in the game read as a slower Drone.
  delegate: {
    type: 'control',
    ap: 2,
    label: 'Delegate Ruthlessly',
    icon: '📤',
    desc: 'Make it someone else\'s problem. They spend their next turn on it instead of on you.',
    // `stunned`, not a new status: turn denial is turn denial, and reusing it
    // means Delegate inherits the anti-chain immunity window for free rather
    // than becoming a second, parallel way to lock somebody out of a fight.
    applies: 'stunned',
    appliesLog: 'It is their problem now - they lose the turn to it.',
    uses: 2, // turn denial is the strongest thing in the game; ration it
    log: 'You delegate the problem back to them.',
    missLog: 'They delegate it right back. Nothing lands.',
  },
  // One of the two `defend` entries left standing, and deliberately so
  // (POWERS_PLAN M8). There used to be FIVE - Deflect Blame, Blame the
  // Firewall, Return to Sender, Own Calendar and Stand Post - which is what
  // made five of six classes read as the same character: whatever else a kit
  // had, its middle button was always "halve the next hit". Three of them
  // became their class's actual identity (a mobility, a stance, a control) and
  // Blame the Firewall was deleted outright once nothing referenced it.
  //
  // These two stay because the Manager's primary (control) is RATIONED at two
  // uses, so he needs something to spend a turn on afterwards, and because two
  // entries sharing a type with different flavour is content - the problem was
  // never a duplicated data row, it was five classes with no other idea.
  'own-calendar': {
    type: 'defend',
    ap: 2,
    label: 'Decline the Invite',
    icon: '📅',
    desc: 'Block out the afternoon. Buys you back some action.',
    log: 'You decline their meeting invite. Incoming damage halved.',
  },
  // The Manager's track control: a cone that roots (POWERS_PLAN M2). His track
  // granted only passive talents, so levelling a Manager never changed what he
  // could DO. A room-wide root is the class fantasy stated plainly.
  'all-hands': {
    type: 'control',
    ap: 3,
    label: 'All-Hands',
    icon: '📣',
    desc: 'Call the room into a meeting. Everyone in the wedge is held where they stand.',
    cone: { range: 4, halfAngle: 40 },
    applies: 'detained',
    appliesLog: 'Attendance is mandatory.',
    uses: 1,
    log: 'You call an all-hands.',
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
    type: 'purge',
    ap: 2,
    label: 'Turn It Off And On Again',
    icon: '🔌',
    desc: 'Power-cycle anyone - yourself, a coworker, a colleague. Clears EVERY status they are carrying, the good ones too.',
    // purge: a reboot wipes the target's status effects - helpful AND harmful
    // alike (a surprised enemy wakes up; rebooting YOURSELF clears paper-cut
    // bleeding but also drops your Deflect). Click your own tile while it's
    // armed to self-cast.
    purge: true,
    log: 'You power-cycle their whole workflow.',
    missLog: 'The reboot hangs on a spinning beach ball. Nothing happens.',
    // No dice, on purpose: a reboot strips state, it does not bruise anybody.
    // performOn reads the absence of `min`/`max` as "this is a pure effect".
    // It used to carry 4-7 damage, which contradicted its own description.
  },
  // IT's track charm (TODO Phase 8). The verb the retired Remote Restart was
  // always reaching for: "remote in and power-cycle them" reads as taking
  // control, not as a cleanse. Enemies only - a purge already covers your own
  // side, and charming a colleague would be a different, darker game.
  //
  // A CONTROL, so it rolls to hit and carries no damage dice: three turns of
  // somebody else's body is the strongest thing in the game, and a guaranteed
  // one at 2 AP is exactly the degenerate case that rule exists to prevent.
  'remote-session': {
    type: 'control',
    ap: 3,
    label: 'Remote Session',
    icon: '🖥️',
    desc: 'Remote into a coworker and drive them yourself for a few turns. They fight their own side while you do.',
    applies: 'charmed',
    appliesLog: 'You are in. {name} is yours for a moment.',
    range: 4,
    uses: 1,
    log: 'You open a remote session.',
    missLog: 'The connection times out.',
  },
  // IT's track control (POWERS_PLAN M2), replacing a grant of the Middle
  // Manager's `cigarette` - a track that handed one class another class's
  // talent action was converging the roster, not separating it.
  'percussive-maintenance': {
    type: 'control',
    ap: 2,
    label: 'Percussive Maintenance',
    icon: '🔨',
    desc: 'Hit it until it works. Hit them until they do not. They lose their next turn.',
    applies: 'stunned',
    appliesLog: 'They reboot, briefly and involuntarily.',
    uses: 2,
    log: 'You apply percussive maintenance.',
    missLog: 'You miss, and hit the desk. The desk works fine now.',
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
  // The Mail Room's primary verb is MOBILITY (POWERS_PLAN M4): the class
  // taglined "knows every corridor" carried Return to Sender, which was the
  // fourth `type: 'defend'` in the game - Deflect Blame with different words -
  // and nothing at all that crossed a floor. This is the corridor knowledge as
  // a button.
  'courier-route': {
    type: 'mobility',
    mode: 'dash',
    ap: 2,
    icon: '↩️',
    label: 'Courier Route',
    distance: 5,
    desc: 'You know a shortcut. Cross the floor for a flat fee, and nobody gets a swing at you on the way.',
    log: 'You take the route only the mail room knows.',
  },
  // The Mail Room track's own mobility, replacing a `kick` the Drone and
  // Security also granted.
  'courier-swap': {
    type: 'mobility',
    mode: 'swap',
    ap: 2,
    label: 'Hand-Off',
    icon: '🔄',
    range: 6,
    uses: 2,
    desc: 'Trade places with a teammate anywhere in sight. Pull the wounded out; put yourself in.',
    log: 'You execute a hand-off.',
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
  // Detain is now a ROOT, not a stun (POWERS_PLAN M2). It is the difference
  // between Security and the Manager: the Manager takes your turn, Security
  // takes your GROUND. A detained coworker keeps their turn and everything on
  // their bar - they simply cannot walk away from the guard, which is what
  // holds a thrower in your reach and stops a wounded manager retreating.
  // It also stops being a third copy of "attack that stuns": Detain, the
  // shove's slam and the old Delegate were converging on one power.
  detain: {
    type: 'control',
    ap: 3,
    label: 'Detain',
    icon: '🔒',
    desc: 'Ask them to wait right there. They keep their turn - they just cannot leave.',
    uses: 2, // an incident report is a big enough hammer to ration it
    applies: 'detained',
    appliesLog: 'They are held for a statement - they are not going anywhere.',
    log: 'You open an incident report. Name, badge number, time of entry.',
    missLog: 'They produce a lanyard from somewhere. It even scans.',
  },
  // The other stance mode (POWERS_PLAN M5/M7): you become cover. A teammate
  // standing behind you is shielded from shots the way a toppled bookcase
  // shields them - which is why the cover predicate is a CELL question and not
  // a prop question: "does the thing standing here shield them?" answers both.
  'hold-the-line': {
    type: 'stance',
    mode: 'guard',
    ap: 2,
    label: 'Hold the Line',
    icon: '🛡️',
    desc: 'Plant yourself. Teammates on the far side of you are in cover from anything thrown.',
    log: 'You plant yourself in the lane. Nothing gets a clean shot past.',
  },
  // The Security track's own control (POWERS_PLAN M2), replacing a third copy
  // of `kick`.
  lockdown: {
    type: 'control',
    ap: 2,
    label: 'Badge Lockdown',
    icon: '🚫',
    desc: 'Kill their badge from the panel. They are held where they stand - from across the floor.',
    range: 5,
    applies: 'detained',
    appliesLog: 'Their badge goes red. The floor stops letting them through.',
    uses: 2,
    log: 'You pull their access from the panel.',
    missLog: 'The panel spins. Somebody has been putting off that firmware update.',
  },
  // Security's primary verb is the STANCE (POWERS_PLAN M5). Stand Post used to
  // be `type: 'defend'` - the third copy of Deflect Blame - on the class whose
  // entire tagline is about holding ground. It now does what it says: you
  // cover the room, and the first coworker to cross your line takes a free
  // swing for it. The reaction budget (TACTICS.REACTIONS_PER_ROUND) was built
  // for opportunity attacks and had exactly one customer until this.
  'stand-post': {
    type: 'stance',
    mode: 'watch',
    ap: 2,
    radius: 4,
    label: 'Stand Post',
    icon: '🚧',
    desc: 'Cover the room. The first coworker to move within 4 tiles takes a free swing - once.',
    log: 'You plant yourself and watch the room. Nobody is getting past unremarked.',
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
  // The Gears turn (TACTICS_PLAN M6): aim at something solid - or somebody
  // brave - and get behind it. The `ap` here is the "+1" of the designer's
  // "distance cost + 1": the walk to the object is billed as ordinary
  // movement by the same engine every step uses, and this is the tuck itself.
  'take-cover': {
    type: 'cover',
    ap: 1,
    label: 'Take Cover',
    icon: '🧎',
    desc: 'Get behind something solid - or someone brave. Ranged attacks from the shielded side cannot touch you until you move.',
    log: 'You tuck in behind cover.',
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
  // HR's two friendly verbs (POWERS_PLAN M1). The class taglined itself
  // "doesn't fight so much as staff" and then shipped with Deflect Blame and
  // Coffee Break - the Office Drone's kit - so the support class supported
  // nobody but itself. These are the offensive and defensive halves of
  // actually helping someone else.
  'performance-review': {
    type: 'buff',
    ap: 2,
    label: 'Performance Review',
    icon: '⭐',
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
    icon: '🧭',
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

// --- the summon descriptor's one vocabulary -----------------------------------
// What a summon descriptor INHERITS when it names the action it is the twin of.
//
// Exactly one field, and the narrowness is the point. WHO shows up when you
// post a role is a fact about the role: an applicant is an applicant whoever
// hired them, and two answers to that is the drift worth preventing. It is
// also the whole of what was actually wrong - a class and an enemy naming the
// same archetype with nothing tying them together.
//
// Everything else is per side, because the two sides post differently. The
// player's action drops ONE because you click the tile they report to, and a
// pair means one lands somewhere you did not choose (see `summon-applicants`);
// an AI has no click, so a small batch beside the summoner on a tight cap is
// its own pacing, next to its cooldown and what the post costs its turn. How
// long a temp serves belongs there too: it sets how many AI turns a fight
// carries, which is pacing, not identity.
//
// This list was drawn twice too wide before it was drawn right. First it took
// `count` and `cap`, which left an enemy HR posting one applicant on a cap of
// three - not a reinforcement - and the suite caught it. Then it kept
// `lifetimeTurns`, which quietly gave the AI's temps a sixth turn where they
// had served five: not obviously wrong, never asked for, and it widens the
// window on an AI turn that stalls at zero AP. Neither was a bug in the idea
// of sharing; both were sharing something that was saying its own thing.
export const SUMMON_CONTRACT = ['archetype'];

// An enemy's descriptor may name the ACTION it is the AI-side twin of
// (`from: 'summon-applicants'`) and inherit the contract above.
//
// This exists because HR posted the same req twice, from a class action and an
// enemy block that named the same archetype with nothing tying them together -
// so the two could drift apart silently and nobody would find out. Resolving
// here means combat.js and the lints read one merged shape rather than each
// doing the merge for itself.
export function summonSpec(d) {
  if (!d?.from) return d;
  const a = ACTIONS[d.from] || {};
  const out = { ...d };
  for (const k of SUMMON_CONTRACT) if (out[k] === undefined) out[k] = a[k];
  return out;
}
