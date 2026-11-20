import { B, NB, fk } from '../../packages/components/src/biped/skeleton.ts';
import { angleBetween, mul, rotate, slerp, yawQ } from '../../packages/components/src/biped/quat.ts';
import { REF_REST, type Retargeted } from './retarget.ts';

/** Ряд кадров на нашем скелете: q — локальные повороты (frames·NB·4), hips — положение таза (frames·3). */
export type Series = { fps: number; frames: number; q: Float64Array; hips: Float64Array };
export type Built = { frames: number; q: Float64Array; hips: Float64Array; vel: [number, number]; duration: number; loop: boolean };

export const series = (r: Retargeted, fps: number): Series => ({ fps, frames: r.frames, q: r.q, hips: r.hips });

const qAt = (s: Series, f: number, b: number): number[] => Array.from(s.q.subarray((f * NB + b) * 4, (f * NB + b) * 4 + 4));

/** Расстояние между позами двух кадров: средний квадрат углов костей и разница высоты таза. */
function poseDist(s: Series, i: number, j: number): number {
  let sum = 0;
  for (let b = 0; b < NB; b++) { const a = angleBetween(s.q.subarray((i * NB + b) * 4, (i * NB + b) * 4 + 4), s.q.subarray((j * NB + b) * 4, (j * NB + b) * 4 + 4)); sum += a * a; }
  const dy = s.hips[i * 3 + 1]! - s.hips[j * 3 + 1]!;
  return sum / NB + dy * dy * 4;
}

/** Мировое положение голеностопа слева относительно таза вдоль вперёд (+Z после разворота): нужен для фазы шага. */
export function leftFootForward(s: Series, f: number, yaw: number): number {
  const wp = new Float64Array(NB * 3), wq = new Float64Array(NB * 4);
  const loc = s.q.slice(f * NB * 4, (f + 1) * NB * 4), h = [s.hips[f * 3]!, s.hips[f * 3 + 1]!, s.hips[f * 3 + 2]!];
  fk(REF_REST, h, loc, wp, wq);
  const d = [wp[B.leftFoot * 3]! - wp[0]!, 0, wp[B.leftFoot * 3 + 2]! - wp[2]!], o = [0, 0, 0];
  rotate(yawQ(-yaw), 0, d, o);
  return o[2]!;
}

export type LoopOpts = { minSec: number; maxSec: number; from?: number; to?: number; moving: boolean; minSpeed?: number; maxSpeed?: number };

/** Ищет лучший цикл: начало i и длина P (кадры) с наименьшей разницей поз на стыке, ровным ходом и без поворота. */
export function findLoop(s: Series, o: LoopOpts): { i: number; P: number; cost: number } {
  const a = Math.max(o.from ?? 0, 8), b = Math.min(o.to ?? s.frames, s.frames) - 8;
  const pMin = Math.round(o.minSec * s.fps), pMax = Math.round(o.maxSec * s.fps);
  let best = { i: a, P: pMin, cost: Infinity };
  const step = Math.max(1, Math.round(s.fps / 20));
  for (let i = a; i + pMax + 1 < b; i += step) {
    for (let P = pMin; P <= pMax; P++) {
      let c = poseDist(s, i, i + P) + 0.5 * (poseDist(s, i + 4, i + P + 4) + poseDist(s, i - 4, i + P - 4));
      if (c >= best.cost) continue;
      if (o.moving) {
        // прямой путь: два полупути смотрят в одну сторону, и идёт он примерно с постоянной скоростью
        const h = P >> 1, x0 = s.hips[i * 3]!, z0 = s.hips[i * 3 + 2]!, x1 = s.hips[(i + h) * 3]!, z1 = s.hips[(i + h) * 3 + 2]!, x2 = s.hips[(i + P) * 3]!, z2 = s.hips[(i + P) * 3 + 2]!;
        const a1 = Math.atan2(x1 - x0, z1 - z0), a2 = Math.atan2(x2 - x1, z2 - z1);
        let da = a2 - a1; da = Math.atan2(Math.sin(da), Math.cos(da));
        const sp1 = Math.hypot(x1 - x0, z1 - z0), sp2 = Math.hypot(x2 - x1, z2 - z1);
        const spd = (sp1 + sp2) / (P / s.fps);
        if (spd < (o.minSpeed ?? 0) || spd > (o.maxSpeed ?? Infinity)) continue;
        c += da * da * 2 + ((sp1 - sp2) / (sp1 + sp2 + 1e-6)) ** 2 * 2;
      }
      c += 0.00002 * P; // при равенстве — более короткий цикл
      if (c < best.cost) best = { i, P, cost: c };
    }
  }
  return best;
}

