// Recruitable companions: coworkers who can JOIN the party. A companion is an
// NPC-shaped actor (stands on the map, blocks movement, talks on left-click)
// who IS one of the classes, plus the handful of things that make them a
// person. Their stat block becomes their character sheet the moment they sign
// on (party.js createCompanionSheet levels it to match the leader).
//
// `classId` is the whole point. A companion USED to restate a class - the mail
// room companion carried his own copy of the mail room's actions, talent and
// attributes, all identical to `mail-room`'s - which is a parallel
// implementation of a thing we already have, and it drifted the moment the
// class changed: reassigning the Mail Room's rig left him wearing the old one,
// still calling himself mail room. Now he names the class and inherits it, so
// there is one definition of what a mail room person IS and he cannot fall out
// of step with it.
//
// The NAME is inherited for the same reason. Neither of these two is a named
// character: one is an IT person, the other a mail room person, and they are
// called what those jobs are called - exactly like the player, whose own
// character is named for their class. The bespoke names they carried ("Nervous
// IT Intern", "Mail Room Veteran") were the last of the parallel copy: a
// characterization stated in a string, describing a state the game never
// advances, and drifting from the class label beside it. A future entry who
// really is somebody - a name on a door, a person with a plot - overrides
// `name` and says so on purpose.
//
// An entry therefore carries ONLY what a class cannot say about a person:
// their char, how they look, what they know (dialogue), and any deliberate
// departure from the class - companions run softer stat lines than the
// player's, because they're the junior in the room, not protagonists. Anything
// you'd otherwise copy from the class, delete: inheriting it is the point.
//
// Dialogue is the recruitment surface: `dialogue` runs while they're still a
// bystander, and an option carrying `effect: { recruit: true }` is what hands
// them a party badge (main.js filters the option out once they've joined or
// the roster is full). `recruitedDialogue` is the small talk afterwards.
// The merge lives in classes.js - enemies build from a class the same way
// (data/enemies.js), and one mechanism means one place for the rules.
import { fromClass } from './classes.js';

