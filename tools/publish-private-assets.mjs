// Publish a prepared private runtime-asset tree to its dedicated repository.
// A normal invocation is a read-only diff. `--push` is the explicit mutation
// gate: validate the profile, sync only managed paths, commit, then push.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PUBLISH_INDEX = 'asset-publish-index.json';
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const compareText = (a, b) => (a < b ? -1 : (a > b ? 1 : 0));
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

function safeRelativePath(value, label = 'asset path') {
  const clean = String(value).replaceAll('\\', '/').replace(/^\.\//, '');
  if (
    !clean
    || isAbsolute(clean)
    || /^[A-Za-z]:/.test(clean)
    || clean.split('/').some((part) => !part || part === '.' || part === '..')
    || clean === '.git'
    || clean.startsWith('.git/')
    || clean === PUBLISH_INDEX
  ) throw new Error(`${label} is not safe to publish: ${value}`);
  return clean;
}

export function snapshotAssetTree(rootPath) {
  const root = resolve(rootPath);
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`Asset source is not a directory: ${root}`);
  const files = [];
  const visit = (directory) => {
    const children = readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => compareText(a.name, b.name));
    for (const child of children) {
      const absolute = resolve(directory, child.name);
      const info = lstatSync(absolute);
      if (info.isSymbolicLink()) throw new Error(`Private asset publishing does not follow symbolic links: ${absolute}`);
      if (info.isDirectory()) visit(absolute);
      else if (info.isFile()) {
        const path = safeRelativePath(relative(root, absolute).split(sep).join('/'));
        const data = readFileSync(absolute);
        files.push({ path, absolute, bytes: data.length, sha256: sha256(data) });
      }
    }
  };
  visit(root);
  if (!files.length) throw new Error(`Asset source is empty: ${root}`);
  return files.sort((a, b) => compareText(a.path, b.path));
}

function oldManagedPaths(repo) {
  const path = resolve(repo, PUBLISH_INDEX);
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.files)) {
    throw new Error(`${PUBLISH_INDEX} has an unsupported shape.`);
  }
  return parsed.files.map((file) => safeRelativePath(file.path, `${PUBLISH_INDEX} path`));
}

function desiredIndex(files) {
  return `${JSON.stringify({
    schemaVersion: 1,
    files: files.map(({ path, bytes, sha256: hash }) => ({ path, bytes, sha256: hash })),
  }, null, 2)}\n`;
}

export function planAssetPublish({ source, repo }) {
  const sourceRoot = resolve(source);
  const repoRoot = resolve(repo);
  if (!existsSync(repoRoot) || !statSync(repoRoot).isDirectory()) {
    throw new Error(`Private asset checkout is not a directory: ${repoRoot}`);
  }
  const files = snapshotAssetTree(sourceRoot);
  const nextPaths = new Set(files.map((file) => file.path));
  const previousPaths = oldManagedPaths(repoRoot);
  const added = [];
  const updated = [];
  for (const file of files) {
    const destination = resolve(repoRoot, ...file.path.split('/'));
    if (!existsSync(destination)) added.push(file.path);
    else {
      const data = readFileSync(destination);
      if (data.length !== file.bytes || sha256(data) !== file.sha256) updated.push(file.path);
    }
  }
  const removed = previousPaths.filter((path) => !nextPaths.has(path) && existsSync(resolve(repoRoot, ...path.split('/'))));
  const indexText = desiredIndex(files);
  const indexPath = resolve(repoRoot, PUBLISH_INDEX);
  const indexChanged = !existsSync(indexPath) || readFileSync(indexPath, 'utf8') !== indexText;
  return {
    source: sourceRoot,
    repo: repoRoot,
    files,
    previousPaths,
    added: added.sort(compareText),
    updated: updated.sort(compareText),
    removed: removed.sort(compareText),
    indexText,
    indexChanged,
    changed: added.length > 0 || updated.length > 0 || removed.length > 0 || indexChanged,
  };
}

export function applyAssetPlan(plan) {
  for (const path of plan.removed) rmSync(resolve(plan.repo, ...path.split('/')), { force: true });
  for (const file of plan.files) {
    const destination = resolve(plan.repo, ...file.path.split('/'));
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(file.absolute, destination);
  }
  writeFileSync(resolve(plan.repo, PUBLISH_INDEX), plan.indexText);
  return [...new Set([
    ...plan.files.map((file) => file.path),
    ...plan.previousPaths,
    PUBLISH_INDEX,
  ])].sort(compareText);
}

