import type { WaterField } from '@cartoon/engine';
import { sandWeight, smoothstep } from './terrain-forms.ts';
import type { TerrainParams } from './world.ts';

/**
 * Карта поверхностей (ARCHITECTURE 6.5): земля «знает место». По прямоугольнику земли в texel-ах считается
 *  R — доля сухого песка (по форме и основе), G — доля лесной подстилки (под деревьями сцены или везде),
 *  B — расстояние до ближайшей воды, м (0 в воде, не больше FAR), A — уровень этой воды, м.
 * Считает CPU по тем же функциям, что и логика (ctx.heightAt и waterAt): вид только читает текстуру. Мокрый песок
 * и полосу песка у воды шейдер берёт из B и A плюс высоты в самой точке: берег по высоте, а не по текселю.
 */
export const SURFACE_FAR = 40;

export type Crown = { x: number; z: number; r: number };
export type SurfaceMap = { n: number; size: number; data: Float32Array; hasWater: boolean };

export function bakeSurfaceMap(
  p: TerrainParams, size: number, waters: WaterField[], trees: Crown[], n = 512,
): SurfaceMap {
  const half = size / 2, cell = size / n, data = new Float32Array(n * n * 4);
  const dist = new Float32Array(n * n).fill(Infinity), level = new Float32Array(n * n);
  const at = (i: number, j: number) => [-half + (i + 0.5) * cell, -half + (j + 0.5) * cell] as const;
  let hasWater = false;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const [x, z] = at(i, j), k = j * n + i;
      data[k * 4] = sandWeight(p, x, z);
      let best: number | null = null, bestD = -1;
      for (const w of waters) {
        const l = w.level(x, z);
        if (l === null) continue;
        const d = w.depth(x, z);
        if (best === null || d > bestD) { best = l; bestD = d; }
      }
      if (best !== null) { dist[k] = 0; level[k] = best; hasWater = true; }
    }
  }
  if (hasWater) {
    // расстояние до воды: два прохода по восьми соседям (фаска 1 и √2), уровень едет вместе с расстоянием
    const relax = (k: number, o: number, w: number) => { const d = dist[o]! + w * cell; if (d < dist[k]!) { dist[k] = d; level[k] = level[o]!; } };
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i;
      if (i > 0) relax(k, k - 1, 1);
      if (j > 0) { relax(k, k - n, 1); if (i > 0) relax(k, k - n - 1, Math.SQRT2); if (i < n - 1) relax(k, k - n + 1, Math.SQRT2); }
    }
    for (let j = n - 1; j >= 0; j--) for (let i = n - 1; i >= 0; i--) {
      const k = j * n + i;
      if (i < n - 1) relax(k, k + 1, 1);
      if (j < n - 1) { relax(k, k + n, 1); if (i < n - 1) relax(k, k + n + 1, Math.SQRT2); if (i > 0) relax(k, k + n - 1, Math.SQRT2); }
    }
  }
  for (let k = 0; k < n * n; k++) {
    data[k * 4 + 2] = Math.min(SURFACE_FAR, dist[k]!);
    data[k * 4 + 3] = Number.isFinite(dist[k]!) ? level[k]! : 0;
  }
  // подстилка: везде или кругами под кронами (мягкий край), несколько кругов не складываются выше 1
  const amount = p.litter;
  if (amount > 0) {
    if (p.litterArea === 'all') for (let k = 0; k < n * n; k++) data[k * 4 + 1] = amount;
    else {
      for (const c of trees) {
        const R = c.r * 1.3;
        const i0 = Math.max(0, Math.floor((c.x - R + half) / cell)), i1 = Math.min(n - 1, Math.ceil((c.x + R + half) / cell));
        const j0 = Math.max(0, Math.floor((c.z - R + half) / cell)), j1 = Math.min(n - 1, Math.ceil((c.z + R + half) / cell));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const [x, z] = at(i, j), w = (1 - smoothstep(c.r * 0.45, R, Math.hypot(x - c.x, z - c.z))) * amount, k = (j * n + i) * 4 + 1;
          if (w > data[k]!) data[k] = w;
        }
      }
    }
  }
  return { n, size, data, hasWater };
}
