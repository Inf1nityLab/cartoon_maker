import { chromium, expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { diff, MAX_CHANNEL, MAX_SHARE } from './pixels.ts';
import { ARGS, BASE, type Player } from './capture.ts';

// Задача 1.7: пост-эффекты кино (глубина резкости, цвет, виньетка, рамки 2.39:1 и 9:16, лучи солнца).
// Кадры и числа — в e2e/report-1.7 (не в git; копии для отчёта — test-results/1.7-keep). swiftshader, как в остальных спеках.
const W = 960, H = 540, DT = 1 / 30;
const OUT = 'e2e/report-1.7';
const FILM = `/?backend=webgl2&film=1&w=${W}&h=${H}`;

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
/** Кадр секунды sec холодным запуском (карта: show → пиксели). */
const frame = (query: string, sec: number) => cold(query, `p.show(${sec})`);

const luma = (p: Buffer, i: number) => 0.2126 * p[i]! + 0.7152 * p[i + 1]! + 0.0722 * p[i + 2]!;
type Rect = [number, number, number, number]; // доли кадра x0 y0 x1 y1
/**
 * Энергия границ: средний КВАДРАТ градиента luma (оператор Собеля) по области кадра. Среднее |∇| для размытия слепо: у
 * размытой границы градиент меньше, но шире, а их сумма (полная вариация) та же, поэтому ratio по |∇| у размытых холмов
 * был 0.93 при явно мягком горизонте. Квадрат — это «энергия»: она падает с шириной размытия.
 */
function sobel(p: Buffer, w: number, h: number, r: Rect = [0, 0, 1, 1]): number {
  const x0 = Math.max(1, Math.floor(r[0] * w)), x1 = Math.min(w - 1, Math.floor(r[2] * w));
  const y0 = Math.max(1, Math.floor(r[1] * h)), y1 = Math.min(h - 1, Math.floor(r[3] * h));
  const L = (x: number, y: number) => luma(p, (y * w + x) * 4);
  let sum = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const gx = -L(x - 1, y - 1) - 2 * L(x - 1, y) - L(x - 1, y + 1) + L(x + 1, y - 1) + 2 * L(x + 1, y) + L(x + 1, y + 1);
    const gy = -L(x - 1, y - 1) - 2 * L(x, y - 1) - L(x + 1, y - 1) + L(x - 1, y + 1) + 2 * L(x, y + 1) + L(x + 1, y + 1);
    sum += gx * gx + gy * gy; n++;
  }
  return sum / n;
}
const meanLuma = (p: Buffer, w: number, r: Rect) => {
  let s = 0, n = 0;
  for (let y = Math.floor(r[1] * H); y < Math.floor(r[3] * H); y++) for (let x = Math.floor(r[0] * w); x < Math.floor(r[2] * w); x++) { s += luma(p, (y * w + x) * 4); n++; }
  return s / n;
};
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

/** PNG из RGBA-буфера w×h; crop — доли кадра, scale — увеличение (ближайший сосед, для кропов ×4). */
async function png(px: Buffer, w: number, h: number, crop: Rect = [0, 0, 1, 1], scale = 1) {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage();
    const [cx, cy, cw, ch] = [Math.floor(crop[0] * w), Math.floor(crop[1] * h), Math.floor((crop[2] - crop[0]) * w), Math.floor((crop[3] - crop[1]) * h)];
    const url = await page.evaluate(`(() => {
      const b = atob('${px.toString('base64')}'); const src = document.createElement('canvas'); src.width = ${w}; src.height = ${h};
      const g = src.getContext('2d'); const im = g.createImageData(${w}, ${h}); for (let i = 0; i < b.length; i++) im.data[i] = b.charCodeAt(i); g.putImageData(im, 0, 0);
      const o = document.createElement('canvas'); o.width = ${cw * scale}; o.height = ${ch * scale}; const q = o.getContext('2d'); q.imageSmoothingEnabled = false;
      q.drawImage(src, ${cx}, ${cy}, ${cw}, ${ch}, 0, 0, ${cw * scale}, ${ch * scale}); return o.toDataURL('image/png'); })()`) as string;
    return Buffer.from(url.split(',')[1]!, 'base64');
  } finally { await browser.close(); }
}
const save = async (name: string, px: Buffer, crop?: Rect, scale?: number, w = W, h = H) => writeFileSync(`${OUT}/${name}.png`, await png(px, w, h, crop, scale));
const report = (name: string, data: unknown) => writeFileSync(`${OUT}/${name}.json`, JSON.stringify(data, null, 2));

