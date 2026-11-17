import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { resolveFrame } from '../packages/render-three/src/film.ts';

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
