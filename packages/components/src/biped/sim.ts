import { B, BONES, NB, PARENT, TIPS, fk, hipsHeight, restOffsets, type Proportions } from './skeleton.ts';
import { CLIPS, clipOf, sampleClip, type Clip } from './clip.ts';
import { blendPose, layerPose, newPose, type Pose } from './pose.ts';
import { legIK, newFoot, stepFoot, type Foot } from './ik.ts';
import { eulerXYZ, fromAxisAngle, mul, rotate, slerp, yawQ } from './quat.ts';

/**
 * Ядро движения Biped: чистое состояние (числа и массивы) и шаг `stepSim(s, dt, env)`. Всё — функция истории с фиксированным шагом,
 * без часов и случайности: перемотка = проигрывание с чекпоинта. Те же функции используют компонент и тесты (`runPlan`).
 */

export type Vec3 = [number, number, number];
export type Env = { heightAt(x: number, z: number): number; resolve(ref: string): Vec3 | null };

export type BipedSim = {
  t: number;
  prop: Proportions;
  // положение
  x: number; z: number; yaw: number; v: number;
  goal: [number, number] | null; goalSpeed: number;
  // управление
  clip: string; speed: number; style: number; styleA: string; styleB: string; lookAt: string;
  phase: number;
  /** явные клипы с весами (переход «склейка»): первый — самый старый */
  fades: { c: string; t: number; w: number }[];
  xfade: number;
  // события-слои
  startleT: number; lookT: number;
  lookYaw: number; lookYawV: number; lookPitch: number; lookPitchV: number;
  backX: number; // сколько уже отшатнулись назад, м
  feet: Foot[];
  // выход
  pose: number[]; hipsW: number[]; joints: number[]; ends: number[];
  moveSpeed: number;
};

export const STYLE_NAMES: string[] = ['ual', ...Array.from(new Set(Object.keys(CLIPS).filter((n) => n.startsWith('s100.') && n.endsWith('.walk')).map((n) => n.split('.')[1]!)))];

export function tiers(style: string): { idle: Clip; walk: Clip; run: Clip } {
  if (style === 'ual') return { idle: clipOf('ual.idle'), walk: clipOf('ual.walk'), run: clipOf('ual.jog') };
  return { idle: clipOf(`s100.${style}.idle`), walk: clipOf(`s100.${style}.walk`), run: clipOf(`s100.${style}.run`) };
}

export function newSim(prop: Proportions, x: number, z: number, yaw: number): BipedSim {
  return {
    t: 0, prop, x, z, yaw, v: 0, goal: null, goalSpeed: 1.2,
    clip: '', speed: 0, style: 0, styleA: 'proud', styleB: 'neutral', lookAt: '',
    phase: 0, fades: [], xfade: 0.3, startleT: -1, lookT: -1, lookYaw: 0, lookYawV: 0, lookPitch: 0, lookPitchV: 0, backX: 0,
    feet: [newFoot(), newFoot()],
    pose: new Array(NB * 4).fill(0), hipsW: [0, 0, 0], joints: new Array(NB * 3).fill(0), ends: new Array(18).fill(0), moveSpeed: 0,
  };
}

// ---------- мелочи ----------
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
const smooth = (x: number): number => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const wrapPi = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const restCache = new Map<string, Float64Array>();
export function restFor(p: Proportions): Float64Array {
  const key = `${p.height}|${p.legLength}|${p.armLength}|${p.shoulderWidth}`;
  let r = restCache.get(key);
  if (!r) { r = restOffsets(p); restCache.set(key, r); }
  return r;
}
/** Масштаб тела относительно типичного: по высоте таза (длине ног). Скорости и сдвиги клипов умножаем на него. */
export const bodyScale = (p: Proportions): number => hipsHeight(p) / 0.94;

// ---------- смешивание клипов ----------
type Entry = { c: Clip; w: number; t?: number };
const scratch = newPose(), acc = newPose(), accB = newPose(), poseA = newPose(), tmpHit = newPose();

/** Позы записей клипов с весами: петли — по общей фазе, разовые — по своему времени. Результат в out (таз без масштаба). */
function mixEntries(es: Entry[], phase: number, out: Pose): void {
  let sum = 0, first = true;
  for (const e of es) {
    if (e.w <= 1e-4) continue;
    if (e.c.loop) sampleClip(e.c, phase * e.c.duration, scratch.q, scratch.hips); else sampleClip(e.c, e.t ?? 0, scratch.q, scratch.hips);
    if (first) { out.q.set(scratch.q); out.hips.set(scratch.hips); first = false; sum = e.w; } else { sum += e.w; blendPose(out, scratch, e.w / sum, out); }
  }
  if (first) { sampleClip(es[0]!.c, 0, out.q, out.hips); }
}

