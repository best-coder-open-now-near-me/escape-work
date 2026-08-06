// Talking to people, and signing them on. Shaped like shopping.js/looting.js:
// the host supplies live accessors and the acts only it can perform (mint a
// sheet, re-tag a body for picking, open the shop), and this module owns the
// conversation state and how a dialogue tree turns into a panel.
//
// The tree-walking half is exported pure as `nodeOptions`, because that is
// where the rules are: which options a node actually offers depends on who is
// speaking and how full the party is, and getting that wrong shows a recruit
// offer that cannot be accepted or a trade option from somebody with no cart.

import * as ui from './ui.js';

// The options a node offers RIGHT NOW. A node with none at all still gets a way
// out - a conversation you cannot leave is a soft-lock with dialogue.
//
// Two filters, both about not offering what cannot be taken:
//   recruit - only while there is room and they are not already aboard
//   shop    - only from someone who actually has a cart
const LEAVE = [{ label: 'Leave', next: null }];

export function nodeOptions(node, { canRecruit = false, hasShop = false } = {}) {
  const offered = (node?.options || [])
    .filter((o) => !o.effect?.recruit || canRecruit)
    .filter((o) => !o.effect?.shop || hasShop);
  // The way out is applied AFTER the filters, not instead of them. It used to
  // be the `||` fallback on the raw list, which only fired for a node with NO
  // options declared - so a node whose every option was gated (a recruit offer
  // to a full party, a trade line from somebody with no cart) filtered down to
  // an empty array and the panel had no button to close on. That is the
  // soft-lock the comment above says this function exists to prevent.
  return offered.length ? offered : LEAVE;
}

export function createDialogue({
  panel, getParty, getPlayer, partyCap, isRecruitable,
  isInCombat, isGameOver, onRecruit, onShop, onOpen,
}) {
  let npc = null;
  let tree = null;

  const canRecruit = (who) => isRecruitable(who)
    && !who.recruited
    && !!getParty()
    && getParty().members.length < partyCap;

  function open(who) {
    if (isInCombat() || isGameOver() || !who) return;
    // A restored companion may have nothing left to say.
    const t = (who.recruited && who.def.recruitedDialogue) || who.def.dialogue;
    if (!t) return;
    npc = who;
    tree = t;
    const p = getPlayer();
    who.faceToward(p.x, p.z);
    onOpen();
    render(tree.start);
  }

  function close() {
    npc = null;
    tree = null;
    panel.hide();
  }

  function render(nodeId) {
    const node = tree?.nodes[nodeId];
    if (!node) { close(); return; }
    const speaker = npc;
    const options = nodeOptions(node, {
      canRecruit: canRecruit(npc),
      hasShop: !!npc.def?.shop,
    }).map((o) => ({
      label: o.label,
      action: () => {
        if (o.effect?.recruit) onRecruit(speaker);
        // Trading REPLACES the conversation rather than layering on it: the
        // shop is its own modal, and two panels stacked over each other is how
        // you get a click that lands on neither (ECONOMY_PLAN #5).
        if (o.effect?.shop && speaker.def?.shop) {
          close();
          onShop(speaker);
          return;
        }
        if (o.next) render(o.next); else close();
      },
    }));
    panel.show({ name: npc.def.name, text: node.text, options });
  }

  return {
    open,
    close,
    canRecruit,
    get visible() { return panel.visible; },
    get speaker() { return npc; },
  };
}

// Where a person's stock lives: keyed by WHO, not where. A person carries their
// cart around - and a recruited one literally walks off with it - so their
// instance key must survive them moving.
export const shopKeyForNpc = (who) => `npc:${who.typeId || who.def.name}`;

// Narration for a signing. Here rather than at the call site so the two places
// that can recruit somebody say the same thing.
export const sayRecruited = (name) => ui.toast(`${name} joins the party.`);
