import { z } from 'zod';
import { defineComponent, type Ctx } from '@cartoon/engine';
import { Target, type Vec3 } from '@cartoon/schema';
import { RobotParams, ROBOT_PRESETS, robotDims } from './params.ts';
import { clamp, newDyn, smooth, stepDyn, wrapPi, type Dyn } from './dynamics.ts';

/** Куда смотрит голова / рука: точка, id места или сущности, 'camera', null — нет цели. Хранится данными. */
type Ref = Vec3 | string | null;

/**
 * Состояние робота: только числа, строки, массивы (кладётся в чекпоинты).
 * Единицы: heading — градусы (как у всех сущностей, 0 = +Z, растёт влево), все остальные углы — радианы
 * (в WorldState они выходят градусами, см. state()).
 */
export type RobotSelf = {
  pos: Vec3; heading: number;
  geo: { scale: number; wheelR: number; halfTrack: number; headH: number; reach: number };
  // движение
  mode: 'idle' | 'roll' | 'turn';
  goal: Vec3 | null; turnRef: Ref; goalHeading: number | null;
  cruise: number; accelMax: number; decelMax: number; turnRate: number; // м/с, м/с², м/с², рад/с
  speed: number; acc: number; yawRate: number;
  dyn: Dyn;
  // земля под колёсами
  pitch: number; roll: number;
  // голова
  lookRef: Ref; yawCmd: number; pitchCmd: number; rollCmd: number;
  headYaw: number; headYawV: number; headPitch: number; headPitchV: number; headRoll: number; headRollV: number;
  // глаз
  glare: number; // яркость света в лицо 0…1 (из сил мира)
  squint: number; squintTarget: number; squintUntil: number;
  blinkAt: number; blinkDur: number; lid: number; // lid — итоговое раскрытие века 0..1
  wide: number; wideTarget: number; wideUntil: number;
  startledUntil: number; startled: boolean;
  // ручки облика и связей с силами мира
  lightColor: string; windSensitivity: number; lightSensitivity: number;
  // луч
  scanOn: boolean; scan: number;
  // рука
  armMode: 'fold' | 'side' | 'ref'; armRef: Ref; armReach: number; armRate: number; armTarget: Vec3; grip: number; gripTarget: number;
};

const DEG = 180 / Math.PI;
const YAW_ACC = 10; // рад/с²: как быстро корпус набирает скорость поворота
const IDLE_DECEL = 2; // м/с²: сама остановка без цели
const JERK = 10; // м/с³: плавность ускорения (иначе наклон дёргается)
const HEAD_W = 13; // рад/с: пружина головы
const WIND_GAIN = 0.006; // рад изгиба антенны на (м/с)²
const GLARE_FROM = 0.2, GLARE_TO = 0.65; // косинус угла между взглядом и солнцем: с него прищур начинается, на нём — полный
const LOOK_YAW = 1.9, LOOK_PITCH = 0.6; // пределы головы, рад

const bearing = (from: Vec3, to: Vec3): number => Math.atan2(to[0] - from[0], to[2] - from[2]);

/** Критически-демпфированная пружина (полунеявный Эйлер). Возвращает ускорение. */
function spring(x: number, v: number, to: number, w: number, dt: number): [number, number, number] {
  const a = w * w * (to - x) - 2 * w * v;
  const nv = v + a * dt;
  return [x + nv * dt, nv, a];
}
const ease = (x: number, to: number, k: number, dt: number): number => x + (to - x) * (1 - Math.exp(-k * dt));

function resolveRef(ctx: Ctx, ref: Ref): Vec3 | null {
  if (ref === null) return null;
  if (ref === 'camera') return ctx.camera.pos;
  return ctx.resolve(ref);
}

/** Робот стоит на земле: высота, наклон вдоль пути и вбок по высотам под колёсами. */
function ground(s: RobotSelf, ctx: Ctx): void {
  const h = (s.heading * Math.PI) / 180;
  const sh = Math.sin(h), ch = Math.cos(h), b = s.geo.halfTrack, e = 0.12 * s.geo.scale;
  const hL = ctx.heightAt(s.pos[0] + ch * b, s.pos[2] - sh * b), hR = ctx.heightAt(s.pos[0] - ch * b, s.pos[2] + sh * b);
  const hF = ctx.heightAt(s.pos[0] + sh * e, s.pos[2] + ch * e), hB = ctx.heightAt(s.pos[0] - sh * e, s.pos[2] - ch * e);
  s.pos[1] = (hL + hR) / 2;
  s.pitch = -Math.atan2(hF - hB, 2 * e) * 0.6 + 0; // +0: без -0 в чекпоинтах
  s.roll = Math.atan2(hL - hR, 2 * b);
}

