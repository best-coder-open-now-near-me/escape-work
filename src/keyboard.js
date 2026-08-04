// WHAT THE KEYS DO.
//
// A slice off `startGame` (Q039): the pan set the update loop reads every frame,
// and the one keydown ladder the whole game hangs off. It is a seam because the
// LADDER is the subject - which keys are live, and under what conditions - and
// that was impossible to read while it sat between the camera helpers and the
// particle wiring.
//
// Two rules in here are decisions, not plumbing:
//   - pan keys are physical CODES, not `e.key`, so WASD stays WASD on a
//     non-QWERTY layout, and keydown/keyup maintain a held SET because a pan is
//     continuous and key-repeat is not.
//   - the number keys are NOT gated on being out of combat. They used to be,
//     which meant a fight - the half of the game that is nothing but pressing
//     verbs under pressure - was the half with no keyboard shortcuts at all.
//     The row you learn out of combat is the row you get in one.
//
// `panHeld` is returned rather than kept private: the update loop drives the rig
// from it every frame, and handing back the live Set says that better than a
// getter that rebuilds one.
export function createKeyboard(d) {
  // --- keyboard: hold Alt for the d.loot overlay, I for the pockets ---------------
  // Camera pan keys (BG3/DOS2: WASD pans, and BG3 takes the arrows too -
  // dotesports.com/pcgamesn BG3 camera guides; DOS2 fextralife Controls).
  // Physical codes, not e.key, so WASD stays WASD on a non-QWERTY layout.
  // keydown/keyup maintain the held set; the update loop drives the rig from
  // it every frame, because pans are continuous and key-repeat isn't.
  const PAN_CODES = {
    KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
    KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  };
  const panHeld = new Set();
  window.addEventListener('keydown', (e) => {
    // Ctrl/meta chords stay the browser's (Ctrl+A, Cmd+D); a plain pan key is
    // ours. The typed-text surfaces (god panel, the creation name field)
    // already stop keydown propagation, so typing "was" never pans.
    if (PAN_CODES[e.code] && !e.ctrlKey && !e.metaKey) {
      panHeld.add(PAN_CODES[e.code]);
      // The arrows scroll the page hosting the game (the itch.io iframe) if
      // left to default; suppressing it is harmless for the letters.
      e.preventDefault();
    }
    if (e.key === 'Alt') {
      e.preventDefault(); // keep focus off the browser's menu bar
      d.hover.setAlt(true); // lights what the cursor is already on, without a re-d.hover
      // Held in a fight too: the overlay is how you SEE the doors, and a door
      // is the one piece of terrain a fight can change. The d.loot entries it
      // also carries stay refused with their own message - being able to read
      // the room beats being able to act on all of it.
      if (!e.repeat && d.sheet && !d.gameOver) d.loot.showLabels();
    } else if (e.key === 'Control') {
      d.hover.setCtrl(true); // rings under everyone while held (drawCharacterRings)
    } else if ((e.key === 'i' || e.key === 'I') && d.sheet && !d.gameOver) {
      d.loot.togglePanel(d.sheet);
    } else if (/^[0-9]$/.test(e.key) && d.sheet && !d.gameOver && !d.modalOpen()) {
      // Number keys press the matching slot of the VISIBLE row, so 1 is always
      // the leftmost button on screen however many rows the kit needs - and 0
      // answers for the tenth slot (TACTICS_PLAN M8's row of ten).
      //
      // These used to be gated `!d.inCombat`, which meant a FIGHT - the half of
      // the game that is nothing but pressing verbs under pressure - was the
      // half with no keyboard shortcuts at all. The row you learn out of d.combat
      // is the row you get in one, which was always the stated point of the
      // layout living on the d.sheet.
      const i = d.hotbarHost.hotbar?.indexAtKey(e.key === '0' ? 10 : Number(e.key)) ?? -1;
      if (i >= 0) d.hotbarHost.pressSlot(i);
    } else if ((e.key === '[' || e.key === ']') && d.sheet && !d.gameOver && !d.modalOpen()) {
      // Page the hotbar rows from the keyboard - the pager buttons and the wheel
      // over the bar do the same thing.
      d.hotbarHost.hotbar?.flip(e.key === ']' ? 1 : -1);
    } else if (e.key === 'Tab' && d.sheet && !d.gameOver && !d.modalOpen()) {
      // Tab cycles which member you lead out of d.combat - and, in one, which
      // member of an open SHARED turn you're steering (INITIATIVE_PLAN). With
      // no shared turn open the d.combat cycle refuses, so the key stays inert
      // on a solo turn rather than falling back to a leader switch.
      e.preventDefault();
      if (d.inCombat) d.combat?.cycleSteer();
      else d.cycleLeader();
    } else if ((e.key === 'h' || e.key === 'H') && d.sheet && !d.gameOver && !d.modalOpen()) {
      // Hide, the pair both references ship (SNEAK_PLAN D4): h sneaks the
      // character you steer and parks the rest; Shift+H sneaks the group.
      if (!d.inCombat) d.toggleSneak(e.shiftKey ? 'group' : 'solo');
    } else if ((e.key === 'c' || e.key === 'C') && d.sheet && !d.gameOver && !d.modalOpen()) {
      // The read-only character d.sheet for whoever you're controlling.
      d.charSheet.toggle(d.charSheetVm(d.sheet));
    } else if ((e.key === 't' || e.key === 'T') && d.sheet && !d.gameOver && !d.modalOpen()) {
      // Overhead tactical view - the same toggle as the rail button.
      d.controls.toggleTactical();
      d.tacticalBtn?.refresh();
    } else if (e.key === 'Home' && d.sheet && !d.gameOver) {
      // BG3's recenter key: put the camera back on whoever you're driving
      // (the acting combatant in a fight, the leader out of one).
      d.focusCameraOn(d.steeredActor());
    }
  });
  window.addEventListener('keyup', (e) => {
    if (PAN_CODES[e.code]) panHeld.delete(PAN_CODES[e.code]);
    if (e.key === 'Alt') { d.hover.setAlt(false); d.loot.hideLabels(); }
    if (e.key === 'Control') d.hover.setCtrl(false);
  });
  window.addEventListener('blur', () => {
    panHeld.clear(); // a key can't be 'still held' across a focus loss
    d.loot.hideLabels();
    d.hover.releaseModifiers(); // a key can't be 'still held' across a focus loss
  });

  return { panHeld };
}