/**
 * Собирает зацикленный клип из окна [start, start+P] ряда s: курс вдоль +Z, сдвиг таза = средняя скорость + покачивание,
 * плавный стык (хвост подмешивается к началу), частота 30 к/с. moving=false — стоим: скорость не вычитаем.
 */
export function loopClip(s: Series, start: number, P: number, moving: boolean, outFps = 30): Built {
  const W = Math.max(2, Math.round(P * 0.22));
  while (start < W) start += P;
  const T = P / s.fps;
  const dx = s.hips[(start + P) * 3]! - s.hips[start * 3]!, dz = s.hips[(start + P) * 3 + 2]! - s.hips[start * 3 + 2]!;
  const yaw = moving ? Math.atan2(dx, dz) : 0;
  const vxw = moving ? dx / T : 0, vzw = moving ? dz / T : 0;
  const Y = yawQ(-yaw), tmp = [0, 0, 0];
  // кадр k (может быть вне окна) → поворот таза и сдвиг в нашей системе
  const hipsAt = (f: number, k: number): number[] => {
    const d = [s.hips[f * 3]! - s.hips[start * 3]! - vxw * (k / s.fps), s.hips[f * 3 + 1]!, s.hips[f * 3 + 2]! - s.hips[start * 3 + 2]! - vzw * (k / s.fps)];
    rotate(Y, 0, d, tmp); return [tmp[0]!, d[1]!, tmp[2]!];
  };
  const qAtF = (f: number, b: number): number[] => { const q = qAt(s, f, b); return b === 0 ? mul(Y, q) : q; };
  const frame = (k: number): { q: number[][]; h: number[] } => {
    const f = start + k;
    const q = Array.from({ length: NB }, (_, b) => qAtF(f, b));
    let h = hipsAt(f, k);
    if (k >= P - W) {
      const w = (k - (P - W) + 1) / (W + 1);
      for (let b = 0; b < NB; b++) { const o = [0, 0, 0, 1]; slerp(q[b]!, 0, qAtF(f - P, b), 0, w, o, 0); q[b] = o; }
      const h2 = hipsAt(f - P, k - P);
      h = h.map((v, i) => v + (h2[i]! - v) * w);
    }
    return { q, h };
  };
  const frames: { q: number[][]; h: number[] }[] = [];
  for (let k = 0; k < P; k++) frames.push(frame(k));
  const N = Math.max(4, Math.round(T * outFps));
  const q = new Float64Array(N * NB * 4), hips = new Float64Array(N * 3);
  for (let n = 0; n < N; n++) {
    const u = (n / N) * P, k0 = Math.floor(u) % P, k1 = (k0 + 1) % P, w = u - Math.floor(u);
    for (let b = 0; b < NB; b++) { const o = [0, 0, 0, 1]; slerp(frames[k0]!.q[b]!, 0, frames[k1]!.q[b]!, 0, w, o, 0); q.set(o, (n * NB + b) * 4); }
    for (let c = 0; c < 3; c++) hips[n * 3 + c] = frames[k0]!.h[c]! + (frames[k1]!.h[c]! - frames[k0]!.h[c]!) * w;
  }
  const stretch = T / (N / outFps);
  const vel: [number, number] = moving ? [0, Math.hypot(vxw, vzw) * stretch] : [0, 0];
  return { frames: N, q, hips, vel, duration: N / outFps, loop: true };
}

