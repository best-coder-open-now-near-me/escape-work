// The E2E runner owns this process directly. Build before importing the static
// server so every npm test script exercises fresh browser assets without a
// Playwright-managed shell child on Windows.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
execFileSync(process.execPath, ['build.mjs'], { cwd: root, stdio: 'inherit' });
await import('../../serve.mjs');
