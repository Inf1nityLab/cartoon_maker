import { chromium, expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { diff, MAX_CHANNEL, MAX_SHARE } from './pixels.ts';

// Задача 1.1: режим «фильм» и выход движения. Кадры складываем в e2e/report-1.1 (не в snapshots).
// swiftshader (как в frames.spec.ts): на нём же и считаем допуски.
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const BASE = 'http://localhost:5174';
const W = 640, H = 360, DT = 1 / 30;
const OUT = 'e2e/report-1.1';
const FILM = `/?backend=webgl2&film=1&w=${W}&h=${H}`;

type Player = { show(sec: number, prev?: number): string };
/** Рисует кадр и в той же задаче читает пиксели холста (иначе буфер WebGL уже сброшен). */
const shot = (sec: number, prev?: number) => `(() => {
  const p = window.__player; const hash = p.show(${sec}, ${prev});
  const c = document.getElementById('view'); const o = document.createElement('canvas'); o.width = c.width; o.height = c.height;
  const g = o.getContext('2d'); g.drawImage(c, 0, 0); const d = g.getImageData(0, 0, o.width, o.height).data;
  let s = ''; for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode(...d.subarray(i, i + 0x8000));
  return { hash, w: o.width, h: o.height, px: btoa(s) };
})()`;

async function coldRun(query: string, sec: number, prev?: number) {
  const browser = await chromium.launch({ channel: 'chrome', args: ARGS });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(BASE + query);
    await page.waitForFunction(() => (window as unknown as { __player?: Player }).__player);
    const r = await page.evaluate(shot(sec, prev)) as { hash: string; w: number; h: number; px: string };
    const png = await page.locator('#view').screenshot();
    return { ...r, px: Buffer.from(r.px, 'base64'), png, errors };
  } finally { await browser.close(); }
}

test.describe('режим film', () => {
  test.setTimeout(120_000);
  test('размер кадра фиксирован и не зависит от окна', async () => {
    const a = await coldRun(FILM, 16);
    expect([a.w, a.h]).toEqual([W, H]);
    expect(a.errors).toEqual([]);
  });

  test('два холодных запуска одной секунды: кадры в допуске', async () => {
    mkdirSync(OUT, { recursive: true });
    const a = await coldRun(FILM, 16, 16 - DT), b = await coldRun(FILM, 16, 16 - DT);
    writeFileSync(`${OUT}/film-t16-run1.png`, a.png);
    writeFileSync(`${OUT}/film-t16-run2.png`, b.png);
    const d = diff(a.px, b.px, W);
    writeFileSync(`${OUT}/film-t16-diff.json`, JSON.stringify(d, null, 2));
    expect(a.errors.concat(b.errors)).toEqual([]);
    expect(a.hash).toBe(b.hash);
    expect(d.differing, `пикселей отличается: ${d.differing} из ${d.total}`).toBeLessThanOrEqual(Math.floor(d.total * MAX_SHARE));
    expect(d.maxChannelDiff).toBeLessThanOrEqual(MAX_CHANNEL);
  });

  test('seek: show(t) после показа другой секунды = show(t) сразу', async () => {
    const direct = await coldRun(FILM, 32, 32 - DT);
    const browser = await chromium.launch({ channel: 'chrome', args: ARGS });
    try {
      const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
      await page.goto(BASE + FILM);
      await page.waitForFunction(() => (window as unknown as { __player?: Player }).__player);
      await page.evaluate(shot(5));
      const r = await page.evaluate(shot(32, 32 - DT)) as { px: string };
      const d = diff(direct.px, Buffer.from(r.px, 'base64'), W);
      writeFileSync(`${OUT}/seek-diff.json`, JSON.stringify(d, null, 2));
      expect(d.differing, `пикселей отличается: ${d.differing} из ${d.total}`).toBeLessThanOrEqual(Math.floor(d.total * MAX_SHARE));
      expect(d.maxChannelDiff).toBeLessThanOrEqual(MAX_CHANNEL);
    } finally { await browser.close(); }
  });
});

test.describe('выход движения (?debug=motion)', () => {
  test.setTimeout(120_000);
  test('на движущемся объекте векторы не нулевые, на небе серый (0)', async () => {
    mkdirSync(OUT, { recursive: true });
    const m = await coldRun(`${FILM}&debug=motion`, 16, 16 - DT);
    const n = await coldRun(FILM, 16, 16 - DT);
    writeFileSync(`${OUT}/motion-t16.png`, m.png);
    writeFileSync(`${OUT}/color-t16.png`, n.png);
    // небо: верхняя строка кадра; серый 0.5 → 127/128 (допуск 1)
    const at = (x: number, y: number) => [...m.px.subarray((y * W + x) * 4, (y * W + x) * 4 + 3)];
    const sky = at(W / 2, 4);
    for (const v of sky) expect(Math.abs(v - 128)).toBeLessThanOrEqual(2);
    // объект: сколько пикселей заметно не серых
    let moving = 0;
    for (let i = 0; i < m.px.length; i += 4) if (Math.max(Math.abs(m.px[i]! - 128), Math.abs(m.px[i + 1]! - 128)) > 6) moving++;
    writeFileSync(`${OUT}/motion-t16.json`, JSON.stringify({ sky, movingPixels: moving, total: m.px.length / 4 }, null, 2));
    expect(moving, 'пиксели с ненулевым вектором').toBeGreaterThan(200);
  });
});