const Ang = (name: string) => z.number().describe(name);
const blank = (m: string, path: string) => ({ message: m, path: [path] });

const Actions = {
  roll: z.object({
    to: Target.describe('куда ехать: точка, место или сущность'),
    speed: z.number().min(0.05).max(3).default(0.6).describe('крейсерская скорость, м/с'),
    accel: z.number().min(0.1).max(5).default(1).describe('разгон, м/с²'),
    decel: z.number().min(0.1).max(5).default(1.5).describe('торможение, м/с²'),
    turnRate: z.number().min(10).max(360).default(140).describe('предельная скорость поворота, °/с'),
  }),
  turn: z.object({
    to: Target.optional().describe('развернуться лицом к точке, месту или сущности'),
    heading: Ang('развернуться на курс, градусы (0 = +Z)').optional(),
    rate: z.number().min(10).max(360).default(120).describe('скорость поворота, °/с'),
  }).refine((a) => (a.to === undefined) !== (a.heading === undefined), blank('нужно задать одно из двух: to (точка) или heading (градусы)', 'to')),
  stop: z.object({}),
  look: z.object({
    target: z.union([Target, z.literal('camera')]).nullable().optional().describe('куда смотреть; null или без — прямо'),
    yaw: z.number().min(-110).max(110).optional().describe('поворот головы влево, °, если цели нет'),
    pitch: z.number().min(-35).max(35).optional().describe('наклон взгляда вверх, °, если цели нет'),
  }),
  tilt: z.object({ angle: z.number().min(-45).max(45).default(20).describe('наклон головы к левому уху, °') }),
  blink: z.object({ duration: z.number().min(0.08).max(1).default(0.22).describe('длительность моргания, с') }),
  squint: z.object({
    amount: z.number().min(0).max(0.9).default(0.35).describe('насколько открыт глаз, 0 закрыт'),
    hold: z.number().min(0).max(30).default(0.8).describe('сколько держать, с'),
  }),
  wide: z.object({
    amount: z.number().min(0).max(1).default(1).describe('насколько расширить зрачок'),
    hold: z.number().min(0).max(30).default(0.8).describe('сколько держать, с'),
  }),
  scan: z.object({
    on: z.boolean().default(true).describe('луч включён'),
    target: z.union([Target, z.literal('camera')]).nullable().optional().describe('куда светить (голова повернётся), без цели — куда смотрит'),
  }),
  reach: z.object({
    to: Target.nullable().optional().describe('куда тянуть руку; без цели — к земле у левого бока, null — сложить'),
    grip: z.number().min(0).max(1).default(0.9).describe('раскрытие захвата'),
    duration: z.number().min(0.2).max(5).default(0.9).describe('за сколько секунд, с'),
  }),
  startle: z.object({ intensity: z.number().min(0.1).max(1.5).default(1).describe('сила испуга') }),
};

