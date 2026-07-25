// E2E smoke tests: build the game, serve build/web, drive it with real mouse
// input in headless Chromium. The game exposes window.__game / __editor
// read-only handles for assertions (see ARCHITECTURE.md).
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  // Generous: CI renders through software GL, where boot alone can eat 30s+
  // of shader compilation. Locally everything exits early.
  timeout: 120_000,
  retries: process.env.CI ? 1 : 0,
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
  webServer: {
    command: 'npm run build && python3 -m http.server 8173 --directory build/web',
    url: 'http://127.0.0.1:8173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
