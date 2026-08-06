// Mutable state shared by the god panel's shell, reflector, placement flow and
// live-sync timer. Keeping it behind named operations makes ownership explicit
// without coupling the state model to DOM construction.
export function createGodPanelState() {
  let open = false;
  let activeTab = 'player';
  let showInternals = false;
  let lastSignature = '';
  let rows = [];
  let placement = null;
  const pins = new Map();

  return {
    pins,
    get open() { return open; },
    setOpen(value) { open = !!value; },
    get activeTab() { return activeTab; },
    selectTab(value) { activeTab = value; },
    get showInternals() { return showInternals; },
    setShowInternals(value) { showInternals = !!value; },
    get lastSignature() { return lastSignature; },
    setLastSignature(value) { lastSignature = value; },
    resetRows() { rows = []; },
    trackRow(input, read) { rows.push({ input, read }); },
    syncRows(activeElement) {
      for (const row of rows) if (row.input !== activeElement) row.read();
    },
    get placement() { return placement; },
    beginPlacement(kind) { placement = { kind }; },
    clearPlacement() { placement = null; },
    signature(api, searchValue) {
      const party = api.party;
      const partySignature = party
        ? party.members.map((member) => (member.sheet.hp <= 0 ? 'd' : 'a')).join('') + party.active
        : '';
      return [
        activeTab,
        searchValue,
        showInternals,
        !!api.player,
        partySignature,
        api.enemies.length,
        !!api.combat,
        api.doors.length,
        pins.size,
        placement ? placement.kind : '',
      ].join('|');
    },
  };
}
