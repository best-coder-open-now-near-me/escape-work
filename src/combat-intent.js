// The combat input intent: exactly one action may be aimed or awaiting a
// confirmation click at a time. Rendering, the action bar, click resolution
// and turn flow all observe this object instead of sharing mutable closure
// variables.
//
// `clearAim` belongs to the view, but dropping an intent must always drop its
// cursor state too. Keeping that invariant here prevents resolved actions and
// turn changes from leaving a stale cone/zone point behind.
export function createCombatIntent({ actions, clearAim, log }) {
  let armed = null;
  let pendingConfirm = null;

  function arm(id) {
    armed = id;
    if (id) pendingConfirm = null;
  }

  function confirm(id) {
    pendingConfirm = id;
    if (id) armed = null;
  }

  function disarm() {
    armed = null;
    pendingConfirm = null;
    clearAim();
  }

  function cancel(quiet = false) {
    const was = armed || pendingConfirm;
    disarm();
    if (was && !quiet) log(`You lower the ${actions[was].label.toLowerCase()}.`);
    return !!was;
  }

  return {
    get armed() { return armed; },
    get pendingConfirm() { return pendingConfirm; },
    arm,
    confirm,
    disarm,
    cancel,
  };
}
