import { B, PARENT, ANKLE_REST_H } from './skeleton.ts';
import { conj, fromTo, mul, rotate, type Q } from './quat.ts';

/**
 * Двухкостный IK ноги: бедро → колено → голеностоп приводит стопу в точку target. Плоскость сгиба берётся из текущего колена
 * (как в клипе), поэтому колено гнётся туда же, куда в записи. wp/wq — мировые положения и повороты после прямой кинематики;
 * q — локальные повороты (меняются: бедро, голень, стопа остаётся в мире такой же, как была).
 */
export function legIK(rest: Float64Array, wp: Float64Array, wq: Float64Array, q: Float64Array, side: 'left' | 'right', target: number[], fwd: number[]): number {
  const up = side === 'left' ? B.leftUpperLeg : B.rightUpperLeg, lo = up + 1, ft = up + 2;
  const L1 = Math.hypot(rest[lo * 3]!, rest[lo * 3 + 1]!, rest[lo * 3 + 2]!), L2 = Math.hypot(rest[ft * 3]!, rest[ft * 3 + 1]!, rest[ft * 3 + 2]!);
  const H = [wp[up * 3]!, wp[up * 3 + 1]!, wp[up * 3 + 2]!], K = [wp[lo * 3]!, wp[lo * 3 + 1]!, wp[lo * 3 + 2]!], A = [wp[ft * 3]!, wp[ft * 3 + 1]!, wp[ft * 3 + 2]!];
  let ux = target[0]! - H[0]!, uy = target[1]! - H[1]!, uz = target[2]! - H[2]!;
  let d = Math.hypot(ux, uy, uz);
  const dMax = (L1 + L2) * 0.9995, dMin = Math.abs(L1 - L2) + 0.01;
  const over = Math.max(0, d - dMax);
  const dc = Math.min(dMax, Math.max(dMin, d));
  ux /= d; uy /= d; uz /= d; d = dc;
  // плоскость колена: сгиб из клипа плюс небольшая тяга вперёд (когда нога почти прямая, сгиб клипа неустойчив и колено «переворачивается»)
  let kx = K[0]! - H[0]!, ky = K[1]! - H[1]!, kz = K[2]! - H[2]!;
  const dot = kx * ux + ky * uy + kz * uz;
  kx -= dot * ux; ky -= dot * uy; kz -= dot * uz;
  const df = fwd[0]! * ux + fwd[1]! * uy + fwd[2]! * uz;
  let fx = fwd[0]! - df * ux, fy = fwd[1]! - df * uy, fz = fwd[2]! - df * uz;
  const fl = Math.hypot(fx, fy, fz) || 1; fx = (fx / fl) * 0.3 * L1; fy = (fy / fl) * 0.3 * L1; fz = (fz / fl) * 0.3 * L1;
  kx += fx; ky += fy; kz += fz;
  const kl = Math.hypot(kx, ky, kz) || 1;
  kx /= kl; ky /= kl; kz /= kl;
  const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  const Kn = [H[0]! + ux * a + kx * h, H[1]! + uy * a + ky * h, H[2]! + uz * a + kz * h];
  const An = [H[0]! + ux * d, H[1]! + uy * d, H[2]! + uz * d];
  // бедро: повернуть так, чтобы колено встало в Kn
  const dq1 = fromTo([K[0]! - H[0]!, K[1]! - H[1]!, K[2]! - H[2]!], [Kn[0]! - H[0]!, Kn[1]! - H[1]!, Kn[2]! - H[2]!]);
  const Wup = mul(dq1, Array.from(wq.subarray(up * 4, up * 4 + 4)));
  const cur = [0, 0, 0];
  rotate(dq1, 0, [A[0]! - K[0]!, A[1]! - K[1]!, A[2]! - K[2]!], cur);
  const dq2 = fromTo(cur, [An[0]! - Kn[0]!, An[1]! - Kn[1]!, An[2]! - Kn[2]!]);
  const Wlo = mul(dq2, mul(dq1, Array.from(wq.subarray(lo * 4, lo * 4 + 4))));
  const Wft = Array.from(wq.subarray(ft * 4, ft * 4 + 4));
  const par = PARENT[up]!;
  const lu = mul(conj(Array.from(wq.subarray(par * 4, par * 4 + 4))), Wup);
  const ll = mul(conj(Wup), Wlo), lf: Q = mul(conj(Wlo), Wft);
  q.set(lu, up * 4); q.set(ll, lo * 4); q.set(lf, ft * 4);
  return over;
}

/** Состояние «стопа прилипла к земле». */
export type Foot = { pin: boolean; px: number; pz: number; w: number; ux: number; uz: number; has: boolean };
export const newFoot = (): Foot => ({ pin: false, px: 0, pz: 0, w: 0, ux: 0, uz: 0, has: false });

export const FOOT_LOCK = { enterH: 0.03, exitH: 0.05, enterSpeed: 0.7, drift: 0.3, rampIn: 0.07, rampOut: 0.1 };

/**
 * Обновляет прилипание одной стопы. (ux, uy, uz) — где стопа без IK; gy — высота земли под ней; k — масштаб тела.
 * Возвращает вес IK (0…1) и точку, куда ставить (px, pz) — вертикаль берёт вызывающий.
 */
export function stepFoot(f: Foot, ux: number, uy: number, uz: number, gy: number, k: number, dt: number): number {
  const h = uy - gy - ANKLE_REST_H * k;
  const speed = f.has ? Math.hypot(ux - f.ux, uz - f.uz) / dt : Infinity;
  f.ux = ux; f.uz = uz; f.has = true;
  const L = FOOT_LOCK;
  if (!f.pin) {
    if (h < L.enterH * k && speed < L.enterSpeed) { f.pin = true; f.px = ux; f.pz = uz; }
  } else if (h > L.exitH * k || Math.hypot(ux - f.px, uz - f.pz) > L.drift * k) f.pin = false;
  const target = f.pin ? 1 : 0;
  const rate = f.pin ? 1 / L.rampIn : 1 / L.rampOut;
  f.w = f.w < target ? Math.min(target, f.w + dt * rate) : Math.max(target, f.w - dt * rate);
  return f.w;
}
