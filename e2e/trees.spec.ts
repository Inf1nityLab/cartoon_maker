import { chromium, expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { ARGS, BASE, coldShot, frameAt, openPlayer } from './capture.ts';
import { diff, MAX_CHANNEL, MAX_SHARE } from './pixels.ts';

// Задача Б2: деревья (Tree). Кадры для глаз — в test-results/B2-keep (Playwright чистит test-results при старте,
// поэтому пишем из тестов). Эталонов-картинок нет: смотрим глазами и проверяем числами.
const OUT = 'test-results/B2-keep';
const W = 1280, H = 720, DT = 1 / 30;
const lib = (extra: string, size = `&w=${W}&h=${H}`) => `/library.html?backend=webgl2&film=1${size}&${extra}`;
const keep = (name: string, png: Buffer) => { mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/${name}.png`, png); };
const shot = async (name: string, query: string, t = 1) => {
  const s = await coldShot(lib(query), t, t - DT);
  keep(name, s.png);
  expect(s.errors, name).toEqual([]);
  return s;
};
const SPECIES = ['oak', 'ash', 'aspen', 'birch', 'pine', 'spruce', 'bush1', 'bush2', 'bush3', 'willow'];
const BASEQ = 'object=Tree&view=general&time=11&clouds=0&wind=0.5&gust=-1';

test.describe('деревья (Б2): кадры', () => {
  test.setTimeout(900_000);

  test('каждая порода', async () => {
    const hashes = new Set<string>();
    for (const sp of SPECIES) {
      // кусты снимаем ближе: рост 1–2 м
      const view = sp.startsWith('bush') ? 'close' : 'general';
      hashes.add((await shot(`species-${sp}`, `object=Tree&preset=${sp}&view=${view}&time=11&clouds=0`)).hash);
    }
    expect(hashes.size).toBe(SPECIES.length); // у каждой породы своё состояние (рост, цвет); как выглядит — смотрим глазами
  });

  test('семейная фотография: 8 пород в ряд одним кадром', async () => {
    await shot('family-8', 'object=Tree&family=1&time=11&clouds=0');
    await shot('family-8-autumn', 'object=Tree&family=1&time=16&clouds=0.2&p.season=0.55');
  });

  test('дуб с четырьмя seed: похожи, но не одинаковы', async () => {
    const pngs: Buffer[] = [];
    for (const seed of [35729, 1, 2, 3]) pngs.push((await shot(`oak-seed-${seed}`, `${BASEQ}&preset=oak&p.seed=${seed}`)).px);
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
      const d = diff(pngs[i]!, pngs[j]!, W);
      expect(d.differing / d.total, `seed ${i} против ${j}`).toBeGreaterThan(0.003); // не одинаковы
    }
  });

  test('возраст 0 / 0.5 / 1', async () => {
    for (const age of [0, 0.25, 0.5, 1]) await shot(`age-${age}`, `${BASEQ}&preset=oak&p.age=${age}&view=${age === 0 ? 'close' : 'general'}`);
  });

  test('сезон 0 / 0.4 / 0.6 / 0.8 / 1', async () => {
    const h = new Set<string>();
    for (const season of [0, 0.4, 0.6, 0.8, 1]) h.add((await shot(`season-${season}`, `${BASEQ}&preset=oak&p.season=${season}`)).hash);
    expect(h.size).toBe(5);
    for (const season of [0.5, 0.65]) await shot(`season-birch-${season}`, `${BASEQ}&preset=birch&p.season=${season}`);
  });

  test('снег на ветвях (мороз) и без снега в тепле', async () => {
    await shot('snow-oak-winter', `${BASEQ}&preset=oak&p.season=1&p.snow=1&temp=-8`);
    await shot('snow-spruce', `${BASEQ}&preset=spruce&p.snow=1&temp=-8`);
    await shot('snow-pine-close', 'object=Tree&preset=pine&view=close&time=11&clouds=0&wind=0.5&p.snow=1&temp=-8');
    await shot('snow-asked-but-warm', `${BASEQ}&preset=spruce&p.snow=1&temp=12`); // тепло: снега нет
  });

  test('демо ручек: лето → осень → листопад → голое → снег, кадры', async () => {
    for (const t of [0.5, 3, 6.5, 9, 11.5, 15]) await shot(`demo-${t}`, 'object=Tree&preset=oak&view=general&time=11&clouds=0.1&demo=0', t);
  });
});

test.describe('деревья (Б2): ветер', () => {
  test.setTimeout(600_000);

  /** Серия кадров порыва в одной странице; возвращает амплитуду верхушки (м) по логике на каждом кадре. */
  async function gustSeries(name: string, preset: string, times: number[]) {
    const browser = await chromium.launch({ channel: 'chrome', args: ARGS });
    try {
      const page = await (await browser.newContext({ viewport: { width: W, height: H } })).newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await openPlayer(page, lib(`object=Tree&preset=${preset}&view=general&time=11&clouds=0&wind=1&winddir=90&gust=1&p.height=12`));
      const amp: number[] = [], hashes: string[] = [];
      for (const [i, t] of times.entries()) {
        const f = await frameAt(page, t);
        keep(`wind-${name}-${i + 1}`, f.png);
        hashes.push(f.hash);
        amp.push(await page.evaluate(() => (window as unknown as { __player: { state(): { entities: Record<string, { sway: number }> } } }).__player.state().entities.tree!.sway));
      }
      expect(errors).toEqual([]);
      return { amp, hashes };
    } finally { await browser.close(); }
  }

  test('порыв ветра, серия 6 кадров: берёза качается сильнее дуба (числа амплитуды)', async () => {
    const times = [0.9, 1.5, 2.1, 2.8, 3.6, 5];
    const birch = await gustSeries('birch', 'birch', times), oak = await gustSeries('oak', 'oak', times);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/wind-amplitude.json`, JSON.stringify({ times, birchSwayM: birch.amp, oakSwayM: oak.amp }, null, 2));
    expect(new Set(birch.hashes).size).toBe(6);
    expect(Math.max(...birch.amp)).toBeGreaterThan(Math.max(...oak.amp) * 1.8);
    expect(Math.max(...birch.amp)).toBeGreaterThan(birch.amp[0]! * 3);
  });

  test('тень дерева падает от солнца: на земле тёмное пятно под нужным азимутом', async () => {
    const lit = await coldShot(lib('object=Tree&preset=oak&view=top&time=11&clouds=0&wind=0'), 1, 1 - DT);
    keep('shadow-top', lit.png);
    // в кадре «сверху» земля светлая и ровная; доля заметно более тёмных пикселей — тень кроны и ствола
    const lum = (i: number) => 0.299 * lit.px[i]! + 0.587 * lit.px[i + 1]! + 0.114 * lit.px[i + 2]!;
    const ys: number[] = [];
    for (let i = 0; i < lit.px.length; i += 4) ys.push(lum(i));
    const sorted = [...ys].sort((a, b) => a - b), med = sorted[Math.floor(sorted.length / 2)]!;
    const dark = ys.filter((y) => y < med * 0.8).length / ys.length;
    writeFileSync(`${OUT}/shadow-number.json`, JSON.stringify({ medianLuma: med, shareDarkerThan80pct: dark }, null, 2));
    expect(dark).toBeGreaterThan(0.005);
    const noon = await coldShot(lib('object=Tree&preset=oak&view=top&time=7&clouds=0&wind=0'), 1, 1 - DT);
    keep('shadow-top-morning', noon.png);
    expect(diff(lit.px, noon.px, W).differing).toBeGreaterThan(1000); // тень сдвинулась вместе с солнцем
  });

  test('TAA в листве на ветру: ошибка против накопления мала, шлейфа нет (серия кадров подряд)', async () => {
    const q = (extra: string) => lib(`object=Tree&preset=birch&view=close&time=11&clouds=0&wind=7&winddir=90&p.height=12${extra}`, '&w=640&h=360');
    const run = async (query: string, action: string) => {
      const browser = await chromium.launch({ channel: 'chrome', args: ARGS });
      try {
        const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await openPlayer(page, query);
        const b64 = await page.evaluate(`(() => { const p = window.__player; ${action};
          const c = document.getElementById('view'); const o = document.createElement('canvas'); o.width = c.width; o.height = c.height;
          const g = o.getContext('2d'); g.drawImage(c, 0, 0); const d = g.getImageData(0, 0, o.width, o.height).data;
          let s = ''; for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode(...d.subarray(i, i + 0x8000)); return btoa(s); })()`) as string;
        expect(errors).toEqual([]);
        return Buffer.from(b64, 'base64');
      } finally { await browser.close(); }
    };
    const stats = (a: Buffer, b: Buffer) => {
      let sum = 0, big = 0;
      for (let i = 0; i < a.length; i += 4) { let m = 0; for (let k = 0; k < 3; k++) { const d = Math.abs(a[i + k]! - b[i + k]!); sum += d; if (d > m) m = d; } if (m > 12) big++; }
      return { meanAbs: sum / (a.length / 4 * 3), shareOver12: big / (a.length / 4) };
    };
    const T = 3 + 9 * DT; // девять кадров подряд на ветру
    const taa = await run(q(''), `p.play(3, ${T})`);
    const off = await run(q('&taa=0'), `p.play(3, ${T})`);
    const ref = await run(q('&accum=16&taa=0'), `p.show(${T})`);
    const a = stats(taa, ref), b = stats(off, ref);
    writeFileSync(`${OUT}/taa-wind-vs-accum16.json`, JSON.stringify({ taa: a, noAA: b }, null, 2));
    expect(a.meanAbs).toBeLessThan(b.meanAbs); // TAA ближе к эталону, чем кадр без сглаживания
    expect(a.meanAbs, 'ошибка TAA против накопления 16').toBeLessThan(2.5);
    expect(a.shareOver12, 'доля сильно отличающихся пикселей (шлейф)').toBeLessThan(0.05);
  });

  test('два холодных запуска кадра с ветром и осенью: хэш равен, пиксели в допуске', async () => {
    const q = lib('object=Tree&preset=ash&view=general&time=15&clouds=0.2&wind=4&gust=1&p.season=0.5&p.snow=0.4&temp=-3');
    const a = await coldShot(q, 2.2, 2.2 - DT), b = await coldShot(q, 2.2, 2.2 - DT);
    const d = diff(a.px, b.px, W);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/cold-runs-diff.json`, JSON.stringify(d, null, 2));
    expect(a.errors.concat(b.errors)).toEqual([]);
    expect(a.hash).toBe(b.hash);
    expect(d.differing, `пикселей отличается: ${d.differing} из ${d.total}`).toBeLessThanOrEqual(Math.floor(d.total * MAX_SHARE));
    expect(d.maxChannelDiff).toBeLessThanOrEqual(MAX_CHANNEL);
  });
});

test.describe('деревья (Б2): витрина и шейдеры', () => {
  test.setTimeout(300_000);

  test('витрина Tree: пресеты, ползунки, силы мира, демо, семья — без ошибок консоли', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.setViewportSize({ width: 1500, height: 880 });
    await openPlayer(page, '/library.html?backend=webgl2&object=Tree&time=11');
    expect(await page.locator('#presets button').allTextContents()).toEqual(SPECIES);
    expect(await page.locator('#handles .row').count()).toBe(5); // age, season, snow, shed, windSensitivity
    expect(await page.locator('#params .row:has(#f-height)').getAttribute('title')).toMatch(/рост взрослого дерева, м/);
    await page.getByRole('button', { name: 'birch', exact: true }).click();
    await page.waitForTimeout(1500);
    await page.locator('#f-season').evaluate((el: HTMLInputElement) => { el.value = '0.55'; el.dispatchEvent(new Event('input')); });
    await page.waitForTimeout(800);
    const st = () => page.evaluate(() => (window as unknown as { __player: { state(): any } }).__player.state());
    expect((await st()).entities.tree.autumn).toBeGreaterThan(0.5);
    await page.locator('#gust').click();
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: /▶ Лето, осень, листопад/ }).click();
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'семья', exact: true }).click();
    await page.waitForTimeout(3000);
    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: `${OUT}/library-ui-tree.png` });
    expect(errors).toEqual([]);
  });

  test('шейдеры не строятся заново на кадрах (осень, листопад, снег, ветер, перемотка)', async () => {
    const browser = await chromium.launch({ channel: 'chrome', args: ARGS });
    try {
      const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${BASE}${lib('object=Tree&preset=oak&view=general&time=11&demo=0&gust=2', '&w=320&h=180')}`);
      await page.waitForFunction(() => !!(window as unknown as { __player?: unknown }).__player);
      const r = await page.evaluate(() => {
        const p = (window as unknown as { __player: { show(s: number): string; step(s: number): string; shaderBuilds(): number } }).__player;
        p.show(0.5);
        for (let i = 1; i <= 5; i++) p.step(0.5 + i / 30);
        const warm = p.shaderBuilds();
        for (let t = 1; t <= 15; t += 1) { p.step(t); p.step(t + 1 / 30); } // лето → осень → листопад → голое → снег
        const afterPlay = p.shaderBuilds();
        p.show(7); for (let i = 1; i <= 3; i++) p.step(7 + i / 30);
        return { warm, afterPlay, afterSeek: p.shaderBuilds() };
      });
      expect(errors).toEqual([]);
      expect(r.warm).toBeGreaterThan(0);
      expect(r.afterPlay).toBe(r.warm);
      expect(r.afterSeek).toBe(r.warm);
    } finally { await browser.close(); }
  });
});
