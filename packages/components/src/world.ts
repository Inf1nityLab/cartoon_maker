import { z } from 'zod';
import { defineComponent } from '@cartoon/engine';
import { fbm } from './noise.ts';
import { gridHeight, sampleGrid, type GridSpec } from './terrain-grid.ts';
import { beachHeight, bowlProfile, duneField, smoothstep } from './terrain-forms.ts';

import { TERRAIN_SETUPS } from './terrain-showcase.ts';

export const TerrainParams = z.object({
  style: z.enum(['hills', 'flat', 'dunes', 'beach']).default('hills').describe('форма: hills — холмы, flat — плоско, dunes — дюны (гребни поперёк ветра), beach — пляж (море с одной стороны, суша с другой)'),
  seed: z.number().int().default(7),
  amplitude: z.number().min(0).max(40).default(7),
  scale: z.number().min(0.005).max(0.2).default(0.025),
  size: z.number().min(50).max(1000).default(240),
  /** Клеток сетки на сторону: по ней нарисована земля, и по ней же считает высоту ctx.heightAt. */
  segments: z.number().int().min(32).max(640).default(384),
  /** lowpoly — граненая раскраска по высоте (как в версии 1); soil — почва и луг с вариациями, брусчатка на дороге. */
  /** surfaces — то же, что soil, плюс песок, подстилка, снег и влажность (версия 3). */
  ground: z.enum(['lowpoly', 'soil', 'surfaces']).default('soil'),
  lake: z.object({
    at: z.tuple([z.number(), z.number()]),
    radius: z.number().min(1).max(200),
    depth: z.number().min(0).max(30),
  }).default({ at: [58, -4], radius: 28, depth: 12 }),
  bank: z.enum(['smooth', 'gentle', 'steep']).default('smooth').describe('берег чаши: smooth — как прежде, gentle — пологий с ровным дном, steep — обрыв'),
  duneHeight: z.number().min(0.5).max(40).default(6).describe('высота дюн, м (style: dunes)'),
  duneSpacing: z.number().min(10).max(300).default(60).describe('шаг между гребнями дюн, м (style: dunes)'),
  windDirection: z.number().min(0).max(360).default(90).describe('куда дует ветер, который сложил дюны и рябь песка, ° (0 — на север, +z; 90 — на восток, +x); гребни поперёк'),
  shoreAngle: z.number().min(0).max(360).default(0).describe('где море (style: beach): направление от суши к воде, ° (0 — на +z, 90 — на +x)'),
  beachWidth: z.number().min(2).max(80).default(14).describe('ширина пляжа от воды до травы или дюн, м (style: beach)'),
  beachSlope: z.number().min(0.01).max(0.4).default(0.055).describe('уклон пляжа и дна, м/м (style: beach)'),
  base: z.enum(['auto', 'meadow', 'sand']).default('auto').describe('основа поверхности (ground: surfaces): auto — по форме (дюны и пляж — песок, холмы — луг), meadow — луг, sand — песок'),
  shoreSand: z.number().min(0).max(1).default(0).describe('полоса песка у воды на любой форме (берег пруда), 0 — нет (ground: surfaces)'),
  litter: z.number().min(0).max(1).default(0).describe('лесная подстилка из листьев: 0 нет, 1 сплошная (ground: surfaces)'),
  litterArea: z.enum(['trees', 'all']).default('trees').describe('где подстилка: trees — под и вокруг деревьев сцены, all — на всей земле (лесная земля)'),
  snow: z.number().min(0).max(1).default(0).describe('снег 0…1: ложится только в мороз (температура из сил мира), на крутых склонах меньше; тает в тепле (ground: surfaces)'),
  wetness: z.number().min(0).max(1).default(0).describe('влажность земли 0…1: темнеет и блестит (ground: surfaces); у воды мокрый песок виден и без неё'),
  sandRipple: z.number().min(0).max(1).default(0.6).describe('рябь песка, поперёк ветра: 0 гладкий, 1 заметные волны (ground: surfaces)'),
});
export type TerrainParams = z.infer<typeof TerrainParams>;

