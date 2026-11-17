import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:5174',
    viewport: { width: 1280, height: 720 },
    channel: 'chrome', // системный Chrome: не качаем свой браузер
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.02 } },
  webServer: { command: 'pnpm --filter @cartoon/player exec vite --port 5174 --strictPort', url: 'http://localhost:5174', reuseExistingServer: true },
});
