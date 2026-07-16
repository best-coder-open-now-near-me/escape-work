// Tile type registry. Adding a tile type = adding an entry here and giving it
// a character in a level's "tiles" legend. No engine code changes needed.
//
// Fields:
//   solid    - blocks movement and line of sight (drawn tall, fades when it
//              hides the player)
//   height   - marker box height in world units (floor tiles are 0.2)
//   color    - [r, g, b] 0..1
//   onEnter  - effect when the player steps on it:
//                { effect: 'exit' }                          -> level complete
//                { effect: 'damage', amount, message }       -> hazard
export const TILE_TYPES = {
  wall: {
    char: '#',
    solid: true,
    height: 0.6,
    color: [0.22, 0.22, 0.3],
  },
  floor: {
    char: '.',
    height: 0.2,
    color: [0.82, 0.82, 0.88],
  },
  exit: {
    char: '>',
    height: 0.3,
    color: [0.96, 0.8, 0.26],
    onEnter: { effect: 'exit' },
  },
  'wet-floor': {
    char: '~',
    height: 0.26,
    color: [0.45, 0.72, 0.85],
    onEnter: { effect: 'damage', amount: 3, message: 'You slip on the wet floor! -3 HP. (No sign in sight.)' },
  },
};
