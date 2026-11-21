import { z } from 'zod';
import { qMul, rotate } from './quat.ts';

/**
 * Скелет Biped: кости по стандарту VRM-гуманоида (обязательные кости тела + upperChest и toes; пальцы рук не делаем).
 * Поза покоя — T: все локальные повороты единичные, руки вдоль ±X, лицом в +Z, левая сторона персонажа — +X.
 * Порядок костей: родитель всегда раньше потомка.
 */
export const BONES = [
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
] as const;
export type BoneName = (typeof BONES)[number];
export const NB = BONES.length;
export const B: Record<BoneName, number> = Object.fromEntries(BONES.map((n, i) => [n, i])) as Record<BoneName, number>;

const PARENT_NAME: Record<BoneName, BoneName | null> = {
  hips: null, spine: 'hips', chest: 'spine', upperChest: 'chest', neck: 'upperChest', head: 'neck',
  leftShoulder: 'upperChest', leftUpperArm: 'leftShoulder', leftLowerArm: 'leftUpperArm', leftHand: 'leftLowerArm',
  rightShoulder: 'upperChest', rightUpperArm: 'rightShoulder', rightLowerArm: 'rightUpperArm', rightHand: 'rightLowerArm',
  leftUpperLeg: 'hips', leftLowerLeg: 'leftUpperLeg', leftFoot: 'leftLowerLeg', leftToes: 'leftFoot',
  rightUpperLeg: 'hips', rightLowerLeg: 'rightUpperLeg', rightFoot: 'rightLowerLeg', rightToes: 'rightFoot',
};
export const PARENT: Int8Array = Int8Array.from(BONES.map((n) => (PARENT_NAME[n] === null ? -1 : B[PARENT_NAME[n]!])));

/** «Главный потомок»: куда смотрит кость (для выравнивания поз покоя при переносе клипов). -1 — конец цепочки. */
export const CHILD: Int8Array = Int8Array.from(BONES.map((n) => {
  const m: Partial<Record<BoneName, BoneName>> = {
    hips: 'spine', spine: 'chest', chest: 'upperChest', upperChest: 'neck', neck: 'head',
    leftShoulder: 'leftUpperArm', leftUpperArm: 'leftLowerArm', leftLowerArm: 'leftHand',
    rightShoulder: 'rightUpperArm', rightUpperArm: 'rightLowerArm', rightLowerArm: 'rightHand',
    leftUpperLeg: 'leftLowerLeg', leftLowerLeg: 'leftFoot', leftFoot: 'leftToes',
    rightUpperLeg: 'rightLowerLeg', rightLowerLeg: 'rightFoot', rightFoot: 'rightToes',
  };
  return m[n] === undefined ? -1 : B[m[n]!];
}));

export const BipedProportions = z.object({
  height: z.number().min(0.4).max(2.6).default(1.7).describe('рост, м'),
  legLength: z.number().min(0.7).max(1.3).default(1).describe('длина ног относительно типичной (1 = как есть)'),
  armLength: z.number().min(0.7).max(1.3).default(1).describe('длина рук относительно типичной'),
  shoulderWidth: z.number().min(0.6).max(1.5).default(1).describe('ширина плеч и таза относительно типичной'),
});
export type Proportions = z.infer<typeof BipedProportions>;
export const REF_HEIGHT = 1.7;

