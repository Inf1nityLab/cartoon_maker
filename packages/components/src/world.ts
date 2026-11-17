import { z } from 'zod';
import { defineComponent } from '@cartoon/engine';
import { fbm } from './noise.ts';
import { gridHeight, sampleGrid, type GridSpec } from './terrain-grid.ts';

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export const TerrainParams = z.object({
  style: z.enum(['hills', 'flat']).default('hills'),
  seed: z.number().int().default(7),
  amplitude: z.number().min(0).max(40).default(7),
  scale: z.number().min(0.005).max(0.2).default(0.025),
  size: z.number().min(50).max(1000).default(240),
  /** Клеток сетки на сторону: по ней нарисована земля, и по ней же считает высоту ctx.heightAt. */
  segments: z.number().int().min(32).max(640).default(384),
  /** lowpoly — граненая раскраска по высоте (как в версии 1); soil — почва и луг с вариациями, брусчатка на дороге. */
  ground: z.enum(['lowpoly', 'soil']).default('soil'),
  lake: z.object({
    at: z.tuple([z.number(), z.number()]),
    radius: z.number().min(1).max(200),
    depth: z.number().min(0).max(30),
  }).default({ at: [58, -4], radius: 28, depth: 12 }),
});
export type TerrainParams = z.infer<typeof TerrainParams>;

/** Высота рельефа без дороги: чистая функция от параметров. Поэтому не нужна в чекпоинтах. */
export function terrainHeight(p: TerrainParams, x: number, z: number): number {
  if (p.style === 'flat') return 0;
  // земля поднята на 0.8·amplitude: вода остаётся только в озере
  const base = fbm(x * p.scale, z * p.scale, p.seed) * p.amplitude + p.amplitude * 0.8;
  const d = Math.hypot(x - p.lake.at[0], z - p.lake.at[1]);
  return base - p.lake.depth * smoothstep(p.lake.radius, 0, d);
}

/**
 * Рельеф: предоставляет ctx.heightAt. Версия 2: высота — одна на CPU и GPU. Сетка высот (в вершинах: рельеф плюс
 * выравнивание под дорогой, если есть Road) строится при первом обращении, heightAt — интерполяция по её
 * треугольникам, и по тем же вершинам и треугольникам рисуется меш (render-three). За краем сетки — сама функция.
 */
export const Terrain = defineComponent({
  type: 'Terrain',
  version: 2,
  describe: 'Рельеф: холмы (fbm-шум) и впадина озера. Предоставляет ctx.heightAt(x, z): поверхность сетки, по которой нарисована земля; под Road рельеф выровнен.',
  params: TerrainParams,
  actions: {},
  migrate: {
    // v1: меш 192 клетки с граненой раскраской, heightAt считалась отдельно от меша. v2: тот же вид и та же сетка
    // (явно заданные значения сильнее: код режиссёра пишет version 1 и при новых параметрах)
    1: (p: Record<string, unknown>) => ({ segments: 192, ground: 'lowpoly', ...p }),
  },
  setup(ctx, p) {
    const spec: GridSpec = { size: p.size, segments: p.segments };
    const base = (x: number, zz: number) => terrainHeight(p, x, zz);
    const graded = (x: number, zz: number) => { const g = ctx.service('grade'); return g ? g(x, zz, base) : base(x, zz); };
    let grid: Float32Array | null = null; // лениво: все setup уже прошли, Road успел объявить grade
    ctx.provide('heightAt', (x, zz) => {
      grid ??= sampleGrid(spec, graded);
      return gridHeight(spec, grid, x, zz) ?? graded(x, zz);
    });
    ctx.provide('terrain', { size: p.size, segments: p.segments, ground: p.ground, seed: p.seed });
  },
  create: () => ({}),
  step() {},
  state: () => ({}),
  examples: ["s.world.use('Terrain', { style: 'hills', seed: 7 })"],
});

export const Water = defineComponent({
  type: 'Water',
  version: 1,
  describe: 'Вода на заданном уровне (озеро появляется там, где рельеф ниже). Предоставляет ctx.waterLevel.',
  params: z.object({ level: z.number().min(-50).max(50).default(-0.4), color: z.string().default('#2a6f97') }),
  actions: {},
  setup(ctx, p) { ctx.provide('waterLevel', p.level); },
  create: () => ({}),
  step() {},
  state: () => ({}),
  examples: ["s.world.use('Water', { level: -0.4 })"],
});

type SkySelf = { elevation: number; azimuth: number; anim: null | { from: number; to: number; t0: number; dur: number } };

/** Небо и солнце: высота и азимут, плавный переход. */
export const Sky = defineComponent<{ elevation: number; azimuth: number }, SkySelf>({
  type: 'Sky',
  version: 1,
  describe: 'Небо и солнце. Действие sun меняет высоту и азимут (градусы), можно плавно за duration секунд.',
  params: z.object({ elevation: z.number().min(-10).max(90).default(30), azimuth: z.number().min(0).max(360).default(180) }),
  actions: {
    sun: z.object({
      elevation: z.number().min(-10).max(90).optional(),
      azimuth: z.number().min(0).max(360).optional(),
      duration: z.number().min(0).max(600).default(0),
    }),
  },
  create: (_ctx, p) => ({ elevation: p.elevation, azimuth: p.azimuth, anim: null }),
  step(s, _dt, ctx) {
    const a = s.anim;
    if (!a) return;
    const k = Math.min(1, (ctx.time + ctx.dt - a.t0) / a.dur);
    s.elevation = a.from + (a.to - a.from) * k;
    if (k >= 1) s.anim = null;
  },
  onAction(s, _n, a, ctx) {
    if (a.azimuth !== undefined) s.azimuth = a.azimuth;
    if (a.elevation === undefined) return;
    if (a.duration > 0) s.anim = { from: s.elevation, to: a.elevation, t0: ctx.time, dur: a.duration };
    else { s.elevation = a.elevation; s.anim = null; }
  },
  state: (s) => ({ sun: { elevation: s.elevation, azimuth: s.azimuth } }),
  examples: ['s.world.sun({ elevation: 0.6, duration: 14 })'],
});
