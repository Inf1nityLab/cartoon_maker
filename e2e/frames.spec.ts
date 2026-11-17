import { expect, test } from '@playwright/test';

// Эталонные кадры «Сцены 01». Обновить: pnpm e2e --update-snapshots
for (const t of [3, 16, 32, 56]) {
  test(`кадр t=${t}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/?backend=webgl2');
    await page.waitForFunction(() => (window as any).__player);
    await page.evaluate((sec) => (window as any).__player.show(sec), t);
    await expect(page.locator('#view')).toHaveScreenshot(`scene-01-t${t}.png`);
    expect(errors).toEqual([]);
  });
}

test('два показа одной секунды дают один хэш WorldState', async ({ page }) => {
  await page.goto('/?backend=webgl2');
  await page.waitForFunction(() => (window as any).__player);
  const a = await page.evaluate(() => (window as any).__player.show(20));
  await page.evaluate(() => (window as any).__player.show(5));
  const b = await page.evaluate(() => (window as any).__player.show(20));
  expect(a).toBe(b);
});
