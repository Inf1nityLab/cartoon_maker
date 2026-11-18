// Рост одного дерева: рецепт (данные из components) → генератор ez-tree (MIT) → наши геометрии коры и листвы.
// Дерево нормировано по высоте (1 = макушка); вид масштабирует до роста в метрах. Всё — функция рецепта и seed.
import * as THREE from 'three/webgpu';
import { Tree as EzTree } from '@dgreenheck/ez-tree';
import { ezOptions, type TreeShape } from '@cartoon/components';
import { hash32 } from '@cartoon/schema';

export type Grown = {
  bark: THREE.BufferGeometry;
  leaves: THREE.BufferGeometry;
  /** сколько листьев (единиц по 6 или 12 индексов) в геометрии; порядок — по случайному рангу, поэтому рисуется префикс */
  leafUnits: number;
  indicesPerLeaf: number;
};

const rank = (seed: number, i: number): number => (hash32(`leaf:${seed}:${i}`) >>> 0) / 4294967296;

/** Выросшее дерево ступени возраста `stage`. */
export function grow(shape: TreeShape, stage: 0 | 1 | 2): Grown {
  const ez = new EzTree();
  ez.options.copy(ezOptions(shape, stage) as never);
  ez.generate();
  const b = ez.branches as { verts: number[]; normals: number[]; indices: number[]; uvs: number[] };
  const l = ez.leaves as { verts: number[]; indices: number[]; uvs: number[] };
  const double = ez.options.leaves.billboard === 'double';
  let top = 1e-6;
  for (const v of [b.verts, l.verts]) for (let i = 1; i < v.length; i += 3) top = Math.max(top, v[i]!);
  const k = 1 / top;
  const [tx, ty] = [ez.options.bark.textureScale.x, ez.options.bark.textureScale.y];

  // ---- кора
  const bark = new THREE.BufferGeometry();
  bark.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(b.verts, (v) => v * k), 3));
  bark.setAttribute('normal', new THREE.BufferAttribute(Float32Array.from(b.normals), 3));
  bark.setAttribute('uv', new THREE.BufferAttribute(Float32Array.from(b.uvs, (v, i) => (i % 2 === 0 ? v * tx : v / ty)), 2));
  bark.setIndex(new THREE.BufferAttribute(Uint32Array.from(b.indices), 1));

  // ---- листва: листья (одна или две пересекающиеся пластины) в порядке случайного ранга
  const quads = l.verts.length / 12, per = double ? 2 : 1, units = Math.floor(quads / per);
  const order = Array.from({ length: units }, (_, i) => i);
  const ranks = order.map((i) => rank(shape.seed * 7 + stage, i));
  order.sort((a, c) => ranks[a]! - ranks[c]! || a - c);
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < l.verts.length; i += 3) { cx += l.verts[i]!; cy += l.verts[i + 1]!; cz += l.verts[i + 2]!; }
  const nv = l.verts.length / 3;
  cx /= nv; cy /= nv; cz /= nv;
  const vpu = 4 * per; // вершин на лист
  const pos = new Float32Array(units * vpu * 3), nrm = new Float32Array(units * vpu * 3), uv = new Float32Array(units * vpu * 2), data = new Float32Array(units * vpu * 4);
  const idx = new Uint32Array(units * per * 6);
  const q = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3(), out = new THREE.Vector3();
  order.forEach((src, dst) => {
    const r0 = rank(shape.seed * 13 + stage, src), r1 = rank(shape.seed * 17 + stage, src + 100003), phase = rank(shape.seed * 19 + stage, src + 200003);
    for (let v = 0; v < vpu; v++) {
      const s = src * vpu + v, d = dst * vpu + v;
      pos[d * 3] = l.verts[s * 3]! * k; pos[d * 3 + 1] = l.verts[s * 3 + 1]! * k; pos[d * 3 + 2] = l.verts[s * 3 + 2]! * k;
      uv[d * 2] = l.uvs[s * 2]!; uv[d * 2 + 1] = l.uvs[s * 2 + 1]!;
      data[d * 4] = r0; data[d * 4 + 1] = dst / units; data[d * 4 + 2] = phase; data[d * 4 + 3] = r1;
    }
    // нормаль листа: плоская нормаль пластины, наклонённая от центра кроны (мягкий объёмный свет вместо шума отдельных пластин)
    for (let p = 0; p < per; p++) {
      const o = dst * vpu + p * 4;
      q.fromArray(pos, o * 3);
      e1.fromArray(pos, (o + 1) * 3).sub(q); e2.fromArray(pos, (o + 2) * 3).sub(q);
      n.crossVectors(e1, e2).normalize();
      out.set(pos[o * 3]! - cx * k, pos[o * 3 + 1]! - cy * k, pos[o * 3 + 2]! - cz * k).normalize();
      if (n.dot(out) < 0) n.negate();
      n.lerp(out, 0.65).normalize();
      for (let v = 0; v < 4; v++) nrm.set([n.x, n.y, n.z], (o + v) * 3);
      const base = (dst * per + p) * 6;
      idx.set([o, o + 1, o + 2, o, o + 2, o + 3], base);
    }
  });
  const leaves = new THREE.BufferGeometry();
  leaves.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  leaves.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  leaves.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  leaves.setAttribute('leafData', new THREE.BufferAttribute(data, 4));
  leaves.setIndex(new THREE.BufferAttribute(idx, 1));
  ez.branchesMesh.geometry.dispose(); ez.leavesMesh.geometry.dispose();
  (ez.branchesMesh.material as THREE.Material).dispose(); (ez.leavesMesh.material as THREE.Material).dispose();
  return { bark, leaves, leafUnits: units, indicesPerLeaf: per * 6 };
}