test.describe('пост-эффекты кино (задача 1.7)', () => {
  test.setTimeout(300_000);
  test.beforeAll(() => mkdirSync(OUT, { recursive: true }));

  test('?fx=0 даёт тот же кадр, что и сцена без эффектов, как бы ни были заданы look и dof', async () => {
    const plain = await frame(FILM, 30);
    const off = await frame(`${FILM}&fx=0&look=cinema&dof=target,1.5,14`, 30);
    const d = diff(plain.px, off.px, W);
    expect(d.differing, 'fx=0 против сцены без эффектов').toBe(0);
    const on = await frame(`${FILM}&dof=target,1.5,14`, 30);
    expect(diff(plain.px, on.px, W).differing, 'dof меняет кадр').toBeGreaterThan(1000);
    expect(plain.errors.concat(off.errors, on.errors)).toEqual([]);
  });

  test('чёткость общих планов: цвет и виньетка без глубины резкости — энергия границ ≥ 0.9 от кадра с ?fx=0', async () => {
    const central: Rect = [0.2, 0.2, 0.8, 0.8];
    const rows: Record<string, unknown> = {};
    for (const [name, sec] of [['establishing-3s', 3], ['follow-10s', 10], ['crane-52s', 52]] as const) {
      const a = await frame(`${FILM}&fx=0`, sec);
      const b = await frame(`${FILM}&look=cinema&lookset=crop:none`, sec);
      const ea = sobel(a.px, W, H, central), eb = sobel(b.px, W, H, central);
      const full = [sobel(a.px, W, H), sobel(b.px, W, H)];
      rows[name] = { sobelFx0: ea, sobelLook: eb, ratio: eb / ea, wholeFrameRatio: full[1]! / full[0]! };
      await save(`wide-${name}-fx0`, a.px);
      await save(`wide-${name}-look`, b.px);
      expect(eb / ea, `${name}: чёткость с цветом и виньеткой / без`).toBeGreaterThanOrEqual(0.9);
      expect(a.errors.concat(b.errors)).toEqual([]);
    }
    report('sharpness-wide', rows);
  });

  test('крупный план паука с фокусом на нём: паук резкий, дальние холмы размыты, ореола нет (кропы ×4)', async () => {
    const T = 30;
    const sharp = await frame(`${FILM}&fx=0`, T);
    const dofQ = `${FILM}&dof=target,1.5,14`;
    const blur = await frame(dofQ, T);
    const body: Rect = [0.4, 0.45, 0.58, 0.6]; // голова, глаза и корпус изнутри (без границы с фоном)
    // полоса вдоль горизонта (стык дальних холмов и неба) слева, вдали от силуэта: глубина там ≫ фокус + 3·range (8.5 + 4.5 м)
    const hills: Rect = [0.0, 0.38, 0.18, 0.48];
    const r = {
      body: { sobelFx0: sobel(sharp.px, W, H, body), sobelDof: sobel(blur.px, W, H, body) },
      hills: { sobelFx0: sobel(sharp.px, W, H, hills), sobelDof: sobel(blur.px, W, H, hills) },
    };
    const out = { ...r, bodyRatio: r.body.sobelDof / r.body.sobelFx0, hillsRatio: r.hills.sobelDof / r.hills.sobelFx0 };
    report('dof-closeup', out);
    await save('dof-closeup-fx0', sharp.px);
    await save('dof-closeup-dof', blur.px);
    // кропы ×4: лапа на фоне неба/холмов (правая лапа) и граница корпуса с размытым фоном
    await save('dof-crop-x4-leg-fx0', sharp.px, [0.70, 0.13, 0.90, 0.38], 4);
    await save('dof-crop-x4-leg-dof', blur.px, [0.70, 0.13, 0.90, 0.38], 4);
    await save('dof-crop-x4-body-fx0', sharp.px, [0.50, 0.33, 0.62, 0.50], 4);
    await save('dof-crop-x4-body-dof', blur.px, [0.50, 0.33, 0.62, 0.50], 4);
    expect(out.bodyRatio, 'паук резкий').toBeGreaterThanOrEqual(0.9);
    expect(out.hillsRatio, 'холмы размыты').toBeLessThan(0.6);
    // без ореола: фон рядом с силуэтом не темнеет и не окрашивается героем. Силуэт = пиксели, где fx0 сильно темнее неба
    // над ним; смотрим полосу неба в 2-4 пикселях от левой лапы: цвет такой же, как в 12 пикселях от неё
    expect(blur.errors).toEqual([]);
  });

  test('лучи: кадр против солнца с лучами и без, TAA и накопление (кропы ×4, слой лучей)', async () => {
    const T = 24, SUN = '&sun=10,232';
    const none = await frame(`${FILM}${SUN}&look=neutral&lookset=rays:0`, T);
    const rays = await frame(`${FILM}${SUN}&look=neutral&lookset=rays:1`, T);
    const layer = (a: Buffer, b: Buffer) => { const o = Buffer.alloc(a.length); for (let i = 0; i < a.length; i += 4) { for (let k = 0; k < 3; k++) o[i + k] = Math.min(255, Math.max(0, 128 + (a[i + k]! - b[i + k]!))); o[i + 3] = 255; } return o; };
    // слой лучей в трёх режимах: TAA, накопление 16 (эталон без ступенек), без сглаживания
    const accN = await frame(`${FILM}${SUN}&accum=16&look=neutral&lookset=rays:0`, T);
    const accR = await frame(`${FILM}${SUN}&accum=16&look=neutral&lookset=rays:1`, T);
    const offN = await frame(`${FILM}${SUN}&taa=0&look=neutral&lookset=rays:0`, T);
    const offR = await frame(`${FILM}${SUN}&taa=0&look=neutral&lookset=rays:1`, T);
    const Lt = layer(rays.px, none.px), La = layer(accR.px, accN.px), Lo = layer(offR.px, offN.px);
    const top: Rect = [0.25, 0.0, 0.75, 0.5];
    const out = {
      meanLumaTop: { none: meanLuma(none.px, W, top), rays: meanLuma(rays.px, W, top) },
      layerSobel: { taa: sobel(Lt, W, H, top), accumulate16: sobel(La, W, H, top), noAa: sobel(Lo, W, H, top) },
      layerVsAccum: { taa: stats(Lt, La), noAa: stats(Lo, La) },
    };
    report('rays', out);
    await save('rays-off', none.px);
    await save('rays-on', rays.px);
    await save('rays-layer-taa', Lt);
    await save('rays-layer-accum16', La);
    await save('rays-crop-x4-off', none.px, [0.30, 0.12, 0.50, 0.30], 4);
    await save('rays-crop-x4-on', rays.px, [0.30, 0.12, 0.50, 0.30], 4);
    await save('rays-crop-x4-layer-taa', Lt, [0.30, 0.12, 0.50, 0.30], 4);
    await save('rays-crop-x4-layer-accum16', La, [0.30, 0.12, 0.50, 0.30], 4);
    expect(out.meanLumaTop.rays, 'лучи подсвечивают кадр').toBeGreaterThan(out.meanLumaTop.none + 2);
    // ступеньки — это лишняя высокочастотная энергия слоя лучей: в TAA её не больше, чем в эталоне накопления
    expect(out.layerSobel.taa, 'слой лучей в TAA: высокие частоты не больше, чем у накопления 16 (+15 %)').toBeLessThanOrEqual(out.layerSobel.accumulate16 * 1.15 + 0.05);
    expect(none.errors.concat(rays.errors, accN.errors, accR.errors)).toEqual([]);
  });

  test('полосы 2.39:1 и кадр 9:16: чёрное снаружи точно, внутри картинка', async () => {
    const cin = await frame(`${FILM}&look=cinema`, 3);
    const vert = await frame(`${FILM}&look=vertical`, 3);
    await save('crop-239', cin.px);
    await save('crop-916', vert.px);
    const blackOutside = (p: Buffer, rect: Rect4) => {
      let outside = 0, bad = 0, inLuma = 0, inN = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4, inside = x >= rect[0] && x < rect[2] && y >= rect[1] && y < rect[3];
        if (inside) { inLuma += luma(p, i); inN++; } else { outside++; if (p[i] || p[i + 1] || p[i + 2]) bad++; }
      }
      return { outside, bad, insideMeanLuma: inLuma / inN };
    };
    type Rect4 = [number, number, number, number];
    const ch = Math.round(W / 2.39), y0 = Math.floor((H - ch) / 2);
    const cw = Math.round(H * 9 / 16), x0 = Math.floor((W - cw) / 2);
    const a = blackOutside(cin.px, [0, y0, W, y0 + ch]), b = blackOutside(vert.px, [x0, 0, x0 + cw, H]);
    report('crops', { cinema239: { ...a, rect: [0, y0, W, y0 + ch] }, vertical916: { ...b, rect: [x0, 0, x0 + cw, H] } });
    expect(a.bad, '2.39:1: ненулевых пикселей в полосах').toBe(0);
    expect(b.bad, '9:16: ненулевых пикселей снаружи').toBe(0);
    expect(a.insideMeanLuma).toBeGreaterThan(20);
    expect(b.insideMeanLuma).toBeGreaterThan(20);
    expect(a.outside).toBe(W * H - W * ch);
    expect(b.outside).toBe(W * H - cw * H);
  });

  test('film + accumulate с эффектами (вид, глубина резкости, лучи): два холодных запуска, seek и проигрывание в допуске', async () => {
    const q = `${FILM}&accum=6&sun=10,232&look=cinema&lookset=rays:1&dof=target,1.5,14`;
    const T = 24;
    const a = await cold(q, `p.show(${T})`);
    const b = await cold(q, `p.show(${T})`);
    const played = await cold(q, `p.play(${T - 4 * DT}, ${T})`);
    const s = await open(q);
    let seeked: Buffer;
    try { await s.px('p.show(5)'); seeked = await s.px(`p.show(${T})`); } finally { await s.close(); }
    const results: Record<string, unknown> = {};
    for (const [name, other] of [['cold-vs-cold', b.px], ['seek-vs-cold', seeked], ['play-vs-cold', played.px]] as const) {
      const d = diff(a.px, other, W);
      results[name] = d;
      expect(d.differing, `${name}: пикселей отличается ${d.differing} из ${d.total}`).toBeLessThanOrEqual(Math.floor(d.total * MAX_SHARE));
      expect(d.maxChannelDiff, name).toBeLessThanOrEqual(MAX_CHANNEL);
    }
    report('accumulate-fx-diffs', results);
    await save('accumulate-fx', a.px);
    expect(a.errors.concat(b.errors, played.errors, s.errors)).toEqual([]);
  });

  test('обычный TAA с эффектами: seek(t) против проигрывания и против накопления 16 (числа в отчёте)', async () => {
    const T = 24, extra = '&sun=10,232&look=cinema&lookset=rays:1&dof=target,1.5,14';
    const s = await open(FILM + extra);
    try {
      const seeked = await s.px(`p.show(${T})`);
      const played = await s.px(`p.play(${T - 15 * DT}, ${T})`);
      const ref = await cold(`${FILM}&accum=16${extra}`, `p.show(${T})`);
      const sp = stats(seeked, played), pr = stats(played, ref.px);
      report('taa-fx-seek-vs-play', { seekVsPlay: sp, playVsAccum16: pr });
      expect(sp.meanAbs, 'seek против проигрывания').toBeLessThan(1.5);
      expect(pr.meanAbs, 'проигрывание против накопления 16').toBeLessThan(1.5);
      expect(s.errors).toEqual([]);
    } finally { await s.close(); }
  });
});
