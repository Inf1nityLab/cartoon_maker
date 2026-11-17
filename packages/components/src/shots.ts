import { z } from 'zod';
import { defineShot, type Ctx } from '@cartoon/engine';
import { Target, Vec3 as Vec3Z, type Vec3 } from '@cartoon/schema';

const Common = z.object({
  target: Target,
  side: z.enum(['left', 'right']).default('right'),
  fov: z.number().min(10).max(110).optional(),
  /** Высота точки, куда смотрит камера, над точкой цели, м. Без неё — как раньше (под рост 1–2 м; для мелких героев задают). */
  aim: z.number().min(0).max(30).optional(),
  /** Минимальная высота камеры над землёй, м (по умолчанию 0.6; для мелких героев задают меньше). */
  clearance: z.number().min(0.02).max(5).optional(),
});

/** Точка и курс цели; курс — только у сущностей. */
function focus(ctx: Ctx, target: Target): { p: Vec3; heading: number } {
  const p = ctx.resolve(target);
  let heading = 0;
  if (typeof target === 'string') { try { heading = ctx.entity(target).heading; } catch { /* место: курса нет */ } }
  return { p, heading };
}
const dir = (heading: number): { fwd: Vec3; right: Vec3 } => {
  const r = (heading * Math.PI) / 180;
  const fwd: Vec3 = [Math.sin(r), 0, Math.cos(r)];
  return { fwd, right: [fwd[2], 0, -fwd[0]] };
};
/** Камера не уходит под землю. */
const clamp = (ctx: Ctx, pos: Vec3, min = 0.6): Vec3 => [pos[0], Math.max(pos[1], ctx.heightAt(pos[0], pos[2]) + min), pos[2]];
const ease = (t: number) => { const k = Math.max(0, Math.min(1, t)); return k * k * (3 - 2 * k); };

export const Establishing = defineShot({
  type: 'establishing',
  describe: 'Общий план: высоко и далеко, сзади-сбоку. Показывает, где происходит действие.',
  params: Common.extend({ distance: z.number().min(5).max(200).default(38), height: z.number().min(2).max(100).default(15) }),
  solve(a, ctx) {
    const { p, heading } = focus(ctx, a.target), { fwd, right } = dir(heading);
    const side = a.side === 'left' ? -1 : 1;
    const pos = clamp(ctx, [p[0] - fwd[0] * a.distance * 0.6 + right[0] * side * a.distance * 0.8, p[1] + a.height, p[2] - fwd[2] * a.distance * 0.6 + right[2] * side * a.distance * 0.8]);
    return { pos, target: [p[0], p[1] + 1, p[2]], fov: a.fov ?? 45 };
  },
  examples: ["s.at(0).camera.shot('establishing', { target: spider })"],
});

export const Follow = defineShot({
  type: 'follow',
  describe: 'Камера следует сзади-сбоку на небольшой дистанции.',
  params: Common.extend({ distance: z.number().min(1).max(50).default(8), height: z.number().min(0.2).max(30).default(2.6) }),
  solve(a, ctx) {
    const { p, heading } = focus(ctx, a.target), { fwd, right } = dir(heading);
    const side = a.side === 'left' ? -1 : 1;
    const pos = clamp(ctx, [p[0] - fwd[0] * a.distance + right[0] * side * a.distance * 0.45, p[1] + a.height, p[2] - fwd[2] * a.distance + right[2] * side * a.distance * 0.45], a.clearance);
    return { pos, target: [p[0], p[1] + (a.aim ?? 1), p[2]], fov: a.fov ?? 55 };
  },
  examples: ["s.at(7).camera.shot('follow', { target: spider, side: 'left' })"],
});

export const LowAngle = defineShot({
  type: 'lowAngle',
  describe: 'Низкая точка спереди-сбоку, снизу вверх: существо выглядит крупным.',
  params: Common.extend({ distance: z.number().min(1).max(50).default(7) }),
  solve(a, ctx) {
    const { p, heading } = focus(ctx, a.target), { fwd, right } = dir(heading);
    const side = a.side === 'left' ? -1 : 1;
    const pos = clamp(ctx, [p[0] + fwd[0] * a.distance * 0.8 + right[0] * side * a.distance * 0.5, p[1] + 0.4, p[2] + fwd[2] * a.distance * 0.8 + right[2] * side * a.distance * 0.5]);
    return { pos, target: [p[0], p[1] + 1.6, p[2]], fov: a.fov ?? 60 };
  },
  examples: ["s.at(12).camera.shot('lowAngle', { target: spider })"],
});

