import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { coldShot, warmShots, type Shot } from './capture.ts';
import { diff, MAX_CHANNEL, MAX_SHARE } from './pixels.ts';

// Задача 1.4: земля и дорога. Кадры для глаз — в test-results/1.4-keep (в .gitignore; Playwright чистит test-results
// при старте, поэтому пишем из тестов). Эталонов-картинок нет: проверяем повторяемостью и числами.
const OUT = 'test-results/1.4-keep';
const W = 1280, H = 720, DT = 1 / 30;
const ROAD = `/?scene=test-road&backend=webgl2&film=1&w=${W}&h=${H}`;
const keep = (name: string, s: Shot) => { mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/${name}.png`, s.png); };
const MAX_RATIO = 0.5; // D(1)/D(16): у чистого сдвига ≈ 0.1…0.3, у ряби → 1
const luma = (px: Buffer, i: number) => 0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!;

test.describe('дорога test-road', () => {
  test.setTimeout(600_000);

  // три камеры: у земли вдоль дороги (t=0), сбоку 3 м (t=10), сверху 20 м (t=20)
  for (const [name, t] of [['ground', 0], ['side', 10], ['top', 20]] as const) {
    test(`камера ${name} (t=${t}): два холодных запуска в допуске pixels.ts`, async () => {
      const a = await coldShot(ROAD, t, Math.max(0, t - DT)), b = await coldShot(ROAD, t, Math.max(0, t - DT));
      keep(`road-${name}`, a);
      const d = diff(a.px, b.px, W);
      writeFileSync(`${OUT}/road-${name}-diff.json`, JSON.stringify(d, null, 2));
      expect(a.errors.concat(b.errors)).toEqual([]);
      expect(a.hash).toBe(b.hash);
      expect(d.differing, `пикселей отличается: ${d.differing} из ${d.total}`).toBeLessThanOrEqual(Math.floor(d.total * MAX_SHARE));
      expect(d.maxChannelDiff).toBeLessThanOrEqual(MAX_CHANNEL);
    });
  }

  test('серия 6 кадров вдоль дороги: брусчатка вдали не мерцает', async () => {
    // Камера едет 2 м/с. Серия для глаз: 6 кадров через 0.1 с (шаг 0.2 м) → series-0..5.png.
    const eyes = await warmShots(ROAD, [[0], [0.1, 0], [0.2, 0.1], [0.3, 0.2], [0.4, 0.3], [0.5, 0.4]], true);
    eyes.forEach((s, k) => keep(`series-${k}`, s));
    // Мерцание: кадр 0 против кадров через k тиков (1 тик = 1/60 с, камера 3.3 см на тик). Узор, который просто
    // сдвигается, расходится с кадром 0 тем сильнее, чем дальше сдвиг (D растёт с k). Рябь — шум, который не зависит
    // от сдвига: D(1) уже почти как D(16). Отношение D(1)/D(16) — мера ряби (у чистого сдвига ≈ 0.1…0.3).
    const TICKS = [0, 1, 2, 4, 8, 16], tick = 1 / 60;
    const tiny = await warmShots(ROAD, TICKS.map((k) => [k * tick, Math.max(0, k - 1) * tick] as [number, number]));
    // Полосы по кадру: далёкая брусчатка (дорога уходит за холм) и средняя; без травы по бокам
    const bands = { far: [520, 680, 358, 396], mid: [470, 770, 405, 450] } as const;
    const res: Record<string, number[]> = {};
    for (const [name, [x0, x1, y0, y1]] of Object.entries(bands)) {
      res[name] = tiny.slice(1).map((s) => {
        let sum = 0, n = 0;
        for (let y = y0!; y < y1!; y++) for (let x = x0!; x < x1!; x++) { const i = (y * W + x) * 4; sum += Math.abs(luma(s.px, i) - luma(tiny[0]!.px, i)); n++; }
        return sum / n;
      });
    }
    const ratio = Object.fromEntries(Object.entries(res).map(([k, v]) => [k, v[0]! / v[v.length - 1]!]));
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/series-flicker.json`, JSON.stringify({ bands, ticks: TICKS.slice(1), meanAbsLumaDiffFromFrame0: res, ratio_D1_over_D16: ratio }, null, 2));
    expect(eyes.concat(tiny).every((s) => s.errors.length === 0)).toBe(true);
    for (const [name, r] of Object.entries(ratio)) expect(r, `${name}: D(1)/D(16) = ${r.toFixed(2)}; D по сдвигам: ${res[name]!.map((x) => x.toFixed(2)).join(' ')}`).toBeLessThan(MAX_RATIO);
  });
});
