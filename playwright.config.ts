import { defineConfig } from '@playwright/test';

// Порт плеера для e2e. У каждой рабочей копии (worktree) свой: E2E_PORT=5184 pnpm e2e — иначе reuseExistingServer
// подхватит сервер другой копии и проверит чужой код.
const PORT = Number(process.env.E2E_PORT ?? 5174);

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 720 },
    channel: 'chrome', // системный Chrome: не качаем свой браузер
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.02 } },
  webServer: { command: `pnpm --filter @cartoon/player exec vite --port ${PORT} --strictPort`, url: `http://localhost:${PORT}`, reuseExistingServer: true },
});
