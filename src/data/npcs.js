// Non-hostile actor registry: coworkers you TALK to instead of fight. An NPC
// is a name, a character .glb (assets/characters/<model>.glb, reused from the
// enemy/class roster for now), and a `dialogue` tree. Give it a character in a
// level's `actors` legend and it stands on the map, blocks movement like any
// body, and opens its dialogue when left-clicked (walk up, then talk - the
// same verb path as looting a container).
//
// Dialogue shape:
//   dialogue: { start: '<nodeId>', nodes: { <nodeId>: node, ... } }
//   node:     { text, options: [{ label, next }] }
// `next` names the node to advance to; `next: null` ends the conversation.
// Linear trees just give each node one option; branches give several. Keep it
// small - this is the minimal talking layer, not a quest engine.
export const NPCS = {
  'it-intern': {
    char: 'N',
    name: 'Nervous IT Intern',
    model: 'itsupport', // reuse the IT Support rig until an intern .glb lands
    examine: 'An intern, hunched behind a monitor. Badge still shrink-wrapped.',
    dialogue: {
      start: 'hi',
      nodes: {
        hi: {
          text: '"Oh thank god, a face without a lanyard of authority. You\'re not... with management, are you?"',
          options: [
            { label: 'Who counts as "management"?', next: 'them' },
            { label: 'How do I get out of here?', next: 'exit' },
            { label: 'Just passing through.', next: null },
          ],
        },
        them: {
          text: '"The Manager. HR. Anyone who\'s ever said \'circle back\'. They patrol the floor. Keep your head down and your calendar clear."',
          options: [
            { label: 'How do I get out?', next: 'exit' },
            { label: 'Good luck in here.', next: null },
          ],
        },
        exit: {
          text: '"Stairwell\'s past the cubicle row, behind the doors. They stick - but they DO open, you just have to actually click them. Firm click. Trust me, I filed the ticket."',
          options: [
            { label: 'Thanks.', next: 'thanks' },
          ],
        },
        thanks: {
          text: '"Don\'t mention it. Seriously - don\'t. It\'s not in my job description."',
          options: [
            { label: 'Leave.', next: null },
          ],
        },
      },
    },
  },
};
