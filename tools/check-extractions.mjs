// A static check for the ONE bug class every module extraction in this codebase
// has produced: a name the rewrite failed to rebind, which builds clean and
// throws only in a browser.
//
// Four variants have shipped and been caught the expensive way (a 10-30 minute
// e2e round each), and all four are the same mistake seen from a different
// angle:
//   1. a bare READ (`by = active`) - not followed by `(` or `.`, so a
//      call-shaped scan walks past it;
//   2. a SPREAD (`...world`) - the dots read as property access to any
//      `(?<![.\w])` lookbehind;
//   3. a rule passed as a VALUE (`truncateByBudget(s, b, stepCost)`);
//   4. a property KEY that shares a name with a real dependency (`log:`).
//
// The check is deliberately dumb: for each extracted module, collect every
// identifier that is not declared locally, not a parameter, not a known global,
// and not a property key - then report it. Everything that is not code is
// removed first, in one pass (stripNotCode). A hit is not automatically a bug,
// but every real bug of this class IS a hit, which is the property that
// matters - and that property is only as good as the two halves below.
//
// What it can MISS is worth as much as what it catches, because both halves
// have failed silently:
//   - the strip has to be right. A regex literal left in reported an `w` that
//     was `[\w-]+`, and a nested template left prose in as code.
//   - masking has to be narrow. A `get x()` used to DECLARE `x` for the whole
//     file, which made `get armed() { return armed; }` - the unbound read this
//     tool exists for - invisible, in the two modules built entirely out of
//     that shape. Keys are erased from the read stream now, not declared.
// Both were found by mutation rather than by reading: break a name on purpose
// and check the tool says so. Do that after changing anything in here.
import { readFileSync } from 'node:fs';

const MODULES = [
  'src/combat-aim.js', 'src/combat-world.js', 'src/hotbar-host.js',
  'src/floor-effects.js', 'src/desk.js', 'src/combat-advance.js', 'src/ooc-verbs.js',
  'src/party-control.js', 'src/sneak-layer.js', 'src/progression-ui.js', 'src/summon-layer.js', 'src/walking.js', 'src/examine.js', 'src/keyboard.js', 'src/mouse.js', 'src/combat-entry.js', 'src/frame.js', 'src/debug-handles.js', 'src/combat-handle.js',
];
// The HOST side of every seam. Nothing here takes a deps bag, so the `d` rules
// do not apply - but the unbound scan does, and this is the half that has twice
// kept reading a name the cut took away: `setPreview` once, and `openLevelUpFor`
// on the progression cut, which stayed wired to the party bar's level-up pip
// after every declaration of it had moved out. Both are a ReferenceError on a
// click, and a build reports neither.
const HOSTS = ['src/main.js', 'src/combat.js'];
const GLOBALS = new Set([
  'if', 'else', 'return', 'const', 'let', 'var', 'new', 'true', 'false', 'null', 'undefined',
  'for', 'of', 'in', 'function', 'continue', 'break', 'export', 'import', 'from', 'typeof',
  'try', 'catch', 'throw', 'delete', 'void', 'this', 'async', 'await', 'class', 'switch', 'case',
  'default', 'do', 'while', 'yield', 'instanceof',
  'Math', 'Number', 'Object', 'Array', 'String', 'JSON', 'Set', 'Map', 'Date', 'Infinity', 'NaN',
  'Promise', 'Error', 'console', 'window', 'document', 'localStorage', 'location', 'globalThis',
  'URLSearchParams', 'Symbol', 'WeakMap', 'WeakSet', 'RegExp', 'Boolean', 'Function',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'performance',
]);

