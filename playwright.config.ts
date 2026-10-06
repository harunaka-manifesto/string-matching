import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'apps/plugin/tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:5173', viewport: { width: 640, height: 760 } },
  webServer: {
    command: 'pnpm dev:ui',
    url: 'http://127.0.0.1:5173/src/ui/index.html',
    reuseExistingServer: !process.env.CI,
  },
});
