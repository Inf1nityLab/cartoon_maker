import { z } from 'zod';
import { defineComponent, mixHex, type Ctx } from '@cartoon/engine';
import type { Vec3 } from '@cartoon/schema';
import { TreeParams, TREE_PRESETS } from './params.ts';
import { RECIPES, ageStage } from './recipes.ts';

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const smoothstep = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** Сколько дерева в рост от взрослого: саженец 0.12, взрослое 1, старое 1.12. */
export const ageScale = (age: number): number => (age <= 0.5 ? 0.12 + 0.88 * smoothstep(0, 1, age / 0.5) : 1 + 0.12 * ((age - 0.5) / 0.5));
/** Ширина относительно высоты: саженец тоньше, старое дерево раскидистее. */
export const ageGirth = (age: number): number => (age <= 0.5 ? 0.8 + 0.2 * smoothstep(0, 1, age / 0.5) : 1 + 0.18 * ((age - 0.5) / 0.5));
/** Густота кроны от возраста: у саженца и у старика листвы меньше. */
export const ageDensity = (age: number): number => (age < 0.5 ? 0.6 + 0.4 * smoothstep(0, 1, age / 0.5) : 1 - 0.14 * ((age - 0.5) / 0.5));

/** Доля листвы от сезона (до листопада-ручки): весной почки, летом полная, осенью опадает, зимой голо. */
export function seasonDensity(season: number, evergreen: boolean): number {
  if (evergreen) return 1;
  return (0.3 + 0.7 * smoothstep(0, 0.16, season)) * (1 - smoothstep(0.6, 0.86, season));
}
/** Насколько лист уже осенний, 0…1. */
export const autumnAmount = (season: number, evergreen: boolean): number => (evergreen ? 0 : smoothstep(0.36, 0.6, season));
/** Цвет листвы без осенних пятен: весна светлее и жёлтее. */
export function seasonColor(summer: string, season: number, evergreen: boolean): string {
  return evergreen ? mixHex(summer, '#10180f', 0.35 * smoothstep(0.6, 1, season)) : mixHex('#b9d85c', summer, smoothstep(0, 0.2, season));
}

export type TreeSelf = {
  pos: Vec3; heading: number;
  // ручки
  age: number; season: number; snow: number; shed: number; windSensitivity: number;
  /** постоянные породы и облика: рост взрослого, вечнозелёная ли, ветер (усиление, частота), цвет летом */
  k: { height: number; evergreen: boolean; gain: number; freq: number; summer: string };
  // следствия (то, что рисует вид)
  height: number; girth: number; stage: number;
  leafDensity: number; leafColor: string; autumn: number; snowLoad: number;
  /** отклонение верхушки от вертикали по осям мира x, z (доли высоты) и его скорость */
  bend: [number, number]; bendV: [number, number];
  /** трепет листьев, 0…1.5 */
  flutter: number;
};

const SNOW_UP = 0.6, SNOW_MELT = 0.35; // 1/с: как быстро снег ложится и тает
const WIND_K = 0.00022; // доли высоты на (м/с)² при усилении 1
const DAMP = 0.16; // доля критического затухания: после порыва дерево качнётся несколько раз

function derive(s: TreeSelf): void {
  const k = s.k;
  s.height = k.height * ageScale(s.age);
  s.girth = ageGirth(s.age);
  s.stage = ageStage(s.age);
  s.autumn = autumnAmount(s.season, k.evergreen);
  s.leafColor = seasonColor(k.summer, s.season, k.evergreen);
  s.leafDensity = clamp(seasonDensity(s.season, k.evergreen) * ageDensity(s.age) * (1 - s.shed), 0, 1);
}

const snowTarget = (ctx: Ctx, s: TreeSelf): number => s.snow * smoothstep(2.5, -0.5, ctx.temperature([s.pos[0], s.pos[1] + s.height * 0.5, s.pos[2]]));