/** Смещения костей в позе покоя (локальные, от родителя), типичный человек ростом 1,7 м. Левая сторона +X. */
const REF: Record<BoneName, [number, number, number]> = {
  hips: [0, 0.94, 0], spine: [0, 0.08, 0], chest: [0, 0.13, 0], upperChest: [0, 0.13, 0], neck: [0, 0.14, 0], head: [0, 0.09, 0],
  leftShoulder: [0.03, 0.1, 0], leftUpperArm: [0.12, 0, 0], leftLowerArm: [0.28, 0, 0], leftHand: [0.26, 0, 0],
  rightShoulder: [-0.03, 0.1, 0], rightUpperArm: [-0.12, 0, 0], rightLowerArm: [-0.28, 0, 0], rightHand: [-0.26, 0, 0],
  leftUpperLeg: [0.09, -0.05, 0], leftLowerLeg: [0, -0.42, 0], leftFoot: [0, -0.4, 0], leftToes: [0, -0.05, 0.13],
  rightUpperLeg: [-0.09, -0.05, 0], rightLowerLeg: [0, -0.42, 0], rightFoot: [0, -0.4, 0], rightToes: [0, -0.05, 0.13],
};
/** Хвосты конечных костей (для рисования и «длины»): голова, кисти, пальцы стопы. */
export const TIPS: Partial<Record<BoneName, [number, number, number]>> = {
  head: [0, 0.19, 0], leftHand: [0.09, 0, 0], rightHand: [-0.09, 0, 0], leftToes: [0, 0, 0.06], rightToes: [0, 0, 0.06],
};
export const ANKLE_REST_H = 0.07; // высота голеностопа над землёй у типичного человека, м (до масштаба)

const LEG = new Set<BoneName>(['leftLowerLeg', 'leftFoot', 'rightLowerLeg', 'rightFoot']);
const ARM = new Set<BoneName>(['leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand']);

/** Смещения костей с учётом пропорций: Float64Array(NB·3). */
export function restOffsets(p: Proportions): Float64Array {
  const out = new Float64Array(NB * 3), h = p.height / REF_HEIGHT;
  BONES.forEach((n, i) => {
    const r = REF[n];
    let sx = h, sy = h, sz = h;
    if (n === 'hips') sy = h * p.legLength; // высота таза = длина ног
    if (LEG.has(n)) { sy = h * p.legLength; }
    if (n === 'leftToes' || n === 'rightToes') { sy = h; sz = h; }
    if (ARM.has(n) || n === 'leftShoulder' || n === 'rightShoulder') { if (ARM.has(n)) sx = h * p.armLength; else sx = h * p.shoulderWidth; }
    if (n === 'leftUpperArm' || n === 'rightUpperArm') sx = h * p.shoulderWidth * 0.5 + h * 0.5 * p.armLength;
    if (n === 'leftUpperLeg' || n === 'rightUpperLeg') sx = h * p.shoulderWidth;
    out[i * 3] = r[0] * sx; out[i * 3 + 1] = r[1] * sy; out[i * 3 + 2] = r[2] * sz;
  });
  return out;
}

/** Высота таза в покое, м. */
export const hipsHeight = (p: Proportions): number => restOffsets(p)[1]!;
/** Длина ноги от бедра до голеностопа, м. */
export const legReach = (rest: Float64Array): number => Math.abs(rest[B.leftLowerLeg * 3 + 1]!) + Math.abs(rest[B.leftFoot * 3 + 1]!);

/**
 * Прямая кинематика. hips — положение таза (в системе персонажа), q — локальные повороты (NB·4).
 * Пишет мировые положения (NB·3) и повороты (NB·4) в системе персонажа; rootQ/rootPos — перенос в мир (по желанию).
 */
export function fk(rest: Float64Array, hips: ArrayLike<number>, q: ArrayLike<number>, wp: Float64Array, wq: Float64Array): void {
  const tmp = [0, 0, 0];
  for (let i = 0; i < NB; i++) {
    const p = PARENT[i]!;
    if (p < 0) {
      wp[0] = hips[0]!; wp[1] = hips[1]!; wp[2] = hips[2]!;
      for (let k = 0; k < 4; k++) wq[k] = q[k]!;
    } else {
      rotate(wq, p * 4, rest, tmp, 0, i * 3);
      wp[i * 3] = wp[p * 3]! + tmp[0]!; wp[i * 3 + 1] = wp[p * 3 + 1]! + tmp[1]!; wp[i * 3 + 2] = wp[p * 3 + 2]! + tmp[2]!;
      qMul(wq, p * 4, q, i * 4, wq, i * 4);
    }
  }
}