/** Записи ходьбы одного стиля для скорости v (м/с, уже в метрах тела): простой → шаг → бег; выше бега — тот же бег быстрее. */
function gaitEntries(style: string, v: number, ks: number): { es: Entry[]; rate: number } {
  const t = tiers(style), vw = t.walk.vel * ks, vr = t.run.vel * ks;
  let es: Entry[], vmix: number;
  if (v <= vw) { const w = clamp(v / vw, 0, 1); es = [{ c: t.idle, w: 1 - w }, { c: t.walk, w }]; vmix = w * vw; }
  else if (v <= vr) { const w = clamp((v - vw) / (vr - vw), 0, 1); es = [{ c: t.walk, w: 1 - w }, { c: t.run, w }]; vmix = (1 - w) * vw + w * vr; }
  else { es = [{ c: t.run, w: 1 }]; vmix = vr; }
  const rate = v < 0.02 ? 1 : clamp(v / Math.max(vmix, 1e-3), 0.5, 1.7);
  return { es, rate };
}
const durOf = (es: Entry[]): number => es.reduce((a, e) => a + e.w * e.c.duration, 0) / (es.reduce((a, e) => a + e.w, 0) || 1);

// ---------- слои верха тела ----------
const ARMS_UP: Record<string, number[]> = {};
const ARM = { a: -88, b: -2, c: -28, e: -125 }; // градусы: плечо вниз, вперёд, внутрь, сгиб локтя
/** «Руки к груди»: заданные локальные повороты плеч, рук, предплечий и кистей. */
function armsToChest(): Record<string, number[]> {
  if (ARMS_UP.leftUpperArm) return ARMS_UP;
  const d = Math.PI / 180;
  ARMS_UP.leftShoulder = eulerXYZ(0, 0, 8 * d); ARMS_UP.rightShoulder = eulerXYZ(0, 0, -8 * d);
  // подобрано перебором углов: локоть у бока чуть вперёд, кисть перед грудью (скрипт подбора — в отчёте задачи)
  ARMS_UP.leftUpperArm = mul(eulerXYZ(ARM.b * d, ARM.c * d, 0), eulerXYZ(0, 0, ARM.a * d)); ARMS_UP.rightUpperArm = mul(eulerXYZ(ARM.b * d, -ARM.c * d, 0), eulerXYZ(0, 0, -ARM.a * d));
  ARMS_UP.leftLowerArm = eulerXYZ(0, ARM.e * d, 0); ARMS_UP.rightLowerArm = eulerXYZ(0, -ARM.e * d, 0);
  ARMS_UP.leftHand = eulerXYZ(0, 0, 0); ARMS_UP.rightHand = eulerXYZ(0, 0, 0);
  return ARMS_UP;
}

const SWEEP: [number, number][] = [[0, 0], [0.45, 1], [1.0, 1], [1.7, -1], [2.25, -1], [2.9, 0]];
/** Поворот головы «оглядеться»: −1…1 по ключам с плавными переходами. */
function sweep(u: number): number {
  if (u <= 0) return 0;
  for (let i = 1; i < SWEEP.length; i++) {
    const a = SWEEP[i - 1]!, b = SWEEP[i]!;
    if (u <= b[0]) return a[1] + (b[1] - a[1]) * smooth((u - a[0]) / (b[0] - a[0]));
  }
  return 0;
}
export const STARTLE = { recoilAt: 0.9, back: 0.09, lookAt: 1.9, lookFor: 2.9, hit: 0.35 };
export const LOOK_AROUND = { dur: 2.9, amp: 1.0 };

function addLocal(q: Float64Array, bone: number, dq: number[]): void {
  const o = [0, 0, 0, 1];
  const a = Array.from(q.subarray(bone * 4, bone * 4 + 4));
  const m = mul(a, dq); o[0] = m[0]; o[1] = m[1]; o[2] = m[2]; o[3] = m[3];
  q.set(o, bone * 4);
}

