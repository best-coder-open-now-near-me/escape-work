// Mutable state for one loaded floor.
//
// main.js remains the composition root: it creates actors, systems and views.
// This record owns the live coordination state those pieces share, making the
// floor lifecycle explicit instead of a dozen unrelated closure variables.
export function createRunSession() {
  return {
    playerLayer: 0,
    inCombat: false,
    combat: null,
    gameOver: false,
    lastPath: null,
    climbAnim: null,
    pendingAction: null,
    armedOoc: null,
    oocCrouch: null,
    oocAim: null,
    pendingGodPick: null,
    oocTurnClock: 0,

    clearCombat() {
      this.inCombat = false;
      this.combat = null;
    },

    finishRun() {
      this.gameOver = true;
      this.pendingAction = null;
      this.armedOoc = null;
    },
  };
}
