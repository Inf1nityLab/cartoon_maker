import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { hashWorldState } from '@cartoon/schema';
import { gridIndices, gridHeight, sampleGrid, terrainHeight, TerrainParams } from '@cartoon/components';
import { testRoad } from '../scenes/src/test-road.ts';
import { loadScene, makeEngine } from './helpers.ts';

const doc = () => loadScene('test-road.json');
const lcg = (seed: number) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);

describe('земля и дорога (задача 1.4)', () => {
  it('scenes/test-road.json собран из кода режиссёра (pnpm scenes), не правлен руками', () => {
    expect(JSON.parse(readFileSync(new URL('../scenes/test-road.json', import.meta.url), 'utf8'))).toEqual(JSON.parse(JSON.stringify(testRoad)));
  });

  it('Terrain v1 → v2: сцена 01 получает lowpoly и 192 клетки, test-road — свои soil и 480', () => {
    const t1 = loadScene().world.find((c) => c.type === 'Terrain')!;
    expect(t1.version).toBe(1);
    const e = makeEngine(loadScene());
    expect(e.sim().services.terrain).toMatchObject({ ground: 'lowpoly', segments: 192, size: 240, seed: 7 });
    expect(makeEngine(doc()).sim().services.terrain).toMatchObject({ ground: 'soil', segments: 480, size: 160 });
  });

  it('ctx.heightAt = поверхность меша: интерполяция по тем же треугольникам, по которым нарисована земля', () => {
    // Меш строится из sampleGrid + gridIndices (views/world.ts). Здесь высота берётся из индексного буфера независимо
    // от gridHeight: барицентрически по реальному треугольнику, куда попала точка. GPU рисует ровно эти треугольники.
    const e = makeEngine(doc()), { heightAt, terrain } = e.sim().services;
    const spec = { size: terrain!.size, segments: terrain!.segments };
    const h = sampleGrid(spec, heightAt), idx = gridIndices(spec), n = spec.segments, w = n + 1, step = spec.size / n, half = spec.size / 2;
    const vx = (k: number) => -half + (k % w) * step, vz = (k: number) => -half + Math.floor(k / w) * step;
    const rnd = lcg(5);
    let worst = 0;
    for (let s = 0; s < 3000; s++) {
      // половина точек — у дороги (x ∈ ±6, z ∈ ±22), половина по всей земле
      const x = s % 2 ? (rnd() - 0.5) * 12 : (rnd() - 0.5) * 150, z = s % 2 ? (rnd() - 0.5) * 44 : (rnd() - 0.5) * 150;
      const cell = Math.floor((z + half) / step) * n + Math.floor((x + half) / step);
      let got: number | null = null;
      for (const t of [cell * 2, cell * 2 + 1]) {
        const [a, b, c] = [idx[t * 3]!, idx[t * 3 + 1]!, idx[t * 3 + 2]!];
        const det = (vz(b) - vz(c)) * (vx(a) - vx(c)) + (vx(c) - vx(b)) * (vz(a) - vz(c));
        const l1 = ((vz(b) - vz(c)) * (x - vx(c)) + (vx(c) - vx(b)) * (z - vz(c))) / det;
        const l2 = ((vz(c) - vz(a)) * (x - vx(c)) + (vx(a) - vx(c)) * (z - vz(c))) / det;
        const l3 = 1 - l1 - l2;
        if (l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9) { got = l1 * h[a]! + l2 * h[b]! + l3 * h[c]!; break; }
      }
      expect(got, `точка ${x},${z} не попала ни в один треугольник клетки`).not.toBeNull();
      worst = Math.max(worst, Math.abs(got! - heightAt(x, z)));
    }
    expect(worst).toBeLessThan(1e-5); // float32 в буфере вершин
  });

  it('треугольники смотрят вверх (нормаль +y) и покрывают сетку без дыр', () => {
    const spec = { size: 10, segments: 4 }, idx = gridIndices(spec), w = 5;
    expect(idx.length).toBe(4 * 4 * 6);
    for (let t = 0; t < idx.length / 3; t++) {
      const p = [0, 1, 2].map((k) => { const i = idx[t * 3 + k]!; return [(i % w) * 2.5, Math.floor(i / w) * 2.5]; });
      const cross = (p[1]![0]! - p[0]![0]!) * (p[2]![1]! - p[0]![1]!) - (p[1]![1]! - p[0]![1]!) * (p[2]![0]! - p[0]![0]!);
      // (x, z) → нормаль y = (b−a)×(c−a) по z-x: для вида сверху нужен знак «минус» cross в координатах (x, z)
      expect(cross).toBeLessThan(0);
    }
    expect(gridHeight(spec, new Float32Array(25).fill(2), 100, 0)).toBeNull();
  });

  it('под дорогой рельеф ровный поперёк и плавный вдоль; вдали от дороги — чистый рельеф', () => {
    const e = makeEngine(doc()), sim = e.sim(), { heightAt, road } = sim.services;
    expect(road).toBeDefined();
    const path = [[0, -20], [0.8, -8], [-0.8, 6], [0, 20]];
    void path;
    // ось: ближайшая точка по edgeDistance; на оси края дальше всего внутрь: −halfWidth
    expect(road!.edgeDistance(0, -20)).toBeCloseTo(-road!.halfWidth, 6);
    // поперёк дороги: высота на оси и в 1.5 м сбоку (внутри мощения 1.8 м) почти одна (допуск — сетка 0.33 м и поворот дороги)
    for (let z = -15; z <= 15; z += 3) {
      let x0 = 0, best = 1e9;
      for (let x = -3; x <= 3; x += 0.05) { const d = road!.edgeDistance(x, z); if (d < best) { best = d; x0 = x; } }
      const c = heightAt(x0, z);
      for (const off of [-1.2, 1.2]) {
        expect(Math.abs(heightAt(x0 + off, z) - c), `z=${z}: перепад поперёк дороги`).toBeLessThan(0.05);
      }
    }
    // вдоль: перепад между соседними точками оси в 0.5 м не больше, чем у сырого рельефа ×1 и без скачков
    const p = { style: 'hills' as const, seed: 11, amplitude: 9, scale: 0.04, size: 160, segments: 480, ground: 'soil' as const, lake: { at: [58, -4] as [number, number], radius: 28, depth: 12 } };
    const parsed = TerrainParams.parse(p);
    let maxRoadStep = 0, maxRawStep = 0;
    for (let z = -19.5; z < 19.5; z += 0.5) {
      maxRoadStep = Math.max(maxRoadStep, Math.abs(heightAt(0, z + 0.5) - heightAt(0, z)));
      maxRawStep = Math.max(maxRawStep, Math.abs(terrainHeight(parsed, 0, z + 0.5) - terrainHeight(parsed, 0, z)));
    }
    expect(maxRoadStep).toBeLessThanOrEqual(maxRawStep + 1e-9);
    // далеко от дороги (x = 40, вне обочины): высота = рельеф без дороги (в пределах интерполяции сетки 0.33 м)
    for (const [x, z] of [[40, 0], [-50, 20], [30, -40]] as const) {
      expect(Math.abs(heightAt(x, z) - terrainHeight(parsed, x, z))).toBeLessThan(0.05);
    }
    // дорога реально меняет рельеф там, где холм её пересекает
    let changed = 0;
    for (let z = -19; z <= 19; z += 2) changed = Math.max(changed, Math.abs(heightAt(0, z) - terrainHeight(parsed, 0, z)));
    expect(changed).toBeGreaterThan(0.05);
  });

  it('детерминизм: test-road дважды и через seek — одинаковый хэш; другой seed рельефа — другой мир', () => {
    const a = makeEngine(doc()), b = makeEngine(doc());
    for (const t of [0, 5, 10, 20, 29]) expect(hashWorldState(a.seek(t))).toBe(hashWorldState(b.seek(t)));
    expect(a.seek(0).camera.shot).toBe('fixed');
    const o = structuredClone(doc());
    o.world[0]!.params = { ...o.world[0]!.params, seed: 12 };
    expect(makeEngine(o).sim().services.heightAt(10, 10)).not.toBe(makeEngine(doc()).sim().services.heightAt(10, 10));
  });

  it('камера fixed: высота над землёй, едет по скорости', () => {
    const e = makeEngine(doc()), h = e.sim().services.heightAt;
    const s0 = e.seek(0).camera, s5 = e.seek(5).camera;
    expect(s0.pos[1] - h(s0.pos[0], s0.pos[2])).toBeCloseTo(0.5, 6);
    expect(s5.pos[2] - s0.pos[2]).toBeCloseTo(10, 6);
    expect(e.seek(20).camera.pos[1]).toBe(20);
  });
});