/** Накладывает на позу слои верха тела: отшатывание (клип «удар в грудь» + процедура), взгляд и оглядывание. */
function overlays(s: BipedSim, env: Env, pose: Pose, k: number): { backVel: number } {
  let backVel = 0;
  const d = Math.PI / 180;
  let sweepYaw = 0;
  if (s.startleT >= 0) {
    const T = s.t - s.startleT, u = T - STARTLE.recoilAt;
    if (u > -0.2) {
      const r = smooth(u / 0.1) * (1 - smooth((u - 0.5) / 0.7));
      const a = smooth((u + 0.05) / 0.15) * (1 - smooth((u - 0.95) / 0.5));
      // готовый кусок: «удар в грудь» поверх позвоночника и головы
      const hit = clipOf('ual.hit-chest');
      sampleClip(hit, clamp(u, 0, hit.duration), tmpHit.q, tmpHit.hips);
      layerPose(pose, tmpHit, [B.spine, B.chest, B.upperChest, B.neck, B.head], 0.75 * r);
      // процедура: корпус назад, подбородок вверх, плечи вверх
      addLocal(pose.q, B.spine, eulerXYZ(-5 * d * r, 0, 0)); addLocal(pose.q, B.chest, eulerXYZ(-8 * d * r, 0, 0)); addLocal(pose.q, B.upperChest, eulerXYZ(-7 * d * r, 0, 0));
      addLocal(pose.q, B.neck, eulerXYZ(-5 * d * r, 0, 0)); addLocal(pose.q, B.head, eulerXYZ(-7 * d * r, 0, 0));
      const arms = armsToChest();
      for (const [name, tq] of Object.entries(arms)) { const b = B[name as keyof typeof B]; slerp(pose.q, b * 4, tq, 0, a, pose.q, b * 4); }
      // отступить на полшага назад
      const dist = STARTLE.back * k, now = dist * smooth((u + 0.05) / 0.3) * (1 - smooth((u - 0.7) / 0.6));
      backVel = (now - s.backX) ;
      pose.hips[1] = pose.hips[1]! - 0.015 * k * r;
    }
    const lu = T - STARTLE.lookAt;
    if (lu > 0) sweepYaw += sweep(lu) * 1.05;
    if (T > STARTLE.lookAt + STARTLE.lookFor + 0.5) s.startleT = -1;
  }
  if (s.lookT >= 0) {
    const lu = s.t - s.lookT;
    sweepYaw += sweep(lu) * LOOK_AROUND.amp;
    if (lu > LOOK_AROUND.dur + 0.1) s.lookT = -1;
  }
  // взгляд на цель
  let wantYaw = 0, wantPitch = 0;
  if (s.lookAt !== '') {
    const p = env.resolve(s.lookAt);
    if (p) {
      const hy = s.hipsW[1]! + 0.65 * k;
      const dx = p[0] - s.x, dz = p[2] - s.z, dist = Math.hypot(dx, dz);
      wantYaw = clamp(wrapPi(Math.atan2(dx, dz) - s.yaw), -1.25, 1.25);
      wantPitch = clamp(Math.atan2(p[1] - hy, Math.max(dist, 0.3)), -0.5, 0.6);
    }
  }
  const dt = 1 / 60;
  const w = 12;
  const ay = w * w * (wantYaw - s.lookYaw) - 2 * w * s.lookYawV; s.lookYawV += ay * dt; s.lookYaw += s.lookYawV * dt;
  const ap = w * w * (wantPitch - s.lookPitch) - 2 * w * s.lookPitchV; s.lookPitchV += ap * dt; s.lookPitch += s.lookPitchV * dt;
  const yaw = s.lookYaw + sweepYaw * 1.0, pitch = s.lookPitch;
  if (Math.abs(yaw) > 1e-4 || Math.abs(pitch) > 1e-4) {
    const parts: [number, number][] = [[B.chest, 0.15], [B.upperChest, 0.2], [B.neck, 0.3], [B.head, 0.35]];
    for (const [b, f] of parts) addLocal(pose.q, b, mul(fromAxisAngle(0, 1, 0, yaw * f), fromAxisAngle(1, 0, 0, -pitch * f)));
  }
  return { backVel };
}

// ---------- шаг ----------
const wp = new Float64Array(NB * 3), wq = new Float64Array(NB * 4), q2 = new Float64Array(NB * 4);
const ACC = 2.2, DEC = 3.6, TURN = 3.6;