function git(repo, args, allowedCodes = [0]) {
  const result = spawnSync(
    'git',
    ['-c', `safe.directory=${repo.split(sep).join('/')}`, '-C', repo, ...args],
    { encoding: 'utf8' },
  );
  if (!allowedCodes.includes(result.status)) {
    throw new Error((result.stderr || result.stdout || `git ${args[0]} failed`).trim());
  }
  return { code: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function canonicalPath(path) {
  const full = resolve(path);
  return process.platform === 'win32' ? full.toLowerCase() : full;
}

function canonicalRemote(remote) {
  return String(remote)
    .trim()
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/\.git\/?$/, '')
    .replace(/\/$/, '')
    .toLowerCase();
}

function verifyCheckout(repo, { expectedRemote, expectedBranch }) {
  const top = git(repo, ['rev-parse', '--show-toplevel']).stdout;
  if (canonicalPath(top) !== canonicalPath(repo)) throw new Error(`--repo must name the checkout root: ${top}`);
  const status = git(repo, ['status', '--porcelain', '--untracked-files=all']).stdout;
  if (status) throw new Error(`Private asset checkout has unrelated changes; refusing to publish:\n${status}`);
  const remote = git(repo, ['remote', 'get-url', 'origin']).stdout;
  if (!expectedRemote) throw new Error('--expect-remote is required with --push.');
  if (canonicalRemote(remote) !== canonicalRemote(expectedRemote)) {
    throw new Error(`Private asset remote mismatch: expected ${expectedRemote}, found ${remote}`);
  }
  const branch = git(repo, ['symbolic-ref', '--short', 'HEAD']).stdout;
  if (expectedBranch && branch !== expectedBranch) {
    throw new Error(`Private asset branch mismatch: expected ${expectedBranch}, found ${branch}`);
  }
  return branch;
}

function validateProfileSource(source, profile) {
  const result = spawnSync(
    process.execPath,
    ['build.mjs', `--profile=${profile}`],
    {
      cwd: PROJECT_ROOT,
      env: { ...process.env, ESCAPE_WORK_SYNTY_SOURCE: source },
      encoding: 'utf8',
    },
  );
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'Profile build validation failed.').trim());
  return result.stdout.trim();
}

export function publishAssets({
  source,
  repo,
  push = false,
  expectedRemote = null,
  expectedBranch = null,
  message = 'Update private runtime assets',
  profile = 'synty',
}) {
  if (!source || !repo) throw new Error('Both source and private checkout directories are required.');
  const plan = planAssetPublish({ source, repo });
  if (!plan.changed) return { changed: false, pushed: false, plan };
  if (!push) return { changed: true, pushed: false, plan };

  const branch = verifyCheckout(plan.repo, { expectedRemote, expectedBranch });
  const validation = validateProfileSource(plan.source, profile);
  const managed = applyAssetPlan(plan);
  for (let offset = 0; offset < managed.length; offset += 100) {
    git(plan.repo, ['add', '-A', '--', ...managed.slice(offset, offset + 100)]);
  }
  const staged = git(plan.repo, ['diff', '--cached', '--quiet'], [0, 1]);
  if (staged.code === 0) throw new Error('Publish plan reported changes, but Git found nothing to commit.');
  git(plan.repo, ['commit', '-m', message]);
  git(plan.repo, ['push', '-u', 'origin', branch]);
  const commit = git(plan.repo, ['rev-parse', 'HEAD']).stdout;
  return { changed: true, pushed: true, commit, branch, validation, plan };
}

function changeSummary(plan) {
  const rows = [];
  for (const path of plan.added) rows.push(`ADD    ${path}`);
  for (const path of plan.updated) rows.push(`UPDATE ${path}`);
  for (const path of plan.removed) rows.push(`REMOVE ${path}`);
  if (plan.indexChanged) rows.push(`UPDATE ${PUBLISH_INDEX}`);
  return rows;
}

function usage() {
  return `Usage:
  node tools/publish-private-assets.mjs --source <dir> --repo <checkout> [options]

Default mode is read-only and reports what would change.

Options:
  --push                    Validate, sync, commit, and push changed assets
  --expect-remote <url>     Required remote identity guard for --push
  --branch <name>           Required current branch (recommended: main)
  --message <text>          Commit message
  --profile <id>            Art profile to validate (default: synty)
  --help                    Show this help
`;
}

function parseArgs(argv) {
  const options = {};
  const values = new Set(['source', 'repo', 'expect-remote', 'branch', 'message', 'profile']);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help') return { help: true };
    if (arg === '--push') { options.push = true; continue; }
    if (!arg.startsWith('--')) throw new Error(`Unknown argument: ${arg}`);
    const [key, inline] = arg.slice(2).split(/=(.*)/s, 2);
    if (!values.has(key)) throw new Error(`Unknown option: --${key}`);
    const value = inline ?? argv[++index];
    if (value === undefined || value.startsWith('--')) throw new Error(`--${key} needs a value.`);
    options[key] = value;
  }
  return {
    source: options.source,
    repo: options.repo,
    push: options.push || false,
    expectedRemote: options['expect-remote'],
    expectedBranch: options.branch,
    message: options.message,
    profile: options.profile,
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) process.stdout.write(usage());
    else {
      const result = publishAssets(options);
      if (!result.changed) console.log('Private runtime assets are already current; nothing to push.');
      else {
        for (const row of changeSummary(result.plan)) console.log(row);
        if (result.pushed) console.log(`Pushed ${result.commit} to ${result.branch}.`);
        else console.log('Dry run only. Re-run with --push to validate, commit, and publish these changes.');
      }
    }
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exitCode = 1;
  }
}
