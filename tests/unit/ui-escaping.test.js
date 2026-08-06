// Player-typed strings reach four `innerHTML` surfaces: the stats card, the
// party bar, the combat initiative strip and the shop heading. `cleanName`
// only collapses whitespace and clamps length, so anything short enough
// survives to the DOM verbatim - and since the cloud save landed, the string
// need not have come from this keyboard.
//
// Testable at all only because ui/chrome.js stopped registering a resize
// listener at import time.
import test from 'node:test';
import assert from 'node:assert';
import { esc } from '../../src/ui/chrome.js';

test('esc neutralises the characters that can open a tag or close an attribute', () => {
  assert.equal(esc('<svg onload=alert(1)>'), '&lt;svg onload=alert(1)&gt;');
  assert.equal(esc('" onerror="x'), '&quot; onerror=&quot;x');
  assert.equal(esc("' onerror='x"), '&#39; onerror=&#39;x');
  assert.equal(esc('a & b'), 'a &amp; b');
});

test('esc escapes the ampersand without double-escaping its own output', () => {
  // Ordering matters: if & were replaced last, `&lt;` would come back as
  // `&amp;lt;` and the name would render as literal markup text.
  assert.equal(esc('<'), '&lt;');
  assert.equal(esc('&lt;'), '&amp;lt;', 'a literal &lt; typed by the player stays literal');
});

test('esc is total - it never returns undefined or throws', () => {
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(0), '0');
  assert.equal(esc(false), 'false');
  assert.equal(esc({}), '[object Object]');
});

test('an ordinary name is unchanged', () => {
  // The escaping must be invisible for every name anybody actually types.
  for (const name of ['Dave', "O'Brien", 'Anne-Marie', 'Иван', '田中']) {
    assert.equal(esc(name), name === "O'Brien" ? 'O&#39;Brien' : name);
  }
});
