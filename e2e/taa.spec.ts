import { chromium, expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { diff, MAX_CHANNEL, MAX_SHARE } from './pixels.ts';

// Задача 1.2: TAA с векторами движения, прогрев после перемотки, режим накопления (?accum=N).
// Кадры и числа — в e2e/report-1.2 (не в git). swiftshader, как в остальных спеках.
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const BASE = `http://localhost:${process.env.E2E_PORT ?? 5174}`;
const W = 640, H = 360, DT = 1 / 30;
const OUT = 'e2e/report-1.2';
const FILM = `/?backend=webgl2&film=1&w=${W}&h=${H}`;

type Player = { show(sec: number, prev?: number): string; step(sec: number): string; play(from: number, to: number): string };
/** Выполняет действие над плеером и в той же задаче читает пиксели холста (иначе буфер WebGL уже сброшен). */
const grab = (action: string) => `(() => {
  const p = window.__player; ${action};
  const c = document.getElementById('view'); const o = document.createElement('canvas'); o.width = c.width; o.height = c.height;
  const g = o.getContext('2d'); g.drawImage(c, 0, 0); const d = g.getImageData(0, 0, o.width, o.height).data;
  let s = ''; for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode(...d.subarray(i, i + 0x8000));
  return btoa(s);
})()`;

async function open(query: string) {
  const browser = await chromium.launch({ channel: 'chrome', args: ARGS });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + query);
  await page.waitForFunction(() => (window as unknown as { __player?: Player }).__player);
  const px = async (action: string) => Buffer.from(await page.evaluate(grab(action)) as string, 'base64');
  return { page, px, errors, close: () => browser.close() };
}
const cold = async (query: string, action: string) => {
  const s = await open(query);
  try { return { px: await s.px(action), errors: s.errors }; } finally { await s.close(); }
};
/** Средняя и максимальная разница по каналам, доля пикселей с разницей > 8/255. */
const stats = (a: Buffer, b: Buffer) => {
  let sum = 0, max = 0, big = 0;
  for (let i = 0; i < a.length; i += 4) {
    let m = 0;
    for (let k = 0; k < 3; k++) { const d = Math.abs(a[i + k]! - b[i + k]!); sum += d; if (d > m) m = d; }
    if (m > max) max = m;
    if (m > 8) big++;
  }
  return { meanAbs: sum / (a.length / 4 * 3), maxChannel: max, shareOver8: big / (a.length / 4) };
};
const save = async (page: Page, name: string, px: Buffer) => {
  const png = await page.evaluate(`(() => { const o = document.createElement('canvas'); o.width = ${W}; o.height = ${H};
    const g = o.getContext('2d'); const im = g.createImageData(${W}, ${H}); const b = atob('${px.toString('base64')}');
    for (let i = 0; i < b.length; i++) im.data[i] = b.charCodeAt(i); g.putImageData(im, 0, 0); return o.toDataURL('image/png'); })()`) as string;
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(png.split(',')[1]!, 'base64'));
};

test.describe('TAA (задача 1.2)', () => {
  test.setTimeout(240_000);

  test('film + accumulate: два холодных запуска, seek и проигрывание дают один кадр в допуске', async () => {
    mkdirSync(OUT, { recursive: true });
    const q = `${FILM}&accum=6`;
    const T = 24; // орбита камеры и движение паука: векторы были бы нужны, но в накоплении история не переносится
    const a = await cold(q, `p.show(${T})`);
    const b = await cold(q, `p.show(${T})`);
    const played = await cold(q, `p.play(${T - 4 * DT}, ${T})`); // 5 кадров подряд, показан последний
    const seekAfter = await open(q);
    let seeked: Buffer;
    try { await seekAfter.px('p.show(5)'); seeked = await seekAfter.px(`p.show(${T})`); } finally { await seekAfter.close(); }
    const results: Record<string, unknown> = {};
    for (const [name, other] of [['cold-vs-cold', b.px], ['seek-vs-cold', seeked], ['play-vs-cold', played.px]] as const) {
      const d = diff(a.px, other, W);
      results[name] = d;
      expect(d.differing, `${name}: пикселей отличается ${d.differing} из ${d.total}`).toBeLessThanOrEqual(Math.floor(d.total * MAX_SHARE));
      expect(d.maxChannelDiff, name).toBeLessThanOrEqual(MAX_CHANNEL);
    }
    writeFileSync(`${OUT}/accumulate-diffs.json`, JSON.stringify(results, null, 2));
    expect(a.errors.concat(b.errors, played.errors, seekAfter.errors)).toEqual([]);
  });

  test('обычный TAA: seek(t) после прогрева против проигрывания до t (числа в отчёте)', async () => {
    mkdirSync(OUT, { recursive: true });
    const T = 24;
    const s = await open(FILM);
    try {
      const seeked = await s.px(`p.show(${T})`);
      const played = await s.px(`p.play(${T - 15 * DT}, ${T})`); // 16 кадров подряд: история набрана
      const ref = await (async () => { const r = await open(`${FILM}&accum=16`); try { return await r.px(`p.show(${T})`); } finally { await r.close(); } })();
      const sp = stats(seeked, played), sr = stats(seeked, ref), pr = stats(played, ref);
      writeFileSync(`${OUT}/taa-seek-vs-play.json`, JSON.stringify({ t: T, warmup: 3, playFrames: 16, seekVsPlay: sp, seekVsAccum16: sr, playVsAccum16: pr }, null, 2));
      await save(s.page, 'taa-seek', seeked);
      await save(s.page, 'taa-play', played);
      expect(sp.meanAbs, 'seek против проигрывания, среднее по каналам /255').toBeLessThan(1.5);
      expect(pr.meanAbs, 'проигрывание против накопления 16').toBeLessThan(1.5);
      expect(s.errors).toEqual([]);
    } finally { await s.close(); }
  });

  test('орбита камеры: TAA без шлейфа (ошибка против накопления 16 мала), без TAA — для сравнения', async () => {
    mkdirSync(OUT, { recursive: true });
    const T = 24 + 9 * DT; // камера кружит вокруг паука (shot orbit с 21 с)
    const run = async (query: string, action: string) => { const s = await open(query); try { return await s.px(action); } finally { await s.close(); } };
    const taa = await run(FILM, `p.play(24, ${T})`);
    const off = await run(`${FILM}&taa=0`, `p.play(24, ${T})`);
    const ref = await run(`${FILM}&accum=16`, `p.show(${T})`);
    const a = stats(taa, ref), b = stats(off, ref);
    writeFileSync(`${OUT}/orbit-vs-accum16.json`, JSON.stringify({ taa: a, off: b }, null, 2));
    expect(a.meanAbs, 'TAA против накопления').toBeLessThan(1.2);
    expect(a.shareOver8, 'доля сильно отличающихся пикселей (край шлейфа)').toBeLessThan(0.03);
  });

  test('?taa=0 и ?accum=N работают без ошибок и дают разные кадры', async () => {
    const on = await cold(FILM, 'p.show(16)');
    const off = await cold(`${FILM}&taa=0`, 'p.show(16)');
    expect(on.errors.concat(off.errors)).toEqual([]);
    expect(diff(on.px, off.px, W).differing, 'TAA меняет края').toBeGreaterThan(100);
  });
});