/** Высота рельефа без дороги: чистая функция от параметров. Поэтому не нужна в чекпоинтах. */
export function terrainHeight(p: TerrainParams, x: number, z: number): number {
  if (p.style === 'flat') return 0;
  if (p.style === 'beach') return beachHeight(p, x, z);
  const d = Math.hypot(x - p.lake.at[0], z - p.lake.at[1]);
  if (p.style === 'dunes') {
    // вокруг чаши (оазиса) дюны стихают в низкий берег
    const w = smoothstep(p.lake.radius * 0.8, p.lake.radius * 1.9, d);
    const bank = p.duneHeight * 0.12 + 0.5;
    return bank + (duneField(p, x, z) - bank) * w - p.lake.depth * bowlProfile(p.bank, d, p.lake.radius);
  }
  // земля поднята на 0.8·amplitude: вода остаётся только в озере
  const base = fbm(x * p.scale, z * p.scale, p.seed) * p.amplitude + p.amplitude * 0.8;
  return base - p.lake.depth * bowlProfile(p.bank, d, p.lake.radius);
}

const SNOW_UP = 0.5, SNOW_MELT = 0.35; // 1/с: как быстро снег ложится и тает (с запаздыванием за ручкой)

/** Морозность 0…1 по температуре: снег ложится ниже -0.5 °C, к +2.5 °C его нет (как у деревьев). */
export const frostFactor = (temperature: number): number => smoothstep(2.5, -0.5, temperature);

export type TerrainSelf = {
  /** ручки */
  snow: number; wetness: number; sandRipple: number;
  /** что рисует вид: сколько снега лежит сейчас (с учётом мороза) и температура у земли */
  cover: number; temp: number;
};

const SURFACE_HANDLES = { snow: {}, wetness: {}, sandRipple: {} };

/**
 * Рельеф: предоставляет ctx.heightAt. Версия 2: высота — одна на CPU и GPU. Сетка высот (в вершинах: рельеф плюс
 * выравнивание под дорогой, если есть Road) строится при первом обращении, heightAt — интерполяция по её
 * треугольникам, и по тем же вершинам и треугольникам рисуется меш (render-three). За краем сетки — сама функция.
 * Версия 3 («Рельеф и поверхности»): формы dunes и beach, берег чаши (bank), поверхности по месту и правилам
 * (ground: surfaces: песок сухой и мокрый у воды, подстилка под деревьями, снег) и ручки snow, wetness, sandRipple.
 * Старые сцены не меняются: новые параметры по умолчанию дают прежний вид, а состояние в отчёте есть только у surfaces.
 */
