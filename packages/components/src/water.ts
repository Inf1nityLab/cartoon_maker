import { z } from 'zod';
import { defineComponent, type Ctx, type PathSampler, type ShowSetup, type WaterField } from '@cartoon/engine';
import { Target, type Vec3 } from '@cartoon/schema';
import { seaState, smooth01, waveHeightAt, windAzimuth, type SeaState } from './water-waves.ts';

/**
 * Вода (ARCHITECTURE 6.5): одна поверхность на пруд, озеро, ручей, реку, океан и оазис. Вода знает место:
 *  - basin: уровень в ложбине. С точкой `at` заполняет ложбину вокруг неё (связная область ниже уровня, береговая линия
 *    берётся из ctx.heightAt); без `at` — всё, что ниже уровня (так вела себя вода версии 1). `open` — вода продолжается
 *    за область до горизонта (океан);
 *  - river: ручей и река идут по пути, как Road: русло прорезает рельеф (сервис grade), уровень течёт под уклон.
 * Волны слоями (зыбь, ветровые, рябь) слушают ветер из сил мира с чувствительностью; лёд слушает температуру.
 * Вид — render-three/views/water.ts. Всё — функция времени фильма и seed.
 */

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const Xz = z.tuple([z.number(), z.number()]);

export const WaterParams = z.object({
  style: z.enum(['realistic', 'classic']).default('realistic').describe('realistic — вода с волнами, глубиной и берегом; classic — прежний простой полупрозрачный лист (старые сцены)'),
  shape: z.enum(['basin', 'river']).default('basin').describe('basin — вода в ложбине на уровне level; river — по пути path с руслом'),
  open: z.boolean().default(false).describe('вода продолжается за область до горизонта (океан)'),
  level: z.number().min(-50).max(50).default(-0.4).describe('уровень воды, м'),
  at: Xz.optional().describe('точка [x, z] внутри ложбины: вода заполняет связную область ниже уровня вокруг неё. Без неё — всё, что ниже уровня'),
  reach: z.number().min(5).max(600).default(120).describe('как далеко от at искать берег, м'),
  path: z.string().optional().describe('id пути в scene.paths (shape: river): ось русла'),
  width: z.number().min(0.4).max(80).default(6).describe('ширина русла, м (shape: river)'),
  bank: z.number().min(0.3).max(30).default(3).describe('ширина берега, на которой земля сходит к руслу, м (river)'),
  depth: z.number().min(0.05).max(12).default(1.2).describe('глубина русла посередине, м (river)'),
  smooth: z.number().min(2).max(300).default(20).describe('на какой длине вдоль русла выравнивается уровень, м (river)'),
  deepDepth: z.number().min(1).max(300).default(40).describe('глубина за областью, м (open)'),
  color: z.string().default('#2a6f97').describe('цвет листа воды (style: classic)'),
  shallowColor: Hex.default('#5fc4c0').describe('цвет мелководья'),
  deepColor: Hex.default('#0c3f5c').describe('цвет глубины'),
  bedColor: Hex.default('#d9c79a').describe('цвет дна (песок), когда bedBlend > 0'),
  bedBlend: z.number().min(0).max(1).default(0).describe('0 — сквозь воду видно настоящую землю, 1 — песчаное дно цвета bedColor'),
  clarity: z.number().min(0).max(1).default(0.6).describe('прозрачность воды: 0 мутная (видно на сантиметры), 1 чистая (видно на десятки метров)'),
  waveHeight: z.number().min(0).max(8).default(0).describe('высота ветровых волн без ветра, м (значимая высота)'),
  swell: z.number().min(0).max(8).default(0).describe('высота океанской зыби, м: идёт независимо от местного ветра'),
  swellDirection: z.number().min(0).max(360).default(270).describe('куда идёт зыбь, ° (0 — на север +z, 90 — на восток +x)'),
  swellLength: z.number().min(8).max(250).default(40).describe('длина волны зыби, м'),
  ripple: z.number().min(0).max(1).default(0.3).describe('рябь: 0 зеркальная гладь, 1 сильная рябь'),
  rippleBoost: z.number().min(0).max(1).default(0).describe('добавка к ряби от порыва, 0…1 (обычно 0; меняется поведением ripple)'),
  windSensitivity: z.number().min(0).max(1).default(0.4).describe('как сильно вода слушает ветер сил мира: 0 — никак, 1 — как открытое море'),
  flowSpeed: z.number().min(0).max(8).default(0).describe('скорость течения, м/с (у реки — вдоль пути)'),
  flowDirection: z.number().min(0).max(360).default(90).describe('куда течёт вода, ° (у basin; у реки течение идёт вдоль пути)'),
  foam: z.number().min(0).max(1).default(0.5).describe('пена: у берега и на гребнях волн'),
  reflection: z.number().min(0).max(1).default(0.8).describe('сила отражений неба и солнца'),
  ice: z.number().min(0).max(1).default(0).describe('лёд: 0 чистая вода, 1 сплошной лёд'),
  temperatureSensitivity: z.number().min(0).max(1).default(0).describe('слушает температуру: 1 — вода замерзает при морозе (ниже freezeAt) сама, 0 — только по ручке ice'),
  freezeAt: z.number().min(-30).max(10).default(0).describe('температура начала льда, °C (полностью покрыта на 6 °C ниже)'),
  touchers: z.array(z.string()).default([]).describe('id сущностей, от которых по воде идут круги (когда они в воде)'),
  spots: z.array(z.object({
    id: z.string(), at: Xz, radius: z.number().min(0.1).max(50).default(1), kind: z.string().default('lily'),
  })).default([]).describe('места на воде под то, что будут добавлять другие объекты (кувшинки, камыш, водоросли, рыбы): id, [x, z], радиус, вид'),
  seed: z.number().int().default(3).describe('seed волн'),
  report: z.boolean().default(true).describe('попадает ли вода в отчёт о мире (WorldState)'),
});
export type WaterParams = z.infer<typeof WaterParams>;

