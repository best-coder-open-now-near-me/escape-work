// Tile type registry. Adding a tile type = adding an entry here and giving it
// a character in a level's "tiles" legend. No engine code changes needed.
//
// Fields:
//   solid    - blocks movement and line of sight (drawn tall, fades when it
//              hides the player)
//   height   - marker box height in world units (floor tiles are 0.2)
//   color    - [r, g, b] 0..1 (marker box, and editor fallback for props)
//   model    - render a .glb (assets/<model>.glb) instead of a marker box;
//              props with solid:true block movement like walls
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

  // Furniture props: solid (they block movement and pathfinding) and rendered
  // as models. Paintable in the editor like any other tile.
  desk: {
    char: 'D',
    solid: true,
    height: 0.5,
    color: [0.62, 0.42, 0.27],
    model: 'furniture/desk',
    scale: 0.5,
  },
  chair: {
    char: 'c',
    solid: true,
    height: 0.5,
    color: [0.5, 0.6, 0.75],
    model: 'furniture/chair',
    scale: 0.55,
    rotY: 90,
  },
  cabinet: {
    char: 'B',
    solid: true,
    height: 0.5,
    color: [0.55, 0.38, 0.24],
    model: 'furniture/cabinet',
    scale: 0.5,
  },
  plant: {
    char: 'P',
    solid: true,
    height: 0.5,
    color: [0.35, 0.62, 0.3],
    model: 'furniture/plant',
    scale: 0.9,
  },
};
