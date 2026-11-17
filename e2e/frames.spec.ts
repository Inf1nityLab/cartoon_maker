import { expect, test } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { decodePng, frameAt, openPlayer } from './capture.ts';
import { diff, MAX_CHANNEL, MAX_SHARE } from './pixels.ts';

// Эталонные кадры «Сцены 01». Режим film + accum=8: кадр = среднее 8 сэмплов в один момент t, без истории TAA, поэтому
// не зависит от того, сколько кадров успела нарисовать машина. Сравнение строгое (e2e/pixels.ts: ≤0.01 % пикселей,
// ≤2/255 по каналу) с PNG в репозитории. Обновить эталоны при законном изменении картинки:
//   UPDATE_FRAMES=1 E2E_PORT=<порт> pnpm exec playwright test e2e/frames.spec.ts   (печатает список изменившихся кадров)
const FRAMES = [3, 16, 32, 56];
const QUERY = '/?backend=webgl2&film=1&accum=8&w=1280&h=720';
const DIR = 'e2e/frames';
const UPDATE = process.env.UPDATE_FRAMES === '1';

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

for (const t of FRAMES) {
  test(`кадр t=${t}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openPlayer(page, QUERY);
    const shot = await frameAt(page, t);
    const file = `${DIR}/scene-01-t${t}.png`;
    if (UPDATE) {
      let note = 'новый эталон';
      if (existsSync(file)) {
        const old = await decodePng(page, readFileSync(file));
        const d = old.w === shot.w && old.h === shot.h ? diff(old.px, shot.px, shot.w) : null;
        note = d ? `изменилось ${d.differing} из ${d.total} пикселей (${((d.differing / d.total) * 100).toFixed(3)} %), макс. разница канала ${d.maxChannelDiff}/255` : `размер ${old.w}x${old.h} → ${shot.w}x${shot.h}`;
        if (d && d.differing === 0) note = 'без изменений';
      }
      if (!note.startsWith('без')) { mkdirSync(DIR, { recursive: true }); writeFileSync(file, shot.png); }
      console.log(`[UPDATE_FRAMES] t=${t}: ${note}`);
      return;
    }
    expect(existsSync(file), `нет эталона ${file}: UPDATE_FRAMES=1`).toBe(true);
    const ref = await decodePng(page, readFileSync(file));
    expect({ w: shot.w, h: shot.h }).toEqual({ w: ref.w, h: ref.h });
    const d = diff(ref.px, shot.px, shot.w);
    if (d.differing > Math.floor(d.total * MAX_SHARE) || d.maxChannelDiff > MAX_CHANNEL) {
      mkdirSync('test-results/frames-actual', { recursive: true });
      writeFileSync(`test-results/frames-actual/scene-01-t${t}.png`, shot.png);
    }
    expect(d.differing, `пикселей отличается: ${d.differing} из ${d.total}`).toBeLessThanOrEqual(Math.floor(d.total * MAX_SHARE));
    expect(d.maxChannelDiff).toBeLessThanOrEqual(MAX_CHANNEL);
    expect(errors).toEqual([]);
  });
}

test('два показа одной секунды дают один хэш WorldState', async ({ page }) => {
  await openPlayer(page, QUERY);
  const a = await page.evaluate(() => (window as any).__player.show(20));
  await page.evaluate(() => (window as any).__player.show(5));
  const b = await page.evaluate(() => (window as any).__player.show(20));
  expect(a).toBe(b);
});
