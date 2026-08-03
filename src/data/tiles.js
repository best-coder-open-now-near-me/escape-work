// Tile type registry. Adding a tile type = adding an entry here and giving it
// a character in a level's "tiles" legend. No engine code changes needed.
//
// Fields:
//   solid    - blocks movement (drawn tall, fades when it hides the player).
//              Whether it also blocks LINE OF SIGHT is a height question - see
//              blocksSight below. Low furniture is shot over, not through.
//   tall     - this solid blocks sight regardless of its drawn height. The '#'
//              wall earns it: it is the building's structure, rendered short
//              only so the camera can see over it (occlusion.js), and the e2e
//              contract says a cell wall is "solid all the way up".
//   height   - marker box height in world units (floor tiles are 0.2)
//   color    - [r, g, b] 0..1 (marker box, and editor fallback for props)
//   model    - render a .glb (assets/<model>.glb) instead of a marker box;
//              props with solid:true block movement like walls
//   onEnter  - effect when the player steps on it:
//                { effect: 'exit' }                          -> level complete
//                { effect: 'damage', amount, message }       -> hazard
//   loot     - loot table id (data/items.js LOOT_TABLES); makes the prop
//              rummageable (click it, or its Alt label). `label` names it.
//   label    - what the thing is CALLED, in the Alt overlay, the focus banner
//              and the Examine line. Worth setting on anything solid: without
//              one, Examine can only fall back to naming it a cubicle wall.
//   examine  - the flavor line Examine prints (main.js examineTile). Optional:
//              a prop with a `label` and no `examine` gets a plain generated
//              line naming it, which is correct but not funny. Write one for
//              anything a player will actually stand next to.
//   scale    - model scale; props are authored to sit inside one tile
//   category - groups the brush in the level editor's palette. With a large
//              furniture kit a flat button bar is unusable, so the editor
//              renders one labelled row per category (editor.js).
//   topple   - this prop can be KNOCKED OVER (POWERS_PLAN M6):
//                { damage: [min, max], becomes: '<tile id>' }
//              A shove aimed at it, or a body slammed into it, lays it into
//              the tile directly opposite the attacker. Whoever is standing
//              there takes `damage` and the EXISTING `stunned` status - reused
//              rather than a new knocked-down, so toppling inherits the
//              anti-chain immunity window and cannot become a second way to
//              lock somebody out of a fight. `becomes` names the fallen twin.
//   hp       - this prop can be BROKEN DOWN by attacks, melee and ranged
//              (TACTICS_PLAN M8). A hidden pool: damage accumulates in
//              grid.js's side map (tile defs are static shared objects, so
//              the number here is the ceiling, never mutated), and at zero
//              the prop is REMOVED - the tile reverts to floor, no debris.
//              "Gone means gone" (designer, 2026-07-30): a shove RELOCATES
//              cover and a pull leaves it standing, so destruction is the
//              one verb that deletes it. Only the cover-grade set carries
//              this - the props whose job is to be hidden behind.
//   onFloor  - draw the marker box ON the floor's top face rather than from
//              ground level up: a flat remnant (the toppled partition) thinner
//              than the floor slab would otherwise render inside the carpet
//   runtimeOnly - this tile is never painted and never exported: it only ever
//              arrives through grid.setType at runtime (the fallen twins).
//              Such tiles are EXEMPT from the one-unique-char rule and hidden
//              from the editor palette, which is what makes them free - see
//              the character ceiling below. A runtimeOnly tile appearing in a
//              shipped level is a lint failure, not a tile with no character.
//   tiltX/tiltZ - degrees of lean for the model (a fallen prop lies over).
//
// NOTE ON `char`: a level's map is one CHARACTER per cell, and the level's own
// `tiles` legend says what each character means THERE. The field below is the
// PREFERRED character - the one the editor hands a type when it happens to be
// free in the level being written - and nothing more. It need not be unique,
// and a type may omit it entirely; the editor allocates from a free pool.
// Adding a kit model is a one-entry job, full stop.
//
// THERE IS NO LONGER A CEILING ON TILE TYPES. There used to be, and this note
// used to say it had been reached: 92 of 94 printable characters spoken for,
// the next prop impossible without retiring one. That was never a property of
// the FORMAT - `grid.parseLevel` has always resolved cells through the level's
// own legend and has never once read the field below. It was the EDITOR, which
// exported the whole registry as every level's legend, so every type needed a
// globally unique character whether any level used it or not.
//
// The editor now allocates characters per level, to the types that level
// actually paints, and exports a legend of only those (see the allocator at
// the top of editor.js). So register as many types as the kits provide. The
// remaining limit is how many DISTINCT types a SINGLE level uses - the pool is
// the printable set minus the actor characters and the backslash, so roughly
// ninety - and passing THAT would need a format change (multi-character cells,
// or an object layer beside the ASCII grid). That is a long way off, and the
// ASCII map is worth keeping legible until it arrives.
//
// One thing the old hand-count got wrong and the lint gets right: a tile
// character must also not collide with an ACTOR character, since both legends
// key the same map and parseLevel checks actors first. The editor's pool
// reserves them. Trust tests/unit/levels.test.js over any count written here.
// --- sight (TACTICS_PLAN M6a) ------------------------------------------------
// A solid cell used to block line of sight at ANY height - a 0.18 microwave
// stopped a throw as absolutely as a wall, while chest-high edge partitions
// (0.6-0.72) never blocked sight at all. The height threshold squares the two:
// a solid shorter than a person is shot OVER (and shields whoever stands
// behind it - the passive cover the fallen twins already grant), a taller one
// still blocks the line outright. Ratified by the designer (2026-07-29,
// "height threshold as you suggest"). Sits just above the partitions' own
// render height so everything partition-sized reads by the partition rule.
export const SIGHT_BLOCK_HEIGHT = 0.75;
export const blocksSight = (def) =>
  !!def?.solid && (!!def.tall || (def.height ?? 1) >= SIGHT_BLOCK_HEIGHT);

