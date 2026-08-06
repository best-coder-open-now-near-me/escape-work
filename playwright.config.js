// E2E smoke tests: build the game, serve build/web, drive it with real mouse
// input in headless Chromium. The game exposes window.__game / __editor
// read-only handles for assertions (see ARCHITECTURE.md).
import { defineConfig } from '@playwright/test';

// Keep test and assertion budgets aligned. A per-test timeout does not extend
// Playwright's independent default for expect(), which otherwise remains 5s.
const E2E_TIMEOUT = 120_000;

export default defineConfig({
  testDir: 'tests/e2e',
  // Generous: CI renders through software GL, where boot alone can eat 30s+
  // of shader compilation. Locally everything exits early.
  timeout: E2E_TIMEOUT,
  expect: { timeout: E2E_TIMEOUT },
  retries: process.env.CI ? 1 : 0,
  // A red run should cost minutes, not half an hour. Every test boots the whole
  // engine under software GL (~40s each), so letting a broken build grind
  // through all 50-odd of them burns the Actions budget to tell you something
  // the first failure already said. Locally, run everything.
  maxFailures: process.env.CI ? 3 : 0,
  // NB: billing is runner WALL-CLOCK, so in-runner parallelism is free money -
  // but these tests are CPU-bound on software GL, and over-subscribing the
  // runner's 4 vCPUs trades flakes (and re-runs) for the time it saves.
  //
  // That warning was written before anyone measured it, and the measurement is
  // in: Playwright's default (cores/2 = 2 on a 4-vCPU box) manufactures
  // failures. A six-file run reported two cover.spec crouch failures that both
  // pass solo, and a near-identical contention run earlier reported fourteen.
  // Every one of them read as a regression and none were. One worker is the
  // only configuration that produces a signal worth acting on here, and a red
  // run you cannot trust costs far more than the wall-clock it saved.
  // Raise it only with a flake check behind it.
  workers: 1,
  // A retry turns a flake green, so make the flakes visible: 'list' prints
  // every retried test, and the HTML report lands in the CI artifact next to
  // the traces below. Without these, a failure on CI left nothing to debug -
  // the uploaded test-results/ directory was effectively empty.
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8173',
    viewport: { width: 1280, height: 800 },
    // Kept only for failures (and the first retry), so a green run costs
    // nothing: the trace carries the DOM snapshots, console and network log
    // that make a headless WebGL failure diagnosable after the fact.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Environments with a preinstalled Chromium (no network for downloads)
    // can point CHROMIUM_PATH at it; otherwise Playwright's own install is
    // used (CI runs `npx playwright install chromium`).
    launchOptions: process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {},
  },
});
