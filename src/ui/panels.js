// The panels you open and close over the game: pockets, the character sheet,
// a conversation, a merchant's stock. Each is a dumb VIEW - the host hands it a
// view-model and callbacks, and it renders and reports clicks. None of them
// knows a rule.
import { EQUIP_SLOTS, equipSlotsFor, pendingPoints } from '../stats.js';
import { ATTRIBUTES } from '../data/attributes.js';
import { PANEL_CHROME, BUTTON_CHROME, HUD_BUTTON_CHROME, registerHudButton, layoutHudRail, railHooks, esc,
} from './chrome.js';

// --- inventory panel ----------------------------------------------------------
// The pockets. Toggled with I or the bag button. Rows come straight from the
// item registry; `usable` items get Use, flavor items get Examine, everything
// can be dropped (dropping creates a loose floor item the Alt overlay sees).
// Equip-position display names. Jewelry is a new two-position item type; the
// legacy trinket position remains Flair, preserving existing items and saves.
const SLOT_LABELS = {
  weapon: 'Main Weapon',
  weapon2: 'Second Weapon',
  jewelryLeft: 'Left-Hand Jewelry',
  jewelryRight: 'Right-Hand Jewelry',
  hat: 'Hat',
  outfit: 'Outfit',
  pants: 'Pants',
  shoes: 'Shoes',
  trinket: 'Flair',
};

