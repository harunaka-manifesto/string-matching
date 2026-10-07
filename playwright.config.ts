import { defineConfig } from '@playwright/test';

// PW_PORT lets a run use its own dev server when 5173 is taken by another checkout.
const port = Number(process.env.PW_PORT ?? 5173);
export default defineConfig({
  testDir: 'apps/plugin/tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  // The plugin window opens at 400 × 720.
  use: { baseURL: `http://127.0.0.1:${port}`, viewport: { width: 400, height: 720 } },
  webServer: {
    command: `pnpm --filter @string-binder/plugin exec vite --config vite.config.ts --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/src/ui/index.html`,
    reuseExistingServer: !process.env.CI,
  },
});
