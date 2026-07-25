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
//   loot     - loot table id (data/items.js LOOT_TABLES); makes the prop
//              rummageable (click it, or its Alt label). `label` names it.
//   scale    - model scale; props are authored to sit inside one tile
//   category - groups the brush in the level editor's palette. With a large
//              furniture kit a flat button bar is unusable, so the editor
//              renders one labelled row per category (editor.js).
//
// NOTE ON `char`: a level's map is one CHARACTER per cell, and the editor
// exports canonical registry chars, so every entry needs a globally unique
// one. That is the real ceiling on how many props can exist - roughly the
// printable ASCII set minus the actor/enemy chars. Adding a kit model that
// isn't registered below is a one-entry job; finding it a free char is the
// only constraint.
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
    // Neutral office-carpet gray: dark enough that the toon lighting has
    // range to shade against, without tinting the whole scene warm.
    color: [0.6, 0.6, 0.64],
  },
  // Carpet-variant floors: plain walkable floor whose `carpet` recolors the
  // checkered carpet itself (nothing is drawn on top). Paint rooms with these
  // to give them an identity - meeting-room blue, break-room terracotta,
  // IT slate.
  'meeting-floor': {
    char: 'm',
    height: 0.2,
    color: [0.48, 0.55, 0.68],
    carpet: [0.48, 0.55, 0.68],
  },
  'break-floor': {
    char: 'k',
    height: 0.2,
    color: [0.64, 0.48, 0.38],
    carpet: [0.64, 0.48, 0.38],
  },
  'it-floor': {
    char: 'i',
    height: 0.2,
    color: [0.4, 0.42, 0.5],
    carpet: [0.4, 0.42, 0.5],
  },
  exit: {
    char: '>',
    height: 0.3,
    color: [0.96, 0.8, 0.26],
    // The way out is a stairwell - the one prop in the kit that means what the
    // game is about. Deliberately NOT solid: you have to be able to walk onto
    // it for the onEnter to fire.
    model: 'furniture/kit/stairsOpen',
    scale: 0.5,
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
  gum: {
    char: 'g',
    height: 0.2,
    color: [0.93, 0.5, 0.65],
    surface: 'gum',
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
    label: 'Trash Can',
    loot: 'trash',
  },
  printer: {
    char: 'R',
    solid: true,
    height: 0.5,
    color: [0.56, 0.56, 0.6],
    primitive: 'printer',
    explosive: true,
    label: 'Printer',
    loot: 'printer',
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
    label: 'Desk',
    loot: 'desk',
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

  // --- Kenney Furniture Kit props (assets/furniture/kit) --------------------
  'desk-corner': {
    char: 'a', category: 'work', solid: true,
    height: 0.31, scale: 0.8, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/deskCorner', label: 'Desk Corner',
  },
  'desk-chair': {
    char: 'b', category: 'work', solid: true,
    height: 0.42, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/chairDesk', label: 'Desk Chair',
  },
  'monitor': {
    char: 'd', category: 'work', solid: true,
    height: 0.29, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/computerScreen', label: 'Monitor',
  },
  'laptop': {
    char: 'e', category: 'work', solid: true,
    height: 0.37, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/laptop', label: 'Laptop',
  },
  'keyboard': {
    char: 'f', category: 'work',
    height: 0.12, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/computerKeyboard', label: 'Keyboard',
  },
  'books': {
    char: 'h', category: 'work',
    height: 0.12, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/books', label: 'Books',
  },
  'bookcase': {
    char: 'j', category: 'storage', solid: true,
    height: 0.85, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/bookcaseClosed', label: 'Bookcase',
  },
  'bookcase-wide': {
    char: 'l', category: 'storage', solid: true,
    height: 0.79, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/bookcaseClosedWide', label: 'Bookcase Wide',
  },
  'bookcase-low': {
    char: 'n', category: 'storage', solid: true,
    height: 0.4, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/bookcaseOpenLow', label: 'Bookcase Low',
  },
  'box-closed': {
    char: 'o', category: 'storage', solid: true,
    height: 0.28, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/cardboardBoxClosed', label: 'Box Closed',
  },
  'box-open': {
    char: 'q', category: 'storage', solid: true,
    height: 0.28, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/cardboardBoxOpen', label: 'Box Open',
  },
  'coat-rack': {
    char: 'r', category: 'storage', solid: true,
    height: 0.77, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/coatRackStanding', label: 'Coat Rack',
  },
  'tv-cabinet': {
    char: 't', category: 'storage', solid: true,
    height: 0.31, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/cabinetTelevision', label: 'Tv Cabinet',
  },
  'chair-cushion': {
    char: 'u', category: 'seating', solid: true,
    height: 0.46, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/chairCushion', label: 'Chair Cushion',
  },
  'chair-modern': {
    char: 'v', category: 'seating', solid: true,
    height: 0.46, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/chairModernCushion', label: 'Chair Modern',
  },
  'chair-round': {
    char: 'w', category: 'seating', solid: true,
    height: 0.45, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/chairRounded', label: 'Chair Round',
  },
  'bench': {
    char: 'x', category: 'seating', solid: true,
    height: 0.47, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/bench', label: 'Bench',
  },
  'bench-cushion': {
    char: 'y', category: 'seating', solid: true,
    height: 0.46, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/benchCushion', label: 'Bench Cushion',
  },
  'lounge-chair': {
    char: 'z', category: 'seating', solid: true,
    height: 0.46, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/loungeChair', label: 'Lounge Chair',
  },
  'sofa': {
    char: 'A', category: 'seating', solid: true,
    height: 0.43, scale: 0.94, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/loungeSofa', label: 'Sofa',
  },
  'sofa-long': {
    char: 'F', category: 'seating', solid: true,
    height: 0.43, scale: 0.94, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/loungeSofaLong', label: 'Sofa Long',
  },
  'sofa-corner': {
    char: 'I', category: 'seating', solid: true,
    height: 0.43, scale: 0.94, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/loungeSofaCorner', label: 'Sofa Corner',
  },
  'bar-stool': {
    char: 'J', category: 'seating', solid: true,
    height: 0.43, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/stoolBar', label: 'Bar Stool',
  },
  'table': {
    char: 'K', category: 'tables', solid: true,
    height: 0.33, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/table', label: 'Table',
  },
  'coffee-table': {
    char: 'O', category: 'tables', solid: true,
    height: 0.23, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/tableCoffee', label: 'Coffee Table',
  },
  'round-table': {
    char: 'Q', category: 'tables', solid: true,
    height: 0.37, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/tableRound', label: 'Round Table',
  },
  'glass-table': {
    char: 'U', category: 'tables', solid: true,
    height: 0.33, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/tableGlass', label: 'Glass Table',
  },
  'side-table': {
    char: 'W', category: 'tables', solid: true,
    height: 0.38, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/sideTable', label: 'Side Table',
  },
  'side-drawers': {
    char: 'Y', category: 'tables', solid: true,
    height: 0.38, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/sideTableDrawers', label: 'Side Drawers',
  },
  'fridge': {
    char: 'Z', category: 'breakroom', solid: true,
    height: 0.92, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/kitchenFridge', label: 'Fridge',
  },
  'mini-fridge': {
    char: '0', category: 'breakroom', solid: true,
    height: 0.6, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/kitchenFridgeSmall', label: 'Mini Fridge',
  },
  'microwave': {
    char: '1', category: 'breakroom', solid: true,
    height: 0.18, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/kitchenMicrowave', label: 'Microwave',
  },
  'coffee-machine': {
    char: '2', category: 'breakroom', solid: true,
    height: 0.3, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/kitchenCoffeeMachine', label: 'Coffee Machine',
  },
  'kitchen-sink': {
    char: '3', category: 'breakroom', solid: true,
    height: 0.49, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/kitchenSink', label: 'Kitchen Sink',
  },
  'counter': {
    char: '4', category: 'breakroom', solid: true,
    height: 0.42, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/kitchenBar', label: 'Counter',
  },
  'stove': {
    char: '5', category: 'breakroom', solid: true,
    height: 0.45, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/kitchenStove', label: 'Stove',
  },
  'toaster': {
    char: '6', category: 'breakroom',
    height: 0.13, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/toaster', label: 'Toaster',
  },
  'potted-plant': {
    char: '7', category: 'decor', solid: true,
    height: 0.54, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/pottedPlant', label: 'Potted Plant',
  },
  'plant-small': {
    char: '8', category: 'decor',
    height: 0.28, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/plantSmall1', label: 'Plant Small',
  },
  'plant-tiny': {
    char: '9', category: 'decor',
    height: 0.28, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/plantSmall2', label: 'Plant Tiny',
  },
  'rug': {
    char: '!', category: 'decor',
    height: 0.12, scale: 0.59, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/rugRectangle', label: 'Rug',
  },
  'rug-round': {
    char: '$', category: 'decor',
    height: 0.12, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/rugRound', label: 'Rug Round',
  },
  'rug-square': {
    char: '&', category: 'decor',
    height: 0.12, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/rugSquare', label: 'Rug Square',
  },
  'floor-lamp': {
    char: '(', category: 'decor', solid: true,
    height: 0.86, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/lampSquareFloor', label: 'Floor Lamp',
  },
  'floor-lamp-round': {
    char: ')', category: 'decor', solid: true,
    height: 0.86, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/lampRoundFloor', label: 'Floor Lamp Round',
  },
  'television': {
    char: '+', category: 'decor', solid: true,
    height: 0.45, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/televisionModern', label: 'Television',
  },
  'radio': {
    char: ',', category: 'decor',
    height: 0.23, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/radio', label: 'Radio',
  },
  'trashcan': {
    char: '?', category: 'decor', solid: true,
    height: 0.91, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/trashcan', label: 'Trashcan',
  },
  'stairs': {
    char: '-', category: 'structure', solid: true,
    height: 0.67, scale: 0.5, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/stairs', label: 'Stairs',
  },
  'stairs-open': {
    char: '/', category: 'structure', solid: true,
    height: 0.67, scale: 0.5, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/stairsOpen', label: 'Stairs Open',
  },
  'stairs-corner': {
    char: ':', category: 'structure', solid: true,
    height: 0.7, scale: 0.52, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/stairsCorner', label: 'Stairs Corner',
  },
  'doorway': {
    char: ';', category: 'structure', solid: true,
    height: 1.01, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/doorwayOpen', label: 'Doorway',
  },
  'window-wall': {
    char: '<', category: 'structure', solid: true,
    height: 1.19, scale: 0.92, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/wallWindow', label: 'Window Wall',
  },
  'paneling': {
    char: '=', category: 'structure', solid: true,
    height: 0.59, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/paneling', label: 'Paneling',
  },
  'toilet': {
    char: '[', category: 'facilities', solid: true,
    height: 0.87, scale: 0.92, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/toilet', label: 'Toilet',
  },
  'bathroom-sink': {
    char: ']', category: 'facilities', solid: true,
    height: 0.56, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/bathroomSink', label: 'Bathroom Sink',
  },
  'mirror': {
    char: '^', category: 'facilities', solid: true,
    height: 0.43, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/bathroomMirror', label: 'Mirror',
  },
  'shower': {
    char: '_', category: 'facilities', solid: true,
    height: 1.77, scale: 0.71, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/shower', label: 'Shower',
  },

  // --- Low Poly Office props (assets/office) --------------------------------
  // Converted from the pack's Unity .fbx by tools/fbx-to-glb.py, which bakes
  // in each model's Unity import scale - so these .glb files are in REAL
  // METRES, unlike the two kits above (each of which has its own arbitrary
  // authoring size). One factor converts the whole pack: `scale: 0.5`, which
  // is not a fudge but a measurement - this pack's desk is 1.87m x 0.99m, and
  // at 0.5 that lands at 0.94 x 0.50, matching the `desk` entry above to the
  // centimetre. So `height` here is always the model's real height / 2, and a
  // new prop from this pack needs no eyeballing: read its metres out of the
  // converter's --report and halve them.
  //
  // These five take the last of the comfortable legend characters. Only `"`
  // and `\` are left after them, and both need escaping inside a level's JSON
  // map rows - so registering a sixth prop from this pack now means either
  // living with that or retiring a tile type. The other 57 .glb files are in
  // assets/office/ ready to register the moment a character frees up.
  'filing-cabinet': {
    char: "'", category: 'storage', solid: true,
    height: 0.62, scale: 0.5, color: [0.2, 0.42, 0.58],
    model: 'office/cabinets', label: 'Filing Cabinet',
    loot: 'filing-cabinet',
  },
  'water-cooler': {
    char: '`', category: 'breakroom', solid: true,
    height: 1.18, scale: 0.5, color: [0.55, 0.6, 0.68],
    model: 'office/waterCooler', label: 'Water Cooler',
  },
  'whiteboard': {
    char: '{', category: 'work', solid: true,
    height: 1.17, scale: 0.5, color: [0.85, 0.85, 0.87],
    model: 'office/whiteBoard', label: 'Whiteboard',
  },
  'wet-floor-sign': {
    char: '}', category: 'facilities', solid: true,
    height: 0.48, scale: 0.5, color: [0.95, 0.78, 0.2],
    model: 'office/caution_wetfloor', label: 'Wet Floor Sign',
  },
  // The one prop in the pack whose Unity scale factor is 1 rather than 4, so
  // it converts to a 17cm model - desk clutter, not a floor unit. 2.0 restores
  // the pack's own metres-based footing (0.5 x 4) and it reads as a real
  // floor-standing shredder next to the cabinet.
  'shredder': {
    char: '|', category: 'work', solid: true,
    height: 0.34, scale: 2.0, color: [0.3, 0.3, 0.34],
    model: 'office/shredder', label: 'Shredder',
  },
};
