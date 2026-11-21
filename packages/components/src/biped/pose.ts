import { B, NB } from './skeleton.ts';
import { slerp } from './quat.ts';

/** Поза: повороты костей (NB·4) и положение таза (3). Все функции пишут в готовый объект, ничего не выделяют. */
export type Pose = { q: Float64Array; hips: Float64Array };
export const newPose = (): Pose => ({ q: new Float64Array(NB * 4), hips: new Float64Array(3) });
export function copyPose(a: Pose, out: Pose): void { out.q.set(a.q); out.hips.set(a.hips); }

/** Смешивание по весу w (0 → a, 1 → b), по всем костям, дугой. */
export function blendPose(a: Pose, b: Pose, w: number, out: Pose): void {
  for (let i = 0; i < NB; i++) slerp(a.q, i * 4, b.q, i * 4, w, out.q, i * 4);
  for (let k = 0; k < 3; k++) out.hips[k] = a.hips[k]! + (b.hips[k]! - a.hips[k]!) * w;
}

const names = (...n: (keyof typeof B)[]) => n.map((x) => B[x]);
/** Верх тела: позвоночник, шея, голова, плечи и руки. Низ — таз и ноги. */
export const UPPER = names('spine', 'chest', 'upperChest', 'neck', 'head', 'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand');
export const ARMS = names('leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand');

/** Слой: на выбранные кости кладётся поза over с весом w (по костям mask), остальное — как в base. Результат пишется в base. */
export function layerPose(base: Pose, over: Pose, mask: number[], w: number): void {
  if (w <= 0) return;
  for (const b of mask) slerp(base.q, b * 4, over.q, b * 4, w, base.q, b * 4);
}
