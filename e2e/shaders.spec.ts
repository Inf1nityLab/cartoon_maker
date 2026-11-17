import { chromium, expect, test } from '@playwright/test';

// Задача 1.8: в установившемся режиме three не строит узловые шейдеры заново. Причина, найденная замером: SkyView.sync
// каждый кадр создавал новый THREE.Fog, three сбрасывал узел тумана, менялся ключ кэша, и все материалы сцены
// пересобирались на каждом кадре (CPU кадра 30–180 мс вместо 3–6). Счётчик — renderer.debug.onNodeBuilderCreated.
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const BASE = `http://localhost:${process.env.E2E_PORT ?? 5174}`;
type Player = { show(sec: number): string; step(sec: number): string; shaderBuilds(): number };
const W = 320, H = 180;

for (const [scene, from] of [['scene-01', 1], ['test-robot', 2], ['test-road', 2]] as const) {
  for (const mode of ['taa', 'accum=3'] as const) {
    test(`${scene} (${mode}): после прогрева шейдеры не строятся заново`, async () => {
      test.setTimeout(180_000); // swiftshader; при возврате причины каждый кадр строит шейдеры, и тест должен падать по сравнению счётчика, а не по времени
      const browser = await chromium.launch({ channel: 'chrome', args: ARGS });
      try {
        const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(e.message));
        const extra = mode === 'taa' ? '' : `&${mode}&taa=0`;
        await page.goto(`${BASE}/?backend=webgl2&film=1&w=${W}&h=${H}&scene=${scene}${extra}`);
        await page.waitForFunction(() => (window as unknown as { __player?: Player }).__player);
        const r = await page.evaluate((from) => {
          const p = (window as unknown as { __player: Player }).__player;
          p.show(from);
          for (let i = 1; i <= 5; i++) p.step(from + i / 30); // прогрев: первые построения шейдеров
          const warm = p.shaderBuilds();
          for (let i = 6; i <= 14; i++) p.step(from + i / 30); // камера и сцена едут, меняются только матрицы и uniform-ы
          const afterPlay = p.shaderBuilds();
          p.show(from + 1); // перемотка тоже не повод строить шейдеры
          for (let i = 1; i <= 3; i++) p.step(from + 1 + i / 30);
          return { warm, afterPlay, afterSeek: p.shaderBuilds() };
        }, from);
        expect(errors).toEqual([]);
        expect(r.warm).toBeGreaterThan(0); // счётчик живой
        expect(r.afterPlay).toBe(r.warm);
        expect(r.afterSeek).toBe(r.warm);
      } finally { await browser.close(); }
    });
  }
}