// ---------- геометрия: где вода ----------

const smoothstep01 = (t: number) => { const k = Math.max(0, Math.min(1, t)); return k * k * (3 - 2 * k); };

type Bounds = WaterField['bounds'];

/** Заливка ложбины: ячейки сетки, достижимые от точки at по ячейкам ниже уровня. Возвращает маску с запасом в ячейку. */
function floodBasin(ctx: Ctx, p: WaterParams, terrainHalf: number | null): { bounds: Bounds; cell: number; nx: number; nz: number; mask: Uint8Array } {
  const [ax, az] = p.at!;
  let x0 = ax - p.reach, x1 = ax + p.reach, z0 = az - p.reach, z1 = az + p.reach;
  if (terrainHalf !== null) { x0 = Math.max(x0, -terrainHalf); x1 = Math.min(x1, terrainHalf); z0 = Math.max(z0, -terrainHalf); z1 = Math.min(z1, terrainHalf); }
  const cell = Math.max(1, Math.max(x1 - x0, z1 - z0) / 400);
  const nx = Math.max(1, Math.ceil((x1 - x0) / cell)), nz = Math.max(1, Math.ceil((z1 - z0) / cell));
  const low = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) low[j * nx + i] = ctx.heightAt(x0 + (i + 0.5) * cell, z0 + (j + 0.5) * cell) < p.level ? 1 : 0;
  const seen = new Uint8Array(nx * nz);
  // стартовая ячейка: ближайшая к at из ячеек ниже уровня (at может стоять чуть выше уровня на берегу)
  const si = Math.min(nx - 1, Math.max(0, Math.floor((ax - x0) / cell))), sj = Math.min(nz - 1, Math.max(0, Math.floor((az - z0) / cell)));
  let start = -1, best = Infinity;
  for (let r = 0; r <= 6 && start < 0; r++) {
    for (let j = Math.max(0, sj - r); j <= Math.min(nz - 1, sj + r); j++) for (let i = Math.max(0, si - r); i <= Math.min(nx - 1, si + r); i++) {
      if (low[j * nx + i] && (i - si) ** 2 + (j - sj) ** 2 < best) { best = (i - si) ** 2 + (j - sj) ** 2; start = j * nx + i; }
    }
  }
  if (start >= 0) {
    const stack = [start]; seen[start] = 1;
    while (stack.length) {
      const c = stack.pop()!, i = c % nx, j = (c - i) / nx;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
        const n = nj * nx + ni;
        if (low[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
      }
    }
  }
  // запас в ячейку: береговая ячейка может быть «выше уровня» в центре, а у самого берега — уже нет
  const mask = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    if (!seen[j * nx + i]) continue;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ni = i + di, nj = j + dj;
      if (ni >= 0 && nj >= 0 && ni < nx && nj < nz) mask[nj * nx + ni] = 1;
    }
  }
  return { bounds: { x0, x1, z0, z1 }, cell, nx, nz, mask };
}

