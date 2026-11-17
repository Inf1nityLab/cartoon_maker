import { z } from 'zod';
import { defineComponent, type PathSampler, type RoadField } from '@cartoon/engine';

const smoothstep01 = (t: number) => { const k = Math.max(0, Math.min(1, t)); return k * k * (3 - 2 * k); };

export const RoadParams = z.object({
  path: z.string().min(1).describe('id пути в scene.paths: ось дороги (точки в метрах, y игнорируется)'),
  width: z.number().min(0.5).max(20).default(3.6).describe('ширина мощения, м'),
  shoulder: z.number().min(0.2).max(30).default(3).describe('обочина: на такую ширину рельеф плавно переходит от дороги к холмам'),
  smooth: z.number().min(0).max(80).default(10).describe('на какой длине вдоль дороги выравнивается высота, м'),
  stone: z.number().min(0.05).max(1).default(0.22).describe('размер камня брусчатки, м'),
});
export type RoadParams = z.infer<typeof RoadParams>;

/** Шаг, с которым ось дороги режется на отрезки, м. */
const STEP = 0.5;

export type RoadModel = RoadField & {
  /** Рельеф с дорогой: base — высота земли без дороги. Дорога ровная поперёк, плавная вдоль, обочина мягко сходит на нет. */
  grade(x: number, z: number, base: (x: number, z: number) => number): number;
  /** Ближайшая точка оси: расстояние до оси, м (Infinity далеко от дороги). Для тестов и видов. */
  centreDistance(x: number, z: number): number;
};

/** Модель дороги по оси-пути. Чистая функция от пути и параметров: от seed и времени не зависит. */
export function buildRoad(path: PathSampler, p: RoadParams): RoadModel {
  const n = Math.max(2, Math.ceil(path.length / STEP));
  const xs = new Float64Array(n + 1), zs = new Float64Array(n + 1);
  for (let k = 0; k <= n; k++) { const q = path.getPointAt(k / n); xs[k] = q[0]; zs[k] = q[2]; }
  const hw = p.width / 2, reach = hw + p.shoulder;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let k = 0; k <= n; k++) { x0 = Math.min(x0, xs[k]!); x1 = Math.max(x1, xs[k]!); z0 = Math.min(z0, zs[k]!); z1 = Math.max(z1, zs[k]!); }
  const bounds = { x0: x0 - reach, x1: x1 + reach, z0: z0 - reach, z1: z1 + reach };

  /** Ближайшая точка оси: расстояние и положение (отрезок + доля). */
  const nearest = (x: number, zz: number, limit: number): { d: number; i: number; t: number } => {
    if (x < bounds.x0 - limit || x > bounds.x1 + limit || zz < bounds.z0 - limit || zz > bounds.z1 + limit) return { d: Infinity, i: 0, t: 0 };
    let best = Infinity, bi = 0, bt = 0;
    for (let i = 0; i < n; i++) {
      const ax = xs[i]!, az = zs[i]!, ex = xs[i + 1]! - ax, ez = zs[i + 1]! - az, l2 = ex * ex + ez * ez;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (zz - az) * ez) / l2)) : 0;
      const dx = x - ax - ex * t, dz = zz - az - ez * t, d2 = dx * dx + dz * dz;
      if (d2 < best) { best = d2; bi = i; bt = t; }
    }
    return { d: Math.sqrt(best), i: bi, t: bt };
  };

  // высоты оси считаем при первом обращении (нужна base), одним и тем же base: результат не зависит от порядка вызовов
  let heights: Float64Array | null = null;
  const axisHeights = (base: (x: number, z: number) => number): Float64Array => {
    if (heights) return heights;
    let h = new Float64Array(n + 1);
    for (let k = 0; k <= n; k++) h[k] = base(xs[k]!, zs[k]!);
    // скользящее среднее по длине: два прохода окном smooth/2 ≈ колоколообразное сглаживание; края — по краевому значению
    const w = Math.round(p.smooth / 2 / (path.length / n));
    for (let pass = 0; pass < 2 && w > 0; pass++) {
      const pre = new Float64Array(n + 2);
      for (let k = 0; k <= n; k++) pre[k + 1] = pre[k]! + h[k]!;
      const o = new Float64Array(n + 1);
      for (let k = 0; k <= n; k++) {
        // окно [k−w, k+w] с зажимом по краям: недостающее добираем краевым значением
        const a = Math.max(0, k - w), b = Math.min(n, k + w);
        const sum = pre[b + 1]! - pre[a]! + (a - (k - w)) * h[0]! + (k + w - b) * h[n]!;
        o[k] = sum / (2 * w + 1);
      }
      h = o;
    }
    heights = h;
    return h;
  };

  return {
    halfWidth: hw, shoulder: p.shoulder, stone: p.stone, bounds,
    centreDistance: (x, zz) => nearest(x, zz, reach).d,
    edgeDistance(x, zz) { return nearest(x, zz, 0).d - hw; },
    grade(x, zz, base) {
      const b = base(x, zz);
      const r = nearest(x, zz, 0);
      if (r.d >= reach) return b;
      const h = axisHeights(base), road = h[r.i]! + (h[r.i + 1]! - h[r.i]!) * r.t;
      return r.d <= hw ? road : road + (b - road) * smoothstep01((r.d - hw) / p.shoulder);
    },
  };
}

/** Дорога: путь, ширина, обочина. Выравнивает рельеф (grade) и отдаёт вид брусчатки (road). */
export const Road = defineComponent({
  type: 'Road',
  version: 1,
  describe: 'Дорога-брусчатка вдоль пути scene.paths[path]. Рельеф под ней мягко выравнивается (ctx.heightAt), обочина плавная. Объявлять после Terrain.',
  params: RoadParams,
  presets: {
    lane: RoadParams.parse({ path: 'road' }),
    wide: RoadParams.parse({ path: 'road', width: 7, shoulder: 5, stone: 0.3 }),
    footpath: RoadParams.parse({ path: 'road', width: 1.2, shoulder: 1.5, stone: 0.12 }),
  },
  showcase: { kind: 'world', size: 40, eye: 1, ground: 'hills' },
  actions: {},
  setup(ctx, p) {
    const model = buildRoad(ctx.path(p.path), p);
    ctx.provide('grade', model.grade);
    ctx.provide('road', model);
  },
  create: () => ({}),
  step() {},
  state: () => ({}),
  examples: ["s.path('road', { points: [[0,0,-20],[0,0,20]] }); s.world.use('Road', { path: 'road', width: 3.6 })"],
});
