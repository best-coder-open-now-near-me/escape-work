// All DOM-facing UI. Nothing in here knows about PlayCanvas.
//
// This file is the FRONT DOOR, not the implementation: everything that used to
// live in one 1,500-line module now sits in ui/, grouped by what a thing IS on
// screen, and is re-exported from here. Callers keep saying `ui.showMenu(...)`
// over `import * as ui from './ui.js'` - the split cost them nothing, which is
// the point of doing it behind a barrel.
//
//   ui/chrome.js    the shared palette, and the HUD rail the bottom-left
//                   buttons queue onto (combat.js and the editor import the
//                   palette too - they build their own DOM but must not look
//                   like a different game)
//   ui/readouts.js  what the game SAYS with nothing to click: the narrator box,
//                   the focus banner, the loot toast
//   ui/hud.js       what stays on screen while you play: the profile card and
//                   its status chips, the tactical button, the attack hotbar,
//                   the party bar, the level-up pip
//   ui/menus.js     what appears AT the cursor: the context menu, the Alt loot
//                   labels
//   ui/panels.js    what you open over the game: pockets, character sheet,
//                   dialogue, a merchant's stock
//   ui/screens.js   what TAKES OVER the frame: level-up, win / floor clear /
//                   lose, the class picker, the game menu, the playtest badge
//
// Where a new thing goes: by what it IS on screen. A panel joins panels.js
// beside the others and inherits their shape - a dumb view over a host-supplied
// view-model, rendering and reporting clicks, knowing no rules.
export {
  PANEL_CHROME, BUTTON_CHROME, HUD_BUTTON_CHROME, addVignette,
  actionDock, refreshDockVisibility,
} from './ui/chrome.js';
export { say, setNarrationGate, narrationLog, narrationEntries, setFocusBanner, toast } from './ui/readouts.js';
export {
  updateStatsHud, createTacticalButton, createHotbar, HOTBAR_ROW_SLOTS,
  createPartyBar, createLevelUpPip,
} from './ui/hud.js';
export { showMenu, hideMenu, createLootLabels } from './ui/menus.js';
export {
  createInventoryPanel, createCharacterSheet, createDialoguePanel, createShopPanel,
} from './ui/panels.js';
export {
  showLevelUpScreen, showWinScreen, showFloorClear, showLoseScreen,
  showClassPicker, showGameMenu, showPlaytestBadge,
} from './ui/screens.js';
export { showCreationStep } from './ui/creation.js';
