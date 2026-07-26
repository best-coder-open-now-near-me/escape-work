// Enemy type registry. Adding an enemy = adding an entry here and giving it a
// character in a level's "actors" legend. `model` is a .glb under
// assets/characters/. `attacks` are picked at random each enemy turn; the log
// line gets the rolled damage appended. `loot` (data/items.js ids) rolls onto
// their body when they fall - bodies stay on the floor and can be looted.
//
// `aggression` is their disposition toward starting a fight, surfaced as the
// dots flanking their name in the focus banner:
//   'green'  - no intention of initiating; only fights if provoked
//   'yellow' - will talk first, then maybe escalate
//   'red'    - straight to battle
import { fromClass } from './classes.js';

// id -> either a standalone stat block, or `{ classId, ...overrides }` for a
// coworker who IS one of the playable classes. The Security Guard is the first
// of those: he and the Security class are the same job, so he names it and
// inherits the rig, the build and the kit rather than keeping a copy that
// drifts the moment the class changes. Everyone else here has no class twin -
// The Manager, the Executive and the rest are their own archetypes - so they
// stay written out. Don't invent a class just to inherit from it.
const KITS = {
  manager: {
    char: 'M',
    name: 'The Manager',
    model: 'manager',
    level: 1, // native tier; a floor deeper than this scales him up (stats.scaleEnemy)
    hp: 14,
    ap: 5,
    attackAp: 3, // AP one swing costs them in combat
    xp: 8,
    aggression: 'red', // straight to battle
    examine: 'The Manager: radiates unread-email energy.',
    loot: [
      { item: 'performance-review', chance: 1 },
      { item: 'cold-coffee', chance: 0.5 },
      { item: 'crumpled-fiver', chance: 0.45 }, // lunch money, and now yours
      { item: 'company-fleece', chance: 0.3 },
    ],
    attacks: [
      { min: 2, max: 3, log: 'The Manager schedules a "quick sync".', missLog: 'You decline the "quick sync". It never lands.' },
      { min: 2, max: 3, log: 'The Manager asks for "just one more thing".', missLog: 'The "one more thing" gets lost in your inbox.' },
      { min: 2, max: 3, log: 'The Manager CCs your skip-level.', missLog: 'The CC bounces - wrong distribution list.' },
      { min: 2, max: 4, log: '"Per my last email..."', missLog: 'Per your last email, you were already out of office.' },
      // applies: 'gum' - sticks gum to the target's shoe (see GUM in surfaces.js)
      { min: 1, max: 2, log: 'The Manager parks his gum on your shoe. A power move.', applies: 'gum', appliesLog: 'Gum. On your shoe.', missLog: 'The Manager reaches for your shoe and misses. Reprieve.' },
    ],
  },
  executive: {
    char: 'E',
    name: 'The Executive',
    model: 'executive',
    // Taller the further up the org chart you go.
    look: { build: { legs: 2.0 } },
    level: 2, // descended from the floors above - a tier over the base Manager
    hp: 18,
    ap: 5,
    attackAp: 3,
    xp: 10,
    accuracy: 0.05, // sharper aim than the base coworkers (HIT_PLAN)
    aggression: 'red', // descended from the floors above; negotiation is beneath him
    examine: 'An Executive, down from the floors above. The air pressure changes around him.',
    loot: [
      { item: 'performance-review', chance: 1 },
      { item: 'red-stapler', chance: 0.35 },
      { item: 'cold-coffee', chance: 0.5 },
      // He is the one who signs for petty cash. The single richest body in the
      // game, and the only reliable source of the envelope on a shipped floor.
      { item: 'petty-cash-envelope', chance: 0.35 },
      { item: 'interview-blazer', chance: 0.4 },
    ],
    attacks: [
      { min: 3, max: 5, log: 'The Executive restructures your reporting line.' },
      { min: 2, max: 4, log: 'The Executive asks what it is you even do here.' },
      { min: 2, max: 5, log: 'The Executive aligns you with the new strategy.' },
      { min: 1, max: 2, log: 'The Executive parks his gum on your shoe. Delegation.', applies: 'gum', appliesLog: 'Gum. On your shoe.' },
    ],
  },
  hr: {
    char: 'H',
    name: 'HR Representative',
    model: 'hrrep',
    level: 1,
    hp: 12,
    ap: 6,
    attackAp: 3,
    xp: 6,
    aggression: 'yellow', // wants a "culture-fit conversation" before the knives
    examine: 'HR: smiles warmly. Never stops taking notes.',
    loot: [
      { item: 'hr-pamphlet', chance: 1 },
      { item: 'half-sandwich', chance: 0.4 },
      { item: 'crumpled-fiver', chance: 0.3 },
      { item: 'laminated-lanyard', chance: 0.4 },
    ],
    attacks: [
      { min: 2, max: 3, log: 'HR invites you to a "culture-fit conversation".' },
      { min: 2, max: 4, log: 'HR slides a self-evaluation form across the desk.' },
      { min: 1, max: 4, log: 'HR reminds you fun is mandatory at the offsite.' },
    ],
    // HR's power (SUMMON_PLAN.md): posts the role and applicants materialize to
    // fight for it. `archetype` names a unit (the `applicant` class); `count` is
    // how many arrive per post; `cap` is how many it may have live at once;
    // `cooldownRounds` is the wait between reqs; `ap` is what the post costs its
    // turn; `lifetimeTurns` is how many of its own turns an applicant serves
    // before the contract lapses and it walks off the board. The combat AI
    // reads this (combat.js resolveSummon).
    summon: {
      archetype: 'applicant',
      count: 2,
      cap: 2,
      cooldownRounds: 2,
      ap: 3,
      lifetimeTurns: 5,
      log: 'HR posts the role internally. Applicants materialize, résumés in hand.',
    },
  },

  'security-guard': {
    // The same job as the playable Security class, so he IS one: the rig, the
    // attributes and the kit all come from it and follow it wherever it goes.
    // What's left below is only what makes him the one you FIGHT - a map char,
    // AI damage rolls, what he's worth and what he drops.
    classId: 'security',
    // Lowercase because every free uppercase char is already spoken for by a
    // tile type or another actor; actor chars are looked up before tiles
    // (grid.js), so 's' is unambiguous in a level map.
    char: 's',
    name: 'Security Guard',
    // Squared off by the vest and the belt - where he departs from the player's
    // guard, who stands taller and less padded on the same rig.
    look: { build: { torso: 1.34 } },
    level: 2,
    hp: 20,
    attackAp: 3,
    xp: 11,
    dodge: 0.05, // trained to stay on his feet (HIT_PLAN)
    // The maglite is already in his attack lines, and a long one is genuinely a
    // reach weapon (TACTICS_PLAN revision M5). 2.1 clears a full orthogonal tile
    // (2.0) with room to spare, so he can hold you at a distance you cannot
    // answer bare-handed - which is exactly what "escorts you toward the door"
    // should feel like, and it gives the player a reason to notice reach exists.
    reach: 2.1,
    // Badge first, force second: he wants to see your lanyard before anything
    // escalates, which is exactly what 'yellow' means.
    aggression: 'yellow',
    examine: 'Security. Knows the badge policy by heart. Has never once been asked about it.',
    loot: [
      { item: 'laminated-lanyard', chance: 1 },
      { item: 'crumpled-fiver', chance: 0.35 },
      { item: 'warehouse-boots', chance: 0.35 },
      { item: 'cold-coffee', chance: 0.5 },
      { item: 'usb-stick', chance: 0.2 },
    ],
    attacks: [
      { min: 3, max: 4, log: 'The Security Guard asks to see your badge. Firmly.', missLog: 'You pat your pockets convincingly. He waits.' },
      { min: 2, max: 5, log: 'The Security Guard escorts you toward the door. You are not going that way.', missLog: 'You sidestep the escort. He recovers his footing.' },
      { min: 2, max: 4, log: 'The Security Guard shines a flashlight directly into your morning.', missLog: 'The beam sweeps past you into an empty cubicle.' },
      { min: 1, max: 3, log: 'The Security Guard writes you up in the incident log.', applies: 'stunned', appliesLog: 'You are detained for a statement - you lose a turn to it.', missLog: 'His pen is out of ink. Reprieve.' },
    ],
  },

  // --- seniority variants (higher native tier) --------------------------------
  // Tougher relatives of the base coworkers: new data entries reusing existing
  // rigs, with a higher native `level` (beefier base stats, better loot, meaner
  // lines). The floor curve (stats.scaleEnemy) scales THESE too on floors past
  // their tier; place them where a floor wants a step up. Nothing else is code.
  'senior-manager': {
    char: 'G',
    name: 'Senior Manager',
    model: 'seniormanager',
    // Heavier set than the floor managers - seniority reads as menace.
    look: { build: { torso: 1.35 } },
    level: 3,
    hp: 22,
    ap: 5,
    attackAp: 3,
    xp: 15,
    accuracy: 0.05, // escalates efficiently (HIT_PLAN)
    aggression: 'red',
    examine: 'A Senior Manager. Same energy, more direct reports. Radiates escalation.',
    loot: [
      { item: 'performance-review', chance: 1 },
      { item: 'red-stapler', chance: 0.3 },
      { item: 'cold-coffee', chance: 0.5 },
      { item: 'petty-cash-envelope', chance: 0.3 },
      { item: 'company-fleece', chance: 0.4 },
    ],
    attacks: [
      { min: 3, max: 4, log: 'The Senior Manager loops in their manager.' },
      { min: 3, max: 5, log: 'The Senior Manager moves the goalposts, then the deadline.' },
      { min: 2, max: 4, log: '"Let\'s take this offline." (It is never taken offline.)' },
      { min: 1, max: 2, log: 'The Senior Manager parks premium gum on your shoe.', applies: 'gum', appliesLog: 'Gum. On your shoe.' },
    ],
  },
  'regional-executive': {
    char: 'X',
    name: 'Regional Executive',
    model: 'regional',
    // The tallest cut in the building.
    look: { build: { legs: 2.05, torso: 1.34 } },
    level: 4,
    hp: 30,
    ap: 5,
    attackAp: 3,
    xp: 22,
    accuracy: 0.10, // knows exactly where it'll hurt (HIT_PLAN)
    dodge: 0.05,    // and is hard to pin down - flew in, will fly out
    aggression: 'red',
    examine: 'A Regional Executive. Flew in for the day. Knows your name, not your work.',
    loot: [
      { item: 'performance-review', chance: 1 },
      { item: 'red-stapler', chance: 0.5 },
      { item: 'cold-coffee', chance: 0.5 },
      { item: 'petty-cash-envelope', chance: 0.5 },
      { item: 'interview-blazer', chance: 0.5 },
    ],
    attacks: [
      { min: 4, max: 6, log: 'The Regional Executive announces a "strategic realignment".', applies: 'stunned', appliesLog: 'You are booked into a mandatory strategy offsite - you lose a turn to it.' },
      { min: 3, max: 6, log: 'The Regional Executive sunsets your entire team.' },
      { min: 3, max: 5, log: 'The Regional Executive asks for a number you do not have.' },
    ],
  },
};

// What every consumer reads: fully-formed defs, so nothing downstream knows or
// cares which entries were assembled from a class. ENEMY_KITS stays exported so
// the lint can check an override never just repeats what its class already says.
export const ENEMY_TYPES = Object.fromEntries(
  Object.entries(KITS).map(([id, kit]) => [
    id,
    // `maxHp`: enemies spell it `hp`, and unitCombat prefers `maxHp` - leaving
    // the class's would silently outrank this enemy's own HP.
    kit.classId ? fromClass(kit, { drop: ['maxHp'] }) : kit,
  ]),
);
export { KITS as ENEMY_KITS };
