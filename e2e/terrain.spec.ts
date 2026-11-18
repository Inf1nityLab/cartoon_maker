import { expect, test } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { ARGS, coldShot, openPlayer } from './capture.ts';
import { diff, MAX_CHANNEL, MAX_SHARE } from './pixels.ts';

// Задача Б3: рельеф и поверхности. Кадры для глаз — в artifacts/B3 (Playwright эту папку не чистит).
// Эталонов-картинок нет: смотрим глазами и проверяем числами (хэши, различие кадров, ошибки консоли).
const OUT = 'artifacts/B3';
const W = 1280, H = 720, DT = 1 / 30;
const lib = (extra: string) => `/library.html?backend=webgl2&film=1&w=${W}&h=${H}&object=Terrain&${extra}`;
const keep = (name: string, png: Buffer) => { mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/${name}.png`, png); };
const shot = async (name: string, query: string, t = 1) => {
  const s = await coldShot(lib(query), t, t - DT);
  keep(name, s.png);
  expect(s.errors, name).toEqual([]);
  return s;
};
const press = (page: import('@playwright/test').Page, label: string) => page.locator('#presets button', { hasText: new RegExp(`^${label}$`) }).evaluate((b: HTMLElement) => b.click());
/** Средняя яркость кадра (0…255) по RGBA-буферу: чтобы убедиться, что снег или влажность действительно изменили картинку. */
const luma = (px: Buffer) => { let s = 0; for (let i = 0; i < px.length; i += 4) s += 0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!; return s / (px.length / 4); };
const share = (a: Buffer, b: Buffer) => diff(a, b, W).differing / (a.length / 4);

test.describe('рельеф и поверхности (Б3)', () => {
  test.setTimeout(900_000);

  test('каждый пресет', async () => {
    const seen = new Set<string>();
    for (const [name, q] of [
      ['meadow-hills', 'preset=meadow-hills&view=general'], ['desert-dunes', 'preset=desert-dunes&view=general'],
      ['pond-shore', 'preset=pond-shore&view=general'], ['sea-beach', 'preset=sea-beach&view=general'],
      ['forest-glade', 'preset=forest-glade&view=general'], ['winter-meadow', 'preset=winter-meadow&view=general'],
    ] as const) seen.add((await shot(`preset-${name}`, q)).hash);
    expect(seen.size).toBe(6);
  });

  test('дюны при солнце 10° и 60°: гребни отбрасывают тени', async () => {
    // Forces: восход в 5:00, высота = 62°·sin(π(t−5)/14): 10° ≈ 5:43, 60° ≈ 11:00 (и вечером 18:17 — низкое солнце с другой стороны)
    const lo = await shot('dunes-sun10-general', 'preset=desert-dunes&view=general&time=5.72');
    const hi = await shot('dunes-sun60-general', 'preset=desert-dunes&view=general&time=11.2');
    await shot('dunes-sun10-close', 'preset=desert-dunes&view=close&time=5.72');
    await shot('dunes-sun60-close', 'preset=desert-dunes&view=close&time=11.2');
    await shot('dunes-sun10-ground', 'preset=desert-dunes&view=ground&time=5.72');
    await shot('dunes-top', 'preset=desert-dunes&view=top&time=5.72');
    expect(lo.hash).not.toBe(hi.hash);
    expect(share(lo.px, hi.px)).toBeGreaterThan(0.3);
  });

  test('снег 0 / 0.5 / 1 на холмах (мороз), на крутом склоне меньше; в тепле снега нет', async () => {
    const px: Buffer[] = [];
    for (const [i, snow] of [0, 0.5, 1].entries()) {
      const s = await shot(`snow-${i}-general`, `preset=winter-meadow&view=general&temp=-6&time=11&p.snow=${snow}`, 8);
      await shot(`snow-${i}-close`, `preset=winter-meadow&view=close&temp=-6&time=11&p.snow=${snow}`, 8);
      px.push(s.px);
    }
    expect(luma(px[1]!)).toBeGreaterThan(luma(px[0]!) + 5);
    expect(luma(px[2]!)).toBeGreaterThan(luma(px[1]!) + 5);
    // снег 1, но тепло: земля чистая (то же, что snow 0)
    const warm = await shot('snow-1-but-warm', 'preset=winter-meadow&view=general&temp=15&time=11&p.snow=1', 8);
    expect(luma(warm.px)).toBeLessThan(luma(px[0]!) + 3);
  });

  test('мокрый песок у воды: море, пруд, влажность 0 → 1', async () => {
    const dry = await shot('wet-beach-close', 'preset=sea-beach&view=close&time=11');
    await shot('wet-beach-ground', 'preset=sea-beach&view=ground&time=11');
    await shot('wet-pond-close', 'preset=pond-shore&view=close&time=11');
    await shot('wet-pond-ground', 'preset=pond-shore&view=ground&time=11');
    const rain = await shot('wet-beach-close-wetness1', 'preset=sea-beach&view=close&time=11&p.wetness=1');
    expect(luma(rain.px)).toBeLessThan(luma(dry.px) - 3);
  });

  test('подстилка в лесу с деревьями Б2', async () => {
    await shot('litter-close', 'preset=forest-glade&view=close&time=14');
    await shot('litter-ground', 'preset=forest-glade&view=ground&time=14');
    await shot('litter-top', 'preset=forest-glade&view=top&time=14');
    await shot('litter-none-close', 'preset=forest-glade&view=close&time=14&p.litter=0');
  });

  test('ручка влажность 0 / 0.5 / 1 на лугу и ручка sandRipple на дюнах', async () => {
    const l: number[] = [];
    for (const [i, w] of [0, 0.5, 1].entries()) l.push(luma((await shot(`wetness-${i}`, `preset=meadow-hills&view=close&time=11&p.wetness=${w}`)).px));
    expect(l[1]).toBeLessThan(l[0]!); expect(l[2]).toBeLessThan(l[1]!);
    const h = new Set<string>();
    for (const [i, r] of [0, 0.5, 1].entries()) h.add((await shot(`ripple-${i}`, `preset=desert-dunes&view=ground&time=17.2&p.sandRipple=${r}`)).hash);
    expect(h.size).toBe(3);
  });

  test('демо: оттепель → снегопад на лугу, 5 кадров', async () => {
    const h = new Set<string>();
    for (const [i, t] of [0.5, 5, 7, 10.5, 14].entries()) h.add((await shot(`demo-thaw-snowfall-${i + 1}-t${t}`, 'preset=winter-meadow&view=general&time=11&demo=0', t)).hash);
    expect(h.size).toBe(5);
  });

  test('пляж: форма берега и берег пруда сверху', async () => {
    await shot('beach-top', 'preset=sea-beach&view=top&time=11');
    await shot('pond-top', 'preset=pond-shore&view=top&time=11');
    await shot('pond-steep-bank', 'preset=pond-shore&view=general&time=11&p.bank=steep');
  });

  test('два холодных запуска кадра дюн и берега: хэш равен, пиксели в допуске', async () => {
    for (const [name, q] of [['dunes', 'preset=desert-dunes&view=close&time=5.72'], ['beach', 'preset=sea-beach&view=close&time=11']] as const) {
      const a = await coldShot(lib(q), 2.2, 2.2 - DT), b = await coldShot(lib(q), 2.2, 2.2 - DT);
      const d = diff(a.px, b.px, W);
      mkdirSync(OUT, { recursive: true });
      writeFileSync(`${OUT}/cold-runs-diff-${name}.json`, JSON.stringify(d, null, 2));
      expect(a.errors.concat(b.errors)).toEqual([]);
      expect(a.hash).toBe(b.hash);
      expect(d.differing, `${name}: пикселей отличается: ${d.differing} из ${d.total}`).toBeLessThanOrEqual(Math.floor(d.total * MAX_SHARE));
      expect(d.maxChannelDiff).toBeLessThanOrEqual(MAX_CHANNEL);
    }
  });

  test('шейдеры не пересобираются: снег, влажность и температура меняют только униформы', async () => {
    const browser = await chromium.launch({ channel: 'chrome', args: ARGS });
    try {
      const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await openPlayer(page, lib('preset=winter-meadow&view=general&time=11&demo=0&temp=-6').replace('w=1280&h=720', 'w=320&h=180'));
      const r = await page.evaluate(() => {
        const p = (window as unknown as { __player: { show(t: number): string; step(t: number): string; shaderBuilds(): number } }).__player;
        p.show(0.2);
        for (let i = 1; i <= 5; i++) p.step(0.2 + i / 30); // прогрев
        const warm = p.shaderBuilds();
        for (let i = 1; i <= 15 * 30; i++) p.step(0.5 + i / 30); // оттепель, потом снегопад: снег от 1 к 0 и обратно
        return { warm, after: p.shaderBuilds() };
      });
      expect(errors).toEqual([]);
      expect(r.warm).toBeGreaterThan(0);
      expect(r.after).toBe(r.warm);
    } finally { await browser.close(); }
  });

  test('витрина земли: пресеты, ручки, демо, силы мира — без ошибок консоли', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.setViewportSize({ width: 1500, height: 880 });
    await page.goto('/library.html?backend=webgl2&object=Terrain&time=11');
    await page.waitForFunction(() => (window as unknown as { __player?: unknown }).__player);
    const state = () => page.evaluate(() => (window as unknown as { __player: { state(): any } }).__player.state());
    expect(await page.locator('#presets button').allTextContents()).toEqual(['hills', 'plain', 'bowl', 'soft', 'meadow-hills', 'desert-dunes', 'pond-shore', 'sea-beach', 'forest-glade', 'winter-meadow']);
    expect(await page.locator('#handles .row').count()).toBe(3);
    expect(await page.locator('#demos button').count()).toBe(2);
    for (const name of ['desert-dunes', 'sea-beach', 'forest-glade', 'pond-shore', 'winter-meadow']) { await press(page, name); await page.waitForTimeout(1200); }
    // winter-meadow: мороз из пресета, снег лежит
    await page.waitForTimeout(2500);
    expect((await state()).world.terrain.snow).toBeGreaterThan(0.9);
    // ползунок температуры: в тепле снег тает
    await page.locator('#force-temperature').evaluate((el: HTMLInputElement) => { el.value = '12'; el.dispatchEvent(new Event('input')); });
    await page.waitForTimeout(500);
    await page.locator('#f-snow').evaluate((el: HTMLInputElement) => { el.value = '0.5'; el.dispatchEvent(new Event('input')); });
    await page.waitForTimeout(800);
    await page.locator('#demos button').nth(0).evaluate((b: HTMLElement) => b.click());
    await page.waitForTimeout(1500);
    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: `${OUT}/library-ui-terrain.png` });
    expect(errors).toEqual([]);
  });

  test('сравнения: дюны с оазисом, берег с прудом (эталон | наш)', async ({ page }) => {
    const pairs: [string, string, string][] = [
      ['compare-dunes-oasis-golden', `${OUT}/ref-oasis-golden.png`, `${OUT}/dunes-sun10-general.png`],
      ['compare-dunes-oasis-sun', `${OUT}/ref-oasis-sun.png`, `${OUT}/dunes-sun60-general.png`],
      ['compare-shore-pond', `${OUT}/ref-pond-general.png`, `${OUT}/preset-pond-shore.png`],
      ['compare-shore-pond-close', `${OUT}/ref-pond-close.png`, `${OUT}/wet-pond-close.png`],
    ];
    for (const [name, a, b] of pairs) {
      if (!existsSync(a) || !existsSync(b)) continue;
      const src = (f: string) => `data:image/png;base64,${readFileSync(f).toString('base64')}`;
      await page.setViewportSize({ width: 2560, height: 720 });
      await page.setContent(`<body style="margin:0;background:#111;display:flex"><img style="width:1280px;height:720px;object-fit:cover" src="${src(a)}"><img style="width:1280px;height:720px;object-fit:cover" src="${src(b)}"></body>`);
      await page.waitForTimeout(200);
      keep(name, await page.screenshot());
    }
  });
});
