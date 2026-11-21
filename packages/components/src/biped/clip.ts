import { NB } from './skeleton.ts';
import { slerp } from './quat.ts';
import library from './clips/library.json' with { type: 'json' };

/** Клип: повороты костей нашего скелета по кадрам (30 к/с) и положение таза. Скорость `vel` — по опорным стопам, м/с (типичный человек 1,7 м). */
export type Clip = {
  name: string; base: string; source: string; license: string; credit: string; kind: string;
  fps: number; frames: number; duration: number; loop: boolean; vel: number;
  q: Float32Array; hips: Float32Array;
};

type Raw = { name: string; base: string; source: string; license: string; credit: string; kind: string; fps: number; frames: number; duration: number; loop: boolean; vel: number[]; q: string; hips: string };

function b64ToI16(s: string): Int16Array {
  const bin = atob(s), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Int16Array(u.buffer);
}

function unpack(r: Raw): Clip {
  const qi = b64ToI16(r.q), hi = b64ToI16(r.hips);
  const q = new Float32Array(qi.length), hips = new Float32Array(hi.length);
  for (let f = 0; f < r.frames; f++) for (let b = 0; b < NB; b++) {
    const o = (f * NB + b) * 4;
    let x = qi[o]! / 32767, y = qi[o + 1]! / 32767, z = qi[o + 2]! / 32767, w = qi[o + 3]! / 32767;
    const l = Math.hypot(x, y, z, w) || 1; x /= l; y /= l; z /= l; w /= l;
    q[o] = x; q[o + 1] = y; q[o + 2] = z; q[o + 3] = w;
  }
  for (let i = 0; i < hi.length; i++) hips[i] = hi[i]! / 10000;
  return { name: r.name, base: r.base, source: r.source, license: r.license, credit: r.credit, kind: r.kind, fps: r.fps, frames: r.frames, duration: r.duration, loop: r.loop, vel: r.vel[1] ?? 0, q, hips };
}

/** Поза покоя (T): один кадр без поворотов; наша, не из баз. Нужна витрине и тестам. */
const restClip = (): Clip => {
  const q = new Float32Array(NB * 4); for (let b = 0; b < NB; b++) q[b * 4 + 3] = 1;
  return { name: 'biped.rest-pose', base: 'own', source: 'procedural', license: 'own', credit: '', kind: 'rest', fps: 30, frames: 1, duration: 1, loop: true, vel: 0, q, hips: new Float32Array([0, 0.94, 0]) };
};
export const CLIPS: Record<string, Clip> = { 'biped.rest-pose': restClip(), ...Object.fromEntries((library as { clips: Raw[] }).clips.map((c) => [c.name, unpack(c)])) };
export const CLIP_NAMES = Object.keys(CLIPS);
export const clipOf = (name: string): Clip => { const c = CLIPS[name]; if (!c) throw new Error(`нет клипа «${name}»`); return c; };

/** Секунда клипа → кадры (петля или зажим) → повороты костей и положение таза. */
export function sampleClip(c: Clip, t: number, q: Float64Array | number[], hips: Float64Array | number[]): void {
  let u: number;
  if (c.loop) { const ph = ((t / c.duration) % 1 + 1) % 1; u = ph * c.frames; } else u = Math.min(Math.max(t, 0), c.duration) * c.fps;
  let f0 = Math.floor(u); const w = u - f0;
  let f1 = f0 + 1;
  if (c.loop) { f0 %= c.frames; f1 %= c.frames; } else { f0 = Math.min(f0, c.frames - 1); f1 = Math.min(f1, c.frames - 1); }
  for (let b = 0; b < NB; b++) slerp(c.q, (f0 * NB + b) * 4, c.q, (f1 * NB + b) * 4, w, q, b * 4);
  for (let k = 0; k < 3; k++) hips[k] = c.hips[f0 * 3 + k]! + (c.hips[f1 * 3 + k]! - c.hips[f0 * 3 + k]!) * w;
}

/** Фаза шага 0…1 → то же, что sampleClip, но по доле цикла (для клипов, сшитых по фазе). */
export const sampleClipPhase = (c: Clip, phase: number, q: Float64Array | number[], hips: Float64Array | number[]): void => sampleClip(c, phase * c.duration, q, hips);
