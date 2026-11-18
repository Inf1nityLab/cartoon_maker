import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { coldShot } from './capture.ts';
import { diff, MAX_CHANNEL, MAX_SHARE } from './pixels.ts';

// Задача Б0: витрина объектов (library.html). Кадры для глаз — в test-results/B0-keep (Playwright чистит test-results
// при старте, поэтому пишем из тестов). Эталонов-картинок нет: смотрим глазами и проверяем числами.
const OUT = 'test-results/B0-keep';
const W = 1280, H = 720, DT = 1 / 30;
const lib = (extra: string) => `/library.html?backend=webgl2&film=1&w=${W}&h=${H}&${extra}`;
const keep = (name: string, png: Buffer) => { mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/${name}.png`, png); };
const shot = async (name: string, query: string, t = 1) => {
  const s = await coldShot(lib(query), t, t - DT);
  keep(name, s.png);
  expect(s.errors, name).toEqual([]);
  return s;
};

test.describe('витрина объектов (Б0)', () => {
  test.setTimeout(240_000);

  test('робот: пресеты и ползунки облика', async () => {
    for (const p of ['explorer', 'scout', 'hauler']) await shot(`robot-preset-${p}`, `object=Robot&preset=${p}&view=close&time=10.5`);
    await shot('robot-sliders-wide', 'object=Robot&view=close&time=10.5&p.bodyWidth=1.45&p.wheelDiameter=1.5&p.headSize=0.8&p.bodyColor=%23e8a0a0&p.lightColor=%23ff8a3a');
  });

  test('робот: время суток 6:00, 19:00, 23:00 (и полдень, и 2:00)', async () => {
    const hashes = new Set<string>();
    for (const h of [6, 12, 19, 23, 2]) hashes.add((await shot(`robot-time-${String(h).padStart(2, '0')}`, `object=Robot&view=general&time=${h}`)).hash);
    expect(hashes.size).toBe(5);
  });

  test('робот: порыв ветра, серия 6 кадров', async () => {
    const seen: string[] = [];
    for (const [i, t] of [0.9, 1.4, 1.9, 2.5, 3.2, 4.5].entries()) seen.push((await shot(`robot-gust-${i + 1}`, 'object=Robot&view=close&time=10.5&wind=1&winddir=125&gust=1', t)).hash);
    expect(new Set(seen).size).toBe(6);
  });

  test('робот: глаз щурится на яркий свет (солнце в лицо) и нет, если спиной', async () => {
    await shot('robot-eye-front-sun', 'object=Robot&view=close&time=11&clouds=0', 2);
    await shot('robot-eye-cloudy', 'object=Robot&view=close&time=11&clouds=1', 2);
  });

  test('демо ручек робота: кадры', async () => {
    for (const t of [0.4, 2, 3.4, 5.5, 8.3, 10.5]) await shot(`robot-demo-${t}`, 'object=Robot&view=close&time=10.5&demo=0', t);
  });

  test('готовые объекты: Terrain, Road, Sky, Forces, FilmLook', async () => {
    await shot('terrain-hills', 'object=Terrain&preset=hills&view=general');
    await shot('terrain-bowl', 'object=Terrain&preset=bowl&view=general&time=8');
    await shot('road-lane', 'object=Road&preset=lane&view=general');
    await shot('road-wide-ground', 'object=Road&preset=wide&view=ground');
    await shot('sky-evening', 'object=Sky&view=general&p.elevation=4&p.azimuth=250');
    await shot('forces-sunset-demo', 'object=Forces&view=general&demo=0', 5);
    await shot('filmlook-cinema', 'object=FilmLook&preset=cinema&view=close&time=11');
    await shot('filmlook-warm', 'object=FilmLook&preset=warm-evening&view=close&time=17');
  });

  test('ошибочный объект: страница сообщает, а не падает молча', async ({ page }) => {
    await page.goto('/library.html?object=Nope');
    await expect(page.locator('body')).toContainText('Нет объекта «Nope». Есть:');
  });

  test('два холодных запуска кадра витрины: хэш равен, пиксели в допуске', async () => {
    const q = lib('object=Robot&view=close&time=19&gust=1');
    const a = await coldShot(q, 2.2, 2.2 - DT), b = await coldShot(q, 2.2, 2.2 - DT);
    const d = diff(a.px, b.px, W);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/cold-runs-diff.json`, JSON.stringify(d, null, 2));
    expect(a.errors.concat(b.errors)).toEqual([]);
    expect(a.hash).toBe(b.hash);
    expect(d.differing, `пикселей отличается: ${d.differing} из ${d.total}`).toBeLessThanOrEqual(Math.floor(d.total * MAX_SHARE));
    expect(d.maxChannelDiff).toBeLessThanOrEqual(MAX_CHANNEL);
  });
});

