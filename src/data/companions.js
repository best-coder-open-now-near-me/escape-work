// Recruitable companions: coworkers who can JOIN the party. A companion is an
// NPC-shaped actor (stands on the map, blocks movement, talks on left-click)
// plus a class-shaped stat block that becomes their character sheet the moment
// they sign on (party.js createCompanionSheet levels it to match the leader).
//
// Dialogue is the recruitment surface: `dialogue` runs while they're still a
// bystander, and an option carrying `effect: { recruit: true }` is what hands
// them a party badge (main.js filters the option out once they've joined or
// the roster is full). `recruitedDialogue` is the small talk afterwards.
// Deliberately softer stat lines than the player classes - they're interns
// and clerks, not protagonists.
export const COMPANIONS = {
  'it-intern': {
    char: 'N',
    name: 'Nervous IT Intern',
    model: 'intern',
    // Smaller than IT Support proper - visibly the junior.
    look: { build: { legs: 1.7, head: 0.68 } },
    examine: 'An intern, hunched behind a monitor. Badge still shrink-wrapped.',
    maxHp: 14,
    ap: 6,
    bonusDmg: 0,
    attr: { grit: 3, hustle: 6, savvy: 3, composure: 3 }, // quick but green
    track: [
      { id: 'intern-fast-learner', name: 'Fast Learner', cost: 1, effect: { attrBonus: { savvy: 1 } } },
      { id: 'intern-nerves', name: 'Steady Nerves', cost: 1, effect: { attrBonus: { composure: 1 } } },
    ],
    actions: ['reboot', 'firewall', 'energy-drink'],
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
    char: 'V',
    name: 'Mail Room Veteran',
    model: 'veteran',
    // Stockier than the rest of the mail room - eleven years of it.
    look: { build: { torso: 1.38 } },
    examine: 'Eleven years in the mail room. Knows every corridor. Fears no wet floor.',
    maxHp: 18,
    ap: 6,
    bonusDmg: 0,
    attr: { grit: 6, hustle: 8, savvy: 4, composure: 5 }, // seasoned, sure-footed
    track: [
      { id: 'vet-hustle', name: 'Decade of Miles', cost: 1, effect: { attrBonus: { hustle: 1 } } },
      { id: 'vet-boots', name: 'Steel-Toe Boots', cost: 1, effect: { grantsAction: 'kick' } },
    ],
    actions: ['mail-cone', 'return-to-sender', 'snack-cart'],
    talent: {
      name: 'Warehouse Soles',
      blurb: 'Eleven years of ignored wet-floor signs. Cannot slip. Ever.',
      effects: { slipImmune: true },
    },
    dialogue: {
      start: 'hi',
      nodes: {
        hi: {
          text: '"You\'re moving with purpose. Nobody on this floor moves with purpose unless they\'re quitting or fleeing. Which is it?"',
          options: [
            { label: 'Fleeing. Escaping, technically.', next: 'escape' },
            { label: 'Who are you?', next: 'who' },
            { label: 'Neither. Carry on.', next: null },
          ],
        },
        who: {
          text: '"Mail room, eleven years. I\'ve pushed a cart down every corridor in this building. There\'s nothing on these floors I haven\'t delivered, dodged, or mopped around."',
          options: [
            { label: 'Then you know the way out. Come with me.', next: 'joined', effect: { recruit: true } },
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