/** Разовый клип: кадры [a, b) без изменений, частота 30 к/с, таз — от первого кадра (по горизонтали). */
export function shotClip(s: Series, a: number, b: number, outFps = 30): Built {
  const T = (b - a - 1) / s.fps, N = Math.max(2, Math.round(T * outFps) + 1);
  const q = new Float64Array(N * NB * 4), hips = new Float64Array(N * 3);
  for (let n = 0; n < N; n++) {
    const u = a + (n / (N - 1)) * (b - a - 1), k0 = Math.floor(u), k1 = Math.min(k0 + 1, b - 1), w = u - k0;
    for (let bn = 0; bn < NB; bn++) { const o = [0, 0, 0, 1]; slerp(s.q, (k0 * NB + bn) * 4, s.q, (k1 * NB + bn) * 4, w, o, 0); q.set(o, (n * NB + bn) * 4); }
    for (let c = 0; c < 3; c++) {
      const h0 = s.hips[k0 * 3 + c]!, h1 = s.hips[k1 * 3 + c]!, ref = c === 1 ? 0 : s.hips[a * 3 + c]!;
      hips[n * 3 + c] = h0 + (h1 - h0) * w - ref;
    }
  }
  return { frames: N, q, hips, vel: [0, 0], duration: (N - 1) / outFps, loop: false };
}

/** Упаковка: кватернионы int16 (÷32767), таз — int16 в долях 1/10000 м; base64. Знак кватерниона ведём непрерывно. */
export function pack(c: Built): { q: string; hips: string } {
  const q = new Int16Array(c.frames * NB * 4), h = new Int16Array(c.frames * 3);
  for (let f = 0; f < c.frames; f++) for (let b = 0; b < NB; b++) {
    const o = (f * NB + b) * 4, prev = (f - 1) * NB * 4 + b * 4;
    let sgn = 1;
    if (f > 0) { const d = c.q[o]! * (q[prev]! / 32767) + c.q[o + 1]! * (q[prev + 1]! / 32767) + c.q[o + 2]! * (q[prev + 2]! / 32767) + c.q[o + 3]! * (q[prev + 3]! / 32767); if (d < 0) sgn = -1; }
    else if (c.q[o + 3]! < 0) sgn = -1;
    for (let k = 0; k < 4; k++) q[o + k] = Math.round(Math.max(-1, Math.min(1, c.q[o + k]! * sgn)) * 32767);
  }
  for (let i = 0; i < h.length; i++) h[i] = Math.round(Math.max(-3.2, Math.min(3.2, c.hips[i]!)) * 10000);
  return { q: Buffer.from(q.buffer).toString('base64'), hips: Buffer.from(h.buffer).toString('base64') };
}

/**
 * Скорость по опорным стопам, м/с: пока стопа на земле, относительно таза она уезжает назад ровно со скоростью ходьбы.
 * Берём кадры, где голеностоп ниже минимума + 3 см, и средний −d(z)/dt по обеим ногам. Для зацикленного клипа с учётом кольца.
 */
export function stanceSpeed(c: Built, fps = 30): number {
  const N = c.frames, wp = new Float64Array(NB * 3), wq = new Float64Array(NB * 4);
  const zs: number[][] = [[], []], ys: number[][] = [[], []];
  for (let f = 0; f < N; f++) {
    fk(REF_REST, [c.hips[f * 3]!, c.hips[f * 3 + 1]!, c.hips[f * 3 + 2]!], c.q.subarray(f * NB * 4, (f + 1) * NB * 4), wp, wq);
    [B.leftToes, B.rightToes].forEach((b, k) => { zs[k]!.push(wp[b * 3 + 2]!); ys[k]!.push(wp[b * 3 + 1]!); });
  }
  const v: number[] = [];
  for (let k = 0; k < 2; k++) {
    const miny = Math.min(...ys[k]!);
    for (let f = 0; f < N; f++) {
      if (ys[k]![f]! > miny + 0.02) continue; // носок на земле
      const a = zs[k]![(f + N - 1) % N]!, b = zs[k]![(f + 1) % N]!;
      v.push(-(b - a) / (2 / fps));
    }
  }
  v.sort((a, b) => a - b);
  return v.length ? v[v.length >> 1]! : 0; // медиана: переходы пятка–носок не тянут среднее
}

/** Типичная скорость ходьбы ряда: 60-й процентиль скорости таза за секунду (стояние и повороты на месте не мешают). */
export function typicalSpeed(s: Series): number {
  const w = s.fps, v: number[] = [];
  for (let i = 0; i + w < s.frames; i += w >> 1) v.push(Math.hypot(s.hips[(i + w) * 3]! - s.hips[i * 3]!, s.hips[(i + w) * 3 + 2]! - s.hips[i * 3 + 2]!));
  v.sort((a, b) => a - b);
  return v[Math.floor(v.length * 0.6)] ?? 0;
}
