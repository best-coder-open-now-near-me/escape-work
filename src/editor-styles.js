// The editor is an application surface, not a floating game HUD. Keeping its
// layout rules here makes the shell inspectable and responsive without turning
// editor.js into an inline-style catalogue.
const EDITOR_STYLE_ID = 'escape-work-editor-styles';

export function installEditorStyles() {
  if (document.getElementById(EDITOR_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = EDITOR_STYLE_ID;
  style.textContent = `
    #editor-shell {
      position: fixed; inset: 0; z-index: 30; pointer-events: none;
      display: grid; grid-template-columns: 270px minmax(0, 1fr) 310px;
      grid-template-rows: 52px minmax(0, 1fr) auto;
      gap: 10px; padding: 10px; box-sizing: border-box;
      color: #f0f0f5; font: 12px system-ui, sans-serif;
    }
    #editor-shell button, #editor-shell input, #editor-shell select {
      font: inherit;
    }
    .editor-surface {
      pointer-events: auto; background: rgba(35, 35, 52, .96);
      border: 1px solid #3a3a52; box-shadow: 0 8px 24px rgba(0, 0, 0, .45);
    }
    #editor-topbar {
      grid-column: 1 / 4; display: flex; align-items: center; gap: 8px;
      min-width: 0; padding: 7px 9px; border-radius: 8px;
    }
    #editor-identity { min-width: 0; flex: 1 1 220px; }
    #editor-identity strong, #editor-identity span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #editor-identity span { opacity: .62; font-size: 11px; margin-top: 1px; }
    #editor-commands { display: flex; align-items: center; justify-content: flex-end; gap: 6px; flex-wrap: wrap; }
    #editor-tools, #editor-inspector, #editor-analysis { pointer-events: auto; }
    #editor-tools {
      grid-column: 1; grid-row: 2 / 4; display: flex; flex-direction: column;
      min-height: 0; overflow: hidden; border-radius: 8px;
    }
    #editor-tools-heading, #editor-inspector-heading, #editor-analysis-heading {
      display: flex; align-items: center; justify-content: space-between;
      gap: 8px; padding: 10px 11px 8px; border-bottom: 1px solid #3a3a52;
      font-weight: 700;
    }
    #editor-tools-heading small, #editor-inspector-heading small { opacity: .6; font-weight: 400; }
    #editor-tool-mode { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; padding: 8px; }
    #editor-palette { display: flex; flex: 1; flex-direction: column; flex-wrap: nowrap; align-items: stretch; justify-content: flex-start; gap: 6px; min-height: 0; overflow: auto; padding: 0 8px 10px; }
    #editor-palette [data-cat] { display: grid !important; grid-template-columns: 74px repeat(2, minmax(0, 1fr)); gap: 5px !important; align-items: center; width: 100% !important; }
    #editor-palette [data-cat] > span { grid-column: 1; min-width: 0 !important; text-align: left !important; }
    #editor-palette [data-cat] > button { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #ed-recent { width: auto !important; justify-content: flex-start !important; padding: 0 8px 4px; }
    #ed-recent > span { min-width: auto !important; text-align: left !important; }
    #editor-inspector {
      grid-column: 3; grid-row: 2; display: flex; flex-direction: column;
      min-height: 0; overflow: hidden; border-radius: 8px;
    }
    #editor-inspector-body { min-height: 0; overflow: auto; padding: 9px; }
    #editor-selection-empty { color: #a9a9ba; line-height: 1.45; padding: 5px 1px 12px; }
    .editor-inspector-card { border-bottom: 1px solid #3a3a52; padding: 0 0 11px; margin: 0 0 10px; }
    .editor-inspector-card h3 { margin: 0 0 8px; font-size: 13px; }
    .editor-inspector-facts { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 5px 9px; margin: 0; }
    .editor-inspector-facts dt { opacity: .58; }
    .editor-inspector-facts dd { margin: 0; overflow-wrap: anywhere; }
    .editor-inspector-actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
    #editor-level-row { display: flex !important; flex-direction: column; align-items: stretch !important; gap: 7px !important; padding: 0; }
    #editor-level-row > * { max-width: 100%; }
    #editor-storeys { flex-wrap: wrap; }
    #editor-analysis {
      grid-column: 2 / 4; grid-row: 3; max-height: 235px; min-height: 68px;
      overflow: hidden; border-radius: 8px;
    }
    #editor-analysis-heading { padding-bottom: 7px; }
    #editor-view-row { display: flex !important; gap: 5px !important; flex-wrap: wrap; padding: 7px 10px 0; }
    #editor-problems { max-height: 120px; overflow: auto; padding: 7px 10px 10px; }
    .editor-problem { display: flex; align-items: flex-start; width: 100%; gap: 7px; margin: 3px 0; padding: 6px 7px; text-align: left; border-radius: 5px; }
    .editor-problem[data-level="error"] { border-color: #7a3a4a; color: #ffd9e0; }
    .editor-problem[data-level="warn"] { border-color: #76643a; color: #ffe7a3; }
    .editor-problem-dot { flex: 0 0 auto; font-weight: 700; }
    #editor-problems-empty { color: #8adf76; padding: 3px 0; }
    #ed-status { position: static !important; max-width: none !important; padding: 0 !important; border: 0 !important; background: transparent !important; box-shadow: none !important; }
    #ed-status b { color: #8adf76; }
    #ed-filter { width: 100%; min-width: 0 !important; box-sizing: border-box; margin: 0 8px 2px; }
    #ed-collapse { display: none; }
    #editor-shell .editor-command, #editor-shell .editor-mode {
      min-height: 32px !important; padding: 6px 9px !important; border-radius: 5px !important;
    }
    #editor-shell .editor-mode[aria-pressed="true"] { border-color: #8adf76 !important; color: #d9f7cf; }
    #editor-shell .editor-panel-toggle { display: none; }
    @media (max-width: 980px) {
      #editor-shell { grid-template-columns: minmax(0, 1fr); grid-template-rows: 90px minmax(0, 1fr) auto; padding: 8px; }
      #editor-topbar {
        grid-column: 1; display: grid; grid-template-columns: minmax(0, 1fr) auto auto;
        grid-template-rows: 32px 34px; align-items: center; gap: 5px;
      }
      #editor-identity { grid-column: 1; grid-row: 1; }
      #editor-commands {
        grid-column: 1 / 4; grid-row: 2; width: 100%; justify-content: flex-start;
        flex-wrap: nowrap; overflow-x: auto; overflow-y: hidden; padding-bottom: 2px;
      }
      #ed-collapse { grid-column: 2; grid-row: 1; }
      #ed-inspector-toggle { grid-column: 3; grid-row: 1; }
      #editor-tools, #editor-inspector { position: fixed; top: 106px; bottom: 8px; width: min(320px, calc(100vw - 16px)); transition: transform .18s ease; z-index: 2; }
      #editor-tools { left: 8px; transform: translateX(calc(-100% - 16px)); }
      #editor-inspector { right: 8px; transform: translateX(calc(100% + 16px)); }
      #editor-shell[data-tools-open="true"] #editor-tools, #editor-shell[data-inspector-open="true"] #editor-inspector { transform: translateX(0); }
      #editor-analysis { grid-column: 1; max-height: 180px; }
      #editor-shell .editor-panel-toggle { display: inline-flex; }
    }
  `;
  document.head.appendChild(style);
}