export const Robot = defineComponent<RobotParams, RobotSelf>({
  type: 'Robot',
  version: 2,
  describe: 'Колёсный робот-исследователь (семейство Biped не нужно: два колеса на оси). Катится, сам балансирует корпус, гибкая антенна (качается от ветра), один большой глаз с веком и зрачком (щурится от яркого света в лицо), рука с захватом, луч сканера. Ручки: lightColor, windSensitivity, lightSensitivity. Слушает силы мира: ветер и свет.',
  // v2: добавлены windSensitivity и lightSensitivity (со значениями по умолчанию); старые сцены читаются как есть
  migrate: { 1: (p: Record<string, unknown>) => p },
  handles: { lightColor: {}, windSensitivity: {}, lightSensitivity: {} },
  params: RobotParams,
  presets: ROBOT_PRESETS,
  actions: Actions,
  showcase: {
    kind: 'entity', size: 0.34, eye: 0.2, ground: 'flat',
    demos: [{
      title: 'Огни меняют цвет, ветер качает антенну, свет бьёт в глаз',
      duration: 12,
      steps: [
        { t: 0.5, action: 'handle.to', args: { handle: 'lightColor', value: '#ff5a5a', over: 2.5, ease: 'ease-in-out' } },
        { t: 3.5, action: 'handle.to', args: { handle: 'lightColor', value: '#59fff3', over: 2, ease: 'ease-in-out' } },
        { t: 5, action: 'handle.set', args: { handle: 'windSensitivity', value: 2.5 } },
        { t: 6, action: 'blink', args: {} },
        { t: 8, action: 'look', args: { target: 'camera' } },
        { t: 10, action: 'startle', args: { intensity: 0.8 } },
      ],
    }],
  },
  create(ctx, p, spawn) {
    const d = robotDims(p), at = spawn!.at;
    const s: RobotSelf = {
      pos: [at[0], 0, at[2]], heading: spawn!.heading,
      geo: { scale: d.scale, wheelR: d.wheelR * d.scale, halfTrack: d.wheelX * d.scale, headH: d.headH * d.scale, reach: 0.25 * d.scale },
      mode: 'idle', goal: null, turnRef: null, goalHeading: null,
      cruise: 0, accelMax: 1, decelMax: 1.5, turnRate: 2.4,
      speed: 0, acc: 0, yawRate: 0, dyn: newDyn(), pitch: 0, roll: 0,
      lookRef: null, yawCmd: 0, pitchCmd: 0, rollCmd: 0,
      headYaw: 0, headYawV: 0, headPitch: 0, headPitchV: 0, headRoll: 0, headRollV: 0,
      glare: 0, squint: 1, squintTarget: 1, squintUntil: 0, blinkAt: -1, blinkDur: 0.22, lid: 1,
      wide: 0, wideTarget: 0, wideUntil: 0, startledUntil: 0, startled: false,
      lightColor: p.lightColor, windSensitivity: p.windSensitivity, lightSensitivity: p.lightSensitivity,
      scanOn: false, scan: 0,
      armMode: 'fold', armRef: null, armReach: 0, armRate: 1 / 0.9, armTarget: [at[0], 0, at[2]], grip: 0.3, gripTarget: 0.3,
    };
    ground(s, ctx);
    return s;
  },
  onAction(s, name, a, ctx) {
    const t = ctx.time;
    switch (name) {
      case 'roll':
        s.mode = 'roll'; s.goal = [...ctx.resolve(a.to)] as Vec3; s.cruise = a.speed; s.accelMax = a.accel; s.decelMax = a.decel; s.turnRate = (a.turnRate * Math.PI) / 180;
        break;
      case 'turn':
        s.mode = 'turn'; s.goal = null; s.turnRate = (a.rate * Math.PI) / 180;
        s.turnRef = a.to === undefined ? null : a.to; s.goalHeading = a.heading === undefined ? null : a.heading;
        break;
      case 'stop': s.mode = 'idle'; s.goal = null; break;
      case 'look':
        s.lookRef = a.target ?? null; s.yawCmd = ((a.yaw ?? 0) * Math.PI) / 180; s.pitchCmd = ((a.pitch ?? 0) * Math.PI) / 180;
        break;
      case 'tilt': s.rollCmd = (a.angle * Math.PI) / 180; break;
      case 'blink': s.blinkAt = t; s.blinkDur = a.duration; break;
      case 'squint': s.squintTarget = a.amount; s.squintUntil = t + a.hold; break;
      case 'wide': s.wideTarget = a.amount; s.wideUntil = t + a.hold; break;
      case 'scan':
        s.scanOn = a.on;
        if (a.on && a.target !== undefined && a.target !== null) s.lookRef = a.target;
        break;
      case 'reach':
        s.armMode = a.to === undefined ? 'side' : a.to === null ? 'fold' : 'ref';
        s.armRef = a.to === undefined ? null : a.to;
        s.armRate = 1 / a.duration;
        s.gripTarget = a.to === null ? 0.3 : a.grip;
        break;
      case 'startle': {
        const k = a.intensity;
        s.dyn.tv -= 1.6 * k; s.dyn.fv += 6 * k; s.dyn.sv += 3 * k;
        s.headPitchV += 3 * k;
        s.wideTarget = 1; s.wideUntil = t + 0.6 + 0.6 * k; s.squintTarget = 1; s.squintUntil = 0; s.blinkAt = -1;
        s.startledUntil = s.wideUntil;
        break;
      }
    }
  },
  step(s, dt, ctx) {
    const t = ctx.time, g = s.geo;
    // ---- голова: цель взгляда → углы относительно корпуса
    let yawT = s.yawCmd, pitchT = s.pitchCmd;
    const lp = resolveRef(ctx, s.lookRef);
    if (lp) {
      const eye: Vec3 = [s.pos[0], s.pos[1] + g.headH, s.pos[2]];
      const rel = wrapPi(bearing(eye, lp) - (s.heading * Math.PI) / 180);
      yawT = clamp(rel, -LOOK_YAW, LOOK_YAW);
      pitchT = clamp(Math.atan2(lp[1] - eye[1], Math.hypot(lp[0] - eye[0], lp[2] - eye[2])), -LOOK_PITCH, LOOK_PITCH);
    }
    let ha = 0;
    [s.headYaw, s.headYawV, ha] = spring(s.headYaw, s.headYawV, yawT, HEAD_W, dt);
    [s.headPitch, s.headPitchV] = spring(s.headPitch, s.headPitchV, pitchT, HEAD_W, dt);
    [s.headRoll, s.headRollV] = spring(s.headRoll, s.headRollV, s.rollCmd, HEAD_W, dt);

    // ---- движение: целевая скорость и целевая скорость поворота
    let vT = 0, wT = 0, decel = IDLE_DECEL, ff = 0, arrived = false;
    const h = (s.heading * Math.PI) / 180;
    if (s.mode === 'roll' && s.goal) {
      const dx = s.goal[0] - s.pos[0], dz = s.goal[2] - s.pos[2], dist = Math.hypot(dx, dz);
      const err = wrapPi(Math.atan2(dx, dz) - h);
      wT = clamp(err * 5, -s.turnRate, s.turnRate);
      decel = s.decelMax;
      const brake = Math.sqrt(2 * 0.7 * s.decelMax * dist);
      // у цели скорость следует кривой торможения v = √(2·a·d); её производная (-a) идёт в ускорение заранее, иначе лаг догоняет цель на ходу
      if (brake < s.cruise) ff = -0.7 * s.decelMax;
      vT = Math.min(s.cruise, brake) * clamp(1 - Math.abs(err) / 0.9, 0, 1);
      if (dist < 0.004) arrived = true;
    } else if (s.mode === 'turn') {
      const to = resolveRef(ctx, s.turnRef);
      const goalH = to ? bearing(s.pos, to) : ((s.goalHeading ?? s.heading) * Math.PI) / 180;
      const e = wrapPi(goalH - h);
      wT = clamp(e * 5, -s.turnRate, s.turnRate);
      if (Math.abs(e) < 0.01 && Math.abs(s.yawRate) < 0.1) { s.heading = (goalH * DEG + 720) % 360; s.yawRate = 0; wT = 0; s.mode = 'idle'; s.turnRef = null; }
    }
    const aT = clamp((vT - s.speed) * 5 + ff, -decel * 1.5, s.accelMax);
    s.acc += clamp(aT - s.acc, -JERK * dt, JERK * dt);
    s.speed += s.acc * dt;
    if (s.speed < 0) { s.speed = 0; s.acc = 0; }
    const yawOld = s.yawRate;
    s.yawRate += clamp(wT - s.yawRate, -YAW_ACC * dt, YAW_ACC * dt);
    s.heading = (((s.heading + s.yawRate * dt * DEG) % 360) + 360) % 360;
    const hn = (s.heading * Math.PI) / 180;
    s.pos[0] += Math.sin(hn) * s.speed * dt; s.pos[2] += Math.cos(hn) * s.speed * dt;
    if (s.mode === 'roll' && s.goal && !arrived) {
      const dist = Math.hypot(s.goal[0] - s.pos[0], s.goal[2] - s.pos[2]);
      if (dist <= Math.max(s.speed * dt, 0.004)) arrived = true;
    }
    if (arrived && s.goal) { s.pos[0] = s.goal[0]; s.pos[2] = s.goal[2]; s.speed = 0; s.acc = 0; s.mode = 'idle'; s.goal = null; }
    ground(s, ctx);

    // ---- наклон корпуса, антенна, колёса
    // ветер в точке антенны (6.6): в систему корпуса — вперёд и влево; сила ~ v·|v|, как у настоящего сопротивления
    const wv = ctx.wind([s.pos[0], s.pos[1] + g.headH, s.pos[2]]);
    const wFwd = wv[0] * Math.sin(hn) + wv[2] * Math.cos(hn), wLeft = wv[0] * Math.cos(hn) - wv[2] * Math.sin(hn);
    stepDyn(s.dyn, { windF: WIND_GAIN * s.windSensitivity * wFwd * Math.abs(wFwd), windS: WIND_GAIN * s.windSensitivity * wLeft * Math.abs(wLeft), speed: s.speed, accel: s.acc, yawRate: s.yawRate, yawAcc: (s.yawRate - yawOld) / dt, headAcc: ha, wheelR: g.wheelR, halfTrack: g.halfTrack, headH: g.headH }, dt);

    // ---- глаз
    if (t >= s.squintUntil) s.squintTarget = 1;
    if (t >= s.wideUntil) s.wideTarget = 0;
    // яркий свет в лицо (6.6): солнце спереди и над горизонтом → прищур, сила — по яркости в точке (облака и тень рельефа учтены)
    const eyeP: Vec3 = [s.pos[0], s.pos[1] + g.headH, s.pos[2]], lt = ctx.light(eyeP);
    const faceA = hn + s.headYaw, face: Vec3 = [Math.sin(faceA), 0, Math.cos(faceA)];
    const toSun = face[0] * lt.sunDir[0] + face[2] * lt.sunDir[2];
    const glare = smooth(GLARE_FROM, GLARE_TO, toSun) * Math.min(1, lt.sun * 1.1) * s.lightSensitivity;
    s.glare = glare;
    s.squint = ease(s.squint, Math.min(s.squintTarget, 1 - 0.75 * glare), 14, dt);
    s.wide = ease(s.wide, s.wideTarget, 12, dt);
    if (s.blinkAt >= 0 && t - s.blinkAt >= s.blinkDur) s.blinkAt = -1;
    // веко: закрывается за первую треть, открывается к концу (форма как в песочнице)
    const u = s.blinkAt >= 0 ? (t - s.blinkAt) / s.blinkDur : 2;
    s.lid = s.squint * (1 - (smooth(0, 0.32, u) - smooth(0.45, 1, u)));
    s.startled = t < s.startledUntil;

    // ---- луч
    s.scan = ease(s.scan, s.scanOn ? 1 : 0, 9, dt);
    if (!s.scanOn && s.scan < 0.002) s.scan = 0;

    // ---- рука: цель в мире (для вида), раскрытие
    s.armReach = clamp(s.armReach + (s.armMode === 'fold' ? -1 : 1) * s.armRate * dt, 0, 1);
    if (s.armMode === 'side') {
      const sh = Math.sin(hn), ch = Math.cos(hn), out = g.reach;
      const tx = s.pos[0] + ch * out + sh * 0.09 * g.scale, tz = s.pos[2] - sh * out + ch * 0.09 * g.scale;
      s.armTarget = [tx, ctx.heightAt(tx, tz), tz];
    } else if (s.armMode === 'ref') {
      const p = resolveRef(ctx, s.armRef);
      if (p) s.armTarget = [p[0], p[1], p[2]];
    }
    s.grip = ease(s.grip, s.gripTarget, 6, dt);
  },
  state(s) {
    return {
      action: s.startled ? 'startled' : s.mode === 'roll' ? 'rolling' : s.mode === 'turn' ? 'turning' : s.speed > 0.02 ? 'braking' : 'standing',
      speed: s.speed, accel: s.acc,
      tilt: s.dyn.tilt * DEG,
      groundPitch: s.pitch * DEG, groundRoll: s.roll * DEG,
      headYaw: s.headYaw * DEG, headPitch: s.headPitch * DEG, headRoll: s.headRoll * DEG,
      eyeOpen: s.lid, ...(s.glare > 0 ? { glare: s.glare } : {}), eyeWide: s.wide, blinking: s.blinkAt >= 0,
      scan: s.scan, armReach: s.armReach, armTarget: [...s.armTarget], grip: s.grip,
      antenna: [s.dyn.antF * DEG, s.dyn.antS * DEG],
      wheels: [s.dyn.wheelL * DEG, s.dyn.wheelR * DEG],
      startled: s.startled,
    };
  },
  examples: [
    'robot.roll({ to: [3, 0, 0], speed: 1, accel: 1.2, decel: 1.5 })',
    'robot.look({ target: "camera" })',
    'robot.blink({})',
    'robot.reach({})',
    'robot.scan({ on: true })',
    'robot.startle({ intensity: 1 })',
  ],
});
