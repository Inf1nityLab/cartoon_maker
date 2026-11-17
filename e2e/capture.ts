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
    await page.goto(BASE + query);
    await page.waitForFunction(() => (window as unknown as { __player?: Player }).__player);
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
    await page.goto(BASE + query);
    await page.waitForFunction(() => (window as unknown as { __player?: Player }).__player);
    const out: Shot[] = [];
    for (const [sec, prev] of steps) {
      const r = await page.evaluate(shotScript(sec, prev)) as Raw;
      out.push({ ...r, px: Buffer.from(r.px, 'base64'), png: withPng ? await page.locator('#view').screenshot() : Buffer.alloc(0), errors });
    }
    return out;
  } finally { await browser.close(); }
}
