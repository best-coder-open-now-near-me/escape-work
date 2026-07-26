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
//   resistable   - whether Composure's statusResist shortens it
//   immunity     - id of a companion status this one GRANTS on landing (for
//                  IMMUNITY_WINDOW_MULT x the duration actually applied) and
//                  which BLOCKS re-application while it is live. The anti-chain
//                  rule; see src/statuses.js. The window must share this
//                  status's `clock`, or it would tick on a schedule the thing
//                  it guards never reaches.
//   log          - narration when it applies/ticks; '{name}' is filled with the
//                  owner's name by the caller
//   effects      - the engine-understood vocabulary the runtime aggregates
//                  (statusFx merges all live statuses into one view):
//     dot            damage per tick (turn or step, per the clock)
//     skipTurn       the owner's combat turn is spent recovering
//     moveCostMult   combat move-AP multiplier
//     speedMult      walk-speed multiplier
//     noFootwork     footwork actions (the kick) disabled
//     slipProof      cannot slip (gum's upside)
//     incomingMult   incoming-damage multiplier (deflect: 0.5)
//     accMod         flat accuracy modifier (HIT_PLAN's hitChance `mods`)
//     dodgeMod       flat dodge modifier
export const STATUSES = {
  // --- the incumbents, now data ---------------------------------------------
  surprised: {
    name: 'Surprised', icon: '❗', harmful: true, clock: 'turn',
    duration: 1, resistable: false,
    effects: { skipTurn: true },
    log: '{name} is still grabbing their lanyard.',
  },
  deflecting: {
    name: 'Deflecting', icon: '🛡️', harmful: false, clock: 'turn',
    duration: 1, resistable: false,
    effects: { incomingMult: 0.5 },
  },
  gum: {
    // Numbers mirror GUM in data/surfaces.js (steps 20, moveCost 1.5, slow 0.6);
    // they become one source of truth when gum migrates onto the framework.
    name: 'Gum on shoe', icon: '🍬', harmful: true, clock: 'step',
    duration: 20, resistable: true,
    effects: { moveCostMult: 1.5, speedMult: 0.6, noFootwork: true, slipProof: true },
  },
  bleed: {
    name: 'Bleeding', icon: '🩸', harmful: true, clock: 'step',
    duration: 2, resistable: false,
    effects: { dot: 1 },
  },

  // --- new content this framework makes possible ----------------------------
  stunned: {
    name: 'Mandatory Training', icon: '🪑', harmful: true, clock: 'turn',
    duration: 1, resistable: true,
    immunity: 'training-credit', // no stun-locks: see src/statuses.js
    effects: { skipTurn: true },
    log: '{name} is pulled into mandatory training. Attendance will be taken.',
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
  },
  burning: {
    name: 'On Fire', icon: '🔥', harmful: true, clock: 'turn',
    duration: 2, resistable: false,
    effects: { dot: 2 },
    log: '{name} is on fire. This is not fine.',
  },
  blinded: {
    name: 'Toner Blast', icon: '🌫️', harmful: true, clock: 'turn',
    duration: 2, resistable: true,
    effects: { accMod: -0.3 },
    log: '{name} takes toner to the eyes.',
  },
};
