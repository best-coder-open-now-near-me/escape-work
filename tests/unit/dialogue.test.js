// The conversation rules. Reachable from node only since `ui/chrome.js` stopped
// registering a resize listener at import time - the whole `ui/` layer and the
// three host-callback modules downstream of it (doors, dialogue, shopping) were
// locked out of the unit suite by that one line.
import test from 'node:test';
import assert from 'node:assert';
import { nodeOptions } from '../../src/dialogue.js';

test('a node offers what it declares', () => {
  const node = { options: [{ label: 'Go on' }, { label: 'Leave', next: null }] };
  assert.equal(nodeOptions(node).length, 2);
});

test('a recruit option is hidden when there is no room', () => {
  const node = { options: [{ label: 'Join me', effect: { recruit: true } }] };
  assert.equal(nodeOptions(node, { canRecruit: true })[0].label, 'Join me');
  assert.notEqual(nodeOptions(node, { canRecruit: false })[0].label, 'Join me');
});

test('a shop option is hidden from somebody with no cart', () => {
  const node = { options: [{ label: 'Show me the cart.', effect: { shop: true } }] };
  assert.equal(nodeOptions(node, { hasShop: true })[0].label, 'Show me the cart.');
  assert.notEqual(nodeOptions(node, { hasShop: false })[0].label, 'Show me the cart.');
});

test('a conversation always has a way out - even when every option is gated', () => {
  // The soft-lock this function exists to prevent. The fallback used to sit on
  // the raw option list, so it only fired for a node with NO options declared;
  // a node whose every option was FILTERED away returned an empty array and the
  // panel had no button to close on.
  const gated = { options: [{ label: 'Show me the cart.', effect: { shop: true } }] };
  const out = nodeOptions(gated, { canRecruit: false, hasShop: false });
  assert.equal(out.length, 1);
  assert.equal(out[0].label, 'Leave');
  assert.equal(out[0].next, null, 'and it ends the conversation');
});

test('a node with no options at all still offers Leave', () => {
  assert.deepEqual(nodeOptions({}), [{ label: 'Leave', next: null }]);
  assert.deepEqual(nodeOptions(null), [{ label: 'Leave', next: null }]);
  assert.deepEqual(nodeOptions({ options: [] }), [{ label: 'Leave', next: null }]);
});

test('the Leave fallback is not shared mutable state', () => {
  // Two dead-end nodes must not be able to scribble on each other's options.
  const a = nodeOptions({});
  assert.equal(a[0].label, 'Leave');
  assert.equal(nodeOptions({})[0].label, 'Leave');
});
