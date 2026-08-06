// Mutable lifecycle state for one combat encounter.
//
// startCombat still composes the encounter's systems and owns the currently
// steered party member. This object owns the state shared by turn order, AI,
// the action bar, aim previews and the debug adapter, so those systems no
// longer communicate through three loose closure variables.
export function createCombatSession() {
  return {
    phase: 'player',
    acting: null,
    scrambleTurn: 0,

    beginScrambleTurn() {
      this.scrambleTurn += 1;
      return this.scrambleTurn;
    },

    finish() {
      this.phase = 'done';
      this.acting = null;
    },

    get active() {
      return this.phase !== 'done';
    },
  };
}