export const Tree = defineComponent<TreeParams, TreeSelf>({
  type: 'Tree',
  version: 1,
  describe: 'Дерево или куст одного семейства (на ez-tree): дуб, ясень, осина, берёза, сосна, ель, кусты, ива — пресеты одного рецепта; seed делает каждое дерево своим. Растёт (age), меняется по сезонам (season: весна, лето, жёлтая и красная осень, голое, зима), сбрасывает листья (shed, shedLeaves), покрывается снегом (snow, тает в тепле), качается от ветра (берёза сильнее дуба; windSensitivity). Ручки: age, season, snow, shed, windSensitivity. Слушает силы мира: ветер, температура.',
  params: TreeParams,
  presets: TREE_PRESETS,
  handles: { age: {}, season: {}, snow: {}, shed: {}, windSensitivity: {} },
  actions: {
    shedLeaves: z.object({
      over: z.number().min(0.5).max(600).default(6).describe('за сколько секунд опадает листва, с'),
      to: z.number().min(0).max(1).default(1).describe('сколько листьев должно опасть к концу, доля'),
    }),
  },
  showcase: {
    kind: 'entity', size: 5, eye: 5, ground: 'flat',
    family: ['oak', 'ash', 'aspen', 'birch', 'pine', 'spruce', 'willow', 'bush1'],
    demos: [{
      title: 'Лето, осень, листопад, голое, снег — за 15 с при поднимающемся ветре',
      duration: 16,
      steps: [
        { t: 0, action: 'handle.set', args: { handle: 'season', value: 0.3 } },
        { t: 0, world: true, action: 'handle.set', args: { handle: 'windStrength', value: 1.5 } },
        { t: 1, action: 'handle.to', args: { handle: 'season', value: 0.58, over: 4, ease: 'linear' } },
        { t: 1, world: true, action: 'handle.to', args: { handle: 'windStrength', value: 7, over: 12, ease: 'ease-in' } },
        { t: 5.5, action: 'shedLeaves', args: { over: 5 } },
        { t: 5.5, action: 'handle.to', args: { handle: 'season', value: 0.9, over: 5, ease: 'ease-out' } },
        { t: 7, world: true, action: 'gust', args: { strength: 7, duration: 3 } },
        { t: 11, action: 'handle.to', args: { handle: 'snow', value: 1, over: 4, ease: 'ease-in-out' } },
        { t: 11, world: true, action: 'handle.to', args: { handle: 'temperature', value: -6, over: 2, ease: 'linear' } },
      ],
    }],
  },
  migrate: {},
  create(ctx, p, spawn) {
    const at = spawn!.at, r = RECIPES[p.species];
    const s: TreeSelf = {
      k: { height: p.height, evergreen: r.evergreen, gain: r.sway.gain, freq: r.sway.freq, summer: p.leafColor },
      pos: [at[0], ctx.heightAt(at[0], at[2]), at[2]], heading: spawn!.heading,
      age: p.age, season: p.season, snow: p.snow, shed: p.shed, windSensitivity: p.windSensitivity,
      height: 0, girth: 1, stage: 2, leafDensity: 1, leafColor: p.leafColor, autumn: 0, snowLoad: 0,
      bend: [0, 0], bendV: [0, 0], flutter: 0,
    };
    derive(s);
    s.snowLoad = snowTarget(ctx, s);
    return s;
  },
  onAction(s, name, a, ctx) {
    if (name === 'shedLeaves') ctx.handles.to('shed', a.to, { over: a.over, ease: 'ease-in' });
    void s;
  },
  step(s, dt, ctx) {
    derive(s);
    // снег: ложится, пока холодно, тает при плюсе (температура в точке дерева)
    const target = snowTarget(ctx, s);
    s.snowLoad += (target - s.snowLoad) * (1 - Math.exp(-(target > s.snowLoad ? SNOW_UP : SNOW_MELT) * dt));
    // ветер в точке кроны; качание — пружина с затуханием: порыв толкает, дерево качается и успокаивается
    const h = s.height, w = ctx.wind([s.pos[0], s.pos[1] + h * 0.65, s.pos[2]]);
    const sens = s.k.gain * s.windSensitivity, speed = Math.hypot(w[0], w[2]);
    const f = clamp(s.k.freq * Math.sqrt(9 / Math.max(h, 0.5)), 0.25, 3.2), om = 2 * Math.PI * f;
    for (let i = 0; i < 2; i++) {
      const goal = WIND_K * sens * (i === 0 ? w[0] : w[2]) * speed; // сила ветра ~ v·|v|
      const a = om * om * (goal - s.bend[i]!) - 2 * DAMP * om * s.bendV[i]!;
      s.bendV[i]! += a * dt;
      s.bend[i]! += s.bendV[i]! * dt;
    }
    // трепет листьев: от скорости ветра у кроны, с лёгкой инерцией
    const fl = clamp(speed / 8, 0, 1.5) * Math.min(1.5, s.windSensitivity * (0.5 + 0.5 * s.k.gain));
    s.flutter += (fl - s.flutter) * (1 - Math.exp(-4 * dt));
  },
  state(s) {
    return {
      height: s.height, stage: s.stage, leafDensity: s.leafDensity, leafColor: s.leafColor, autumn: s.autumn, snow: s.snowLoad,
      sway: Math.hypot(s.bend[0], s.bend[1]) * s.height, swayX: s.bend[0] * s.height, swayZ: s.bend[1] * s.height, flutter: s.flutter,
    };
  },
  examples: [
    "const oak = s.add('Tree', { species: 'oak', seed: 7, height: 12 }, { at: 'meadow' })",
    's.at(5).do(oak.to("season", 0.58, { over: 20 }))   // лето → осень',
    's.at(25).do(oak.shedLeaves({ over: 8 }))   // листопад',
    's.at(40).do(oak.to("snow", 1, { over: 6 }))   // снег ложится, если холодно',
    'birch.set("windSensitivity", 2)   // чутче к ветру',
  ],
});
