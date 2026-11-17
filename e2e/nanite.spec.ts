import { chromium, expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

// Часть B: nanite-lib на нашем three 0.187.0. Нужен настоящий WebGPU (не swiftshader): свои флаги запуска.
const ARGS = ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-features=WebGPU'];
const BASE = process.env.NANITE_URL ?? 'http://localhost:5175';
const W = 960, H = 540;
const OUT = process.env.NANITE_OUT ?? 'sources/_eval/report-B';

interface Run { adapter: unknown; px: Buffer; stats: { gpuMs: number | null; computeMs: number | null; clusters: number; trees: number }; shot: Buffer; errors: string[]; dag: unknown }

/** Холодный старт: свежий браузер без кэша и профиля, один и тот же путь по кадрам. */
async function coldRun(query: string): Promise<Run> {
  const browser = await chromium.launch({ channel: 'chrome', args: ARGS });
  try {
    const page = await (await browser.newContext({ viewport: { width: W, height: H } })).newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('response', (r) => r.status() >= 400 && !r.url().endsWith('/favicon.ico') && errors.push(`HTTP ${r.status()} ${r.url()}`));
    page.on('console', (m) => m.type() === 'error' && !/status of 404/.test(m.text()) && errors.push(m.text())); // (404 ловит response выше, с адресом; favicon не в счёт)
    await page.goto(`${BASE}/nanite.html?w=${W}&h=${H}&${query}`);
    await page.waitForFunction(() => (window as any).__nanite, null, { timeout: 60_000 });
    const res = await page.evaluate(async () => {
      const d = await (window as any).__nanite;
      for (let f = 0; f < 10; f++) await d.renderFrame(f / 30);
      await d.renderFrame(10 / 30, false);
      const px: Uint8Array = await d.pixels();
      let s = ''; for (let i = 0; i < px.length; i += 0x8000) s += String.fromCharCode(...px.subarray(i, i + 0x8000));
      await d.renderFrame(10 / 30);
      const ad = await (navigator as any).gpu.requestAdapter();
      return { px: btoa(s), stats: await d.stats(), dag: d.dagStats, adapter: { vendor: ad.info.vendor, architecture: ad.info.architecture, description: ad.info.description } };
    });
    const shot = await page.locator('#view').screenshot();
    return { px: Buffer.from(res.px, 'base64'), stats: res.stats, shot, errors, dag: res.dag, adapter: res.adapter };
  } finally { await browser.close(); }
}

const diff = (a: Buffer, b: Buffer) => {
  let n = 0, max = 0;
  const where: { x: number; y: number; a: number[]; b: number[] }[] = [];
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.max(Math.abs(a[i]! - b[i]!), Math.abs(a[i + 1]! - b[i + 1]!), Math.abs(a[i + 2]! - b[i + 2]!), Math.abs(a[i + 3]! - b[i + 3]!));
    if (d) { n++; if (d > max) max = d; if (where.length < 5) where.push({ x: (i / 4) % W, y: Math.floor(i / 4 / W), a: [...a.subarray(i, i + 4)], b: [...b.subarray(i, i + 4)] }); }
  }
  return { differing: n, total: a.length / 4, maxChannelDiff: max, firstDifferences: where };
};

test.describe('nanite-lib на three 0.187.0', () => {
  test.setTimeout(240_000);
  // Допуск двух холодных запусков (решение владельца): не больше 0.01% пикселей и не больше 2/255 по каналу.
  // GPU порядок atomicAdd в списках кластеров не фиксирует, побитового равенства кадров не требуем.
  const MAX_SHARE = 0.0001, MAX_CHANNEL = 2;
  // fixed — режим страницы по умолчанию (prepass и list-guard выключены); live — они в режимах автора (auto). Occlusion выключен в обоих.
  for (const [name, query] of [['fixed', ''], ['live', 'live=1']] as const) {
    test(`${name}: показ и два холодных старта`, async () => {
      mkdirSync(OUT, { recursive: true });
      const a = await coldRun(query), b = await coldRun(query);
      writeFileSync(`${OUT}/nanite-${name}-run1.png`, a.shot);
      writeFileSync(`${OUT}/nanite-${name}-run2.png`, b.shot);
      const d = diff(a.px, b.px);
      const report = { name, query, run1: { adapter: a.adapter, stats: a.stats, errors: a.errors, dag: a.dag }, run2: { stats: b.stats, errors: b.errors }, diff: d };
      writeFileSync(`${OUT}/nanite-${name}.json`, JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report));
      expect(a.errors, 'ошибки страницы').toEqual([]);
      expect(a.stats.clusters, 'рисуется хоть что-то').toBeGreaterThan(0);
      expect(d.differing, `пикселей отличается: ${d.differing} из ${d.total}`).toBeLessThanOrEqual(Math.floor(d.total * MAX_SHARE));
      expect(d.maxChannelDiff, 'максимальная разница канала').toBeLessThanOrEqual(MAX_CHANNEL);
    });
  }
});

test('чем отличаются режимы: occlusion вкл/выкл и prepass листьев вкл/выкл (одна камера)', async () => {
  test.setTimeout(240_000);
  mkdirSync(OUT, { recursive: true });
  const base = await coldRun('');
  const occ = await coldRun('occ=1'); // occlusion включён (известный дефект стенда или библиотеки: пропадают дальние стволы; в предпросмотре и экспорте выключен)
  const pre = await coldRun('leafpre=1'); // depth prepass листьев принудительно
  const rep = { occlusionOn_vs_off: diff(base.px, occ.px), prepassOn_vs_off: diff(base.px, pre.px), clusters: { off: base.stats.clusters, occ: occ.stats.clusters, pre: pre.stats.clusters } };
  writeFileSync(`${OUT}/nanite-modes.json`, JSON.stringify(rep, null, 2));
  console.log(JSON.stringify(rep));
  expect(base.errors).toEqual([]);
});