type RiverModel = {
  bounds: Bounds;
  hw: number;
  centreDistance(x: number, z: number): number;
  /** Дно/берег: рельеф с руслом. base — высота земли до русла. */
  grade(x: number, z: number, base: (x: number, z: number) => number): number;
  /** Уровень воды в ближайшей к (x, z) точке оси (нужен grade хотя бы раз вызванный; иначе null). */
  surfaceAt(x: number, z: number): number | null;
  /** То же, но и за берегом (по ближайшей точке оси). */
  surfaceExt(x: number, z: number): number;
  flow(x: number, z: number): [number, number];
  nearest(x: number, z: number): { d: number; i: number; t: number };
};

const STEP = 0.5;

/** Модель русла по оси-пути. Уровень по оси: сглаженная высота земли, не растущая вниз по течению. */
function buildRiver(path: PathSampler, p: WaterParams): RiverModel {
  const n = Math.max(2, Math.min(4000, Math.ceil(path.length / STEP)));
  const xs = new Float64Array(n + 1), zs = new Float64Array(n + 1);
  for (let k = 0; k <= n; k++) { const q = path.getPointAt(k / n); xs[k] = q[0]; zs[k] = q[2]; }
  const hw = p.width / 2, reach = hw + p.bank;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let k = 0; k <= n; k++) { x0 = Math.min(x0, xs[k]!); x1 = Math.max(x1, xs[k]!); z0 = Math.min(z0, zs[k]!); z1 = Math.max(z1, zs[k]!); }
  const bounds = { x0: x0 - reach, x1: x1 + reach, z0: z0 - reach, z1: z1 + reach };
  const nearest = (x: number, zz: number, limit: number) => {
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
  let surface: Float64Array | null = null;
  const axis = (base: (x: number, z: number) => number): Float64Array => {
    if (surface) return surface;
    let h = new Float64Array(n + 1);
    for (let k = 0; k <= n; k++) h[k] = base(xs[k]!, zs[k]!);
    const w = Math.round(p.smooth / 2 / (path.length / n));
    for (let pass = 0; pass < 2 && w > 0; pass++) {
      const pre = new Float64Array(n + 2);
      for (let k = 0; k <= n; k++) pre[k + 1] = pre[k]! + h[k]!;
      const o = new Float64Array(n + 1);
      for (let k = 0; k <= n; k++) {
        const a = Math.max(0, k - w), b = Math.min(n, k + w);
        o[k] = (pre[b + 1]! - pre[a]! + (a - (k - w)) * h[0]! + (k + w - b) * h[n]!) / (2 * w + 1);
      }
      h = o;
    }
    for (let k = 1; k <= n; k++) h[k] = Math.min(h[k]!, h[k - 1]!); // вода течёт под уклон: уровень не растёт вниз по течению
    surface = h;
    return h;
  };
  const surfAt = (i: number, t: number): number => { const h = surface!; return h[i]! + (h[i + 1]! - h[i]!) * t; };
  return {
    bounds, hw,
    nearest: (x, zz) => nearest(x, zz, 0),
    centreDistance: (x, zz) => nearest(x, zz, reach).d,
    grade(x, zz, base) {
      const b = base(x, zz);
      const r = nearest(x, zz, 0);
      if (r.d >= reach) return b;
      axis(base);
      const sf = surfAt(r.i, r.t);
      if (r.d <= hw) { const u = r.d / hw; return sf - 0.05 - (p.depth - 0.05) * (1 - u * u); }
      return sf - 0.05 + (b - (sf - 0.05)) * smoothstep01((r.d - hw) / p.bank);
    },
    surfaceAt(x, zz) {
      if (!surface) return null;
      const r = nearest(x, zz, 0);
      return r.d <= hw ? surfAt(r.i, r.t) : null;
    },
    surfaceExt(x, zz) {
      const r = nearest(x, zz, 1e9);
      return surface ? surfAt(r.i, r.t) : 0;
    },
    flow(x, zz) {
      const r = nearest(x, zz, 1e9);
      if (!isFinite(r.d)) return [0, 0];
      const ex = xs[r.i + 1]! - xs[r.i]!, ez = zs[r.i + 1]! - zs[r.i]!, l = Math.hypot(ex, ez) || 1;
      return [ex / l, ez / l];
    },
  };
}

