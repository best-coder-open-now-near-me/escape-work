// Regenerate the branch-preview landing page.
//
//   node tools/preview-index.mjs <gh-pages-dir>
//
// Scans <dir>/preview/* and writes <dir>/index.html listing every preview that
// currently exists. Run it after adding a preview and after deleting one, so
// the list never advertises a build that is no longer there.
//
// Branch slugs are lossy on purpose (see .github/workflows/preview.yml), so
// each preview directory carries a `branch.txt` with the real branch name.
// The listing prefers that over the slug; a preview published before this
// existed just shows its slug.
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.argv[2];
if (!ROOT) {
  console.error('usage: node tools/preview-index.mjs <gh-pages-dir>');
  process.exit(1);
}

const PREVIEWS = join(ROOT, 'preview');

const slugs = existsSync(PREVIEWS)
  ? readdirSync(PREVIEWS).filter((n) => statSync(join(PREVIEWS, n)).isDirectory())
  : [];

const entries = slugs
  .map((slug) => {
    const nameFile = join(PREVIEWS, slug, 'branch.txt');
    const branch = existsSync(nameFile) ? readFileSync(nameFile, 'utf8').trim() : slug;
    // Mtime of the preview directory is close enough to "when was this built" -
    // the publish step rewrites the directory wholesale every time.
    const built = statSync(join(PREVIEWS, slug)).mtime;
    return { slug, branch, built };
  })
  .sort((a, b) => b.built - a.built);

// Escape into HTML text/attributes. Branch names are attacker-controllable in
// principle (anyone who can push a branch names it), and this page is public.
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);

const rows = entries.length
  ? entries
      .map(
        (e) => `      <li>
        <a href="preview/${esc(encodeURIComponent(e.slug))}/">${esc(e.branch)}</a>
        <time datetime="${esc(e.built.toISOString())}">${esc(e.built.toISOString().replace('T', ' ').slice(0, 16))} UTC</time>
      </li>`,
      )
      .join('\n')
  : '      <li class="empty">No previews right now. Push a branch.</li>';

writeFileSync(
  join(ROOT, 'index.html'),
  `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Escape Work - branch previews</title>
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0; padding: 40px 20px; background: #1a1a26; color: #f0f0f5;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    }
    main { max-width: 640px; margin: 0 auto; }
    h1 { font-size: 20px; letter-spacing: 1px; font-weight: 600; margin: 0 0 6px; }
    p.sub { margin: 0 0 28px; opacity: .6; font-size: 13px; line-height: 1.5; }
    ul { list-style: none; padding: 0; margin: 0; }
    li {
      display: flex; align-items: baseline; gap: 12px; padding: 12px 14px;
      border: 1px solid #3a3a52; border-radius: 9px; margin-bottom: 8px;
      background: rgba(20,20,32,.82);
    }
    li.empty { opacity: .5; }
    a { color: #8adf76; text-decoration: none; font-weight: 600; overflow-wrap: anywhere; }
    a:hover { text-decoration: underline; }
    time { margin-left: auto; opacity: .45; font-size: 12px; white-space: nowrap; }
  </style>
</head>
<body>
  <main>
    <h1>Escape Work - branch previews</h1>
    <p class="sub">
      Unverified builds, one per pushed branch. These skip the test suite
      entirely - they are for looking at, not for trusting. The real release
      is on itch.io.
    </p>
    <ul>
${rows}
    </ul>
  </main>
</body>
</html>
`,
);

console.log(`Preview index -> ${entries.length} build(s)`);
