import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
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
});