// ---------- состояние ----------

export type Ring = { x: number; z: number; t0: number; amp: number };
export type WaterSelf = {
  waveHeight: number; swell: number; swellDirection: number; ripple: number; rippleBoost: number; windSensitivity: number;
  flowSpeed: number; flowDirection: number; clarity: number; foam: number; reflection: number; ice: number;
  shallowColor: string; deepColor: string;
  /** производные, считаются в step */
  windSpeed: number; windDir: number; temp: number; iceEff: number;
  /** путь, который прошла вода по течению с начала фильма, м (волны и рябь сносит течением) */
  drift: number;
  rings: Ring[];
  last: Record<string, [number, number]>;
};

/** Поле воды этого компонента среди всех вод мира. */
const mine = (ctx: Ctx): WaterField => ctx.service('waters')!.find((w) => w.id === ctx.componentId)!;

const MAX_RINGS = 8, RING_LIFE = 5, RING_STEP = 0.35;
const RIPPLE_HANDLES = ['waveHeight', 'swell', 'swellDirection', 'ripple', 'rippleBoost', 'windSensitivity', 'flowSpeed', 'flowDirection', 'clarity', 'foam', 'reflection', 'ice', 'shallowColor', 'deepColor'] as const;

/** Состояние моря для вида и тестов: из self. */
export const seaOf = (s: WaterSelf, swellLength: number): SeaState => seaState({ ...s, swellLength, ice: s.iceEff });

/** Лёд сейчас: ручка ice, либо мороз (если вода слушает температуру): от freezeAt до freezeAt − 6 °C нарастает от 0 до 1. */
export const iceNow = (ice: number, temp: number, p: Pick<WaterParams, 'temperatureSensitivity' | 'freezeAt'>): number =>
  Math.max(ice, p.temperatureSensitivity * smooth01((p.freezeAt - temp) / 6));

const OCEAN_SETUP: ShowSetup = {
  terrain: { style: 'hills', seed: 7, amplitude: 3, scale: 0.02, size: 400, segments: 384, ground: 'soil', lake: { at: [-190, 0], radius: 170, depth: 22 } },
  views: {
    general: { at: [-30, 3.2, 14], look: [-150, 0.2, -10], fov: 50, abs: true },
    close: { at: [-56, 1.4, 6], look: [-100, 0, 0], fov: 45, abs: true },
    ground: { at: [-50, 0.3, 9], look: [-110, 0, 0], fov: 60, abs: true },
    top: { at: [-75, 70, 0], look: [-95, 0, 0], fov: 50, abs: true },
    dive: { at: [-95, -1.5, 6], look: [-160, -3, 0], fov: 60, abs: true },
  },
};
const RIVER_PATH: [number, number, number][] = [[-70, 0, -35], [-35, 0, 5], [0, 0, -10], [30, 0, 18], [70, 0, 10]];
const RIVER_VIEWS: NonNullable<ShowSetup['views']> = {
  general: { at: [-52, 9, -52], look: [0, 0, 0], fov: 50 },
  close: { at: [-24, 2.2, 16], look: [-16, -0.5, -6], fov: 45 },
  ground: { at: [-6, 0.6, 2], look: [14, -0.3, -2], fov: 55 },
  top: { at: [0, 80, 0], look: [0, 0, 0], fov: 55, abs: true },
  dive: { at: [-12, -0.3, 0], look: [10, -0.5, -8], fov: 60, abs: true },
};

