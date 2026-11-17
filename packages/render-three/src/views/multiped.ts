import * as THREE from 'three';
import { defineView } from '../view.ts';

type Handle = { root: THREE.Group; legs: { upper: THREE.Mesh; lower: THREE.Mesh; side: number; row: number; group: number }[]; params: any };

const UP = new THREE.Vector3(0, 1, 0);

/** Ставит цилиндр единичной высоты между двумя точками. */
function segment(m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) {
  const d = b.clone().sub(a), len = d.length() || 1e-6;
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(UP, d.divideScalar(len));
  m.scale.set(1, len, 1);
}

/** Двухсуставный IK: колено лежит в плоскости (бедро, стопа, «вверх») на расстояниях upper/lower. */
function knee(hip: THREE.Vector3, foot: THREE.Vector3, upper: number, lower: number): THREE.Vector3 {
  const d = foot.clone().sub(hip);
  const dist = Math.min(d.length(), upper + lower - 1e-3);
  const dir = d.clone().normalize();
  const a = (upper * upper - lower * lower + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, upper * upper - a * a));
  const side = new THREE.Vector3().crossVectors(dir, UP).normalize();
  const up = new THREE.Vector3().crossVectors(side, dir).normalize();
  return hip.clone().addScaledVector(dir, a).addScaledVector(up, h);
}

export const MultipedView = defineView<Handle>('Multiped', {
  mount(three, inst) {
    const p = inst.params as { legs?: number; color?: string; bodyHeight?: number };
    const legs = p.legs ?? 8;
    const mat = new THREE.MeshStandardMaterial({ color: p.color ?? '#ff5a1f', metalness: 0.45, roughness: 0.45 });
    const dark = new THREE.MeshStandardMaterial({ color: '#2b2f36', metalness: 0.6, roughness: 0.5 });
    const root = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.9, 24, 16), mat);
    body.scale.set(1, 0.7, 1.35);
    body.name = 'body';
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 12), dark);
    head.position.set(0, 0, 1.15);
    body.add(head);
    root.add(body);
    for (const e of [-0.2, 0.2]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), new THREE.MeshStandardMaterial({ color: '#ffe36a', emissive: '#ffb000', emissiveIntensity: 1.5 }));
      eye.position.set(e, 0.1, 1.55);
      body.add(eye);
    }
    const cyl = new THREE.CylinderGeometry(0.1, 0.07, 1, 8);
    const list: Handle['legs'] = [];
    const rows = Math.ceil(legs / 2);
    for (let i = 0; i < legs; i++) {
      const upper = new THREE.Mesh(cyl, mat), lower = new THREE.Mesh(cyl, dark);
      upper.castShadow = lower.castShadow = true;
      root.add(upper, lower);
      const row = Math.floor(i / 2);
      list.push({ upper, lower, side: i % 2 ? 1 : -1, row: rows > 1 ? row / (rows - 1) - 0.5 : 0, group: (row + (i % 2)) % 2 });
    }
    body.castShadow = true;
    three.scene.add(root);
    return { root, legs: list, params: inst.params };
  },
  sync(h, self, three) {
    const bodyH = h.params.bodyHeight ?? 1.35, up = h.params.upperLeg ?? 1.75, lo = h.params.lowerLeg ?? 2.15;
    const { heightAt } = three.sim().services;
    h.root.position.set(self.pos[0], self.pos[1], self.pos[2]);
    h.root.rotation.y = (self.heading * Math.PI) / 180;
    h.root.updateMatrixWorld(true);
    const moving = self.speed > 0.05;
    const body = h.root.getObjectByName('body')!;
    body.position.y = bodyH + (moving ? Math.sin(self.phase * 2) * 0.06 : 0);
    for (const l of h.legs) {
      // стопа: положение покоя сбоку от корпуса + шаг вперёд-назад, поднимается в фазе переноса
      const ph = self.phase + l.group * Math.PI;
      const swing = moving ? Math.sin(ph) : 0, lift = moving ? Math.max(0, Math.cos(ph)) : 0;
      const local = new THREE.Vector3(l.side * 3.1, 0, l.row * 2.6 + swing * 0.9);
      const world = local.clone().applyMatrix4(h.root.matrixWorld);
      world.y = heightAt(world.x, world.z) + lift * 0.7;
      const footLocal = h.root.worldToLocal(world.clone());
      const hip = new THREE.Vector3(l.side * 0.7, bodyH, l.row * 1.6);
      const k = knee(hip, footLocal, up, lo);
      segment(l.upper, hip, k);
      segment(l.lower, k, footLocal);
    }
  },
  dispose(h, three) { three.scene.remove(h.root); },
});
