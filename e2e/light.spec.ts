import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { coldShot, warmShots, type Shot } from './capture.ts';
import { diff, MAX_CHANNEL, MAX_SHARE } from './pixels.ts';

// Задача 1.3: свет и тени. Кадры для глаз кладём в test-results/1.3-keep (в .gitignore; Playwright чистит test-results
// при старте, поэтому пишем из тестов, а не заранее). Эталонов-картинок нет: проверяем числами и повторяемостью.
const OUT = 'test-results/1.3-keep';
const W = 1280, H = 720, DT = 1 / 30;
const FILM = `/?backend=webgl2&film=1&w=${W}&h=${H}`;
const keep = (name: string, s: Shot) => { mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/${name}.png`, s.png); };
const luma = (s: Shot, x: number, y: number) => { const i = (y * s.w + x) * 4; return 0.2126 * s.px[i]! + 0.7152 * s.px[i + 1]! + 0.0722 * s.px[i + 2]!; };

test.describe('солнце и тени', () => {
  test.setTimeout(120_000);

  // Вид сверху на плоской земле, солнце с юга (азимут 180): тень бокса падает на +z, то есть вниз по кадру.
  // Камера в 30 м над боксом, fov 20: 720 px = 2·30·tan(10°) м, ~68 px/м. Основание бокса — ±0.2 м от центра кадра.
  for (const el of [10, 30, 60]) {
    test(`высота солнца ${el}°: длина тени бокса ≈ 0.4/tan(высоты)`, async () => {
      const s = await coldShot(`${FILM}&probe=hero&view=top&flat=1&sun=${el},180`, 16, 16 - DT);
      keep(`probe-top-sun${el}`, s);
      expect(s.errors).toEqual([]);
      const pxPerM = H / (2 * 30 * Math.tan((10 * Math.PI) / 180));
      const x = W / 2, base = Math.round(H / 2 + 0.2 * pxPerM) + 1; // первая строка ниже основания
      const lit = luma(s, x, H - 5), dark = luma(s, x, base + 3);
      expect(lit - dark, 'тень темнее освещённой земли (на 10° контраст мал: свет скользит по земле)').toBeGreaterThan(5);
      const thr = (lit + dark) / 2;
      let n = 0;
      while (base + n < H && luma(s, x, base + n) < thr) n++;
      const measured = n / pxPerM, expected = 0.4 / Math.tan((el * Math.PI) / 180);
      writeFileSync(`${OUT}/probe-top-sun${el}.json`, JSON.stringify({ el, expectedM: expected, measuredM: measured, lit, dark }, null, 2));
      // допуск: 2 пикселя границы (полутень PCF) + 8 %
      expect(Math.abs(measured - expected), `длина тени ${measured.toFixed(3)} м, ждали ${expected.toFixed(3)} м`).toBeLessThanOrEqual(2 / pxPerM + 0.08 * expected);
    });
  }

  for (const el of [10, 30, 60]) {
    test(`кадр ${el}°: бокс у камеры и паук с тенями (для глаз)`, async () => {
      const s = await coldShot(`${FILM}&probe=hero&sun=${el},90`, 16, 16 - DT);
      keep(`probe-cam-sun${el}`, s);
      expect(s.errors).toEqual([]);
    });
  }

  test('общий план: тени рельефа до горизонта (кадры для глаз)', async () => {
    const s = await coldShot(`${FILM}&sun=12,100`, 3, 3 - DT);
    keep('wide-sun12', s);
    const t = await coldShot(`${FILM}`, 16, 16 - DT);
    keep('scene01-t16-spider', t);
    expect(s.errors.concat(t.errors)).toEqual([]);
  });

  test('карта теней: у камеры тексель ≤ 5 см, каскады растут к горизонту', async () => {
    for (const sec of [3, 16, 29]) { // общий план, низкая точка, крупный план (fov разный)
      const s = await coldShot(`${FILM}&probe=hero`, sec, sec - DT);
      const texels = s.shadow.map((c) => c.texel);
      writeFileSync(`${OUT}/shadow-cascades-t${sec}.json`, JSON.stringify(s.shadow, null, 2));
      expect(texels[0]!, `t=${sec}: тексел первого каскада, м`).toBeLessThanOrEqual(0.05);
      expect(texels[1]!, `t=${sec}: тексел второго каскада, м`).toBeLessThanOrEqual(0.06);
      for (let i = 1; i < texels.length; i++) expect(texels[i]!).toBeGreaterThan(texels[i - 1]!);
    }
  });

  test('два холодных запуска одного кадра с тенями: в допуске', async () => {
    const q = `${FILM}&probe=hero&sun=30,90`;
    const a = await coldShot(q, 16, 16 - DT), b = await coldShot(q, 16, 16 - DT);
    const d = diff(a.px, b.px, W);
    writeFileSync(`${OUT}/cold-runs-diff.json`, JSON.stringify(d, null, 2));
    expect(a.errors.concat(b.errors)).toEqual([]);
    expect(a.hash).toBe(b.hash);
    expect(d.differing, `пикселей отличается: ${d.differing} из ${d.total}`).toBeLessThanOrEqual(Math.floor(d.total * MAX_SHARE));
    expect(d.maxChannelDiff).toBeLessThanOrEqual(MAX_CHANNEL);
  });

  test('тень обновляется на каждый render(): несколько показов в одной странице', async () => {
    // Три render() подряд в одном браузерном кадре. Если каскады обновлялись раз за rAF, третий кадр унаследовал бы тень второго.
    const q = `${FILM}&probe=hero&sun=30,90`;
    const [a, b, c] = await warmShots(q, [[16, 16 - DT], [40, 40 - DT], [16, 16 - DT]]);
    const same = diff(a!.px, c!.px, W), other = diff(a!.px, b!.px, W);
    writeFileSync(`${OUT}/rerender-diff.json`, JSON.stringify({ firstVsThird: same, firstVsSecond: other }, null, 2));
    expect(same.differing, `пикселей отличается: ${same.differing} из ${same.total}`).toBeLessThanOrEqual(Math.floor(same.total * MAX_SHARE));
    expect(same.maxChannelDiff).toBeLessThanOrEqual(MAX_CHANNEL);
    expect(other.differing, 'разные секунды дают разные кадры').toBeGreaterThan(same.total * 0.05);
  });
});
