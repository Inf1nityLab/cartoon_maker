import * as THREE from 'three/webgpu';
import { BIPED_BONES, BIPED_PARENT, BIPED_BONE, BipedParams, type BipedSelf } from '@cartoon/components';
import { defineView } from '../view.ts';

// Скелет Biped палочками и шариками (без чужих моделей): кость = цилиндр между суставами, сустав = шарик.
// Положения суставов считает логика (self.joints, мир), вид только расставляет меши.
const TIP_OF: [number, number][] = [[BIPED_BONE.head, 0], [BIPED_BONE.leftHand, 1], [BIPED_BONE.rightHand, 2], [BIPED_BONE.leftToes, 3], [BIPED_BONE.rightToes, 4]];
const LEFT = new Set<number>([6, 7, 8, 9, 14, 15, 16, 17]);

type Handle = { root: THREE.Group; sticks: THREE.Mesh[]; joints: THREE.Mesh[]; k: number; mats: THREE.Material[]; geos: THREE.BufferGeometry[]; up: THREE.Vector3; a: THREE.Vector3; b: THREE.Vector3; d: THREE.Vector3 };

export const BipedView = defineView<Handle>('Biped', {
  mount(three, inst) {
    const p = BipedParams.parse(inst.params), k = p.height / 1.7;
    const mat = (c: number, rough = 0.5) => new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(c), roughness: rough, metalness: 0 });
    const mats = { nose: mat(0xffffff, 0.3), mid: mat(0xe6e2d8), left: mat(0x4aa8ff), right: mat(0xff6a5a), joint: mat(0xffd34e, 0.35) };
    const stick = new THREE.CylinderGeometry(1, 1, 1, 10, 1), ball = new THREE.SphereGeometry(1, 16, 12);
    const root = new THREE.Group(), sticks: THREE.Mesh[] = [], joints: THREE.Mesh[] = [];
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, list: THREE.Mesh[]) => { const me = new THREE.Mesh(geo, m); me.castShadow = me.receiveShadow = true; me.frustumCulled = false; root.add(me); list.push(me); };
    for (let i = 1; i < BIPED_BONES; i++) {
      const side = LEFT.has(i) ? mats.left : [10, 11, 12, 13, 18, 19, 20, 21].includes(i) ? mats.right : mats.mid;
      add(stick, side, sticks);
    }
    for (let t = 0; t < 5; t++) add(stick, t === 1 || t === 3 ? mats.left : t === 0 ? mats.mid : mats.right, sticks); // хвосты: голова, кисти, пальцы стопы
    add(stick, mats.nose, sticks); // «нос»: куда смотрит голова
    for (let i = 0; i < BIPED_BONES + 5; i++) add(ball, mats.joint, joints);
    three.scene.add(root);
    return { root, sticks, joints, k, mats: Object.values(mats), geos: [stick, ball], up: new THREE.Vector3(0, 1, 0), a: new THREE.Vector3(), b: new THREE.Vector3(), d: new THREE.Vector3() };
  },
  sync(h, s: BipedSelf) {
    const J = s.joints, E = s.ends, r = 0.016 * h.k, rb = 0.03 * h.k;
    const seg = (m: THREE.Mesh, ax: number, ay: number, az: number, bx: number, by: number, bz: number, rad: number) => {
      h.a.set(ax, ay, az); h.b.set(bx, by, bz); h.d.subVectors(h.b, h.a);
      const len = Math.max(h.d.length(), 1e-4);
      m.position.copy(h.a).addScaledVector(h.d, 0.5);
      m.quaternion.setFromUnitVectors(h.up, h.d.multiplyScalar(1 / len));
      m.scale.set(rad, len, rad);
    };
    for (let i = 1; i < BIPED_BONES; i++) { const p = BIPED_PARENT[i]!; seg(h.sticks[i - 1]!, J[p * 3]!, J[p * 3 + 1]!, J[p * 3 + 2]!, J[i * 3]!, J[i * 3 + 1]!, J[i * 3 + 2]!, r); }
    TIP_OF.forEach(([b, t], n) => seg(h.sticks[BIPED_BONES - 1 + n]!, J[b * 3]!, J[b * 3 + 1]!, J[b * 3 + 2]!, E[t * 3]!, E[t * 3 + 1]!, E[t * 3 + 2]!, r * 0.8));
    seg(h.sticks[BIPED_BONES + 4]!, J[BIPED_BONE.head * 3]! + (E[0]! - J[BIPED_BONE.head * 3]!) * 0.5, J[BIPED_BONE.head * 3 + 1]! + (E[1]! - J[BIPED_BONE.head * 3 + 1]!) * 0.5, J[BIPED_BONE.head * 3 + 2]! + (E[2]! - J[BIPED_BONE.head * 3 + 2]!) * 0.5, E[15]!, E[16]!, E[17]!, r * 0.9);
    for (let i = 0; i < BIPED_BONES; i++) { h.joints[i]!.position.set(J[i * 3]!, J[i * 3 + 1]!, J[i * 3 + 2]!); h.joints[i]!.scale.setScalar(i === 0 ? rb * 1.5 : rb); }
    for (let t = 0; t < 5; t++) { h.joints[BIPED_BONES + t]!.position.set(E[t * 3]!, E[t * 3 + 1]!, E[t * 3 + 2]!); h.joints[BIPED_BONES + t]!.scale.setScalar(rb * (t === 0 ? 1.6 : 0.7)); }
  },
  dispose(h, three) {
    three.scene.remove(h.root);
    h.geos.forEach((g) => g.dispose()); h.mats.forEach((m) => m.dispose());
  },
});