export const Water = defineComponent<WaterParams, WaterSelf>({
  type: 'Water',
  version: 2,
  describe: 'Вода: пруд, озеро, ручей, река, океан, оазис. Знает место: заполняет ложбину до уровня (береговая линия по ctx.heightAt, глубина и цвет по глубине) или идёт по пути с руслом (река). Волны слоями (зыбь, ветровые, рябь), пена, каустики на дне, лёд, подводный вид. Слушает ветер и температуру сил мира. Ручки: waveHeight, swell, ripple, windSensitivity, flowSpeed, clarity, foam, reflection, ice, цвета. Поведения: ripple, storm, calm, freeze, thaw, splash. Для реки объявлять после Terrain и Road.',
  params: WaterParams,
  presets: {
    'ocean-tropical': WaterParams.parse({ shape: 'basin', open: true, level: 0, at: [-190, 0], reach: 400, shallowColor: '#58d6c8', deepColor: '#05466e', bedColor: '#d8c490', bedBlend: 0.9, clarity: 0.9, swell: 0.9, swellLength: 55, swellDirection: 90, waveHeight: 0.15, ripple: 0.25, windSensitivity: 0.7, foam: 0.6, reflection: 0.6, deepDepth: 60 }),
    'ocean-storm': WaterParams.parse({ shape: 'basin', open: true, level: 0, at: [-190, 0], reach: 400, shallowColor: '#6f9a95', deepColor: '#16323f', bedColor: '#b9a77f', bedBlend: 0.9, clarity: 0.3, swell: 3.6, swellLength: 90, swellDirection: 90, waveHeight: 1.6, ripple: 0.5, windSensitivity: 1, foam: 1, reflection: 0.7, deepDepth: 60 }),
    'lake-mountain': WaterParams.parse({ shape: 'basin', level: -0.4, at: [0, 0], reach: 80, shallowColor: '#3fa0b4', deepColor: '#0b3552', clarity: 0.85, ripple: 0.2, windSensitivity: 0.2, foam: 0.25, reflection: 1, temperatureSensitivity: 1, freezeAt: -2 }),
    'pond-forest': WaterParams.parse({ shape: 'basin', level: -0.4, at: [0, 0], reach: 80, shallowColor: '#5d8f55', deepColor: '#1e3b2c', clarity: 0.3, ripple: 0.18, windSensitivity: 0.12, foam: 0.2, reflection: 0.85, temperatureSensitivity: 1, freezeAt: 0 }),
    'pond-lilies': WaterParams.parse({
      shape: 'basin', level: -0.4, at: [0, 0], reach: 80, shallowColor: '#5d8f55', deepColor: '#1e3b2c', clarity: 0.3, ripple: 0.15, windSensitivity: 0.1, foam: 0.15, reflection: 0.85, temperatureSensitivity: 1, freezeAt: 0,
      spots: [{ id: 'lily-1', at: [-6, 4], radius: 2.2, kind: 'lily' }, { id: 'lily-2', at: [5, 6], radius: 1.8, kind: 'lily' }, { id: 'lily-3', at: [-2, -8], radius: 2.6, kind: 'lily' }],
    }),
    creek: WaterParams.parse({ shape: 'river', path: 'water', width: 2.4, bank: 1.6, depth: 0.45, smooth: 14, level: 0, shallowColor: '#86bcae', deepColor: '#2c6064', bedColor: '#9a8a6a', bedBlend: 0.5, clarity: 0.8, flowSpeed: 0.9, ripple: 0.5, windSensitivity: 0.05, foam: 0.5, reflection: 0.7 }),
    river: WaterParams.parse({ shape: 'river', path: 'water', width: 9, bank: 4, depth: 2.2, smooth: 30, level: 0, shallowColor: '#79966a', deepColor: '#2a4538', clarity: 0.4, flowSpeed: 1.7, ripple: 0.35, windSensitivity: 0.2, foam: 0.35, reflection: 0.8 }),
    oasis: WaterParams.parse({ shape: 'basin', level: -0.4, at: [0, 0], reach: 80, shallowColor: '#37cbc9', deepColor: '#0a6a99', bedColor: '#e6cf9b', bedBlend: 0.65, clarity: 0.75, ripple: 0.1, windSensitivity: 0.1, foam: 0.1, reflection: 1 }),
  },
  handles: {
    waveHeight: { unit: 'м' }, swell: { unit: 'м' }, swellDirection: { unit: '°' }, ripple: {}, rippleBoost: {}, windSensitivity: {},
    flowSpeed: { unit: 'м/с' }, flowDirection: { unit: '°' }, clarity: {}, foam: {}, reflection: {}, ice: {}, shallowColor: {}, deepColor: {},
  },
  showcase: {
    kind: 'world', size: 50, eye: 1.2, ground: 'hills', defaultPreset: 'pond-forest', dive: true,
    setups: {
      default: {
        terrain: { style: 'hills', seed: 7, amplitude: 3.5, scale: 0.05, size: 240, segments: 384, ground: 'soil', lake: { at: [0, 0], radius: 34, depth: 9 } },
        views: {
          general: { at: [-24, 5, -30], look: [0, -1, 3], fov: 45, abs: true },
          close: { at: [-13, 1.3, -15], look: [0, -0.6, 2], fov: 40, abs: true },
          ground: { at: [-9, 0.15, -12], look: [0, -0.5, 3], fov: 55, abs: true },
          top: { at: [0, 48, -2], look: [0, 0, 0], fov: 45, abs: true },
          dive: { at: [3, -1.6, -9], look: [0, -2.2, 8], fov: 55, abs: true },
        },
      },
      'ocean-tropical': OCEAN_SETUP,
      'ocean-storm': OCEAN_SETUP,
      creek: { terrain: { style: 'hills', seed: 7, amplitude: 5, scale: 0.03, size: 240, segments: 384, ground: 'soil' }, path: RIVER_PATH, views: RIVER_VIEWS },
      river: { terrain: { style: 'hills', seed: 7, amplitude: 5, scale: 0.03, size: 240, segments: 384, ground: 'soil' }, path: RIVER_PATH, views: RIVER_VIEWS },
    },
    demos: [
      {
        title: 'Штиль, ветер, шторм (океан)', duration: 15,
        steps: [
          { t: 0, action: 'calm', args: { over: 0.1 } },
          { t: 0, target: 'forces', action: 'handle.set', args: { handle: 'windStrength', value: 0 } },
          { t: 2.5, target: 'forces', action: 'handle.to', args: { handle: 'windStrength', value: 9, over: 5 } },
          { t: 3, action: 'storm', args: { over: 6, severity: 1 } },
          { t: 10.5, target: 'forces', action: 'handle.to', args: { handle: 'windStrength', value: 1, over: 3 } },
          { t: 10.5, action: 'calm', args: { over: 3 } },
        ],
      },
      {
        title: 'Пруд замерзает', duration: 12,
        steps: [{ t: 1, action: 'freeze', args: { over: 6 } }, { t: 8, action: 'thaw', args: { over: 3 } }],
      },
      {
        title: 'Порыв ряби и круги', duration: 10,
        steps: [{ t: 0.5, action: 'ripple', args: { strength: 0.8, duration: 3 } }, { t: 2, action: 'splash', args: { at: [3, 0, 3], strength: 1 } }, { t: 4.5, action: 'splash', args: { at: [-2, 0, 4], strength: 0.7 } }],
      },
    ],
  },
  actions: {
    ripple: z.object({
      strength: z.number().min(0.05).max(1).default(0.6).describe('на сколько усиливается рябь на пике, 0…1'),
      duration: z.number().min(0.4).max(60).default(3).describe('сколько длится порыв ряби, с'),
    }),
    storm: z.object({
      over: z.number().min(0).max(600).default(8).describe('за сколько секунд волнение нарастает, с'),
      severity: z.number().min(0).max(1).default(1).describe('сила шторма 0…1: ветровые волны до 2.5 м и зыбь до 4 м, больше пены, мутнее вода'),
    }),
    calm: z.object({ over: z.number().min(0).max(600).default(5).describe('за сколько секунд вода успокаивается до глади, с') }),
    freeze: z.object({ over: z.number().min(0).max(3600).default(8).describe('за сколько секунд вода замерзает, с') }),
    thaw: z.object({ over: z.number().min(0).max(3600).default(8).describe('за сколько секунд лёд тает, с') }),
    splash: z.object({
      at: Target.describe('куда упало: [x, y, z] или id места/сущности'),
      strength: z.number().min(0.1).max(2).default(1).describe('сила круга'),
    }),
  },
  setup(ctx, p) {
    const terrainHalf = (): number | null => { const t = ctx.service('terrain'); return t ? t.size / 2 : null; };
    let river: RiverModel | null = null;
    if (p.shape === 'river') {
      if (!p.path) throw new Error('Water shape: river требует path (id пути в scene.paths)');
      river = buildRiver(ctx.path(p.path), p);
      const prev = ctx.service('grade');
      ctx.provide('grade', (x, z, base) => river!.grade(x, z, prev ? (xx, zz) => prev(xx, zz, base) : base));
      // грубо до первого grade: нулевой уровень не лжёт, он нужен только лоуполи-раскраске
    }
    ctx.provide('waterLevel', p.level);

    type Flood = ReturnType<typeof floodBasin> | null;
    let flood: Flood | undefined;
    const ensure = (): Flood => {
      if (flood !== undefined) return flood;
      ctx.heightAt(0, 0); // собрать сетку высот (для реки — и вызвать grade, чтобы появился уровень по оси)
      flood = p.shape === 'basin' && p.at ? floodBasin(ctx, p, terrainHalf()) : null;
      return flood;
    };

    const basinBounds = (): Bounds => {
      const f = ensure();
      if (f) return f.bounds;
      const h = terrainHalf() ?? p.reach;
      return { x0: -h, x1: h, z0: -h, z1: h };
    };
    const levelAt = (x: number, z: number): number | null => {
      if (p.shape === 'river') {
        ensure();
        const l = river!.surfaceAt(x, z);
        return l !== null && ctx.heightAt(x, z) < l ? l : null;
      }
      const f = ensure();
      const b = basinBounds();
      if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) return p.open ? p.level : null;
      if (f) {
        const i = Math.min(f.nx - 1, Math.floor((x - f.bounds.x0) / f.cell)), j = Math.min(f.nz - 1, Math.floor((z - f.bounds.z0) / f.cell));
        if (!f.mask[j * f.nx + i]) return null;
      }
      return ctx.heightAt(x, z) < p.level ? p.level : null;
    };
    const depthAt = (x: number, z: number): number => {
      const l = levelAt(x, z);
      if (l === null) return 0;
      const b = p.shape === 'river' ? river!.bounds : basinBounds();
      if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) return p.deepDepth;
      return Math.max(0, l - ctx.heightAt(x, z));
    };
    const centre = (): [number, number] => {
      if (p.shape === 'river') { const q = ctx.path(p.path!).getPointAt(0.5); return [q[0], q[2]]; }
      return p.at ?? [0, 0];
    };
    const field: WaterField = {
      id: ctx.componentId,
      config: p as unknown as Record<string, any>,
      get center() { return centre(); },
      get bounds() { return p.shape === 'river' ? river!.bounds : basinBounds(); },
      open: p.open,
      level: levelAt,
      depth: depthAt,
      surface: (x, z) => { if (p.shape !== 'river') return p.level; ensure(); return river!.surfaceExt(x, z); },
      flowDir(x, z) {
        if (p.shape === 'river') return river!.flow(x, z);
        const a = (p.flowDirection * Math.PI) / 180;
        return [Math.sin(a), Math.cos(a)];
      },
    };
    ctx.provide('waters', [...(ctx.service('waters') ?? []), field]);
  },
  create(_ctx, p) {
    const s = {} as WaterSelf;
    for (const k of RIPPLE_HANDLES) (s as any)[k] = p[k];
    return Object.assign(s, { windSpeed: 0, windDir: 0, temp: 15, iceEff: p.ice, drift: 0, rings: [], last: {} });
  },
  step(self, dt, ctx) {
    const water = mine(ctx);
    const p = water.config as WaterParams;
    const c = water.center;
    const probe: Vec3 = [c[0], p.level, c[1]];
    const w = ctx.wind(probe);
    self.windSpeed = Math.hypot(w[0], w[2]);
    self.windDir = self.windSpeed > 1e-6 ? windAzimuth(w[0], w[2]) : p.flowDirection;
    self.temp = ctx.temperature(probe);
    self.iceEff = iceNow(self.ice, self.temp, p);
    self.drift += self.flowSpeed * (1 - self.iceEff) * dt;
    // круги от тех, кто касается воды
    for (const id of p.touchers) {
      let pos: Vec3;
      try { pos = ctx.entity(id).pos; } catch { continue; }
      const depth = water.depth(pos[0], pos[2]);
      if (depth < 0.02 || depth > 1.6 || self.iceEff > 0.8) { delete self.last[id]; continue; }
      const last = self.last[id];
      if (!last) { self.last[id] = [pos[0], pos[2]]; self.rings.push({ x: pos[0], z: pos[2], t0: ctx.time, amp: 1 }); continue; }
      const d = Math.hypot(pos[0] - last[0], pos[2] - last[1]);
      if (d >= RING_STEP) { self.last[id] = [pos[0], pos[2]]; self.rings.push({ x: pos[0], z: pos[2], t0: ctx.time, amp: Math.min(1, 0.45 + d) }); }
    }
    self.rings = self.rings.filter((r) => ctx.time - r.t0 < RING_LIFE).slice(-MAX_RINGS);
  },
  onAction(self, name, a, ctx) {
    switch (name) {
      case 'ripple':
        ctx.handles.seq('rippleBoost', [{ to: a.strength, over: a.duration * 0.3, ease: 'ease-out' }, { to: 0, over: a.duration * 0.7, ease: 'ease-in-out' }]);
        break;
      case 'storm': {
        const k = a.severity;
        ctx.handles.to('waveHeight', 0.2 + 2.3 * k, { over: a.over });
        ctx.handles.to('swell', 0.4 + 3.6 * k, { over: a.over });
        ctx.handles.to('foam', Math.min(1, 0.45 + 0.55 * k), { over: a.over });
        ctx.handles.to('clarity', Math.max(0.2, self.clarity * (1 - 0.5 * k)), { over: a.over });
        ctx.handles.to('windSensitivity', Math.min(1, 0.5 + 0.5 * k), { over: a.over });
        break;
      }
      case 'calm':
        for (const h of ['waveHeight', 'swell', 'rippleBoost'] as const) ctx.handles.to(h, 0, { over: a.over });
        ctx.handles.to('ripple', 0.05, { over: a.over });
        ctx.handles.to('windSensitivity', 0, { over: a.over });
        break;
      case 'freeze': ctx.handles.to('ice', 1, { over: a.over, ease: 'ease-in-out' }); break;
      case 'thaw': ctx.handles.to('ice', 0, { over: a.over, ease: 'ease-in-out' }); break;
      case 'splash': {
        const at = ctx.resolve(a.at);
        self.rings.push({ x: at[0], z: at[2], t0: ctx.time, amp: a.strength });
        self.rings = self.rings.slice(-MAX_RINGS);
        break;
      }
    }
  },
  migrate: {
    // v1: простой полупрозрачный лист на уровне level. v2: тот же лист как style 'classic' (старые сцены не меняются);
    // код режиссёра пишет version 1 и при новых параметрах — если есть что-то кроме level и color, это уже новая вода
    1: (p: Record<string, unknown>) => (Object.keys(p).every((k) => k === 'level' || k === 'color') ? { style: 'classic', report: false, ...p } : p),
  },
  state(self, ctx) {
    const p = mine(ctx)?.config as WaterParams | undefined;
    if (!p || !p.report) return {};
    const sea = seaOf(self, p.swellLength);
    return {
      shape: p.shape, level: p.level, ice: round(self.iceEff), clarity: round(self.clarity),
      waves: { swell: round(sea.swell.height), wind: round(sea.wind.height), ripple: round(sea.ripple.height), windSpeed: round(self.windSpeed) },
      flow: round(self.flowSpeed * (1 - self.iceEff)),
      rings: self.rings.length,
      spots: p.spots.length,
    };
  },
  examples: [
    "s.world.use('Water', { shape: 'basin', at: [0, 0], level: -0.4, clarity: 0.5 })",
    "s.path('water', { points: [[-40,0,-20],[0,0,0],[40,0,20]] }); s.world.use('Water', { shape: 'river', path: 'water', width: 6 })",
    "water.to('ice', 1, { over: 8 })",
    "s.at(5).do(water.storm({ over: 6 }))",
  ],
});

const round = (v: number) => Math.round(v * 1000) / 1000;
export { waveHeightAt };
