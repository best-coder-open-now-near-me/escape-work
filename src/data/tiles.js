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
    // Warm office-carpet greige: near-white washed the whole scene out and
    // gave the toon lighting nothing to shade against.
    color: [0.76, 0.74, 0.68],
  },
  exit: {
    char: '>',
    height: 0.3,
    color: [0.96, 0.8, 0.26],
    onEnter: { effect: 'exit' },
  },
  // Surface-carrying floor tiles (see data/surfaces.js). The surface layer
  // brings the effects and interactions - these tiles are just floor + paint.
  water: {
    char: '~',
    height: 0.2,
    color: [0.45, 0.72, 0.85],
    surface: 'water',
  },
  'coffee-spill': {
    char: '%',
    height: 0.2,
    color: [0.34, 0.22, 0.14],
    surface: 'coffee',
  },
  cable: {
    char: '*',
    height: 0.2,
    color: [0.2, 0.2, 0.24],
    surface: 'cable',
  },
  paper: {
    char: 'p',
    height: 0.22,
    color: [0.93, 0.91, 0.83],
    surface: 'paper',
  },

  // Interactive props built from primitives (no .glb needed). Solid like
  // furniture; `ignitable` offers "set it on fire" on right-click, and
  // printers explode when fire reaches them.
  trash: {
    char: 'T',
    solid: true,
    height: 0.55,
    color: [0.3, 0.32, 0.35],
    primitive: 'trash',
    ignitable: true,
  },
  printer: {
    char: 'R',
    solid: true,
    height: 0.5,
    color: [0.56, 0.56, 0.6],
    primitive: 'printer',
    explosive: true,
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
  couch: {
    char: 'C',
    solid: true,
    height: 0.5,
    color: [0.72, 0.45, 0.32],
    model: 'furniture/couch',
    scale: 0.5,
  },
  bookshelf: {
    char: 'S',
    solid: true,
    height: 0.6,
    color: [0.5, 0.36, 0.22],
    model: 'furniture/bookshelf',
    scale: 0.5,
  },
  lamp: {
    char: 'L',
    solid: true,
    height: 0.6,
    color: [0.92, 0.85, 0.55],
    model: 'furniture/lamp',
    scale: 0.55,
  },
};