// id -> the class they are, plus only what makes them them.
const KITS = {
  'it-intern': {
    classId: 'it-support',
    char: 'N',
    // No name of his own: he is an IT person, so he is called what the job is
    // called (inherited from the class). He was "Nervous IT Intern", which
    // asserted a state - nervous, junior - that nothing in the game ever
    // develops or resolves; he levels up and stays nervous in his own name
    // forever. What makes him the junior is in the numbers and the writing
    // below, where it can actually change.
    // His own rig, and smaller than IT Support proper - visibly the junior.
    model: 'intern',
    look: { build: { legs: 1.7, head: 0.68 } },
    examine: 'An intern, hunched behind a monitor. Badge still shrink-wrapped.',
    // Where the intern departs from IT Support, and nowhere else: softer, a
    // step slower, and nothing like their savvy yet. Grit, hustle and composure
    // are the class's - he is the same person earlier on. The kit (reboot,
    // firewall, energy drink) is inherited too: he does the same job, badly.
    maxHp: 14,
    ap: 6,
    attr: { savvy: 3 }, // the one dial that makes him the intern
    track: [
      { id: 'intern-fast-learner', name: 'Fast Learner', cost: 1, effect: { attrBonus: { savvy: 1 } } },
      { id: 'intern-nerves', name: 'Steady Nerves', cost: 1, effect: { attrBonus: { composure: 1 } } },
    ],
    talent: null, // too new for a talent - fresh eyes, no habits
    dialogue: {
      start: 'hi',
      nodes: {
        hi: {
          text: '"Oh thank god, a face without a lanyard of authority. You\'re not... with management, are you?"',
          options: [
            { label: 'Who counts as "management"?', next: 'them' },
            { label: 'How do I get out of here?', next: 'exit' },
            { label: 'Come with me. We\'re both getting out.', next: 'joined', effect: { recruit: true } },
            { label: 'Just passing through.', next: null },
          ],
        },
        them: {
          text: '"The Manager. HR. Anyone who\'s ever said \'circle back\'. They patrol the floor. Keep your head down and your calendar clear."',
          options: [
            { label: 'How do I get out?', next: 'exit' },
            { label: 'Come with me instead.', next: 'joined', effect: { recruit: true } },
            { label: 'Good luck in here.', next: null },
          ],
        },
        exit: {
          text: '"Stairwell\'s past the cubicle row, behind the doors. They stick - but they DO open, you just have to actually click them. Firm click. Trust me, I filed the ticket."',
          options: [
            { label: 'Come show me. We\'re leaving together.', next: 'joined', effect: { recruit: true } },
            { label: 'Thanks.', next: 'thanks' },
          ],
        },
        thanks: {
          text: '"Don\'t mention it. Seriously - don\'t. It\'s not in my job description."',
          options: [
            { label: 'Leave.', next: null },
          ],
        },
        joined: {
          text: '"Really? Okay. Okay okay okay. I\'m deleting my calendar. Done. Where you go, I go - just, if anyone asks, I\'m escorting YOU."',
          options: [
            { label: 'Stick close.', next: null },
          ],
        },
      },
    },
    recruitedDialogue: {
      start: 'hi',
      nodes: {
        hi: {
          text: '"Still here. Still deleting meeting invites as they arrive. It\'s very freeing."',
          options: [
            { label: 'How are you holding up?', next: 'mood' },
            { label: 'Back to it.', next: null },
          ],
        },
        mood: {
          text: '"My badge says \'temp\', my heart says \'escape velocity\'. Lead on."',
          options: [
            { label: 'Good enough.', next: null },
          ],
        },
      },
    },
  },
  'mail-veteran': {
    // He is a mail room person. That is the entire stat block: the rig, the
    // kit (Bulk Mail, Return to Sender, the snack cart), Warehouse Soles and
    // the mail room's own progression all come from the class, and follow it
    // wherever it goes next.
    classId: 'mail-room',
    char: 'V',
    // Named by the job too (see the intern) - he was the "Mail Room Veteran",
    // which put his whole characterization in a label the rules never touch.
    // The eleven years live in his dialogue and his examine line, which is
    // where a story can be told.
    // Stockier than the rest of the mail room - eleven years of it. The only
    // reason to restate `look`: it is what tells him apart from the clerk
    // wearing the same rig.
    look: { build: { torso: 1.38 } },
    examine: 'Eleven years in the mail room. Knows every corridor. Fears no wet floor.',
    maxHp: 18, // a companion line, not a protagonist's
    // He runs the cart (ECONOMY_PLAN M3). The person merchant is deliberately
    // NOT a new NPC standing in a supply closet: the map legend is one
    // character per cell and the printable set is all but spent, so a merchant
    // who already has a character on the map is the only kind we can still
    // afford. It also happens to be the better story - he has pushed a cart
    // down every corridor in this building, and he takes it with him when he
    // signs on, so the party's fence is a member of the party.
    shop: 'mail-cart',
    dialogue: {
      start: 'hi',
      nodes: {
        hi: {
          text: '"You\'re moving with purpose. Nobody on this floor moves with purpose unless they\'re quitting or fleeing. Which is it?"',
          options: [
            { label: 'Fleeing. Escaping, technically.', next: 'escape' },
            { label: 'Who are you?', next: 'who' },
            { label: 'What\'s on the cart?', effect: { shop: true }, next: null },
            { label: 'Neither. Carry on.', next: null },
          ],
        },
        who: {
          text: '"Mail room, eleven years. I\'ve pushed a cart down every corridor in this building. There\'s nothing on these floors I haven\'t delivered, dodged, or mopped around."',
          options: [
            { label: 'Then you know the way out. Come with me.', next: 'joined', effect: { recruit: true } },
            { label: 'Anything on that cart worth having?', effect: { shop: true }, next: null },
            { label: 'Good for you.', next: null },
          ],
        },
        escape: {
          text: '"Ha. Stairwell\'s past the far cubicles - mind the spilled coffee, it never dries. I\'d know. I\'ve routed around it for a decade."',
          options: [
            { label: 'Route around it WITH me. We\'re leaving.', next: 'joined', effect: { recruit: true } },
            { label: 'Noted. Thanks.', next: null },
          ],
        },
        joined: {
          text: '"Eleven years and nobody ever asked. One second - I\'m taking the good hand truck. Okay. Follow me. Actually - I\'ll follow you. Symbolism matters."',
          options: [
            { label: 'Stay close.', next: null },
          ],
        },
      },
    },
    recruitedDialogue: {
      start: 'hi',
      nodes: {
        hi: {
          text: '"Still here. Still not slipping. You get used to the floors betraying you - and then one day they simply can\'t anymore."',
          options: [
            { label: 'Any advice?', next: 'advice' },
            { label: 'Show me the cart.', effect: { shop: true }, next: null },
            { label: 'Keep moving.', next: null },
          ],
        },
        advice: {
          text: '"Shove the paperwork problems into the wet-floor problems. Let the problems fight each other. Eleven years of management theory, that."',
          options: [
            { label: 'Solid.', next: null },
          ],
        },
      },
    },
  },
};

// The registry every consumer reads: fully-formed defs, so nothing downstream
// (grid, party, stats, main, god) needs to know a companion is assembled
// rather than written out. The raw kits stay exported so the lint can check a
// companion never re-states something its class already says.
export const COMPANIONS = Object.fromEntries(
  Object.entries(KITS).map(([id, kit]) => [id, fromClass(kit)]),
);
export { KITS as COMPANION_KITS };
