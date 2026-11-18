import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { coldShot, openPlayer } from './capture.ts';
import { diff, MAX_CHANNEL, MAX_SHARE } from './pixels.ts';

// Задача Б5: небо и свет. Кадры для глаз — artifacts/B5/<префикс>-*.png (SKY_PREFIX=before снимает «было»).
const OUT = 'artifacts/B5';
const PFX = process.env.SKY_PREFIX ?? 'day';
const W = 1280, H = 720, DT = 1 / 30;
const lib = (extra: string) => `/library.html?backend=webgl2&film=1&w=${W}&h=${H}&object=Forces&view=general&${extra}`;
const keep = (name: string, png: Buffer) => { mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/${name}.png`, png); };
const shot = async (name: string, query: string, t = 1) => {
  const s = await coldShot(lib(query), t, t - DT);
  keep(`${PFX}-${name}`, s.png);
  expect(s.errors, name).toEqual([]);
  expect({ w: s.w, h: s.h }, `${name}: размер холста`).toEqual({ w: W, h: H });
  return s;
};

test.describe('небо и свет (Б5)', () => {
  test.setTimeout(900_000);

  test('сутки: 6, 8, 12, 16, 18, 19, 20, 23 ч на лугу с деревьями и водой', async () => {
    const seen = new Set<string>();
    // камера каждый час смотрит туда, где солнце или луна (az — азимут взгляда, pitch — наклон)
    const SERIES: Record<number, string> = { 6: 'az=100&pitch=8', 8: 'az=125&pitch=12', 12: 'az=180&pitch=22', 16: 'az=240&pitch=14', 18: 'az=262&pitch=6', 19: 'az=270&pitch=3', 20: 'az=108&pitch=12', 23: 'az=165&pitch=32' };
    for (const h of (process.env.SKY_HOURS ? process.env.SKY_HOURS.split(',').map(Number) : Object.keys(SERIES).map(Number))) seen.add((await shot(`series-${String(h).padStart(2, '0')}`, `time=${h}&${SERIES[h]}`)).hash);
    if (!process.env.SKY_HOURS) expect(seen.size).toBe(8);
  });

  test('облачность 0 / 0.5 / 1 в полдень, туман 0 / 0.5 утром', async () => {
    const h = new Set<string>();
    for (const c of [0, 0.5, 1]) h.add((await shot(`clouds-${c}`, `time=12.5&clouds=${c}&az=200&pitch=24`)).hash);
    for (const f of [0, 0.5]) h.add((await shot(`fog-${f}`, `time=7&clouds=0.2&fog=${f}&az=110&pitch=6`)).hash);
    expect(h.size).toBe(5);
  });

  test('пресеты: рассвет, полдень, золотой час, закат, ночь с луной, пасмурно, туманное утро', async () => {
    const h = new Set<string>();
    for (const [name, view] of [['dawn', 'az=100&pitch=8'], ['noon', 'az=180&pitch=22'], ['golden-hour', 'az=262&pitch=8'], ['sunset', 'az=270&pitch=3'], ['moonlit-night', 'az=150&pitch=30'], ['overcast', 'az=200&pitch=18'], ['foggy-morning', 'az=110&pitch=6']] as const)
      h.add((await shot(`preset-${name}`, `preset=${name}&${view}`)).hash);
    expect(h.size).toBe(7);
  });

  test('фаза луны: полная и серп', async () => {
    const a = await shot('moon-full', 'time=22&az=150&pitch=30&clouds=0&p.moonPhase=1');
    const b = await shot('moon-crescent', 'time=22&az=150&pitch=30&clouds=0&p.moonPhase=0.2');
    expect(a.hash).not.toBe(b.hash);
  });

  test('сутки за 20 с через полночь (демо): 22 → 00 → 02 → 04 ч', async () => {
    const h = new Set<string>();
    // демо 1 витрины: time = 5 в t=0, затем линейно до 29 (05:00 следующих суток) за 20 с, начиная с t=0.5
    for (const [name, t, view] of [['22h', 14.67, 'az=150&pitch=30'], ['00h', 16.33, 'az=180&pitch=35'], ['02h', 18, 'az=216&pitch=30'], ['04h', 19.67, 'az=250&pitch=12']] as const)
      h.add((await shot(`midnight-${name}`, `demo=1&${view}&clouds=0.2`, t)).hash);
    expect(h.size).toBe(4);
  });

  test('два холодных запуска закатного кадра: хэш равен, пиксели в допуске', async () => {
    const q = lib('time=18.95&az=270&pitch=3');
    const a = await coldShot(q, 1, 1 - DT), b = await coldShot(q, 1, 1 - DT);
    expect(a.hash).toBe(b.hash);
    const d = diff(a.px, b.px, a.w);
    expect(d.differing, `пикселей отличается: ${d.differing}`).toBeLessThanOrEqual(Math.floor(d.total * MAX_SHARE));
    expect(d.maxChannelDiff).toBeLessThanOrEqual(MAX_CHANNEL);
  });

  test('сторож шейдеров: смена времени суток проигрыванием (демо «сутки») не строит шейдеры заново', async () => {
    const { chromium } = await import('@playwright/test');
    const { ARGS } = await import('./capture.ts');
    const browser = await chromium.launch({ channel: 'chrome', args: ARGS });
    try {
      const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await openPlayer(page, '/library.html?backend=webgl2&film=1&w=320&h=180&object=Forces&demo=1&time=5');
      const r = await page.evaluate(() => {
        const p = (window as unknown as { __player: { show(s: number): string; step(s: number): string; shaderBuilds(): number } }).__player;
        p.show(0.5);
        for (let i = 1; i <= 5; i++) p.step(0.5 + i / 30);
        const warm = p.shaderBuilds();
        // быстрый проход по суткам с закатом, ночью и рассветом: меняются только униформы
        for (let t = 1; t <= 21; t += 0.5) p.step(t);
        const afterPlay = p.shaderBuilds();
        p.show(16.33); // перемотка в полночь
        for (let i = 1; i <= 3; i++) p.step(16.33 + i / 30);
        return { warm, afterPlay, afterSeek: p.shaderBuilds() };
      });
      expect(errors).toEqual([]);
      expect(r.warm).toBeGreaterThan(0);
      expect(r.afterPlay).toBe(r.warm);
      expect(r.afterSeek).toBe(r.warm);
    } finally { await browser.close(); }
  });

  test('рельеф Б3 под золотым часом (18.2 ч): дюны, морской пляж, зимний луг', async () => {
    const h = new Set<string>();
    for (const [name, view] of [['desert-dunes', 'view=general'], ['sea-beach', 'view=general'], ['winter-meadow', 'view=general']] as const) {
      const s = await coldShot(`/library.html?backend=webgl2&film=1&w=${W}&h=${H}&object=Terrain&preset=${name}&${view}&time=18.2&clouds=0.25`, 1, 1 - DT);
      keep(`terrain-under-sky-${name}`, s.png);
      expect(s.errors, name).toEqual([]);
      expect({ w: s.w, h: s.h }, name).toEqual({ w: W, h: H });
      h.add(s.hash);
    }
    expect(h.size).toBe(3);
  });
});
