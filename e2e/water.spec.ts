import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { coldShot } from './capture.ts';

// Задача Б1: вода. Кадры для глаз — в test-results/B1-keep (Playwright чистит test-results при старте, поэтому пишем из тестов).
const OUT = 'test-results/B1-keep';
const W = 1280, H = 720, DT = 1 / 30;
const lib = (extra: string) => `/library.html?backend=webgl2&film=1&w=${W}&h=${H}&object=Water&${extra}`;
const keep = (name: string, png: Buffer) => { mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/${name}.png`, png); };
const shot = async (name: string, query: string, t = 1) => {
  const s = await coldShot(lib(query), t, t - DT);
  keep(name, s.png);
  expect(s.errors, name).toEqual([]);
  return s;
};

test.describe('вода (Б1)', () => {
  test.setTimeout(300_000);
  test('пробный кадр', async () => {
    const w = process.env.WSHOT ?? 'preset=pond-forest&view=general';
    await shot(`try-${process.env.WNAME ?? 'a'}`, w, Number(process.env.WT ?? 1));
  });
});