// `capOf` is asked per refresh, not captured: the carry limit is a stat, so it
// moves with the character and with whoever is currently the leader. A panel
// built once with a number would print the boot-time cap forever.
export function createInventoryPanel(ITEMS, capOf, { onUse, onDrop, onExamine, onEquip, onUnequip, onSend, canSend, getCash }) {
  // The bag sits immediately right of the bottom-left profile card, where your
  // eye already is for HP - not up in the top-left corner it used to share with
  // nothing. Its exact left edge is measured from the card each layout pass,
  // because the card's width moves with the character's name.
  const bag = document.createElement('button');
  bag.id = 'inventory-btn';
  bag.textContent = '🎒';
  Object.assign(bag.style, HUD_BUTTON_CHROME);
  document.body.appendChild(bag);
  registerHudButton(bag); // first slot on the rail

  // ...and the pockets rise out of the bottom over the button, rather than
  // dropping from the top-left. Long bags scroll inside the panel instead of
  // growing off the top of the screen.
  const panel = document.createElement('div');
  panel.id = 'inventory-panel';
  Object.assign(panel.style, {
    position: 'fixed', bottom: '80px', left: '12px', zIndex: '25', width: '250px',
    display: 'none', background: '#232334', color: '#f0f0f5',
    border: '1px solid #3a3a52', borderRadius: '9px', padding: '10px 12px',
    font: '12px system-ui, sans-serif', boxShadow: '0 8px 24px rgba(0,0,0,.45)',
    maxHeight: 'min(58vh, 520px)', overflowY: 'auto',
    // The pop: it slides up into place from behind the button. `display` stays
    // the source of truth for "is it open" (tests and the hotkey read it), so
    // the transform only ever decorates a state that has already flipped.
    transformOrigin: 'bottom left', transform: 'translateY(12px)', opacity: '0',
    transition: 'transform .16s ease-out, opacity .16s ease-out',
  });
  document.body.appendChild(panel);

  // The panel rides the rail: it must clear the profile card AND the button row,
  // both of which live in the bottom-left corner. Registered as a rail hook so
  // it re-seats on the same passes the buttons do.
  function layout(r, bottom) {
    const cardTop = r && r.height ? window.innerHeight - r.top : 60;
    panel.style.bottom = `${Math.round(Math.max(cardTop, (bottom ?? 14) + bag.offsetHeight) + 8)}px`;
  }
  railHooks.push(layout);
  layoutHudRail();

  const smallBtn = (label, title) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title;
    Object.assign(b.style, {
      padding: '3px 8px', borderRadius: '5px', border: '1px solid #3a3a52',
      background: '#2e2e46', color: '#f0f0f5', font: '11px system-ui, sans-serif',
      cursor: 'pointer',
    });
    return b;
  };

  // The equipped positions, above the pockets: each names its position and shows
  // the worn item (or a dash), with an Unequip button when occupied. Stable ids
  // #equip-slot-<slot> / #equip-unequip-<slot> for the e2e suite.
  function renderEquipStrip(sheet) {
    const eq = sheet?.equipped || {};
    const wrap = document.createElement('div');
    wrap.id = 'equip-strip';
    wrap.style.margin = '0 0 9px';
    for (const slot of EQUIP_SLOTS) {
      const id = eq[slot];
      const def = id ? ITEMS[id] : null;
      const row = document.createElement('div');
      row.id = `equip-slot-${slot}`;
      row.dataset.item = id || '';
      Object.assign(row.style, {
        display: 'flex', alignItems: 'center', gap: '7px', padding: '3px 2px',
      });
      const label = document.createElement('div');
      label.textContent = SLOT_LABELS[slot];
      Object.assign(label.style, { width: '104px', flexShrink: '0', opacity: '.6', fontSize: '11px' });
      row.appendChild(label);
      const item = document.createElement('div');
      item.style.flex = '1';
      item.textContent = def ? `${def.icon || '📦'} ${def.name}` : '—';
      if (!def) item.style.opacity = '.45';
      item.title = def?.examine || '';
      row.appendChild(item);
      if (def && onUnequip) {
        const un = smallBtn('Stow', 'Unequip to pockets');
        un.id = `equip-unequip-${slot}`;
        un.onclick = () => onUnequip(slot);
        row.appendChild(un);
      }
      wrap.appendChild(row);
    }
    panel.appendChild(wrap);
  }

  function refresh(sheet) {
    const inv = sheet?.inventory || [];
    const cap = capOf(sheet);
    panel.innerHTML = `<div style="font-weight:700; letter-spacing:1px; margin-bottom:7px;">
      POCKETS <span style="opacity:.6; font-weight:400;">${Number.isFinite(cap) ? `${inv.length}/${cap}` : inv.length}</span></div>`;
    if (sheet?.equipped) renderEquipStrip(sheet);
    // Paper is ammo, not an inventory item - it lives on the sheet, not in the
    // bag - but it was only ever a number in the header, so it read as missing.
    // Give it a real row of its own, above the loose items.
    const paperRow = document.createElement('div');
    paperRow.id = 'inv-paper';
    Object.assign(paperRow.style, {
      display: 'flex', alignItems: 'center', gap: '7px',
      padding: '5px 2px', marginBottom: '4px',
      borderTop: '1px solid #2c2c42', borderBottom: '1px solid #2c2c42',
    });
    const pName = document.createElement('div');
    pName.style.flex = '1';
    pName.textContent = `📄 Paper × ${sheet?.paper ?? 0}`;
    pName.title = 'Ammunition for thrown attacks. Gathered from spills; no carry limit.';
    paperRow.appendChild(pName);
    // Petty Cash sits in the same strip, for the same reason: it is a resource
    // the sheet spends, not an item in the bag. It is PARTY state though, so it
    // comes from an accessor rather than off the sheet (ECONOMY_PLAN #2).
    if (getCash) {
      const cName = document.createElement('div');
      cName.id = 'inv-cash';
      cName.style.flex = '1';
      cName.textContent = `💵 ${getCash()}`;
      cName.title = 'Petty Cash. Shared by the whole party; spent at machines and merchants.';
      paperRow.appendChild(cName);
    }
    panel.appendChild(paperRow);
    if (!inv.length) {
      const empty = document.createElement('div');
      empty.style.opacity = '.6';
      empty.textContent = 'Empty. The office provides, if you rummage.';
      panel.appendChild(empty);
      return;
    }
    inv.forEach((id, i) => {
      const def = ITEMS[id];
      const row = document.createElement('div');
      row.id = `inv-row-${i}`;
      Object.assign(row.style, {
        display: 'flex', alignItems: 'center', gap: '7px', padding: '4px 2px',
        borderTop: i ? '1px solid #2c2c42' : 'none',
      });
      const name = document.createElement('div');
      name.textContent = `${def?.icon || '📦'} ${def?.name || id}`;
      name.style.flex = '1';
      name.title = def?.examine || '';
      row.appendChild(name);
      // Equippable gear gets Equip; a consumable gets Use; everything else,
      // Examine. Drop is always available.
      const compatible = equipSlotsFor(def);
      if (compatible.length && onEquip) {
        const destinations = compatible.map((slot) => SLOT_LABELS[slot]).join(' or ');
        const eq = smallBtn('Equip', `Equip to ${destinations}`);
        eq.id = `inv-equip-${i}`;
        eq.onclick = () => onEquip(i);
        row.appendChild(eq);
      } else if (def?.heal || def?.ammo) {
        const use = smallBtn('Use', def.heal ? `+${def.heal} HP` : `+${def.ammo} paper`);
        use.id = `inv-use-${i}`;
        use.onclick = () => onUse(i);
        row.appendChild(use);
      } else {
        const ex = smallBtn('👁', def?.examine || '');
        ex.id = `inv-examine-${i}`;
        ex.onclick = () => onExamine(i);
        row.appendChild(ex);
      }
      // Hand it to another member. Hidden when travelling alone - a button
      // that can only ever say "there is nobody" is not worth the width.
      if (onSend && canSend?.()) {
        const send = smallBtn('Send', 'Hand it to another party member');
        send.id = `inv-send-${i}`;
        send.onclick = () => onSend(i, send);
        row.appendChild(send);
      }
      const drop = smallBtn('Drop', 'Leave it on the floor');
      drop.id = `inv-drop-${i}`;
      drop.onclick = () => onDrop(i);
      row.appendChild(drop);
      panel.appendChild(row);
    });
  }

  // Open/close flips `display` immediately (the honest "is it open" answer) and
  // then plays the slide on the next frame - a transform applied in the same
  // frame as display:block never animates.
  function setOpen(open) {
    if (open) {
      panel.style.display = 'block';
      layoutHudRail(); // seat it against the card + rail before it slides in
      requestAnimationFrame(() => {
        panel.style.transform = 'translateY(0)';
        panel.style.opacity = '1';
      });
    } else {
      panel.style.display = 'none';
      panel.style.transform = 'translateY(12px)';
      panel.style.opacity = '0';
    }
  }

  let lastSheet = null;
  function toggle(sheet) {
    lastSheet = sheet;
    const showing = panel.style.display !== 'none';
    if (!showing) refresh(sheet); // fill it before it slides into view
    setOpen(!showing);
  }
  bag.onclick = () => { if (lastSheet) toggle(lastSheet); };

  return {
    toggle,
    refresh: (sheet) => { lastSheet = sheet; if (panel.style.display !== 'none') refresh(sheet); },
    hide: () => setOpen(false),
    get visible() { return panel.style.display !== 'none'; },
  };
}