export function stepSim(s: BipedSim, dt: number, env: Env): void {
  const rest = restFor(s.prop), ks = bodyScale(s.prop);
  s.t += dt;
  const explicit = s.clip !== '';
  // 1. куда идём
  let vt = explicit ? 0 : s.speed;
  const halting = s.startleT >= 0 && s.t - s.startleT < STARTLE.recoilAt + 1.2;
  if (s.goal) {
    const dx = s.goal[0] - s.x, dz = s.goal[1] - s.z, dist = Math.hypot(dx, dz);
    const err = wrapPi(Math.atan2(dx, dz) - s.yaw);
    const step = TURN * dt;
    if (dist > 0.05) s.yaw += clamp(err, -step, step);
    vt = Math.min(s.goalSpeed, Math.sqrt(2 * DEC * 0.8 * dist));
    vt *= clamp(1 - Math.abs(err) / 1.6, 0.12, 1);
    if (dist < 0.06) { s.goal = null; s.speed = 0; vt = 0; }
  }
  if (halting) vt = 0;
  // явный клип: скорость берёт из записи
  // 2. записи для смешивания
  let es: Entry[];
  if (explicit) {
    if (s.fades.length === 0 || s.fades[s.fades.length - 1]!.c !== s.clip) s.fades.push({ c: s.clip, t: 0, w: s.fades.length ? 0 : 1 });
    const last = s.fades[s.fades.length - 1]!;
    const others = s.fades.slice(0, -1), osum = others.reduce((a, f) => a + f.w, 0);
    last.w = Math.min(1, last.w + dt / s.xfade);
    for (const f of others) f.w = osum > 0 ? (1 - last.w) * (f.w / osum) : 0;
    s.fades = s.fades.filter((f, i) => i === s.fades.length - 1 || f.w > 0.002);
    const tot = s.fades.reduce((a, f) => a + f.w, 0) || 1;
    for (const f of s.fades) f.w /= tot;
    for (const f of s.fades) f.t += dt;
    es = s.fades.map((f) => ({ c: clipOf(f.c), w: f.w / tot, t: f.t }));
    const vc = es.reduce((a, e) => a + (e.c.loop ? e.w * e.c.vel * ks : 0), 0);
    vt = vc;
    s.phase = (s.phase + dt / durOf(es.filter((e) => e.c.loop).length ? es.filter((e) => e.c.loop) : es)) % 1;
  } else {
    if (s.fades.length) s.fades = [];
    const a = gaitEntries(s.styleA, s.v, ks), b = gaitEntries(s.styleB, s.v, ks);
    const wb = clamp(s.style, 0, 1);
    es = [...a.es.map((e) => ({ ...e, w: e.w * (1 - wb) })), ...b.es.map((e) => ({ ...e, w: e.w * wb }))];
    const adv = ((1 - wb) * a.rate / durOf(a.es) + wb * b.rate / durOf(b.es));
    s.phase = (s.phase + dt * adv) % 1;
  }
  // скорость
  s.v += clamp(vt - s.v, -DEC * dt, ACC * dt);
  if (s.v < 1e-4 && vt === 0) s.v = 0;
  // 3. поза
  const pose = poseA;
  if (!explicit && s.style > 0 && s.style < 1) {
    const ea = es.slice(0, es.length / 2), eb = es.slice(es.length / 2);
    for (const e of ea) e.w /= (1 - s.style); for (const e of eb) e.w /= s.style;
    mixEntries(ea, s.phase, acc); mixEntries(eb, s.phase, accB);
    blendPose(acc, accB, s.style, pose);
  } else mixEntries(es.filter((e) => e.w > 1e-4), s.phase, pose);
  pose.hips[0] = pose.hips[0]! * ks; pose.hips[1] = pose.hips[1]! * ks; pose.hips[2] = pose.hips[2]! * ks;
  // положение таза в мире (без слоёв, чтобы слои знали высоту)
  const yq = yawQ(s.yaw);
  const gy = env.heightAt(s.x, s.z);
  const hw = [0, 0, 0];
  rotate(yq, 0, [pose.hips[0]!, 0, pose.hips[2]!], hw);
  s.hipsW[0] = s.x + hw[0]!; s.hipsW[1] = gy + pose.hips[1]!; s.hipsW[2] = s.z + hw[2]!;
  const { backVel } = overlays(s, env, pose, ks);
  // 4. движение корня
  const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
  s.x += fx * s.v * dt - fx * backVel; s.z += fz * s.v * dt - fz * backVel;
  s.backX += backVel;
  if (s.startleT < 0) s.backX = 0;
  s.moveSpeed = s.v;
  // 5. мировая поза, прилипание стоп, IK
  const gy2 = env.heightAt(s.x, s.z);
  rotate(yq, 0, [pose.hips[0]!, 0, pose.hips[2]!], hw);
  const hipsPos = [s.x + hw[0]!, gy2 + pose.hips[1]!, s.z + hw[2]!];
  const loc = q2; loc.set(pose.q);
  const hq = mul(yq, Array.from(pose.q.subarray(0, 4))); loc[0] = hq[0]!; loc[1] = hq[1]!; loc[2] = hq[2]!; loc[3] = hq[3]!;
  fk(rest, hipsPos, loc, wp, wq);
  const fwd = [fx, 0, fz];
  const tgt: (number[] | null)[] = [null, null];
  ([['left', B.leftFoot], ['right', B.rightFoot]] as const).forEach(([, ft], i) => {
    const ux = wp[ft * 3]!, uy = wp[ft * 3 + 1]!, uz = wp[ft * 3 + 2]!, g = env.heightAt(ux, uz);
    const w = stepFoot(s.feet[i]!, ux, uy, uz, g, ks, dt);
    if (w > 0) {
      const f = s.feet[i]!, ty = uy + (env.heightAt(f.px, f.pz) - g);
      tgt[i] = [ux + (f.px - ux) * w, uy + (ty - uy) * w, uz + (f.pz - uz) * w];
    }
  });
  for (let pass = 0; pass < 2; pass++) {
    let over = 0;
    (['left', 'right'] as const).forEach((side, i) => { if (tgt[i]) over = Math.max(over, legIK(rest, wp, wq, loc, side, tgt[i]!, fwd)); });
    if (over > 0.002 && pass === 0) { hipsPos[1] -= Math.min(0.2, over); fk(rest, hipsPos, loc, wp, wq); } else break;
  }
  fk(rest, hipsPos, loc, wp, wq);
  // вывод
  const outQ = loc;
  const inv = mul([-yq[0], -yq[1], -yq[2], yq[3]], [outQ[0]!, outQ[1]!, outQ[2]!, outQ[3]!]);
  outQ[0] = inv[0]!; outQ[1] = inv[1]!; outQ[2] = inv[2]!; outQ[3] = inv[3]!;
  for (let i = 0; i < NB * 4; i++) s.pose[i] = outQ[i]!;
  for (let i = 0; i < NB * 3; i++) s.joints[i] = wp[i]!;
  s.hipsW[0] = hipsPos[0]!; s.hipsW[1] = hipsPos[1]!; s.hipsW[2] = hipsPos[2]!;
  const tip = [0, 0, 0];
  [B.head, B.leftHand, B.rightHand, B.leftToes, B.rightToes].forEach((b, i) => {
    const t = TIPS[BONES[b]!]!;
    rotate(wq, b * 4, [t[0] * ks, t[1] * ks, t[2] * ks], tip);
    s.ends[i * 3] = wp[b * 3]! + tip[0]!; s.ends[i * 3 + 1] = wp[b * 3 + 1]! + tip[1]!; s.ends[i * 3 + 2] = wp[b * 3 + 2]! + tip[2]!;
  });
  // нос: точка перед лицом (по ней видно, куда повёрнута голова)
  rotate(wq, B.head * 4, [0, 0.1 * ks, 0.12 * ks], tip);
  s.ends[15] = wp[B.head * 3]! + tip[0]!; s.ends[16] = wp[B.head * 3 + 1]! + tip[1]!; s.ends[17] = wp[B.head * 3 + 2]! + tip[2]!;
  void PARENT;
}

// ---------- команды ----------
export function cmdWalkTo(s: BipedSim, x: number, z: number, speed: number): void { s.goal = [x, z]; s.goalSpeed = speed; s.clip = ''; }
export function cmdStop(s: BipedSim): void { s.goal = null; s.speed = 0; }
export function cmdStartle(s: BipedSim): void { s.startleT = s.t; s.goal = null; }
export function cmdLookAround(s: BipedSim): void { s.lookT = s.t; }

/**
 * План как чистая функция времени: создаёт сима, подаёт команды в нужные моменты (по шагу dt) и проигрывает с нуля до t.
 * Перемотка в любом порядке даёт то же, что проигрывание.
 */
export type PlanEvent = { t: number; do: (s: BipedSim) => void };
export function runPlan(init: () => BipedSim, events: PlanEvent[], t: number, env: Env, dt = 1 / 60): BipedSim {
  const s = init();
  const ev = [...events].sort((a, b) => a.t - b.t);
  const n = Math.round(t / dt);
  let k = 0;
  for (let i = 0; i < n; i++) {
    while (k < ev.length && ev[k]!.t <= i * dt + 1e-9) ev[k++]!.do(s);
    stepSim(s, dt, env);
  }
  return s;
}