export const Orbit = defineShot({
  type: 'orbit',
  describe: 'Камера кружит вокруг цели с постоянной скоростью (градусов в секунду).',
  params: Common.extend({ distance: z.number().min(1).max(80).default(10), height: z.number().min(0.2).max(40).default(4), speed: z.number().min(-90).max(90).default(14) }),
  solve(a, ctx, t) {
    const { p } = focus(ctx, a.target);
    const ang = ((a.speed * t + (a.side === 'left' ? 180 : 0)) * Math.PI) / 180;
    const pos = clamp(ctx, [p[0] + Math.sin(ang) * a.distance, p[1] + a.height, p[2] + Math.cos(ang) * a.distance], a.clearance);
    return { pos, target: [p[0], p[1] + (a.aim ?? 1), p[2]], fov: a.fov ?? 50 };
  },
  examples: ["s.at(20).camera.shot('orbit', { target: spider, speed: 20 })"],
});

export const Closeup = defineShot({
  type: 'closeup',
  describe: 'Крупный план. on: "eyes" — на голову, иначе на корпус.',
  params: Common.extend({ distance: z.number().min(0.5).max(30).default(8), on: z.enum(['eyes', 'body']).default('body') }),
  solve(a, ctx) {
    const { p, heading } = focus(ctx, a.target), { fwd, right } = dir(heading);
    const side = a.side === 'left' ? -1 : 1;
    const h = a.aim ?? (a.on === 'eyes' ? 1.6 : 1.3);
    const pos = clamp(ctx, [p[0] + fwd[0] * a.distance + right[0] * side * a.distance * 0.35, p[1] + h, p[2] + fwd[2] * a.distance + right[2] * side * a.distance * 0.35], a.clearance);
    return { pos, target: [p[0], p[1] + h * 0.9, p[2]], fov: a.fov ?? 32 };
  },
  examples: ["s.at(29).camera.shot('closeup', { target: spider, on: 'eyes' })"],
});

export const Crane = defineShot({
  type: 'crane',
  describe: 'Кран: камера поднимается вверх, открывая окружение. duration — за сколько секунд.',
  params: Common.extend({
    distance: z.number().min(2).max(100).default(16),
    from: z.number().min(0.3).max(60).default(2),
    to: z.number().min(0.3).max(120).default(26),
    duration: z.number().min(0.5).max(120).default(10),
  }),
  solve(a, ctx, t) {
    const { p, heading } = focus(ctx, a.target), { fwd, right } = dir(heading);
    const side = a.side === 'left' ? -1 : 1;
    const h = a.from + (a.to - a.from) * ease(t / a.duration);
    const pos = clamp(ctx, [p[0] - fwd[0] * a.distance + right[0] * side * a.distance * 0.5, p[1] + h, p[2] - fwd[2] * a.distance + right[2] * side * a.distance * 0.5]);
    return { pos, target: [p[0], p[1] + 1, p[2]], fov: a.fov ?? 48 };
  },
  examples: ["s.at(50).camera.shot('crane', { target: spider, to: 30, duration: 8 })"],
});

export const Fixed = defineShot({
  type: 'fixed',
  describe: 'Камера в заданной точке и смотрит в заданную точку, опционально едет по прямой. Высоты — над землёй (aboveGround) или абсолютные.',
  params: z.object({
    at: Vec3Z.describe('[x, высота, z], м'),
    look: Vec3Z.describe('куда смотрит [x, высота, z], м'),
    aboveGround: z.boolean().default(true).describe('высоты отсчитываются от земли под точкой'),
    velocity: z.tuple([z.number(), z.number()]).default([0, 0]).describe('скорость по земле [vx, vz], м/с: камера и точка взгляда едут вместе'),
    fov: z.number().min(10).max(110).default(50),
  }),
  solve(a, ctx, t) {
    const at = (p: Vec3): Vec3 => {
      const x = p[0] + a.velocity[0] * t, zz = p[2] + a.velocity[1] * t;
      return [x, a.aboveGround ? ctx.heightAt(x, zz) + p[1] : p[1], zz];
    };
    return { pos: at(a.at), target: at(a.look), fov: a.fov };
  },
  examples: ["s.at(0).camera.shot('fixed', { at: [0, 0.5, -18], look: [0, 0.4, 0], velocity: [0, 2] })"],
});
