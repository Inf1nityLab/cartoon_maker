import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { resolveFrame } from '../packages/render-three/src/film.ts';
import { accumulationOffsets, halton, taaJitter, TAA_PHASES } from '../packages/render-three/src/frame/jitter.ts';

describe('каркас кадра: режимы (задача 1.1)', () => {
  it('film: размер всегда filmSize, как бы ни менялось окно; pixelRatio фиксирован', () => {
    const f = resolveFrame({ mode: 'film', filmSize: { w: 1920, h: 1080 } });
    expect(f.mode).toBe('film');
    expect(f.pixelRatio).toBe(1);
    for (const win of [{ w: 300, h: 200 }, { w: 4000, h: 3000 }, { w: 1920, h: 1080 }]) expect(f.size(win)).toEqual({ w: 1920, h: 1080 });
    expect(f.pixels(f.size({ w: 10, h: 10 }))).toEqual({ w: 1920, h: 1080 });
  });
  it('film: pixelRatio задаёт размер цели, не экран', () => {
    const f = resolveFrame({ mode: 'film', filmSize: { w: 640, h: 360 }, pixelRatio: 2 });
    expect(f.pixels(f.size({ w: 1, h: 1 }))).toEqual({ w: 1280, h: 720 });
  });
  it('film без filmSize или с плохим pixelRatio — ошибка', () => {
    expect(() => resolveFrame({ mode: 'film' })).toThrow(/filmSize/);
    expect(() => resolveFrame({ mode: 'film', filmSize: { w: 0, h: 10 } })).toThrow(/filmSize/);
    expect(() => resolveFrame({ pixelRatio: 0 })).toThrow(/pixelRatio/);
  });
  it('preview: размер как просили', () => {
    const f = resolveFrame();
    expect(f.mode).toBe('preview');
    expect(f.size({ w: 800, h: 450 })).toEqual({ w: 800, h: 450 });
  });
});

const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));

describe('каркас кадра: время только из таймлайна', () => {
  it('в src адаптера рендера нет Math.random / Date.now / performance.now / new Date', () => {
    for (const f of walk('packages/render-three/src').filter((x) => x.endsWith('.ts') && !x.includes('/nanite/'))) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/Math\.random|Date\.now|performance\.now|new Date\(/);
    }
  });
});

describe('TAA: режимы и джиттер (задача 1.2)', () => {
  it('по умолчанию включён TAA, цель без MSAA; taa.enabled=false — выкл, MSAA как просили', () => {
    expect(resolveFrame().aa).toEqual({ mode: 'taa', accumulate: 0, warmup: 3 });
    expect(resolveFrame().samples).toBe(1);
    const off = resolveFrame({ taa: { enabled: false } });
    expect(off.aa.mode).toBe('off');
    expect(off.samples).toBe(4);
  });
  it('accumulate>0 перекрывает enabled, MSAA не трогает', () => {
    const f = resolveFrame({ taa: { enabled: false, accumulate: 8 } });
    expect(f.aa.mode).toBe('accumulate');
    expect(f.aa.accumulate).toBe(8);
    expect(f.samples).toBe(4);
  });
  it('плохие accumulate и warmup — ошибка', () => {
    expect(() => resolveFrame({ taa: { accumulate: 1.5 } })).toThrow(/accumulate/);
    expect(() => resolveFrame({ taa: { accumulate: -1 } })).toThrow(/accumulate/);
    expect(() => resolveFrame({ taa: { warmup: 99 } })).toThrow(/warmup/);
  });
  it('Хэлтон: известные значения, джиттер зависит только от номера кадра и в пределах пикселя', () => {
    expect([1, 2, 3, 4].map((i) => halton(i, 2))).toEqual([0.5, 0.25, 0.75, 0.125]);
    expect(halton(1, 3)).toBeCloseTo(1 / 3, 12);
    for (let f = 0; f < 40; f++) {
      const [x, y] = taaJitter(f);
      expect(Math.abs(x)).toBeLessThan(0.5);
      expect(Math.abs(y)).toBeLessThan(0.5);
      expect(taaJitter(f)).toEqual(taaJitter(f + TAA_PHASES));
    }
  });
  it('накопление: N смещений с нулевым средним, N=1 — без смещения, повторяемо', () => {
    expect(accumulationOffsets(1)).toEqual([[0, 0]]);
    for (const n of [2, 4, 8, 16]) {
      const o = accumulationOffsets(n);
      expect(o).toHaveLength(n);
      expect(o.reduce((a, v) => a + v[0], 0) / n).toBeCloseTo(0, 12);
      expect(o.reduce((a, v) => a + v[1], 0) / n).toBeCloseTo(0, 12);
      expect(new Set(o.map((v) => v.join())).size).toBe(n);
      expect(accumulationOffsets(n)).toEqual(o);
    }
  });
});