export function createCharacterSheet({ onLevelUp } = {}) {
  const host = document.createElement('div');
  host.id = 'character-sheet';
  Object.assign(host.style, PANEL_CHROME, {
    position: 'fixed', right: '12px', top: '54px', zIndex: '24', display: 'none',
    width: '250px', maxHeight: '82vh', overflow: 'auto', borderRadius: '12px',
    padding: '15px 17px', userSelect: 'none', font: '13px system-ui, sans-serif',
  });
  host.onmousedown = (e) => e.stopPropagation();
  document.body.appendChild(host);

  const label = 'font-size:11px; letter-spacing:1px; opacity:.55; margin:12px 0 4px;';
  const row = (name, val) => `<div style="display:flex; justify-content:space-between; padding:1px 0;">
    <span style="opacity:.85;">${name}</span><b>${val}</b></div>`;

  function render(vm) {
    const pending = pendingPoints(vm);
    const xpPct = Math.max(0, Math.min(100, Math.round((vm.xp / vm.xpNext) * 100)));
    const attrRows = ATTRIBUTES.map(({ key, label: attrLabel }) =>
      `<div style="display:flex; justify-content:space-between; padding:1px 0;">
        <span style="opacity:.85;">${attrLabel}</span><b id="charsheet-attr-${key}">${vm.attr[key] ?? 0}</b></div>`).join('');
    const perks = vm.perks.length
      ? vm.perks.map((n) => `<div style="opacity:.82;">• ${n}</div>`).join('')
      : '<div style="opacity:.45;">None yet</div>';
    host.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:baseline; gap:8px;">
        <div style="font-weight:700; color:#8adf76;">${esc(vm.name)}</div>
        <button id="charsheet-close" style="border:none; background:none; color:#aaa;
          font-size:15px; cursor:pointer; line-height:1;">✕</button></div>
      <div style="opacity:.7; font-size:12px; margin-bottom:8px;">${vm.className} · Level ${vm.level}</div>
      <div style="height:4px; background:#1a1a28; border-radius:2px;">
        <div style="height:100%; width:${xpPct}%; background:#6f87d8; border-radius:2px;"></div></div>
      <div style="opacity:.5; font-size:11px; margin-top:3px;">XP ${vm.xp}/${vm.xpNext}</div>
      <div style="${label}">ATTRIBUTES</div>${attrRows}
      <div style="${label}">DERIVED</div>
      ${row('HP', `${vm.hp}/${vm.maxHp}`)}${row('AP', vm.maxAp)}
      ${row('Damage bonus', `+${vm.damageBonus}`)}${row('Deflect', vm.deflect)}
      ${vm.equipped ? `<div style="${label}">EQUIPPED</div>`
        + EQUIP_SLOTS.map((slot) => row(SLOT_LABELS[slot], vm.equipped[slot] || '—')).join('') : ''}
      ${vm.talent ? `<div style="${label}">TALENT</div><div style="opacity:.85;">${vm.talent.name}</div>` : ''}
      <div style="${label}">PERKS</div>${perks}
      ${pending ? `<button id="charsheet-levelup" style="margin-top:12px; width:100%; padding:7px;
        border-radius:8px; border:1px solid #8adf76; background:#3a5a34; color:#eafbe6;
        font:inherit; font-weight:700; cursor:pointer;">⬆ Spend ${pending} point${pending === 1 ? '' : 's'}</button>` : ''}
      <div style="opacity:.4; font-size:11px; margin-top:10px;">Press C to close</div>`;
    host.querySelector('#charsheet-close').onclick = () => hide();
    const lu = host.querySelector('#charsheet-levelup');
    if (lu && onLevelUp) lu.onclick = () => { hide(); onLevelUp(); };
  }
  function hide() { host.style.display = 'none'; }
  function toggle(vm) {
    if (host.style.display !== 'none') { hide(); return; }
    render(vm);
    host.style.display = 'block';
  }
  return {
    toggle, hide,
    refresh(vm) { if (host.style.display !== 'none') render(vm); },
    get visible() { return host.style.display !== 'none'; },
  };
}

// --- dialogue -----------------------------------------------------------------
// The minimal talking layer: a bottom panel with the speaker's name, a line,
// and one button per response. Dumb by design - main.js owns the dialogue tree
// (data/npcs.js) and hands over a rendered view each step. Options carry an
// `action` the caller supplies (advance to the next node, or close).
export function createDialoguePanel() {
  const panel = document.createElement('div');
  panel.id = 'dialogue-panel';
  Object.assign(panel.style, PANEL_CHROME, {
    position: 'fixed', left: '50%', bottom: '22px', transform: 'translateX(-50%)',
    zIndex: '28', width: 'min(560px, 92vw)', display: 'none', borderRadius: '12px',
    padding: '16px 18px', userSelect: 'none',
  });
  panel.onmousedown = (e) => e.stopPropagation(); // clicks stay off the canvas
  document.body.appendChild(panel);

  function show({ name, text, options }) {
    panel.innerHTML = '';
    const nm = document.createElement('div');
    Object.assign(nm.style, { fontWeight: '700', letterSpacing: '1px', marginBottom: '6px', color: '#8adf76' });
    nm.textContent = name;
    panel.appendChild(nm);
    const tx = document.createElement('div');
    Object.assign(tx.style, { margin: '0 0 12px', lineHeight: '1.5' });
    tx.textContent = text;
    panel.appendChild(tx);
    const opts = document.createElement('div');
    Object.assign(opts.style, { display: 'flex', flexDirection: 'column', gap: '6px' });
    options.forEach((o, i) => {
      const b = document.createElement('button');
      b.className = 'dialogue-option';
      b.id = 'dialogue-option-' + i;
      Object.assign(b.style, BUTTON_CHROME, { textAlign: 'left', padding: '8px 10px', borderRadius: '7px' });
      b.textContent = o.label;
      b.onclick = () => o.action();
      opts.appendChild(b);
    });
    panel.appendChild(opts);
    panel.style.display = 'block';
  }
  function hide() { panel.style.display = 'none'; panel.innerHTML = ''; }
  return { show, hide, get visible() { return panel.style.display !== 'none'; } };
}

// --- the shop panel (ECONOMY_PLAN.md) ----------------------------------------
// One panel for both merchant shapes: a machine and a person differ only in
// what they hand this function. Two short columns - what they have, what you
// have - because this is the first screen in the game that asks the player to
// COMPARE rather than click a thing and have the thing happen. The price lives
// in the button, so nothing has to be read twice.
//
// `show()` takes a fully-resolved view (shopping.js owns the arithmetic):
//   { name, greeting, cash, buys,
//     stock: [{ item, name, icon, qty, price, affordable }],
//     sellable: [{ id, index, name, icon, paid }] }
export function createShopPanel({ onBuy, onSell, onClose }) {
  const panel = document.createElement('div');
  panel.id = 'shop-panel';
  Object.assign(panel.style, PANEL_CHROME, {
    position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
    zIndex: '29', width: 'min(620px, 94vw)', display: 'none', borderRadius: '12px',
    padding: '16px 18px', userSelect: 'none', maxHeight: '80vh', overflowY: 'auto',
  });
  panel.onmousedown = (e) => e.stopPropagation(); // clicks stay off the canvas
  document.body.appendChild(panel);

  const btn = (label, title, enabled) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title;
    Object.assign(b.style, {
      padding: '4px 9px', borderRadius: '5px', border: '1px solid #3a3a52',
      background: enabled ? '#2e2e46' : '#26262e', color: enabled ? '#f0f0f5' : '#7a7a8c',
      font: '11px system-ui, sans-serif', cursor: enabled ? 'pointer' : 'default',
      whiteSpace: 'nowrap',
    });
    b.disabled = !enabled;
    return b;
  };

  // One goods row: icon + name (+ how many are left), then its verb button.
  function row(icon, name, note, button) {
    const r = document.createElement('div');
    Object.assign(r.style, {
      display: 'flex', alignItems: 'center', gap: '7px', padding: '5px 2px',
      borderTop: '1px solid #2c2c42',
    });
    const n = document.createElement('div');
    n.style.flex = '1';
    n.textContent = `${icon || '📦'} ${name}`;
    r.appendChild(n);
    if (note) {
      const q = document.createElement('div');
      Object.assign(q.style, { opacity: '.55', fontSize: '11px' });
      q.textContent = note;
      r.appendChild(q);
    }
    r.appendChild(button);
    return r;
  }

  function column(title, emptyText) {
    const col = document.createElement('div');
    Object.assign(col.style, { flex: '1', minWidth: '0' });
    const h = document.createElement('div');
    Object.assign(h.style, {
      fontWeight: '700', letterSpacing: '1px', fontSize: '11px', opacity: '.7',
      marginBottom: '2px',
    });
    h.textContent = title;
    col.appendChild(h);
    col.__empty = emptyText;
    return col;
  }

  function finish(col) {
    if (col.children.length > 1) return col;
    const e = document.createElement('div');
    Object.assign(e.style, { opacity: '.5', padding: '6px 2px' });
    e.textContent = col.__empty;
    col.appendChild(e);
    return col;
  }

  function show(view) {
    panel.innerHTML = '';
    const head = document.createElement('div');
    Object.assign(head.style, { display: 'flex', alignItems: 'baseline', gap: '10px' });
    const nm = document.createElement('div');
    Object.assign(nm.style, { fontWeight: '700', letterSpacing: '1px', color: '#8adf76', flex: '1' });
    nm.textContent = view.name;
    head.appendChild(nm);
    const cash = document.createElement('div');
    cash.id = 'shop-cash';
    Object.assign(cash.style, { fontWeight: '700' });
    cash.textContent = `💵 ${view.cash}`;
    head.appendChild(cash);
    panel.appendChild(head);

    const greet = document.createElement('div');
    Object.assign(greet.style, { opacity: '.75', margin: '4px 0 12px', lineHeight: '1.45' });
    greet.textContent = view.greeting;
    panel.appendChild(greet);

    const cols = document.createElement('div');
    Object.assign(cols.style, { display: 'flex', gap: '18px', alignItems: 'flex-start' });

    const forSale = column('FOR SALE', 'SOLD OUT. Try another floor.');
    view.stock.forEach((s, i) => {
      const b = btn(`Buy — ${s.price}💵`, s.affordable ? '' : 'Not enough Petty Cash', s.affordable);
      b.id = `shop-buy-${i}`;
      b.onclick = () => onBuy(i);
      forSale.appendChild(row(s.icon, s.name, s.qty > 1 ? `×${s.qty}` : '', b));
    });
    cols.appendChild(finish(forSale));

    // A merchant that doesn't buy gets no second column at all, rather than an
    // empty one - a machine refusing your stapler is a fact about machines, not
    // a thing you should have to discover by clicking.
    if (view.buys) {
      const yours = column('THEY WILL TAKE', 'Nothing here they want.');
      view.sellable.forEach((s) => {
        const b = btn(`Sell +${s.paid}💵`, '', true);
        b.id = `shop-sell-${s.index}`;
        // The item id rides along with the index: the host verifies the pocket
        // still holds what this button was drawn for before selling anything.
        b.onclick = () => onSell(s.index, s.id);
        yours.appendChild(row(s.icon, s.name, '', b));
      });
      cols.appendChild(finish(yours));
    }
    panel.appendChild(cols);

    const close = document.createElement('button');
    close.id = 'shop-close';
    Object.assign(close.style, BUTTON_CHROME, {
      marginTop: '14px', padding: '8px 10px', borderRadius: '7px', width: '100%',
    });
    close.textContent = view.buys ? 'That\'s everything.' : 'Step away from the machine.';
    close.onclick = () => onClose();
    panel.appendChild(close);

    panel.style.display = 'block';
  }

  function hide() { panel.style.display = 'none'; panel.innerHTML = ''; }
  return { show, hide, get visible() { return panel.style.display !== 'none'; } };
}
