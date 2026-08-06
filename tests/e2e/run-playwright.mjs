// Browser descendants can inherit the terminal's output handles on Windows,
// leaving an otherwise green Playwright run attached to the invoking shell.
// Keep the real runner's stdio in files, then relay those files from this
// short-lived parent process instead.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// Playwright's `webServer.command` is launched through a shell. On Windows the
// tests finish but Playwright can wait forever for that shell to observe the
// HTTP server's exit. Own the direct Node child here instead, where shutdown is
// a process handle rather than a shell/stdio inference.
const server = spawn(process.execPath, [
  resolve(root, 'tests/e2e/start-server.mjs'),
  '--port',
  '8173',
], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});

const serverReady = new Promise((resolveReady, reject) => {
  let output = '';
  const relay = (stream, target) => (chunk) => {
    target.write(chunk);
    output += chunk.toString();
    if (output.includes('Serving ') && output.includes(':8173/')) resolveReady();
  };
  server.stdout.on('data', relay(server.stdout, process.stdout));
  server.stderr.on('data', relay(server.stderr, process.stderr));
  server.once('error', reject);
  server.once('exit', (code, signal) => {
    reject(new Error(`E2E server stopped before it was ready (${signal || code}).`));
  });
});

const stopServer = async () => {
  if (server.exitCode !== null || server.signalCode !== null) return;
  const exited = once(server, 'exit');
  server.kill();
  if (await Promise.race([exited.then(() => true), delay(2_000, false)])) return;
  server.kill('SIGKILL');
  await Promise.race([once(server, 'exit'), delay(2_000)]);
};

await serverReady;

const logDir = await mkdtemp(resolve(tmpdir(), 'escape-work-playwright-'));
const stdoutPath = resolve(logDir, 'stdout.log');
const stderrPath = resolve(logDir, 'stderr.log');
const stdout = await open(stdoutPath, 'w');
const stderr = await open(stderrPath, 'w');

const child = spawn(process.execPath, [
  resolve(root, 'node_modules/@playwright/test/cli.js'),
  'test',
  ...process.argv.slice(2),
], {
  cwd: root,
  stdio: ['ignore', stdout.fd, stderr.fd],
  windowsHide: true,
});
await stdout.close();
await stderr.close();

let stdoutOffset = 0;
let stderrOffset = 0;
let relay = Promise.resolve();
const forward = async (path, stream, offset) => {
  const content = await readFile(path);
  if (content.length <= offset) return content.length;
  stream.write(content.subarray(offset));
  return content.length;
};
const scheduleRelay = () => {
  relay = relay.then(async () => {
    stdoutOffset = await forward(stdoutPath, process.stdout, stdoutOffset);
    stderrOffset = await forward(stderrPath, process.stderr, stderrOffset);
  });
};
const timer = setInterval(scheduleRelay, 250);

let result;
try {
  result = await new Promise((resolveResult, reject) => {
    child.once('error', reject);
    // `close` waits for every inherited copy of the redirected handles to
    // close. On Windows, Chromium or the managed web server can retain one
    // after Playwright itself has exited, leaving npm attached to a test run
    // that is already over. `exit` is the lifecycle event we actually need:
    // the Playwright process has finished and its status is final.
    child.once('exit', (code, signal) => resolveResult({ code, signal }));
  });
} finally {
  clearInterval(timer);
  scheduleRelay();
  await relay;
  await stopServer();
  // A just-terminated browser descendant may still be releasing its duplicate
  // file handle. Do not turn a green run into a hung/failed run over disposable
  // relay files; the OS temp directory can reap that exceptional case.
  await rm(logDir, { recursive: true, force: true }).catch(() => {});
}

if (result.signal) {
  process.stderr.write(`Playwright stopped by ${result.signal}.\n`);
  process.exit(1);
} else {
  process.exit(result.code ?? 1);
}