test.describe('витрина объектов: интерфейс (Б0)', () => {
  test.setTimeout(180_000);

  test('кнопки пресетов, ползунки из схемы, силы мира, порыв, демо, виды, снимок — без ошибок консоли', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.setViewportSize({ width: 1500, height: 880 });
    await page.goto('/library.html?backend=webgl2&object=Robot&time=11');
    await page.waitForFunction(() => (window as unknown as { __player?: unknown }).__player);
    const state = () => page.evaluate(() => (window as unknown as { __player: { state(): any } }).__player.state());
    // пресеты и подсказки у ползунков (единицы и описание из схемы)
    expect(await page.locator('#presets button').allTextContents()).toEqual(['explorer', 'scout', 'hauler']);
    expect(await page.locator('#params .row:has(#f-height)').getAttribute('title')).toMatch(/рост до макушки головы, м[\s\S]*диапазон 0.1 … 3/);
    expect(await page.locator('#handles .row').count()).toBe(3); // lightColor, windSensitivity, lightSensitivity
    await page.getByRole('button', { name: 'scout' }).click();
    await page.waitForTimeout(400);
    expect(Number(await page.locator('#f-height').inputValue())).toBeCloseTo(0.24, 1);
    // ползунок облика
    await page.locator('#f-height').evaluate((el: HTMLInputElement) => { el.value = '0.5'; el.dispatchEvent(new Event('input')); });
    await page.waitForTimeout(400);
    expect(await page.locator('#f-height-out').textContent()).toMatch(/^0\.(49|5\d)$/);
    // силы мира сверху: время суток двигает солнце
    const before = (await state()).sun.elevation;
    await page.locator('#force-time').evaluate((el: HTMLInputElement) => { el.value = '8'; el.dispatchEvent(new Event('input')); });
    await page.waitForTimeout(400);
    expect((await state()).sun.elevation).not.toBeCloseTo(before, 1);
    expect(await page.locator('#f-time-out').textContent()).toBe('08:00');
    // порыв ветра и демо
    await page.locator('#gust').click();
    // кадры идут по часам страницы и на нагруженной машине редки: ждём, пока время фильма уйдёт за момент порыва
    await page.waitForFunction(() => (window as unknown as { __player: { state(): any } }).__player.state().world.forces.wind.gust > 0, undefined, { timeout: 20_000 });
    expect((await state()).world.forces.wind.gust).toBeGreaterThan(0);
    await page.getByRole('button', { name: /▶ Огни меняют цвет/ }).click();
    await page.waitForTimeout(800);
    // виды камеры
    for (const v of ['крупно', 'у земли', 'сверху', 'общий']) { await page.getByRole('button', { name: v, exact: true }).click(); await page.waitForTimeout(300); }
    // снимок: скачивается PNG
    const dl = page.waitForEvent('download', { timeout: 90_000 });
    await page.locator('#snap').click();
    const file = await dl;
    expect(file.suggestedFilename()).toMatch(/\.png$/);
    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: `${OUT}/library-ui-robot.png` });
    expect(errors).toEqual([]);
  });

  test('страница для остальных объектов открывается без ошибок: Terrain, Road, Sky, Forces, FilmLook', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    for (const o of ['Terrain', 'Road', 'Sky', 'Forces', 'FilmLook']) {
      await page.goto(`/library.html?backend=webgl2&object=${o}`);
      await page.waitForFunction(() => (window as unknown as { __player?: unknown }).__player);
      await page.waitForTimeout(500);
      expect(await page.locator('#title').textContent()).toBe(`Витрина: ${o}`);
    }
    await page.screenshot({ path: `${OUT}/library-ui-filmlook.png` });
    expect(errors).toEqual([]);
  });
});
