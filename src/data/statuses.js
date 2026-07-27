// Status effect registry - the "apply X for N turns and the engine does the
// rest" layer (STATUS_PLAN.md). A status is data; src/statuses.js is the one
// runtime that interprets it, exactly as data/surfaces.js + surfaces-runtime.js
// pair up. Imports nothing (data/* is leaf data).
//
// Fields:
//   name, icon   - shown in the HUD chips / focus banner / initiative strip
//   harmful      - polarity: drives the UI tint and the "clear only debuffs"
//                  sweep option (a purge today wipes everything regardless)
//   clock        - 'turn' ticks at the owner's combat turn start (stun, burn,
//                  deflect); 'step' ticks per tile walked and persists on the
//                  map (gum, bleed). See STATUS_PLAN decision #1.
//   duration     - default ticks/steps when applied (a source may override)
//   resistable   - whether Composure's statusResist applies. It does two things
//                  to a resistable status: shortens it (fewer ticks) and BLUNTS
//                  it (every magnitude in `effects` scales by the severity
//                  stored at application - see SEVERITY_PER_RESIST in
//                  src/statuses.js). Booleans never scale, so a `resistable`
//                  status whose only effect is a boolean is shortened alone.
//   immunity     - id of a companion status this one GRANTS on landing (for
//                  IMMUNITY_WINDOW_MULT x the duration actually applied) and
//                  which BLOCKS re-application while it is live. The anti-chain
//                  rule; see src/statuses.js. The window must share this
//                  status's `clock`, or it would tick on a schedule the thing
//                  it guards never reaches.
//   log          - narration when it applies/ticks; '{name}' is filled with the
//                  owner's name by the caller
//   fx           - what it LOOKS like (src/fx.js is the runtime that reads it,
//                  exactly as src/statuses.js is the runtime for the rules):
//     color          [r, g, b] 0..1 for both the landing burst and the aura
//     burst          the shape of the one-shot when it lands: 'rise' (off the
//                    feet - the default for a buff), 'fall' (onto the head -
//                    the default for a debuff), 'pop' (straight out)
//     aura           the trickle drawn WHILE it is live: 'ember' | 'orbit' |
//                    'drip' | 'haze' | 'shield' | 'cling'. Omit for no aura.
//     rate           seconds between aura emissions (default 0.25)
//   effects      - the engine-understood vocabulary the runtime aggregates
//                  (statusFx merges all live statuses into one view):
//     dot            damage per tick (turn or step, per the clock)
//     skipTurn       the owner's combat turn is spent recovering
//     moveCostMult   combat move-AP multiplier
//     speedMult      walk-speed multiplier
//     noFootwork     footwork actions (the kick) disabled
//     rooted         cannot MOVE at all this turn, but may still act. Read by
//                    combat.js's moveBudget - the one choke point both sides
//                    price movement through - so it binds a member and an AI
//                    unit by the same line. Distinct from skipTurn: a root
//                    costs you the ground, a stun costs you the turn.
//     slipProof      cannot slip (gum's upside)
//     incomingMult   incoming-damage multiplier (deflect: 0.5)
//     accMod         flat accuracy modifier (HIT_PLAN's hitChance `mods`)
//     dodgeMod       flat dodge modifier
//     aimSway        0..1 - how hard the PLAYER's aim drifts off their mouse
//                    while steering this character (src/vision.js is the
//                    runtime). An AI unit carries it harmlessly: nothing aims
//                    a mouse for them, so for units it is accMod that bites.
//     sightBlots     0..1 - how much ink swims across the player's view. Same
//                    runtime, same "only the character you steer" rule.
//     shuffleActions the combat action bar is reordered every turn, so the
//                    power you reach for by muscle memory is not where you
//                    left it (combat.js buildActionBar)
export const STATUSES = {
  // --- the incumbents, now data ---------------------------------------------
  surprised: {
    name: 'Surprised', icon: '❗', harmful: true, clock: 'turn',
    duration: 1, resistable: false,
    effects: { skipTurn: true },
    log: '{name} is still grabbing their lanyard.',
    fx: { color: [1, 0.85, 0.25], burst: 'pop', aura: 'orbit', rate: 0.16 },
  },
  deflecting: {
    name: 'Deflecting', icon: '🛡️', harmful: false, clock: 'turn',
    duration: 1, resistable: false,
    effects: { incomingMult: 0.5 },
    fx: { color: [0.45, 0.78, 1], burst: 'rise', aura: 'shield', rate: 0.12 },
  },
  gum: {
    // Numbers mirror GUM in data/surfaces.js (steps 20, moveCost 1.5, slow 0.6);
    // they become one source of truth when gum migrates onto the framework.
    name: 'Gum on shoe', icon: '🍬', harmful: true, clock: 'step',
    duration: 20, resistable: true,
    effects: { moveCostMult: 1.5, speedMult: 0.6, noFootwork: true, slipProof: true },
    fx: { color: [0.93, 0.5, 0.65], burst: 'pop', aura: 'cling', rate: 0.5 },
  },
  bleed: {
    name: 'Bleeding', icon: '🩸', harmful: true, clock: 'step',
    duration: 2, resistable: false,
    effects: { dot: 1 },
    fx: { color: [0.55, 0.05, 0.05], burst: 'fall', aura: 'drip', rate: 0.42 },
  },

  // --- new content this framework makes possible ----------------------------
  stunned: {
    name: 'Mandatory Training', icon: '🪑', harmful: true, clock: 'turn',
    duration: 1, resistable: true,
    immunity: 'training-credit', // no stun-locks: see src/statuses.js
    effects: { skipTurn: true },
    log: '{name} is pulled into mandatory training. Attendance will be taken.',
    fx: { color: [0.72, 0.5, 1], burst: 'fall', aura: 'orbit', rate: 0.13 },
  },
  // The anti-chain window `stunned` grants when it lands. Carries no effects at
  // all - its entire job is to exist, be seen (a HUD chip with a countdown),
  // and turn the next stun away. Not harmful, so a debuff-only sweep spares it;
  // a full purge (reboot) clears it with everything else, which is the honest
  // reading of power-cycling somebody.
  //
  // Named off the stun it guards: the stun IS mandatory training, so the
  // immunity is having the certificate already. The duration below is only a
  // fallback for a direct hand-application - the granting stun computes the
  // real one (IMMUNITY_WINDOW_MULT x its own length).
  'training-credit': {
    name: 'Training Credit', icon: '✅', harmful: false, clock: 'turn',
    duration: 3, resistable: false,
    effects: {},
    log: '{name} completed that training this quarter. It does not take.',
    fx: { color: [0.45, 1, 0.55], burst: 'rise', aura: 'shield', rate: 0.4 },
  },
  burning: {
    name: 'On Fire', icon: '🔥', harmful: true, clock: 'turn',
    duration: 2, resistable: false,
    effects: { dot: 2 },
    log: '{name} is on fire. This is not fine.',
    fx: { color: [1, 0.52, 0.12], burst: 'pop', aura: 'ember', rate: 0.09 },
  },
  blinded: {
    // Named for what it DOES, not for one imagined source: the only thing in
    // the game that applies it is the Office Drone's folded dart, and a chip
    // reading "Toner Blast" over a paper cut to the eye described an event that
    // had not happened. Generic enough that a real toner source can apply it
    // later without renaming a status id that lives in saves.
    name: 'Blinded', icon: '🌫️', harmful: true, clock: 'turn',
    duration: 2, resistable: true,
    // accMod is what blind costs a BODY - it applies to whoever carries it,
    // player or coworker. aimSway/sightBlots are what it costs a PLAYER, and
    // they only bite while you are steering the blinded character: DOS1 and
    // DOS2 stop at the accuracy line, which is why being blinded there feels
    // like nothing at all.
    effects: { accMod: -0.3, aimSway: 1, sightBlots: 1 },
    log: '{name} cannot see straight.',
    fx: { color: [0.34, 0.34, 0.4], burst: 'fall', aura: 'haze', rate: 0.3 },
  },
  confused: {
    // Not damage and not a lost turn - a lost BEARING. Everything you can do is
    // still available and still does what its label says; you just have to read
    // the bar instead of hitting the button where the power used to be.
    name: 'Reorg', icon: '🌀', harmful: true, clock: 'turn',
    duration: 2, resistable: true,
    effects: { shuffleActions: true, aimSway: 0.45 },
    log: '{name} is reorganised. Nothing is where it was.',
    fx: { color: [0.72, 0.45, 0.95], burst: 'pop', aura: 'orbit', rate: 0.22 },
  },
  // --- what a stance looks like (POWERS_PLAN M5) ----------------------------
  // Overwatch carries no `effects` at all: the rule lives in combat's
  // `watching` map, because it is about the REACTION budget and a sightline,
  // neither of which the effect vocabulary can express. This entry exists so
  // the state is VISIBLE - a chip on the HUD, an aura on the body, a line in
  // the initiative strip. A tactical commitment nobody can see is one nobody
  // plays around, and holding a stance is meant to be read by both sides.
  //
  // Its duration is nominal for the same reason: combat clears it the moment
  // the stance lapses or fires, so the number only bounds a leak.
  watching: {
    name: 'Overwatch', icon: '👁️', harmful: false, clock: 'turn',
    duration: 2, resistable: false,
    effects: {},
    log: '{name} is watching the room.',
    fx: { color: [0.55, 0.9, 0.75], burst: 'rise', aura: 'orbit', rate: 0.5 },
  },
  // --- what the control verb lands (POWERS_PLAN M2) -------------------------
  // A ROOT, not a stun. The distinction is the whole reason this status exists
  // rather than reusing `stunned`: a detained coworker still gets their turn
  // and everything on their bar - they simply cannot walk away from you. That
  // is a real tactical state (it holds a thrower in your reach, it stops a
  // wounded manager retreating) and it is NOT turn denial, so it deliberately
  // carries no anti-chain window: re-detaining someone who is standing right
  // there is a legitimate way to spend AP, and it never costs them a turn.
  detained: {
    name: 'Detained', icon: '🪪', harmful: true, clock: 'turn',
    duration: 2, resistable: true,
    effects: { rooted: true },
    log: '{name} is being asked to wait right there.',
    fx: { color: [0.95, 0.78, 0.25], burst: 'fall', aura: 'cling', rate: 0.28 },
  },
  // --- the friendly half (POWERS_PLAN M1) -----------------------------------
  // Until the `buff` verb landed, every status in this registry arrived from
  // the environment or from something swinging at you: the most expensive
  // system in the codebase had no player-facing way to help ANYONE, least of
  // all a teammate. These two are what the verb carries.
  //
  // Neither is `resistable`. Composure is a defence, and making it blunt a
  // compliment would mean the most composed member of the party benefits
  // least from being supported - which is exactly backwards, and would quietly
  // make the HR class worse the better your party got.
  commended: {
    name: 'Commended', icon: '⭐', harmful: false, clock: 'turn',
    duration: 3, resistable: false,
    // The offensive buff: it does not add damage, it adds CONNECTING. Damage
    // is the equipment layer's currency; accuracy is the one HIT_PLAN left
    // open to modifiers on both sides, so a support class pushing it is the
    // spread the to-hit math was built to accept.
    effects: { accMod: 0.15 },
    log: '{name} has it in writing that they are doing great.',
    fx: { color: [1, 0.85, 0.35], burst: 'rise', aura: 'orbit', rate: 0.3 },
  },
  onboarded: {
    name: 'Onboarded', icon: '🧭', harmful: false, clock: 'turn',
    duration: 3, resistable: false,
    // The defensive buff. Deliberately WEAKER than Deflect Blame's 0.5 and
    // longer-lived: a stance you spend your own turn on should beat a favour
    // somebody else did you, or nobody would ever brace again.
    effects: { incomingMult: 0.8, dodgeMod: 0.1 },
    log: '{name} has been walked through the fire exits.',
    fx: { color: [0.45, 0.85, 1], burst: 'rise', aura: 'shield', rate: 0.35 },
  },
};
