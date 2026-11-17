import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { coldShot, type Shot } from './capture.ts';
import { diff, MAX_CHANNEL, MAX_SHARE } from './pixels.ts';

// Задача 3.1: робот-исследователь. Кадры для глаз кладём в test-results/3.1-keep (Playwright чистит test-results при
// старте, поэтому пишем из тестов). Эталонов-картинок нет: смотрим глазами рядом с кадрами песочницы и проверяем
// числами (повторяемость двух холодных запусков, ошибки страницы).
const OUT = 'test-results/3.1-keep';
const W = 1280, H = 720, DT = 1 / 30;
const Q = `/?backend=webgl2&film=1&w=${W}&h=${H}&scene=test-robot`;
const keep = (name: string, s: Shot) => { mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/${name}.png`, s.png); };

const FRAMES: [name: string, t: number][] = [
  ['rest-34', 0.5], ['rest-side', 1.2], ['eye-closeup', 8.3],
  ['brake-1', 4.8], ['brake-2', 5.0], ['brake-3', 5.2], ['brake-4', 5.4], ['brake-5', 5.6], ['brake-6', 5.8],
  ['look-left', 6.3], ['look-right', 7.2], ['squint', 8.8], ['wide', 9.7],
  ['arm', 11.0], ['beam', 13.0], ['turn', 14.6],
];

test.describe('робот-исследователь (3.1)', () => {
  test.setTimeout(180_000);

  for (const [name, t] of FRAMES) {
    test(`кадр ${name} (t=${t})`, async () => {
      const s = await coldShot(Q, t, t - DT);
      keep(name, s);
      expect(s.errors).toEqual([]);
    });
  }

  test('два холодных запуска кадра с роботом: хэш равен, пиксели в допуске', async () => {
    const a = await coldShot(Q, 5.2, 5.2 - DT), b = await coldShot(Q, 5.2, 5.2 - DT);
    const d = diff(a.px, b.px, W);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/cold-runs-diff.json`, JSON.stringify(d, null, 2));
    expect(a.errors.concat(b.errors)).toEqual([]);
    expect(a.hash).toBe(b.hash);
    expect(d.differing, `пикселей отличается: ${d.differing} из ${d.total}`).toBeLessThanOrEqual(Math.floor(d.total * MAX_SHARE));
    expect(d.maxChannelDiff).toBeLessThanOrEqual(MAX_CHANNEL);
  });
});
