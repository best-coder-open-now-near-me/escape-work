// Local-only: this container ships an older Chromium build than the pinned
// @playwright/test wants. Not committed.
import base from './playwright.config.js';
export default { ...base, use: { ...base.use, launchOptions: { executablePath: '/opt/pw-browsers/chromium' } } };
