import { chromium } from '@playwright/test';

/**
 * Общие помощники e2e для кадров «фильма»: холодный запуск браузера и чтение пикселей холста в той же задаче, что и
 * show(t) (иначе буфер WebGL уже сброшен). Порт плеера — как в playwright.config.ts (E2E_PORT, у каждой копии свой).
 */
export const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
export const BASE = `http://localhost:${Number(process.env.E2E_PORT ?? 5174)}`;

export type Player = { show(sec: number, prev?: number): string; shadowInfo(): { to: number; extent: number; texel: number }[] };
export type Shot = { hash: string; w: number; h: number; px: Buffer; png: Buffer; errors: string[]; shadow: { to: number; extent: number; texel: number }[] };

const shotScript = (sec: number, prev?: number) => `(() => {
  const p = window.__player; const hash = p.show(${sec}, ${prev});
  const c = document.getElementById('view'); const o = document.createElement('canvas'); o.width = c.width; o.height = c.height;
  const g = o.getContext('2d'); g.drawImage(c, 0, 0); const d = g.getImageData(0, 0, o.width, o.height).data;
  let s = ''; for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode(...d.subarray(i, i + 0x8000));
  return { hash, w: o.width, h: o.height, px: btoa(s), shadow: p.shadowInfo() };
})()`;

type Raw = { hash: string; w: number; h: number; px: string; shadow: Shot['shadow'] };

/** Холодный запуск: новый браузер, одна секунда фильма (prev — секунда перед ней, для векторов движения). */
export async function coldShot(query: string, sec: number, prev?: number): Promise<Shot> {
  const browser = await chromium.launch({ channel: 'chrome', args: ARGS });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openPlayer(page, query);
    const r = await page.evaluate(shotScript(sec, prev)) as Raw;
    const png = await page.locator('#view').screenshot();
    return { ...r, px: Buffer.from(r.px, 'base64'), png, errors };
  } finally { await browser.close(); }
}

/** Несколько показов подряд в одной странице (без перезапуска): для проверки «кадр не зависит от истории». */
export async function warmShots(query: string, steps: [sec: number, prev?: number][], withPng = false): Promise<Shot[]> {
  const browser = await chromium.launch({ channel: 'chrome', args: ARGS });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openPlayer(page, query);
    const out: Shot[] = [];
    for (const [sec, prev] of steps) {
      const r = await page.evaluate(shotScript(sec, prev)) as Raw;
      out.push({ ...r, px: Buffer.from(r.px, 'base64'), png: withPng ? await page.locator('#view').screenshot() : Buffer.alloc(0), errors });
    }
    return out;
  } finally { await browser.close(); }
}

/**
 * Последовательность вызовов плеера в одной странице: 'show' — перемотка (история TAA сбрасывается и прогревается),
 * 'step' — следующий кадр без перемотки (как при проигрывании: история копится). Для проверок «камера стоит» и «камера едет».
 */
export async function seqShots(query: string, calls: ['show' | 'step', number][], withPng = false): Promise<Shot[]> {
  const browser = await chromium.launch({ channel: 'chrome', args: ARGS });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openPlayer(page, query);
    const out: Shot[] = [];
    for (const [kind, sec] of calls) {
      const script = shotScript(sec).replace('p.show(' + sec + ', undefined)', kind === 'show' ? 'p.show(' + sec + ')' : 'p.step(' + sec + ')');
      const r = await page.evaluate(script) as Raw;
      out.push({ ...r, px: Buffer.from(r.px, 'base64'), png: withPng ? await page.locator('#view').screenshot() : Buffer.alloc(0), errors });
    }
    return out;
  } finally { await browser.close(); }
}

type PwPage = import('@playwright/test').Page;

/**
 * Надёжное открытие плеера. Раньше тесты ждали только window.__player и сразу делали evaluate: при первом заходе
 * Vite мог «открыть» зависимость на лету («optimized dependencies changed. reloading») и перезагрузить страницу
 * посреди evaluate → «Execution context was destroyed». Здесь: страница загрузилась, сеть утихла, __player есть,
 * первый кадр нарисован (#time заполнен), а идентификатор загрузки (performance.timeOrigin) не менялся за время проверки.
 * Если страница перезагрузилась (evaluate упал или timeOrigin сменился) — проверяем заново.
 */
export async function openPlayer(page: PwPage, query: string, timeoutMs = 90_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  await page.goto(BASE + query, { waitUntil: 'load' });
  for (;;) {
    try {
      const origin = await page.evaluate(() => performance.timeOrigin);
      await page.waitForLoadState('networkidle', { timeout: 15_000 });
      await page.waitForFunction(() => !!(window as unknown as { __player?: unknown }).__player && (document.getElementById('time')?.textContent ?? '').includes('/'), null, { timeout: 30_000 });
      await page.waitForTimeout(300); // окно для запоздалой перезагрузки Vite
      if ((await page.evaluate(() => performance.timeOrigin)) === origin) return;
    } catch (e) {
      if (Date.now() > until) throw e;
      await page.waitForTimeout(200); // страница перезагружается: ждём и пробуем снова
    }
    if (Date.now() > until) throw new Error('openPlayer: страница не успокоилась');
  }
}

/** Показать секунду и в той же задаче прочитать пиксели холста (RGBA) и PNG (без потерь). */
export async function frameAt(page: PwPage, sec: number): Promise<{ hash: string; w: number; h: number; px: Buffer; png: Buffer }> {
  const r = await page.evaluate(`(() => {
    const hash = window.__player.show(${sec});
    const c = document.getElementById('view'); const o = document.createElement('canvas'); o.width = c.width; o.height = c.height;
    const g = o.getContext('2d'); g.drawImage(c, 0, 0); const d = g.getImageData(0, 0, o.width, o.height).data;
    let s = ''; for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode(...d.subarray(i, i + 0x8000));
    return { hash, w: o.width, h: o.height, px: btoa(s), png: o.toDataURL('image/png').split(',')[1] };
  })()`) as { hash: string; w: number; h: number; px: string; png: string };
  return { hash: r.hash, w: r.w, h: r.h, px: Buffer.from(r.px, 'base64'), png: Buffer.from(r.png, 'base64') };
}

/** Декодировать PNG в RGBA-буфер (средствами браузера: своего декодера в проекте нет). */
export async function decodePng(page: PwPage, png: Buffer): Promise<{ w: number; h: number; px: Buffer }> {
  const r = await page.evaluate(async (b64: string) => {
    const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([u], { type: 'image/png' }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const o = document.createElement('canvas'); o.width = bmp.width; o.height = bmp.height;
    const g = o.getContext('2d')!; g.drawImage(bmp, 0, 0); const d = g.getImageData(0, 0, o.width, o.height).data;
    let s = ''; for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode(...d.subarray(i, i + 0x8000));
    return { w: o.width, h: o.height, px: btoa(s) };
  }, png.toString('base64'));
  return { w: r.w, h: r.h, px: Buffer.from(r.px, 'base64') };
}