// The order the editor groups tile brushes in. It lives HERE, with the tiles,
// because it is a fact about the CONTENT: adding a category to a tile def and
// having the editor lay it out should be one edit, not two.
//
// It was a `CATEGORY_ORDER` const inside editor.js, and it had already fallen
// behind - `snack-machine` declares `furniture`, which the editor's list did
// not name, so its brush sorted silently to the end of the palette. A tile
// whose category is missing here still shows up; it just lands last, which is
// exactly the kind of quiet wrong the lint below now refuses.
//
// `basics` is the bucket for a def with no category at all - floor, walls,
// hazards, the originals - and leads so the old muscle memory holds.
export const TILE_CATEGORIES = ['basics', 'work', 'seating', 'tables', 'storage',
  'breakroom', 'furniture', 'decor', 'structure', 'facilities'];

export const TILE_TYPES = {
  wall: {
    char: '#',
    solid: true,
    tall: true, // the building itself: sight-blocking at full height (see above)
    height: 0.6,
    color: [0.22, 0.22, 0.3],
    label: 'Cubicle Wall',
    examine: 'A cubicle wall. It has seen things.',
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
  // A staircase marker (layered levels, EDITOR_PLAN spike). One run of these
  // on a storey generates the whole flight: geometry, the opening above, the
  // connection pathfinding climbs. Solid on purpose - nobody strolls onto the
  // ramp sideways; traversal is the scripted climb between the run's entry
  // and its landing (src/floors.js). Short, so it never blocks sight.
  stairway: {
    // No preferred char: the printable pool is spoken for, and per-level
    // legends (the editor allocates on demand) are what name it in maps -
    // the spike level uses 'X' via its own legend.
    solid: true,
    height: 0.2,
    color: [0.56, 0.54, 0.6],
    label: 'Stairway',
    examine: 'Stairs. Apparently this office believes in upward mobility after all.',
    stairs: true,
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
    label: 'Chair',
    examine: 'An office chair, lowered to its saddest setting. Someone\'s back gave up here.',
  },
  cabinet: {
    char: 'B',
    solid: true,
    height: 0.5,
    color: [0.55, 0.38, 0.24],
    model: 'furniture/cabinet',
    scale: 0.5,
    label: 'Filing Cabinet',
    examine: 'A filing cabinet. The second drawer has not opened since the merger.',
    topple: { damage: [3, 6], becomes: 'cabinet-fallen' },
    hp: 10,
  },
  // The merchant you can paint (ECONOMY_PLAN M2). `shop` points at a SHOPS
  // entry (data/shops.js) exactly the way `loot` points at a loot table, and
  // everything downstream - picking, the walk-up, the Alt label, the
  // right-click verb - follows from that one field.
  //
  // The kit ships no vending machine, so this is the tall door-fronted fridge
  // tinted machine-red; at this camera angle it reads correctly, and a bespoke
  // model is a swap of one line whenever one exists.
  'snack-machine': {
    char: '$', category: 'furniture',
    solid: true,
    // A machine is TALL - that is how you spot one across a break room. The
    // kit's models are authored for scale 1 (the 0.5s elsewhere belong to the
    // older non-kit props), and `height` is what occlusion and the Alt label
    // measure against, so both have to describe the same object.
    height: 1.2,
    scale: 1.0,
    color: [0.72, 0.18, 0.22],
    model: 'furniture/kit/kitchenFridgeLarge',
    label: 'Snack Machine',
    shop: 'vending',
  },
  plant: {
    char: 'P',
    solid: true,
    height: 0.5,
    color: [0.35, 0.62, 0.3],
    model: 'furniture/plant',
    scale: 0.9,
    label: 'Potted Plant',
    examine: 'A potted plant, watered by rumour and the occasional coffee dregs.',
  },
  couch: {
    char: 'C',
    solid: true,
    height: 0.5,
    color: [0.72, 0.45, 0.32],
    model: 'furniture/couch',
    scale: 0.5,
    label: 'Couch',
    examine: 'A breakout-area couch. Load-bearing for at least one nap a day.',
  },
  bookshelf: {
    char: 'S',
    solid: true,
    height: 0.6,
    color: [0.5, 0.36, 0.22],
    model: 'furniture/bookshelf',
    scale: 0.5,
    label: 'Bookshelf',
    topple: { damage: [4, 7], becomes: 'bookshelf-fallen' },
    hp: 12,
    examine: 'A bookshelf of binders nobody has opened. The spines are immaculate.',
  },
  lamp: {
    char: 'L',
    solid: true,
    height: 0.6,
    color: [0.92, 0.85, 0.55],
    model: 'furniture/lamp',
    scale: 0.55,
    label: 'Floor Lamp',
    examine: 'A floor lamp, on. The overheads are also on. Nobody knows who owns either switch.',
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
    topple: { damage: [4, 7], becomes: 'bookcase-fallen' },
    hp: 12,
  },
  'bookcase-wide': {
    char: 'l', category: 'storage', solid: true,
    height: 0.79, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/bookcaseClosedWide', label: 'Bookcase Wide',
    topple: { damage: [4, 8], becomes: 'bookcase-wide-fallen' },
    hp: 14,
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
    topple: { damage: [1, 3], becomes: 'coat-rack-fallen' },
    hp: 4,
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
    // The break room is where a floor's healing lives now that the class bars
    // stopped carrying it (POWERS_PLAN M9).
    loot: 'break-room',
  },
  'mini-fridge': {
    char: '0', category: 'breakroom', solid: true,
    height: 0.6, scale: 1.0, color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/kitchenFridgeSmall', label: 'Mini Fridge',
    loot: 'break-room',
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
    loot: 'break-room',
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
    examine: 'Somebody waters this. Nobody admits to it.',
  },
  // --- the plants you can hide behind (SNEAK_PLAN) ---------------------------
  // Concealment is not a new field: a SOLID prop below SIGHT_BLOCK_HEIGHT is
  // shot over by a standing shot and blocks a CROUCH-height line, which is
  // exactly what a sneaking body is (grid.sightOpenCellLow). The desk rule,
  // wearing leaves. So the design question here is only ever "is this plant
  // big enough that ducking behind it should work?" - and the honest answer
  // is a matter of the model's own size, which is why the knee-high
  // `plant-small`/`plant-tiny` stay non-solid and hide nobody.
  //
  // 0.62 is deliberately just under the 0.75 threshold: tall enough to read
  // as cover, short enough that a thrown stapler still sails over it. A plant
  // that blocked shots outright would be a wall with leaves on, and the
  // office already has walls.
  ficus: {
    char: 'G', category: 'decor', solid: true,
    height: 0.62, scale: 1.0, color: [0.34, 0.6, 0.32],
    model: 'furniture/kit/pottedPlant', label: 'Office Ficus',
    examine: 'Big enough to hide behind, if you are the kind of person who would.',
    // Sprite cards standing in the pot (tile-renderer addFoliage).
    foliage: {
      sprites: ['bush', 'bush2', 'rosette'],
      cards: 4, size: 0.8, lift: 0.44, spread: 0.12, splay: 32,
      tint: [0.42, 0.74, 0.36],
    },
  },
  // The same trick with a spikier silhouette, so a row of plants is not a row
  // of one plant. Same rule, same height band.
  palm: {
    char: 'X', category: 'decor', solid: true,
    height: 0.62, scale: 1.0, color: [0.3, 0.55, 0.34],
    model: 'furniture/kit/pottedPlant', label: 'Lobby Palm',
    examine: 'Plastic, probably. It has not changed since the merger.',
    foliage: {
      sprites: ['tuft', 'leaf', 'tuft'],
      cards: 4, size: 0.88, lift: 0.48, spread: 0.09, splay: 24,
      tint: [0.36, 0.68, 0.42],
    },
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
    // Was '$' until the snack machine wanted the one character in the printable
    // set that means money. No shipped level had painted a round rug, so the
    // swap cost nothing - and it could never be made later.
    char: '"', category: 'decor',
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
    char: '=', category: 'structure', solid: true, tall: true,
    // Structure, not furniture: the kit's wall segment, same family as
    // 'window-wall' and 'doorway' beside it - drawn short like every wall
    // here, but a wall. Without `tall` the sight threshold would read its
    // 0.59 render height as shoot-over furniture.
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
  // These five take the last of the comfortable legend characters. `"` has
  // since gone to 'rug-round' (displaced by the snack machine's '$'), which
  // leaves `\` alone - and it needs escaping inside a level's JSON map rows.
  // Registering a sixth prop from this pack now means retiring a tile type.
  // The other 57 .glb files are in assets/office/ ready to register the moment
  // a character frees up, which is to say: not until the map stops being one
  // character per cell. See the ceiling note at the top of this file.
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

  // --- fallen twins (POWERS_PLAN M6, revised TACTICS_PLAN M6) ---------------
  // Every one of these is `runtimeOnly`: nobody paints them, nobody exports
  // them, they only ever arrive through grid.setType when something goes over.
  // That is what makes them AFFORDABLE - the character ceiling above is
  // reached (92 of 94 spoken for), and six fallen twins would have needed six
  // characters that do not exist.
  //
  // The chunky ones ARE solid now: an object on its side, not a walkable mess
  // (designer, 2026-07-30 - "it def depends on the object's height after
  // falling, but i prefer in most cases just having an object on its side").
  // They shipped walkable out of a stalemate fear - spawn-solid-on-demand
  // could seal a doorway and strand a fight the enemy can never reach - but
  // the M6a sight rule defused it: a low solid no longer blocks sight, so a
  // sealed pocket is a shooting gallery, not a stalemate. Being low solids,
  // they block bodies, are shot over, and grant cover all from the ONE height
  // rule (blocksSight above) - the special `cover` flag they used to need is
  // gone with the walkability. A body the furniture lands on stands IN the
  // cell until the pin lifts; pathfinding never tests a walk's starting tile,
  // so they always climb out.
  //
  // The coat rack is the height exception the designer named: a pole and a
  // coat at 0.2 is a flat tangle you step over - it keeps the walkable-debris
  // shape, the explicit `cover` flag (the M6a rule cannot derive cover for a
  // NON-solid), and the `debris` clamber cost.
  //
  // The twins carry `hp` too (TACTICS_PLAN M8): a thing on its side is still
  // in the way, so it can still be broken up. Less than standing - the fall
  // did half the work - which prices FULL tile denial (topple, then destroy
  // the debris) at two actions' effort. The flat partition board is the
  // exception: walkable, no cover, nothing left to deny.
  'cabinet-fallen': {
    runtimeOnly: true,
    solid: true,
    height: 0.3,
    color: [0.55, 0.38, 0.24],
    model: 'furniture/cabinet',
    scale: 0.5,
    tiltX: 90,
    hp: 6,
    label: 'Toppled Filing Cabinet',
    examine: 'Eleven years of performance reviews, face down on the carpet.',
  },
  'bookcase-fallen': {
    runtimeOnly: true,
    solid: true,
    height: 0.3,
    color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/bookcaseClosed',
    scale: 1.0,
    tiltX: 90,
    hp: 8,
    label: 'Toppled Bookcase',
    examine: 'Face down. The binders inside have not moved in years and are not starting now.',
  },
  'bookcase-wide-fallen': {
    runtimeOnly: true,
    solid: true,
    height: 0.3,
    color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/bookcaseClosedWide',
    scale: 1.0,
    tiltX: 90,
    hp: 8,
    label: 'Toppled Bookcase',
    examine: 'It took two people to put it up and one shove to put it down.',
  },
  'bookshelf-fallen': {
    runtimeOnly: true,
    solid: true,
    height: 0.3,
    color: [0.5, 0.36, 0.22],
    model: 'furniture/bookshelf',
    scale: 0.5,
    tiltX: 90,
    hp: 8,
    label: 'Toppled Bookshelf',
    examine: 'The immaculate spines are now face down. Still unopened.',
  },
  'coat-rack-fallen': {
    runtimeOnly: true,
    solid: false,
    height: 0.2,
    cover: true,
    surface: 'debris',
    color: [0.55, 0.5, 0.45],
    model: 'furniture/kit/coatRackStanding',
    scale: 1.0,
    tiltX: 90,
    hp: 3,
    label: 'Fallen Coat Rack',
    examine: 'Somebody\'s good coat is under there.',
  },
  // A cubicle panel, flat on the carpet (TACTICS_PLAN M6 partition topple).
  // The OTHER height exception, in the other direction: a partition on its
  // side is just a board - walkable, no cover. `onFloor` because a marker box
  // is drawn from GROUND level up, and anything thinner than the floor slab
  // (0.2) tops out inside the carpet - the fallen panel was invisible until
  // the renderer learned to lay it ON the floor's top face. Thin enough
  // (0.03) to duck under the aim wash (0.13) and the rings (0.14).
  'partition-fallen': {
    runtimeOnly: true,
    solid: false,
    height: 0.03,
    onFloor: true,
    color: [0.3, 0.3, 0.38],
    label: 'Toppled Partition',
    examine: 'The great divider, floored. The office is open plan now.',
  },
};

// What knocking a PARTITION over does (TACTICS_PLAN M6). Partitions are
// edges, not cells, so they cannot carry a `topple` block the way furniture
// does - this is that block, for every plain wall edge. Light chip damage: a
// hollow panel, not a loaded bookcase. Doors are NOT toppleable - they go
// floor to frame.
export const PARTITION_TOPPLE = { damage: [1, 3], becomes: 'partition-fallen' };

// ...and what SHOOTING or HITTING one does (TACTICS_PLAN M8): partitions are
// edges, so like the topple block this lives beside the registry rather than
// on a tile entry. A hollow panel - two or three solid swings. Destruction
// removes the EDGE outright, fallen plank included ("gone means gone",
// designer 2026-07-30): the topple keeps the board in play, the break-down
// does not.
export const PARTITION_HP = 8;
