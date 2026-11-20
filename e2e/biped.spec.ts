import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { ARGS, coldShot, warmShots } from './capture.ts';
import { diff, MAX_CHANNEL, MAX_SHARE } from './pixels.ts';

// Задача Ч1: витрина Biped. Кадры для глаз — в artifacts/H1 (Playwright чистит test-results). Эталонов-картинок нет: смотрим глазами.
const OUT = 'artifacts/H1';
const W = 960, H = 540;
const lib = (extra: string) => `/library.html?backend=webgl2&film=1&w=${W}&h=${H}&object=Biped&${extra}`;
mkdirSync(OUT, { recursive: true });

/** Склеивает кадры в одну картинку (сетка cols колонок) средствами браузера: своего PNG-кодера в проекте нет. */
async function montage(pngs: Buffer[], cols: number, name: string): Promise<void> {
  const browser = await chromium.launch({ channel: 'chrome', args: ARGS });
  try {
    const page = await browser.newPage();
    const b64 = await page.evaluate(async ({ imgs, cols, w, h }: { imgs: string[]; cols: number; w: number; h: number }) => {
      cols = Math.min(cols, imgs.length); const rows = Math.ceil(imgs.length / cols), cw = Math.round(w * 0.5), ch = Math.round(h * 0.5);
      const c = document.createElement('canvas'); c.width = cw * cols; c.height = ch * rows;
      const g = c.getContext('2d')!; g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
      for (let i = 0; i < imgs.length; i++) {
        const bin = atob(imgs[i]!); const u = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) u[k] = bin.charCodeAt(k);
        const bmp = await createImageBitmap(new Blob([u], { type: 'image/png' }));
        g.drawImage(bmp, (i % cols) * cw, Math.floor(i / cols) * ch, cw, ch);
      }
      return c.toDataURL('image/png').split(',')[1]!;
    }, { imgs: pngs.map((p) => p.toString('base64')), cols, w: W, h: H });
    writeFileSync(`${OUT}/${name}.png`, Buffer.from(b64, 'base64'));
  } finally { await browser.close(); }
}

async function series(name: string, query: string, times: number[], cols = 3): Promise<void> {
  const shots = await warmShots(lib(query), times.map((t, i) => [t, i === 0 ? t - 1 / 30 : times[i - 1]!] as [number, number]), true);
  shots.forEach((s, i) => { expect(s.errors, name).toEqual([]); writeFileSync(`${OUT}/${name}-${i + 1}.png`, s.png); });
  await montage(shots.map((s) => s.png), cols, name);
}

test.describe('Biped: витрина', () => {
  test.setTimeout(600_000);
  const only = process.env.H1 ?? '';
  const on = (n: string) => !only || only.split(',').includes(n);

  test('поза покоя: спереди и сбоку', async () => {
    test.skip(!on('rest'));
    await series('rest-front', 'view=front&p.clip=biped.rest-pose', [0.2]);
    await series('rest-side', 'view=side&p.clip=biped.rest-pose', [0.2]);
  });

  test('клипы: по 3 из каждой базы, серии по 6 кадров', async () => {
    test.skip(!on('clips'));
    const clips = (process.env.H1CLIPS ?? 's100.proud.walk,s100.angry.run,s100.old.walk,ual.walk,ual.fast-run,ual.hit-chest').split(',');
    // разовый клип «удар в грудь» длится 0,33 с: кадры чаще
    for (const c of clips) await series(`clip-${c}`, `view=side&p.clip=${c}`, c === 'ual.hit-chest' ? [0.0, 0.07, 0.13, 0.2, 0.27, 0.33] : [0.1, 0.3, 0.5, 0.7, 0.9, 1.1]);
  });

  test('склейка шаг → бег', async () => {
    test.skip(!on('stitch'));
    await series('stitch-walk-run', 'view=side&demo=1', [3.2, 3.5, 3.7, 3.9, 4.2, 4.6]);
  });

  test('смешивание стилей: вес 0, 0,5, 1', async () => {
    test.skip(!on('blend'));
    for (const w of [0, 0.5, 1]) await series(`blend-${w}`, `view=side&p.speed=1.0&p.styleA=proud&p.styleB=zombie&p.style=${w}`, [2.0, 2.2, 2.4, 2.6, 2.8, 3.0]);
  });

  test('удивление: серии по 8 кадров', async () => {
    test.skip(!on('startle'));
    await series('startle', 'view=side&demo=0', [2.6, 3.4, 4.0, 4.4, 4.8, 5.2, 6.0, 7.0], 4);
    await series('startle-front', 'view=front&demo=0', [2.6, 3.4, 4.0, 4.4, 4.8, 5.2, 6.0, 7.0], 4);
  });

  test('два холодных запуска кадра удивления: хэш равен, пиксели в допуске; витрина без ошибок консоли', async () => {
    test.skip(!on('cold'));
    const q = lib('view=side&demo=0');
    const a = await coldShot(q, 4.6, 4.6 - 1 / 30), b = await coldShot(q, 4.6, 4.6 - 1 / 30);
    const d = diff(a.px, b.px, W);
    writeFileSync(`${OUT}/cold-runs-diff.json`, JSON.stringify(d, null, 2));
    expect(a.errors.concat(b.errors)).toEqual([]);
    expect(a.hash).toBe(b.hash);
    expect(d.differing, `пикселей отличается: ${d.differing} из ${d.total}`).toBeLessThanOrEqual(Math.floor(d.total * MAX_SHARE));
    expect(d.maxChannelDiff).toBeLessThanOrEqual(MAX_CHANNEL);
  });
});
