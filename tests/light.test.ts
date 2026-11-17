import { describe, expect, it } from 'vitest';
import { cascadeExtent, cascadeTexels, dayK, pcfRadius, SPLITS, sunLevels, sunVector } from '../packages/render-three/src/light/math.ts';

const deg = (r: number) => (r * 180) / Math.PI;

describe('солнце (задача 1.3): направление', () => {
  it('единичный вектор; высота — угол над горизонтом, азимут — 0 на +z, 90 на +x', () => {
    for (const [el, az] of [[10, 0], [30, 90], [60, 205], [89, 359]] as const) {
      const v = sunVector(el, az);
      expect(Math.hypot(...v)).toBeCloseTo(1, 12);
      expect(deg(Math.asin(v[1]))).toBeCloseTo(el, 9);
    }
    expect(sunVector(30, 0)[2]).toBeGreaterThan(0.8);
    expect(sunVector(30, 90)[0]).toBeGreaterThan(0.8);
    expect(sunVector(30, 180)[2]).toBeLessThan(-0.8);
  });
  it('ниже горизонта свет не идёт снизу: зажим 0.5°', () => {
    expect(sunVector(-20, 10)[1]).toBeCloseTo(Math.sin((0.5 * Math.PI) / 180), 12);
  });
  it('длина тени бокса 0.4 м по высоте солнца: 0.4/tan(высоты) растёт к закату', () => {
    const len = (el: number) => { const v = sunVector(el, 0); return (0.4 * Math.hypot(v[0], v[2])) / v[1]; };
    expect(len(10)).toBeCloseTo(0.4 / Math.tan((10 * Math.PI) / 180), 9);
    expect(len(10)).toBeGreaterThan(len(30));
    expect(len(30)).toBeGreaterThan(len(60));
  });
});

describe('солнце: сила света по высоте', () => {
  it('день 0…1 монотонен и упирается в 1 от 30°', () => {
    expect(dayK(-5)).toBe(0);
    expect(dayK(15)).toBeCloseTo(0.5, 12);
    expect(dayK(30)).toBe(1);
    expect(dayK(80)).toBe(1);
  });
  it('сила солнца растёт с высотой; ниже горизонта — слабый свет, не ноль', () => {
    expect(sunLevels(60).sun).toBeCloseTo(sunLevels(30).sun, 12);
    expect(sunLevels(10).sun).toBeGreaterThan(sunLevels(-5).sun);
    expect(sunLevels(30).sun).toBeGreaterThan(sunLevels(10).sun);
    expect(sunLevels(-5).sun).toBeGreaterThan(0);
  });
});

describe('каскады теней: размер тексела', () => {
  it('границы возрастают', () => {
    for (let i = 1; i < SPLITS.length; i++) expect(SPLITS[i]!).toBeGreaterThan(SPLITS[i - 1]!);
  });
  it('первый каскад: тексел ≤ 5 см при любом fov 10…110° и кадре от 1:1 до 2.39:1 (карта 2048)', () => {
    for (const fov of [10, 32, 45, 60, 90, 110]) for (const aspect of [9 / 16, 1, 16 / 9, 2.39]) {
      expect(cascadeTexels(fov, aspect, 2048)[0]!, `fov=${fov} aspect=${aspect}`).toBeLessThanOrEqual(0.05);
    }
  });
  it('совпадает с тем, что мерил e2e в браузере для fov 60 и 16:9 (≈1.38 см)', () => {
    expect(cascadeTexels(60, 16 / 9, 2048)[0]!).toBeCloseTo(0.01382, 4);
  });
  it('тексел растёт к горизонту, сторона карты — монотонна', () => {
    const t = cascadeTexels(50, 16 / 9, 2048);
    for (let i = 1; i < t.length; i++) expect(t[i]!).toBeGreaterThan(t[i - 1]!);
    expect(cascadeExtent(1, 10, 50, 16 / 9)).toBeLessThan(cascadeExtent(1, 20, 50, 16 / 9));
  });
  it('мягкость PCF: ~4 см полутени, но от 1.5 до 4 текселей', () => {
    expect(pcfRadius(0.0138)).toBeCloseTo(2.9, 1);
    expect(pcfRadius(0.0001)).toBe(4);
    expect(pcfRadius(0.5)).toBe(1.5);
  });
});
