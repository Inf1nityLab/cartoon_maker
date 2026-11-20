import { z } from 'zod';
import { defineComponent, type Ctx } from '@cartoon/engine';
import { Target, type Vec3 } from '@cartoon/schema';
import { CLIP_NAMES } from './clip.ts';
import { BipedProportions } from './skeleton.ts';
import { STYLE_NAMES, cmdLookAround, cmdStartle, cmdStop, cmdWalkTo, newSim, stepSim, type BipedSim, type Env } from './sim.ts';

const styleEnum = z.enum(STYLE_NAMES as [string, ...string[]]);
export const BipedParams = BipedProportions.extend({
  styleA: styleEnum.default('proud').describe('первый стиль ходьбы (100STYLE или «ual»)'),
  styleB: styleEnum.default('neutral').describe('второй стиль: смешивается с первым по весу style'),
  clip: z.enum(['', ...CLIP_NAMES] as [string, ...string[]]).default('').describe('имя клипа из библиотеки; пусто — ходьба по скорости'),
  speed: z.number().min(0).max(4).default(0).describe('скорость ходьбы вперёд, м/с (ноль — стоит)'),
  style: z.number().min(0).max(1).default(0).describe('вес смешивания стилей: 0 — только styleA, 1 — только styleB'),
  lookAt: z.string().default('').describe('куда смотреть: id места или сущности, «camera», пусто — прямо'),
});
export type BipedParams = z.infer<typeof BipedParams>;

export const BIPED_PRESETS: Record<string, BipedParams> = {
  adult: BipedParams.parse({}),
  tall: BipedParams.parse({ height: 1.95, legLength: 1.08, armLength: 1.04, shoulderWidth: 1.1 }),
  child: BipedParams.parse({ height: 1.15, legLength: 0.9, armLength: 0.92, shoulderWidth: 0.85 }),
  stocky: BipedParams.parse({ height: 1.62, legLength: 0.9, armLength: 0.95, shoulderWidth: 1.3 }),
};

export type BipedSelf = BipedSim & { pos: Vec3; heading: number };

const envOf = (ctx: Ctx): Env => ({ heightAt: (x, z) => ctx.heightAt(x, z), resolve: (ref) => (ref === 'camera' ? ctx.camera.pos : (() => { try { return ctx.resolve(ref); } catch { return null; } })()) });
const sync = (s: BipedSelf, ctx: Ctx): void => { s.pos = [s.x, ctx.heightAt(s.x, s.z), s.z]; s.heading = (((s.yaw * 180) / Math.PI + 180) % 360 + 360) % 360 - 180; };
const r4 = (v: number): number => Math.round(v * 1e4) / 1e4;

export const Biped = defineComponent<BipedParams, BipedSelf>({
  type: 'Biped',
  version: 1,
  describe: 'Двуногое существо со своим скелетом (кости по стандарту VRM). Движения — клипы из разрешённых баз (100STYLE, Quaternius UAL), перенесённые на скелет: ходьба и бег по скорости, смешивание двух стилей, склейка клипов с плавным переходом, слой верха тела (взгляд, оглядывание, отшатывание), стопы не скользят (IK). Ручки: clip, speed, style, lookAt. Глаголы: walkTo, stop, startle, lookAround.',
  params: BipedParams,
  presets: BIPED_PRESETS,
  handles: { clip: {}, speed: { unit: 'м/с' }, style: {}, lookAt: {} },
  actions: {
    walkTo: z.object({ to: Target.describe('куда идти: точка, место или сущность'), speed: z.number().min(0.1).max(4).default(1.2).describe('скорость, м/с') }),
    stop: z.object({}),
    startle: z.object({}),
    lookAround: z.object({}),
  },
  showcase: {
    kind: 'entity', size: 1.0, eye: 0.85, ground: 'flat', defaultPreset: 'adult',
    setups: {
      default: {
        views: {
          // камера едет за персонажем: смещение в осях мира
          front: { at: [0, 0.95, -3.2], look: [0, 0.85, 0], fov: 40, track: true },
          side: { at: [3.2, 0.95, 0], look: [0, 0.85, 0], fov: 40, track: true },
          wide: { at: [2.6, 1.6, -5.5], look: [0, 0.7, 0], fov: 42, track: true },
        },
      },
    },
    demos: [
      {
        title: 'Удивление: шёл → замедлился → замер → отшатнулся → огляделся',
        duration: 10,
        steps: [
          { t: 0.2, action: 'handle.set', args: { handle: 'speed', value: 1.1 } },
          { t: 3.2, action: 'startle', args: {} },
        ],
      },
      {
        title: 'Склейка: шаг → бег (переход 0,3 с)',
        duration: 8,
        steps: [
          { t: 0.2, action: 'handle.set', args: { handle: 'clip', value: 's100.proud.walk' } },
          { t: 3.5, action: 'handle.set', args: { handle: 'clip', value: 's100.proud.run' } },
        ],
      },
      {
        title: 'Смешивание стилей: вес 0 → 1',
        duration: 10,
        steps: [
          { t: 0.2, action: 'handle.set', args: { handle: 'speed', value: 1.0 } },
          { t: 1, action: 'handle.to', args: { handle: 'style', value: 1, over: 6, ease: 'linear' } },
        ],
      },
      {
        title: 'Оглянуться на ходу',
        duration: 8,
        steps: [
          { t: 0.2, action: 'handle.set', args: { handle: 'speed', value: 1.0 } },
          { t: 2, action: 'lookAround', args: {} },
        ],
      },
    ],
  },
  create(ctx, p, spawn) {
    const at = spawn!.at;
    const s = newSim(BipedProportions.parse(p), at[0], at[2], (spawn!.heading * Math.PI) / 180) as BipedSelf;
    s.styleA = p.styleA; s.styleB = p.styleB; s.clip = p.clip; s.speed = p.speed; s.style = p.style; s.lookAt = p.lookAt;
    s.pos = [at[0], 0, at[2]]; s.heading = spawn!.heading;
    // прогрев: сперва пара шагов, чтобы поза и стопы были заполнены
    stepSim(s, 1 / 60, envOf(ctx)); s.t = 0;
    sync(s, ctx);
    return s;
  },
  step(s, dt, ctx) { stepSim(s, dt, envOf(ctx)); sync(s, ctx); },
  onAction(s, name, a, ctx) {
    switch (name) {
      case 'walkTo': { const to = ctx.resolve(a.to); cmdWalkTo(s, to[0], to[2], a.speed); break; }
      case 'stop': cmdStop(s); break;
      case 'startle': cmdStartle(s); s.speed = 0; break;
      case 'lookAround': cmdLookAround(s); break;
    }
  },
  state(s) {
    return {
      speed: r4(s.v), phase: r4(s.phase), clip: s.clip, style: r4(s.style), mode: s.clip ? 'clip' : s.goal ? 'goto' : s.v > 0.05 ? 'walk' : 'idle',
      pinned: s.feet.map((f) => (f.pin ? 1 : 0)), startle: s.startleT >= 0, hips: s.hipsW.map(r4), joints: s.joints.map(r4),
    };
  },
  examples: [
    'person.walkTo({ to: "door", speed: 1.2 })',
    'person.startle()',
    'person.lookAround()',
    'person.stop()',
    'person.set("clip", "s100.proud.run")',
    'person.to("style", 1, { over: 4 })',
  ],
});
