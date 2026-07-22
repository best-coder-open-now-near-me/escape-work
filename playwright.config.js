// E2E smoke tests: build the game, serve build/web, drive it with real mouse
// input in headless Chromium. The game exposes window.__game / __editor
// read-only handles for assertions (see ARCHITECTURE.md).
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://127.0.0.1:8173',
    viewport: { width: 1280, height: 800 },
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