export const Terrain = defineComponent<TerrainParams, TerrainSelf>({
  type: 'Terrain',
  version: 3,
  describe: 'Рельеф и поверхности: холмы, дюны (гребни поперёк ветра, рябь песка), пляж и чаша под воду (пологий или крутой берег). С ground: surfaces земля знает место: песок сухой и мокрый у воды, подстилка из листьев под деревьями, снег (ложится в мороз, на крутых склонах меньше, тает в тепле), влажность. Предоставляет ctx.heightAt(x, z): поверхность сетки, по которой нарисована земля; под Road рельеф выровнен. Ручки: snow, wetness, sandRipple. Поведения: snowfall, thaw. Слушает силы мира: температуру.',
  params: TerrainParams,
  presets: {
    hills: TerrainParams.parse({}),
    plain: TerrainParams.parse({ style: 'flat' }),
    bowl: TerrainParams.parse({ amplitude: 14, scale: 0.05, lake: { at: [0, 0], radius: 45, depth: 18 } }),
    soft: TerrainParams.parse({ amplitude: 3, scale: 0.012 }),
    'meadow-hills': TerrainParams.parse({ ground: 'surfaces', amplitude: 6, scale: 0.022, lake: { at: [58, -4], radius: 28, depth: 12 } }),
    'desert-dunes': TerrainParams.parse({ style: 'dunes', ground: 'surfaces', duneHeight: 7, duneSpacing: 55, windDirection: 90, lake: { at: [0, 0], radius: 1, depth: 0 } }),
    'pond-shore': TerrainParams.parse({ ground: 'surfaces', amplitude: 2.5, scale: 0.03, bank: 'gentle', shoreSand: 1, lake: { at: [0, 0], radius: 26, depth: 6.5 } }),
    'sea-beach': TerrainParams.parse({ style: 'beach', ground: 'surfaces', size: 300, segments: 480, shoreAngle: 270, beachWidth: 16, beachSlope: 0.05, amplitude: 3, scale: 0.02 }),
    'forest-glade': TerrainParams.parse({ ground: 'surfaces', amplitude: 3, scale: 0.012, litter: 1, lake: { at: [200, 0], radius: 1, depth: 0 } }),
    'winter-meadow': TerrainParams.parse({ ground: 'surfaces', amplitude: 6, scale: 0.022, snow: 1, lake: { at: [58, -4], radius: 28, depth: 12 } }),
  },
  handles: SURFACE_HANDLES,
  showcase: {
    kind: 'world', size: 60, eye: 3, ground: 'hills', defaultPreset: 'meadow-hills',
    setups: TERRAIN_SETUPS,
    demos: [
      {
        title: 'Оттепель, потом снегопад на лугу', duration: 16,
        steps: [
          { t: 0, world: true, action: 'handle.set', args: { handle: 'temperature', value: -6 } },
          { t: 0, action: 'handle.set', args: { handle: 'snow', value: 1 } },
          { t: 1.5, world: true, action: 'handle.to', args: { handle: 'temperature', value: 6, over: 2, ease: 'ease-in-out' } },
          { t: 2, action: 'thaw', args: { over: 3 } },
          { t: 8, world: true, action: 'handle.to', args: { handle: 'temperature', value: -6, over: 2, ease: 'ease-in-out' } },
          { t: 8.5, action: 'snowfall', args: { over: 5 } },
        ],
      },
      {
        title: 'Дождь: земля темнеет и блестит', duration: 10,
        steps: [
          { t: 1, action: 'handle.to', args: { handle: 'wetness', value: 1, over: 3, ease: 'ease-in-out' } },
          { t: 6, action: 'handle.to', args: { handle: 'wetness', value: 0, over: 3, ease: 'ease-in-out' } },
        ],
      },
    ],
  },
  actions: {
    snowfall: z.object({
      over: z.number().min(0.5).max(3600).default(8).describe('за сколько секунд снег доходит до нужной глубины, с'),
      to: z.number().min(0).max(1).default(1).describe('сколько снега выпадет, 0…1 (ляжет только в мороз)'),
    }),
    thaw: z.object({ over: z.number().min(0.5).max(3600).default(8).describe('за сколько секунд снег сходит, с') }),
  },
  migrate: {
    // v1: меш 192 клетки с граненой раскраской, heightAt считалась отдельно от меша. v2: тот же вид и та же сетка
    // (явно заданные значения сильнее: код режиссёра пишет version 1 и при новых параметрах)
    1: (p: Record<string, unknown>) => ({ segments: 192, ground: 'lowpoly', ...p }),
    // v2 → v3: новые параметры (дюны, пляж, снег…) по умолчанию ничего не меняют: ground остаётся soil, берег smooth
    2: (p: Record<string, unknown>) => p,
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
  create: (ctx, p) => {
    const s: TerrainSelf = { snow: p.snow, wetness: p.wetness, sandRipple: p.sandRipple, cover: 0, temp: 15 };
    if (p.ground === 'surfaces') {
      s.temp = ctx.temperature([0, ctx.heightAt(0, 0), 0]);
      s.cover = s.snow * frostFactor(s.temp); // сцена открывается с тем снегом, который уже лежит
    }
    return s;
  },
  step(s, dt, ctx) {
    if (!(ctx.service('terrain')?.ground === 'surfaces')) return;
    // снег ложится, пока холодно, и тает при плюсе (температура у земли в центре); без Forces температура 15 °C: снега нет
    s.temp = ctx.temperature([0, ctx.heightAt(0, 0), 0]);
    const target = s.snow * frostFactor(s.temp);
    s.cover += (target - s.cover) * (1 - Math.exp(-(target > s.cover ? SNOW_UP : SNOW_MELT) * dt));
  },
  onAction(_s, name, a, ctx) {
    if (name === 'snowfall') ctx.handles.to('snow', a.to, { over: a.over, ease: 'ease-in-out' });
    else if (name === 'thaw') ctx.handles.to('snow', 0, { over: a.over, ease: 'ease-in-out' });
  },
  // в отчёт (и в хэш) попадает только земля с поверхностями: у старых сцен состояния нет, хэши прежние
  state: (s, ctx) => (ctx.service('terrain')?.ground === 'surfaces'
    ? { snow: Math.round(s.cover * 1e3) / 1e3, wetness: Math.round(s.wetness * 1e3) / 1e3, frost: Math.round(frostFactor(s.temp) * 1e3) / 1e3 }
    : {}),
  examples: [
    "s.world.use('Terrain', { style: 'hills', seed: 7 })",
    "s.world.use('Terrain', { style: 'dunes', ground: 'surfaces', duneHeight: 7, windDirection: 90 })",
    "const ground = s.world.use('Terrain', { ground: 'surfaces' }); s.at(10).do(ground.snowfall({ over: 8 }))   // ляжет, если в Forces мороз",
    "s.at(30).do(ground.thaw({ over: 10 }))",
  ],
});

type SkySelf = { elevation: number; azimuth: number };

/**
 * Небо и солнце: высота и азимут вручную. Если в мире есть Forces (силы мира), солнце берётся из часов суток
 * и эти два числа не используются: Sky только показывает небо (вид — render-three).
 * Версия 1; высота и азимут теперь ручки (6.7), действие sun — поведение: те же числа в те же моменты, что и раньше.
 */
export const Sky = defineComponent<{ elevation: number; azimuth: number }, SkySelf>({
  type: 'Sky',
  version: 1,
  describe: 'Небо и солнце. Действие sun меняет высоту и азимут (градусы), можно плавно за duration секунд. Если в мире есть Forces, солнце идёт по часам суток, а эти значения не используются.',
  params: z.object({
    elevation: z.number().min(-10).max(90).default(30).describe('высота солнца над горизонтом, ° (если нет Forces)'),
    azimuth: z.number().min(0).max(360).default(180).describe('азимут солнца, ° (0 — север, +z; 90 — восток, +x) (если нет Forces)'),
  }),
  handles: { elevation: { unit: '°' }, azimuth: { unit: '°' } },
  actions: {
    sun: z.object({
      elevation: z.number().min(-10).max(90).optional(),
      azimuth: z.number().min(0).max(360).optional(),
      duration: z.number().min(0).max(600).default(0),
    }),
  },
  create: (_ctx, p) => ({ elevation: p.elevation, azimuth: p.azimuth }),
  step() {},
  // поведение «sun»: азимут сразу, высота сразу или линейно за duration (как было до механизма ручек)
  onAction(_s, _n, a, ctx) {
    if (a.azimuth !== undefined) ctx.handles.set('azimuth', a.azimuth);
    if (a.elevation === undefined) return;
    if (a.duration > 0) ctx.handles.to('elevation', a.elevation, { over: a.duration, ease: 'linear' });
    else ctx.handles.set('elevation', a.elevation);
  },
  state: (s, ctx) => ({ sun: ctx.service('forces')?.sun() ?? { elevation: s.elevation, azimuth: s.azimuth } }),
  showcase: {
    kind: 'world', size: 40, eye: 2, ground: 'hills',
    demos: [{
      title: 'Солнце: утро, день, закат',
      duration: 10,
      steps: [
        { t: 0, action: 'sun', args: { elevation: 8, azimuth: 100 } },
        { t: 0.5, action: 'sun', args: { elevation: 55, azimuth: 180, duration: 4 } },
        { t: 5, action: 'sun', args: { elevation: 1, azimuth: 260, duration: 5 } },
      ],
    }],
  },
  examples: ['s.world.sun({ elevation: 0.6, duration: 14 })', "sky.to('elevation', 20, { over: 8 })"],
});