// Two more ways a mechanical rewrite corrupts a module, both of which shipped:
// a dependency name written INSIDE a string literal (`'player'` became
// `'d.player'`, a team argument that silently stopped matching), and a local
// declared with the same name as the deps bag (`const d = grid.defAt(...)`,
// which shadowed `d` and made every other `d.` on that line a dead-zone read).
// Neither is an unbound identifier, so the scan below cannot see them.
function rewriteDamage(raw, file) {
  const hits = [];
  for (const m of raw.matchAll(/(['"])d\.[A-Za-z_$][\w$]*\1/g)) {
    hits.push(`${file}: a dependency name inside a string literal - ${m[0]}`);
  }
  for (const m of raw.matchAll(/(?:const|let|var)\s+d\s*=/g)) {
    hits.push(`${file}: a local named \`d\` shadows the deps bag`);
  }
  // The same shadow through a PARAMETER, which is how it actually shipped:
  // `(d) => d.applyDamage(m.sheet, d)`. The original read `(d) => applyDamage(
  // m.sheet, d)` and the rewrite prefixed the call without noticing that `d`
  // was already taken - so `d.applyDamage` became a property of the damage
  // NUMBER, and every out-of-combat status dot on a party member or a summon
  // threw. Only a declaration was checked for, and this is a binding.
  for (const m of raw.matchAll(/\(\s*d\s*\)\s*=>|\(\s*d\s*,|,\s*d\s*\)\s*(?:=>|\{)/g)) {
    hits.push(`${file}: a parameter named \`d\` shadows the deps bag - ${m[0].trim()}`);
  }
  // ASSIGNING to the deps bag. `d` is a plain object of getters and functions,
  // so `d.inCombat = true` writes a property on the BAG - and since a getter
  // with no setter is read-only, in a module (always strict) that throws. The
  // host's binding never changes either way.
  //
  // This is how it shipped: the rewriter prefixed `inCombat = true` to
  // `d.inCombat = true`, and the pass that was supposed to turn assignments
  // into `setInCombat(true)` ran afterwards, looking for the UNPREFIXED form.
  // It matched nothing, and combat stopped starting at all.
  //
  // Worse, the diff used to verify that cut normalised `d.` away - which made
  // `d.inCombat = true` and `inCombat = true` compare EQUAL. The one check that
  // was supposed to catch a bad rewrite was blind to exactly this class, which
  // is why it needs to be a rule here instead.
  //
  // Every write from a module goes through a named setter. No exceptions: if a
  // module needs to change a host binding, the bag says so out loud.
  for (const m of raw.matchAll(/\bd\.([A-Za-z_$][\w$]*)\s*(?:=[^=]|\+=|-=|\|\|=|\?\?=)/g)) {
    hits.push(`${file}: assigns to \`d.${m[1]}\` - a deps bag is read-only, use a named setter`);
  }
  return hits;
}

// The third kind of rewrite damage, and the only one that is a MISMATCH rather
// than a corruption: an OBJECT dependency handed the call-through wrapper that
// every function dependency gets. `charSheet: (...a) => charSheet(...a)` makes
// `d.charSheet` a function, so `d.charSheet.refresh(...)` is a TypeError on
// every leader switch - and the name is bound, the code parses, and the party
// spec passed because the throw landed on the last line of the function, after
// everything it asserts.
//
// So: for every `d.<name>.<prop>` a module reads, if a bag anywhere passes
// `<name>` as `(...a) => <name>(...a)`, the two disagree about its shape.
// Property access on a wrapper is never what the caller meant.
const BAGS = ['src/main.js', 'src/combat.js'].map((f) => readFileSync(f, 'utf8')).join('\n');
const wrapped = new Set(
  [...BAGS.matchAll(/^\s+([A-Za-z_$][\w$]*): \(\.\.\.a\) =>/gm)].map((m) => m[1]));
function shapeMismatch(raw, file) {
  const hits = new Set();
  for (const m of raw.matchAll(/\bd\.([A-Za-z_$][\w$]*)\.[A-Za-z_$]/g)) {
    if (wrapped.has(m[1])) {
      hits.add(`${file}: reads \`d.${m[1]}.<prop>\`, but a bag passes ${m[1]} as a call-through wrapper - that property is undefined`);
    }
  }
  return [...hits];
}

// The fourth: a `d.<name>` that NO bag supplies. `d` is a bound parameter, so
// every property off it looks fine to the scan below - it just evaluates to
// undefined and throws at the call. This is what a cut produces when a function
// moves INTO a module that used to receive it: `tickTurnClockOn` came off the
// deps bag the same commit it became a local, and three callers upstairs in the
// same file kept saying `d.tickTurnClockOn(...)`.
//
// The supply side is read from the factory's own call site, not guessed: find
// `create<Name>({ ... })` in a host and take that literal's top-level keys,
// including `get x()` and shorthand.
function bagKeysFor(factory) {
  const at = BAGS.indexOf(`${factory}({`);
  if (at < 0) return null; // not wired up anywhere - nothing to check against
  let i = BAGS.indexOf('{', at);
  let depth = 0;
  let end = i;
  for (; end < BAGS.length; end += 1) {
    if (BAGS[end] === '{') depth += 1;
    else if (BAGS[end] === '}') { depth -= 1; if (depth === 0) break; }
  }
  const lit = BAGS.slice(i, end + 1);
  const keys = new Set();
  for (const m of lit.matchAll(/^\s+(?:get\s+)?([A-Za-z_$][\w$]*)\s*[:(,]/gm)) keys.add(m[1]);
  for (const m of lit.matchAll(/^\s+([A-Za-z_$][\w$]*),\s*$/gm)) keys.add(m[1]);
  return keys;
}
function unsuppliedDeps(raw, file) {
  const factory = raw.match(/^export function (create[A-Za-z_$][\w$]*)/m)?.[1];
  if (!factory) return [];
  const keys = bagKeysFor(factory);
  if (!keys) return [];
  const hits = new Set();
  for (const m of raw.matchAll(/\bd\.([A-Za-z_$][\w$]*)/g)) {
    if (!keys.has(m[1])) hits.add(`${file}: reads \`d.${m[1]}\`, which no bag supplies`);
  }
  return [...hits];
}

// And the fifth, which is about the CALL SITE rather than the module: a
// dependency passed EAGERLY whose declaration sits below the factory call.
// `createWalking({ controls, ... })` reads `controls` the moment the bag is
// built, and if `const controls = createControls(...)` is two hundred lines
// further down that is a temporal dead zone - a ReferenceError at boot. The
// fix is always the same (`get controls() { return controls; }`, or a
// `(...a) =>` wrapper), and main.js already carries a comment naming four
// consts it had to do this for. A comment is not a check.
//
// Only EAGER entries can trip: a getter body and a wrapper arrow both defer the
// read to call time, which is exactly why they are the fix.
function deadZoneDeps(hostSrc, hostName) {
  const hits = [];
  for (const call of hostSrc.matchAll(/\b(create[A-Za-z_$][\w$]*)\(\{/g)) {
    const open = hostSrc.indexOf('{', call.index);
    let depth = 0;
    let end = open;
    for (; end < hostSrc.length; end += 1) {
      if (hostSrc[end] === '{') depth += 1;
      else if (hostSrc[end] === '}') { depth -= 1; if (depth === 0) break; }
    }
    const lit = hostSrc.slice(open, end + 1);
    const eager = new Set();
    for (const m of lit.matchAll(/^\s{4}([A-Za-z_$][\w$]*),\s*$/gm)) eager.add(m[1]);
    for (const m of lit.matchAll(/^\s{4}([A-Za-z_$][\w$]*):\s*([A-Za-z_$][\w$]*),\s*$/gm)) eager.add(m[2]);
    for (const name of eager) {
      // `function` declarations HOIST, so a function passed eagerly from above
      // its own declaration is fine - `onExplosion: handleExplosion` is the
      // house example. Only the let/const family has a dead zone.
      // Destructured declarations count: `const { panHeld } = createKeyboard(...)`
      // binds `panHeld` exactly as a plain const does, and matching only the
      // `const name` form let a genuine dead-zone read through - `panHeld` was
      // passed to a factory a thousand lines above the destructure that binds
      // it, and the whole game failed to boot.
      const decl = hostSrc.search(new RegExp(
        `^\\s*(?:const|let|var)\\s+(?:${name}\\b|[{[][^=]*\\b${name}\\b[^=]*[}\\]]\\s*=)`, 'm'));
      if (decl > end) {
        hits.push(`${hostName}: ${call[1]} is passed \`${name}\` eagerly, but \`${name}\` is declared below the call - a dead-zone read at boot (use a getter or a wrapper)`);
      }
    }
  }
  return hits;
}

// Everything in a source file that is NOT code, removed in ONE left-to-right
// pass: comments, the three string flavours, and regex literals. It used to be
// a chain of independent regex replaces, and a chain cannot do this job -
// each pass re-reads text the previous one already mangled, so one bad strip
// cascades into the rest.
//
// Both failures the chain actually produced are worth keeping written down,
// because they look like unrelated bugs and are the same one:
//
//   - a REGEX literal was never stripped at all, so `[\w-]+` reported an
//     unbound `w`. It hid for as long as it did because something else in the
//     same file happened to declare `w`; the masking was doing the work.
//   - NESTED templates broke the template pass: the non-greedy `` `[\s\S]*?` ``
//     ends at the first inner backtick, so the rest of the prose came out as
//     code AND the leaked backtick unbalanced the quote passes that ran next -
//     which is why combat.js reported `colleague`, `patches` and `up`, three
//     words out of a log line, only one of which is even in the broken
//     template. That is the cascade: the visible hits were not where the bug
//     was.
//
// What is KEPT is as important as what goes: the contents of `${...}` are real
// code, and dropping them once hid a live `summonRange(a)` call inside an
// interpolated sentence - a module shipped with it unbound. So an
// interpolation's body is emitted as code, however deeply nested.
function stripNotCode(src) {
  let out = '';
  let i = 0;
  // The mode stack. `tpl` means "inside a template's PROSE" (emit nothing);
  // anything else is code. An interpolation pushes a brace depth, so `${...}`
  // knows which `}` hands the reader back to the prose - which is the whole
  // trick, and the reason this is a stack rather than a recursive walk. A
  // recursive one was tried first and double-counted: it walked the nested
  // template AND re-emitted the raw range around it, so the prose came back
  // out as code anyway.
  const stack = [];
  const inTemplate = () => stack[stack.length - 1]?.type === 'tpl';
  // Whether a `/` here opens a regex or divides. Regex only follows an operand
  // POSITION - an operator, an opening bracket, or a keyword - never a value.
  const opensRegex = () => {
    const before = out.replace(/\s+$/, '');
    if (!before) return true;
    if ('=(,:[!&|?{};+-*%~^<>'.includes(before[before.length - 1])) return true;
    return /\b(return|typeof|case|in|of|new|delete|void|do|else|yield|await)$/.test(before);
  };
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (inTemplate()) {
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { stack.pop(); out += ')'; i += 1; continue; }
      // The contents of `${...}` are real code, and dropping them once hid a
      // live `summonRange(a)` call inside an interpolated sentence - a module
      // shipped with it unbound. So the body is emitted; only prose is not.
      if (c === '$' && next === '{') { stack.push({ type: 'interp', depth: 0 }); out += ';'; i += 2; continue; }
      i += 1; // prose
      continue;
    }
    if (c === '/' && next === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
    if (c === '/' && next === '*') { const at = src.indexOf('*/', i); i = at < 0 ? src.length : at + 2; continue; }
    if (c === "'" || c === '"') {
      i += 1;
      while (i < src.length && src[i] !== c) i += src[i] === '\\' ? 2 : 1;
      i += 1;
      out += c + c;
      continue;
    }
    if (c === '`') { stack.push({ type: 'tpl' }); out += '('; i += 1; continue; }
    if (c === '{') { const top = stack[stack.length - 1]; if (top?.type === 'interp') top.depth += 1; out += c; i += 1; continue; }
    if (c === '}') {
      const top = stack[stack.length - 1];
      if (top?.type === 'interp') {
        if (top.depth === 0) { stack.pop(); out += ';'; i += 1; continue; } // back to the prose
        top.depth -= 1;
      }
      out += c;
      i += 1;
      continue;
    }
    if (c === '/' && opensRegex()) {
      i += 1;
      let inClass = false;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        else if (src[i] === '/' && !inClass) break;
        else if (src[i] === '\n') break; // unterminated - it was division after all
        i += 1;
      }
      i += 1;
      while (i < src.length && /[gimsuy]/.test(src[i])) i += 1;
      out += '/(?:)/';
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

let bad = 0;
for (const file of [...MODULES, ...HOSTS]) {
  const raw = readFileSync(file, 'utf8');
  if (!HOSTS.includes(file)) {
    for (const hit of rewriteDamage(raw, file)) { bad += 1; console.log(hit); }
    for (const hit of shapeMismatch(raw, file)) { bad += 1; console.log(hit); }
    for (const hit of unsuppliedDeps(raw, file)) { bad += 1; console.log(hit); }
  }
  if (HOSTS.includes(file)) {
    for (const hit of deadZoneDeps(raw, file)) { bad += 1; console.log(hit); }
  }
  let code = stripNotCode(raw.replace(/^import\s[\s\S]*?from\s*['"][^'"]*['"];?$/gm, ''));
  const declared = new Set([...code.matchAll(/(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
  // Imported names count as declared - a module that imports `ACTIONS` is not
  // reading an unbound one.
  for (const m of raw.matchAll(/^import\s+\*\s+as\s+([A-Za-z_$][\w$]*)/gm)) declared.add(m[1]);
  for (const m of raw.matchAll(/^import\s+(?:\{([^}]*)\}|([A-Za-z_$][\w$]*))/gm)) {
    for (const part of (m[1] || m[2] || '').split(',')) {
      const n = part.trim().split(/\s+as\s+/).pop().trim();
      if (/^[A-Za-z_$][\w$]*$/.test(n)) declared.add(n);
    }
  }
  // Parameters, including destructured ones, and destructuring assignments.
  // Parameter lists. A control-flow head looks exactly like one to a naive
  // regex, and treating `for (const [dx, dz] of DIRS8) {` as params declared
  // DIRS8 - so a genuinely unbound DIRS8 sailed through and only turned up
  // when the followers stopped following. Skip any head introduced by a
  // control keyword, and any head that declares or iterates.
  // One level of nesting is allowed inside the head, because a DEFAULT VALUE
  // may be a call: `(body, opts = sneakSightOpts()) =>` has parens in it, and a
  // flat `[^()]*` cannot span them - so the head never matched and every
  // parameter in it was reported unbound.
  for (const m of code.matchAll(/(\w+)?\s*\(((?:[^()]|\([^()]*\))*)\)\s*(?:=>|\{)/g)) {
    if (/^(?:for|if|while|switch|catch)$/.test(m[1] || '')) continue;
    const head = m[2];
    if (/\b(?:const|let|var|of|in)\b/.test(head)) continue;
    for (const part of head.split(',')) {
      const n = part.split('=')[0].replace(/[{}[\].]/g, ' ').trim().split(/\s+/).pop();
      if (n && /^[A-Za-z_$][\w$]*$/.test(n)) declared.add(n);
    }
  }
  // Array destructuring, including `for (const [a, b] of ...)`.
  for (const m of code.matchAll(/(?:const|let|var)\s*\[([^\]]*)\]/g)) {
    for (const part of m[1].split(',')) {
      const n = part.trim();
      if (/^[A-Za-z_$][\w$]*$/.test(n)) declared.add(n);
    }
  }
  // Object destructuring in a for-of head has no `=` to key off.
  for (const m of code.matchAll(/for\s*\((?:const|let|var)\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const n = part.split(':').pop().trim();
      if (/^[A-Za-z_$][\w$]*$/.test(n)) declared.add(n);
    }
  }
  // A getter, setter or shorthand method NAMES A KEY. It used to be added to
  // `declared`, and that is too strong: `declared` masks the name everywhere in
  // the file, so `get armed() { return armed; }` - the exact unbound read this
  // check exists to catch - was invisible, because the key had vouched for it.
  // combat-handle.js is a hundred and eighty lines of getters named after the
  // dependency each one returns, which is the shape that makes this matter.
  //
  // So the header is erased from the read stream instead of being declared: the
  // key stops counting as a read, and stops covering for one. A plain `name:`
  // key needs no help - the scan's own `(?!\s*:)` already skips it. Shorthand
  // methods stay in scope because one WAS a real bug (`setPreview` existed only
  // as a method and the moved code called it as a function), and that failure
  // shows up at the CALL site, which is untouched by this.
  code = code
    .replace(/^(\s{2,})([A-Za-z_$][\w$]*)(\s*\([^)]*\)\s*\{)/gm, '$1__key__$3')
    .replace(/\b(get|set)\s+([A-Za-z_$][\w$]*)\s*\(/g, '$1 __key__(');
  declared.add('__key__');
  declared.add('get');
  declared.add('set');
  for (const m of code.matchAll(/\{([^{}]*)\}\s*=/g)) {
    for (const part of m[1].split(',')) {
      const n = part.split(':').pop().split('=')[0].trim();
      if (n && /^[A-Za-z_$][\w$]*$/.test(n)) declared.add(n);
    }
  }
  // Everything that is not a property key (`name:`), not after a dot, and not
  // a declared name. A SPREAD counts: `...world` is an identifier read.
  const seen = new Set();
  for (const m of code.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\b(?!\s*:)/g)) {
    const n = m[1];
    if (declared.has(n) || GLOBALS.has(n) || seen.has(n)) continue;
    // `...name` is a read even though the lookbehind sees a dot; catch it here.
    seen.add(n);
  }
  const spreads = [...code.matchAll(/\.\.\.([A-Za-z_$][\w$]*)/g)]
    .map((m) => m[1]).filter((n) => !declared.has(n) && !GLOBALS.has(n));
  const hits = [...new Set([...seen, ...spreads])].sort();
  if (hits.length) {
    bad += hits.length;
    console.log(`${file}: ${hits.length} unbound identifier(s)`);
    console.log(`   ${hits.join(', ')}`);
  }
}
console.log(bad ? `\n${bad} to review - each is either a real unbound read or a false positive worth knowing about.` : 'All extracted modules bind every name they read.');
