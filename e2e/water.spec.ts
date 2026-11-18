import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { coldShot } from './capture.ts';
import { diff, MAX_CHANNEL, MAX_SHARE } from './pixels.ts';
import { chromium } from '@playwright/test';
import { ARGS, BASE, openPlayer } from './capture.ts';

// Задача Б1: вода. Кадры для глаз — в test-results/B1-keep (Playwright чистит test-results при старте, поэтому пишем из тестов).
// Эталонов-картинок нет: смотрим глазами и проверяем числами (хэши, различие кадров, ошибки консоли).
const OUT = 'artifacts/B1';
const W = 1280, H = 720, DT = 1 / 30;
const lib = (extra: string) => `/library.html?backend=webgl2&film=1&w=${W}&h=${H}&object=Water&${extra}`;
const keep = (name: string, png: Buffer) => { mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/${name}.png`, png); };
const shot = async (name: string, query: string, t = 1) => {
  const s = await coldShot(lib(query), t, t - DT);
  keep(name, s.png);
  expect(s.errors, name).toEqual([]);
  return s;
};

test.describe('вода (Б1)', () => {
  test.setTimeout(900_000);

  test('каждый пресет', async () => {
    const seen = new Set<string>();
    for (const [name, q] of [
      ['pond-forest', 'preset=pond-forest&view=general&time=11'], ['pond-lilies', 'preset=pond-lilies&view=close&time=17.5'],
      ['lake-mountain', 'preset=lake-mountain&view=general&time=9'], ['oasis', 'preset=oasis&view=close&time=11'],
      ['creek', 'preset=creek&view=close&time=11'], ['river', 'preset=river&view=general&time=11'],
      ['ocean-tropical', 'preset=ocean-tropical&view=general&time=11'], ['ocean-storm', 'preset=ocean-storm&view=general&time=14&clouds=0.7'],
    ] as const) seen.add((await shot(`preset-${name}`, q)).hash);
    expect(seen.size).toBe(8);
  });

  test('берег с пеной, мелководье с каустиками, вид сверху', async () => {
    await shot('shore-foam-ocean', 'preset=ocean-tropical&view=close&time=11', 2);
    await shot('shallows-caustics-top', 'preset=pond-forest&view=top&time=11&p.clarity=0.7&p.ripple=0.4', 2);
    await shot('shallows-caustics-oasis', 'preset=oasis&view=ground&time=11', 2);
  });

  test('подводный вид: две глубины', async () => {
    await shot('under-1.0m', 'preset=oasis&view=general&time=11&dive=0&dy=-1', 6);
    await shot('under-3.0m', 'preset=lake-mountain&view=general&time=11&dive=0&dy=-3', 6);
  });

  test('лёд 0 / 0.5 / 1', async () => {
    const h = new Set<string>();
    for (const [i, ice] of [0, 0.5, 1].entries()) h.add((await shot(`ice-${i}`, `preset=pond-forest&view=close&time=11&p.ice=${ice}&p.temperatureSensitivity=0`, 2)).hash);
    expect(h.size).toBe(3);
  });

  test('ручей по изогнутому пути, сверху', async () => {
    await shot('creek-top', 'preset=creek&view=top&time=11', 2);
  });

  test('ветер 0 → 8 м/с: рябь растёт, серия 6 кадров', async () => {
    const h = new Set<string>();
    for (const [i, wind] of [0, 1.6, 3.2, 4.8, 6.4, 8].entries()) h.add((await shot(`wind-${i + 1}-${wind}`, `preset=pond-forest&view=close&time=11&wind=${wind}&p.windSensitivity=1&p.ripple=0.05&winddir=60`, 2)).hash);
    expect(h.size).toBe(6);
  });

  test('камера ныряет: серия 6 кадров', async () => {
    const h = new Set<string>();
    for (const [i, t] of [0.5, 1.6, 2.6, 3.6, 6, 11].entries()) h.add((await shot(`dive-${i + 1}`, 'preset=pond-forest&view=general&time=11&dive=0', t)).hash);
    expect(h.size).toBe(6);
  });

  test('океан: штиль → шторм (демо), 3 кадра', async () => {
    for (const t of [1, 7, 10]) await shot(`ocean-demo-${t}`, 'preset=ocean-tropical&view=general&time=11&demo=0', t);
  });

  test('пруд замерзает (демо), круги на воде', async () => {
    for (const t of [0.5, 4, 8]) await shot(`pond-freeze-${t}`, 'preset=pond-forest&view=close&time=11&demo=1', t);
    for (const t of [2.6, 3.4, 5.5]) await shot(`pond-rings-${t}`, 'preset=pond-forest&view=close&time=11&demo=2', t);
  });

  test('два холодных запуска кадра воды: хэш равен, пиксели в допуске', async () => {
    const q = lib('preset=ocean-tropical&view=general&time=11');
    const a = await coldShot(q, 2.2, 2.2 - DT), b = await coldShot(q, 2.2, 2.2 - DT);
    const d = diff(a.px, b.px, W);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/cold-runs-diff.json`, JSON.stringify(d, null, 2));
    expect(a.errors.concat(b.errors)).toEqual([]);
    expect(a.hash).toBe(b.hash);
    expect(d.differing, `пикселей отличается: ${d.differing} из ${d.total}`).toBeLessThanOrEqual(Math.floor(d.total * MAX_SHARE));
    expect(d.maxChannelDiff).toBeLessThanOrEqual(MAX_CHANNEL);
  });

  test('шейдеры после прогрева не строятся заново (вода, нырок, лёд)', async () => {
    const browser = await chromium.launch({ channel: 'chrome', args: ARGS });
    try {
      const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await openPlayer(page, lib('preset=pond-forest&view=general&time=11&dive=1').replace('w=1280&h=720', 'w=320&h=180'));
      const r = await page.evaluate(() => {
        const p = (window as unknown as { __player: { show(t: number): string; step(t: number): string; shaderBuilds(): number } }).__player;
        p.show(0.2);
        for (let i = 1; i <= 5; i++) p.step(0.2 + i / 30); // прогрев: над водой
        for (let i = 1; i <= 120; i++) p.step(1 + i / 30); // камера ныряет и возвращается: лучи, туман под водой строятся один раз
        const warm = p.shaderBuilds();
        for (let i = 1; i <= 30; i++) p.step(5 + i / 30);
        p.show(1.5);
        for (let i = 1; i <= 5; i++) p.step(1.5 + i / 30);
        return { warm, after: p.shaderBuilds() };
      });
      expect(errors).toEqual([]);
      expect(r.warm).toBeGreaterThan(0);
      expect(r.after).toBe(r.warm);
    } finally { await browser.close(); }
  });

  test('витрина воды: пресеты, ползунки, нырнуть, демо — без ошибок консоли', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.setViewportSize({ width: 1500, height: 880 });
    await page.goto('/library.html?backend=webgl2&object=Water&time=11');
    await page.waitForFunction(() => (window as unknown as { __player?: unknown }).__player);
    const state = () => page.evaluate(() => (window as unknown as { __player: { state(): any } }).__player.state());
    expect(await page.locator('#presets button').allTextContents()).toEqual(['ocean-tropical', 'ocean-storm', 'lake-mountain', 'pond-forest', 'pond-lilies', 'creek', 'river', 'oasis']);
    expect((await page.locator('#handles .row').count())).toBe(14);
    await page.getByRole('button', { name: 'ocean-storm', exact: true }).click();
    await page.waitForTimeout(1500);
    expect((await state()).world.water.waves.swell).toBeGreaterThan(3);
    await page.getByRole('button', { name: 'creek', exact: true }).click();
    await page.waitForTimeout(1500);
    expect((await state()).world.water.shape).toBe('river');
    await page.getByRole('button', { name: 'pond-forest', exact: true }).click();
    await page.waitForTimeout(1500);
    await page.locator('#f-ice').evaluate((el: HTMLInputElement) => { el.value = '1'; el.dispatchEvent(new Event('input')); });
    await page.waitForTimeout(800);
    expect((await state()).handles.water.ice).toBe(1);
    await expect(page.locator('#dive')).toBeVisible();
    await page.locator('#dive').click();
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: /▶ Пруд замерзает/ }).click();
    await page.waitForTimeout(1000);
    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: `${OUT}/library-ui-water.png` });
    expect(errors).toEqual([]);
  });
});
