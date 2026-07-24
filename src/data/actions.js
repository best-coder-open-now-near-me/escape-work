// Combat action registry. Buttons in the combat panel are generated from the
// player's action list (from their class; later modified by weapons/items).
// The id doubles as the DOM id suffix (#act-<id>), so keep ids stable.
//
// Types the combat runner understands:
//   attack - rolls min..max (+ the character sheet's bonusDmg)
//   defend - halves the next incoming hit
//   heal   - restores `amount` HP, limited to `uses` per fight
//   summon - conjures `count` AI allies of `archetype` (a class id) on your
//            side, up to a live `cap`; instant, `uses` per fight (SUMMON_PLAN)
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
    ap: 3,
    label: 'Passive-Aggressive Email',
    min: 3,
    max: 5,
    log: 'You send a passive-aggressive email.',
    missLog: 'Your passive-aggressive email lands in their spam folder.',
  },
  defend: {
    type: 'defend',
    ap: 2,
    label: 'Deflect Blame',
    log: 'You pre-emptively deflect blame. Incoming damage halved.',
  },
  coffee: {
    type: 'heal',
    ap: 2,
    label: 'Coffee Break',
    amount: 6,
    uses: 3,
    log: 'You chug lukewarm coffee. +6 HP.',
  },

  // --- Middle Manager ---------------------------------------------------------
  delegate: {
    type: 'attack',
    ap: 3,
    label: 'Delegate Ruthlessly',
    min: 2,
    max: 4,
    log: 'You delegate the problem back to them.',
    missLog: 'They delegate it right back. Nothing lands.',
  },
  'own-calendar': {
    type: 'defend',
    ap: 2,
    label: 'Decline the Invite',
    log: 'You decline their meeting invite. Incoming damage halved.',
  },
  espresso: {
    type: 'heal',
    ap: 2,
    label: 'Executive Espresso',
    amount: 8,
    uses: 2,
    log: 'You down a double espresso from the good machine. +8 HP.',
  },

  // --- IT Support ---------------------------------------------------------------
  reboot: {
    type: 'attack',
    ap: 3,
    label: 'Turn It Off And On Again',
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
    amount: 4,
    uses: 4,
    log: 'You crack open something neon. +4 HP.',
  },

  // --- Mail Room ----------------------------------------------------------------
  'mail-cone': {
    type: 'attack',
    ap: 3,
    cone: { range: 4, halfAngle: 35 },
    leaves: 'paper',
    label: 'Bulk Mail',
    min: 2,
    max: 4,
    log: 'You fan a fistful of envelopes downrange.',
  },
  'return-to-sender': {
    type: 'defend',
    ap: 2,
    label: 'Return to Sender',
    log: 'You mark the incoming abuse "addressee unknown". Damage halved.',
  },
  'snack-cart': {
    type: 'heal',
    ap: 2,
    label: 'Snack Cart Raid',
    amount: 5,
    uses: 3,
    log: 'You liberate a pastry from the cart. +5 HP.',
  },

  // --- universal ----------------------------------------------------------------
  shove: {
    type: 'shove',
    ap: 2,
    label: 'Shove',
    log: 'You shove them.',
  },

  // --- applicants (player-controlled summons) -----------------------------------
  // A summoned applicant you control swings with this (its AI-summon twin on
  // the enemy side rolls from the class's `attacks` instead). Cheap and weak -
  // a disposable body, not a bruiser.
  'resume-slap': {
    type: 'attack',
    ap: 3,
    label: 'Résumé Slap',
    min: 1,
    max: 3,
    log: 'The applicant slaps a résumé across the desk.',
    missLog: 'The applicant\'s résumé sails wide. Unqualified.',
  },

  // --- Human Resources ----------------------------------------------------------
  // The HR class's power (SUMMON_PLAN.md): post the role and applicants report
  // for duty on your side. `archetype` is the unit (the applicant class),
  // `count` how many per post, `cap` how many may be live at once, `uses` how
  // many posts per fight. Instant - no target to pick.
  'summon-applicants': {
    type: 'summon',
    ap: 4,
    archetype: 'applicant',
    count: 2,
    cap: 3,
    uses: 2,
    label: 'Post the Role',
    log: 'You open a req. Applicants flood in -',
  },

  // --- talent-granted -----------------------------------------------------------
  kick: {
    type: 'attack',
    ap: 2,
    label: 'Steel-Toe Kick',
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
    min: 4,
    max: 6,
    log: 'You fold a dart and send it. Right in the lanyard.',
    missLog: 'The dart banks left and augers into a monitor.',
  },
};
