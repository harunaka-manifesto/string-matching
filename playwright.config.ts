import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'apps/plugin/tests/ui',
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:4173', ...devices['Desktop Chrome'] },
  webServer: {
    command: 'pnpm --filter @ux-copy-sync/plugin dev:ui --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
