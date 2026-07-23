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
    model: 'itsupport', // reuse the IT Support rig until an intern .glb lands
    examine: 'An intern, hunched behind a monitor. Badge still shrink-wrapped.',
    maxHp: 14,
    ap: 6,
    bonusDmg: 0,
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
};
