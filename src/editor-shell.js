// Structural DOM for the level editor. Feature code supplies buttons, fields
// and callbacks; this module owns the regions, accessibility labels, common
// control builders, layout measurement and final mounting order.
export function createEditorShell(buttonChrome) {
  const element = (tag, id, className = '') => {
    const node = document.createElement(tag);
    node.id = id;
    if (className) node.className = className;
    return node;
  };

  const bar = element('div', 'editor-shell');
  bar.dataset.toolsOpen = 'false';
  bar.dataset.inspectorOpen = 'false';
  const topbar = element('div', 'editor-topbar', 'editor-surface');
  const identity = element('div', 'editor-identity');
  const status = element('div', 'ed-status');
  identity.appendChild(status);
  const toolPanel = element('section', 'editor-tools', 'editor-surface');
  const toolHeading = element('div', 'editor-tools-heading');
  toolHeading.innerHTML = '<span>Tools</span><small>Paint and place</small>';
  const toolMode = element('div', 'editor-tool-mode');
  const inspector = element('aside', 'editor-inspector', 'editor-surface');
  const inspectorHeading = element('div', 'editor-inspector-heading');
  inspectorHeading.innerHTML = '<span>Inspector</span><small>Selection and level</small>';
  const inspectorBody = element('div', 'editor-inspector-body');
  const selectionInfo = element('div', 'editor-selection');
  const analysis = element('section', 'editor-analysis');
  const analysisHeading = element('div', 'editor-analysis-heading');
  analysisHeading.textContent = 'Analysis';
  const problems = element('div', 'editor-problems');
  const orientation = element('div', 'editor-orientation');
  orientation.setAttribute('role', 'img');
  orientation.setAttribute('aria-label', 'Viewport orientation: X and Y axes');
  const orientationAxes = element('div', 'editor-orientation-axes');
  orientationAxes.setAttribute('aria-hidden', 'true');
  const orientationAxis = (axis, label) => {
    const line = document.createElement('div');
    line.className = 'editor-orientation-axis';
    line.dataset.axis = axis;
    const name = document.createElement('span');
    name.textContent = label;
    line.appendChild(name);
    return line;
  };
  const orientationOrigin = document.createElement('span');
  orientationOrigin.className = 'editor-orientation-origin';
  orientationAxes.append(
    orientationAxis('x', '+X'),
    orientationAxis('y', '+Y'),
    orientationOrigin,
  );
  orientation.appendChild(orientationAxes);

  const palette = element('div', 'editor-palette');
  const commands = element('div', 'editor-commands');
  const levelRow = element('div', 'editor-level-row');
  const viewRow = element('div', 'editor-view-row');
  const inspectorSection = (id, title) => {
    const section = element('section', id, 'editor-inspector-section');
    const heading = document.createElement('div');
    heading.className = 'editor-inspector-section-heading';
    heading.textContent = title;
    const body = document.createElement('div');
    body.className = 'editor-inspector-section-body';
    section.append(heading, body);
    return { section, body };
  };
  const inspectorField = (labelText, control) => {
    const field = document.createElement('label');
    field.className = 'editor-inspector-field';
    field.htmlFor = control.id;
    const label = document.createElement('span');
    label.textContent = labelText;
    field.append(label, control);
    return field;
  };
  const levelDetails = inspectorSection('editor-level-details', 'Level');
  const storeyDetails = inspectorSection('editor-storey-details', 'Storeys');
  levelRow.append(levelDetails.section, storeyDetails.section);

  const btn = (id, label, host = palette) => {
    const button = document.createElement('button');
    button.id = id;
    button.textContent = label;
    Object.assign(button.style, buttonChrome, {
      padding: '7px 9px', borderRadius: '5px', minHeight: '32px', cursor: 'pointer',
    });
    button.classList.add('editor-command');
    host.appendChild(button);
    return button;
  };
  const divider = (host = commands) => {
    const line = document.createElement('div');
    Object.assign(line.style, {
      width: '1px', alignSelf: 'stretch', background: '#3a3a52', margin: '0 2px',
    });
    host.appendChild(line);
  };

  function frameViewport() {
    const canvasRect = document.getElementById('app').getBoundingClientRect();
    const topbarRect = topbar.getBoundingClientRect();
    let left = canvasRect.left + 10;
    let right = canvasRect.right - 10;
    const top = Math.max(canvasRect.top + 10, topbarRect.bottom + 10);
    const bottom = canvasRect.bottom - 10;
    if (window.matchMedia('(min-width: 981px)').matches) {
      left = Math.max(left, toolPanel.getBoundingClientRect().right + 10);
      right = Math.min(right, inspector.getBoundingClientRect().left - 10);
    }
    const middleX = canvasRect.left + canvasRect.width / 2;
    const middleY = canvasRect.top + canvasRect.height / 2;
    return {
      width: Math.max(1, 2 * Math.min(middleX - left, right - middleX)),
      height: Math.max(1, 2 * Math.min(middleY - top, bottom - middleY)),
    };
  }

  function mount({ filterBox, collapseBtn, inspectorToggle }) {
    topbar.append(identity, commands, collapseBtn, inspectorToggle);
    toolPanel.append(toolHeading, toolMode, filterBox, palette);
    inspectorBody.append(selectionInfo, levelRow);
    analysis.append(analysisHeading, viewRow, problems);
    inspector.append(inspectorHeading, inspectorBody, analysis);
    bar.append(topbar, toolPanel, inspector, orientation);
    document.body.appendChild(bar);
  }

  return {
    bar,
    status,
    toolPanel,
    toolMode,
    inspector,
    selectionInfo,
    problems,
    palette,
    commands,
    levelRow,
    viewRow,
    levelDetails,
    storeyDetails,
    inspectorField,
    btn,
    divider,
    frameViewport,
    setOrientationYaw: (yaw) => orientationAxes.style
      .setProperty('--editor-orientation-yaw', `${yaw}deg`),
    mount,
  };
}
