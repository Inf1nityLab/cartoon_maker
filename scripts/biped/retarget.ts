import { B, BONES, CHILD, NB, PARENT, ANKLE_REST_H as _a, BipedProportions, restOffsets, type BoneName } from '../../packages/components/src/biped/skeleton.ts';
import { conj, fromTo, mul, rotate, yawQ } from '../../packages/components/src/biped/quat.ts';
import type { SrcMotion, SrcRig } from './source.ts';

void _a;
/** Какой сустав источника ведёт нашу кость и на какой сустав он «смотрит» (для выравнивания поз покоя). */
export type Mapping = Record<BoneName, { j: string; child?: string }>;
export const REF_REST = restOffsets(BipedProportions.parse({}));

export type Retargeted = { q: Float64Array; hips: Float64Array; scale: number; frames: number };

const idxOf = (rig: SrcRig, name: string): number => { const i = rig.names.indexOf(name); if (i < 0) throw new Error(`в источнике нет сустава ${name}`); return i; };

/**
 * Перенос движения на наш скелет в мировых осях. Для кости b: D = (мировой поворот сустава в кадре)·(поворот покоя)⁻¹ — «насколько
 * кость ушла от покоя»; A — кратчайший поворот, который ставит нашу кость в направление покоя источника (T против A-позы).
 * Мировой поворот нашей кости = D·A, локальный = (мировой родителя)⁻¹·(мировой кости). Таз масштабируется по длине ноги.
 * toeJoint/legJoint — чтобы сравнить длину ног. frameOf — кадры источника, которые брать (по умолчанию все).
 */
export function retarget(m: SrcMotion, map: Mapping, hipsName: string, toeName: string): Retargeted {
  const rig = m.rig, nj = rig.names.length;
  // направление «налево/вперёд» источника: если не совпало с нашим — разворот на 180° вокруг вертикали
  const lh = rig.restPos.subarray(idxOf(rig, map.leftUpperLeg.j) * 3, idxOf(rig, map.leftUpperLeg.j) * 3 + 3);
  const rh = rig.restPos.subarray(idxOf(rig, map.rightUpperLeg.j) * 3, idxOf(rig, map.rightUpperLeg.j) * 3 + 3);
  const lt = idxOf(rig, toeName);
  const fwd = rig.restPos[lt * 3 + 2]! - rig.restPos[idxOf(rig, map.leftFoot.j) * 3 + 2]!;
  const leftIsPlusX = lh[0]! > rh[0]!;
  if (leftIsPlusX !== fwd > 0) throw new Error('зеркальный скелет источника: лево/право и «вперёд» не согласованы');
  const F = leftIsPlusX ? [0, 0, 0, 1] : yawQ(Math.PI);

  const A: number[][] = new Array(NB);
  const tmp = [0, 0, 0];
  for (let b = 0; b < NB; b++) {
    const spec = map[BONES[b]!];
    const c = CHILD[b]!;
    if (spec.child !== undefined && c >= 0) {
      const ji = idxOf(rig, spec.j), ci = idxOf(rig, spec.child);
      const d = [0, 0, 0].map((_, k) => rig.restPos[ci * 3 + k]! - rig.restPos[ji * 3 + k]!);
      rotate(F, 0, d, tmp); // в нашу ориентацию
      const t = [REF_REST[c * 3]!, REF_REST[c * 3 + 1]!, REF_REST[c * 3 + 2]!];
      A[b] = fromTo(t, tmp.slice());
    } else A[b] = PARENT[b]! >= 0 && c < 0 ? A[PARENT[b]!]!.slice() : [0, 0, 0, 1];
  }
  const ji = BONES.map((n) => idxOf(rig, map[n].j));
  const hi = idxOf(rig, hipsName);
  const tgtHipToToe = REF_REST[B.leftUpperLeg * 3 + 1]! + REF_REST[B.leftLowerLeg * 3 + 1]! + REF_REST[B.leftFoot * 3 + 1]! + REF_REST[B.leftToes * 3 + 1]!;
  const scale = Math.abs(tgtHipToToe) / Math.abs(rig.restPos[hi * 3 + 1]! - rig.restPos[lt * 3 + 1]!);
  const n = m.frames, q = new Float64Array(n * NB * 4), hips = new Float64Array(n * 3);
  const ta: number[][] = new Array(NB);
  const Fi = conj(F);
  for (let f = 0; f < n; f++) {
    for (let b = 0; b < NB; b++) {
      const w = Array.from(m.wq.subarray((f * nj + ji[b]!) * 4, (f * nj + ji[b]!) * 4 + 4));
      const r0 = Array.from(rig.restQ.subarray(ji[b]! * 4, ji[b]! * 4 + 4));
      // D в нашей ориентации: F·(w·r0⁻¹)·F⁻¹
      const D = mul(mul(F, mul(w, conj(r0))), Fi);
      ta[b] = mul(D, A[b]!);
      const loc = PARENT[b]! < 0 ? ta[b]! : mul(conj(ta[PARENT[b]!]!), ta[b]!);
      q.set(loc, (f * NB + b) * 4);
    }
    rotate(F, 0, m.hips.subarray(f * 3, f * 3 + 3), tmp);
    hips[f * 3] = tmp[0]! * scale; hips[f * 3 + 1] = tmp[1]! * scale; hips[f * 3 + 2] = tmp[2]! * scale;
  }
  return { q, hips, scale, frames: n };
}
