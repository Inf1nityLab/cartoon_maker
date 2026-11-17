// Часть B: одно дерево ez-tree → исходные меши (метры) → кластерный DAG nanite-lib. Всё в worker, детерминированно:
// ez-tree берёт seed из опций, buildDag — чистая функция от мешей.
import { Tree, Billboard } from '@dgreenheck/ez-tree';
import { buildDag } from '../../vendor/threejs-nanites/dag/build.ts';
import type { LeafMask } from '../../vendor/threejs-nanites/dag/types.ts';
import type { GrowJob, GrowReply } from './types.ts';

const scope = self as unknown as { onmessage: (e: MessageEvent<GrowJob>) => void; postMessage(m: GrowReply, t?: Transferable[]): void };

scope.onmessage = async (e) => {
  const { preset, seed, height, leafMask } = e.data;
  try {
    const tree = new Tree();
    tree.loadPreset(preset);
    tree.options.seed = seed;
    tree.generate();
    const b = tree.branches, l = tree.leaves;
    let maxY = 0;
    for (const v of [b.verts, l.verts]) for (let i = 1; i < v.length; i += 3) maxY = Math.max(maxY, v[i]);
    const s = height / maxY;
    const tex = tree.options.bark.textureScale;
    const bark = {
      pos: Float32Array.from(b.verts, (v: number) => v * s),
      nrm: Float32Array.from(b.normals),
      uv: Float32Array.from(b.uvs, (v: number, i: number) => (i % 2 === 0 ? v * tex.x : v / tex.y)),
      idx: Uint32Array.from(b.indices),
    };
    const leaves = {
      pos: Float32Array.from(l.verts, (v: number) => v * s),
      nrm: Float32Array.from(l.normals),
      uv: Float32Array.from(l.uvs),
      vpl: tree.options.leaves.billboard === Billboard.Double ? 8 : 4,
    };
    let radius = 0;
    for (const p of [bark.pos, leaves.pos]) for (let i = 0; i < p.length; i += 3) radius = Math.max(radius, Math.hypot(p[i], p[i + 1] - height / 2, p[i + 2]));
    const mask: LeafMask = leafMask;
    // DAG строится из копий: исходные меши нужны рендереру отдельно (NaniteType.src)
    const dag = await buildDag({ id: 0, leafMask: mask, bark: structuredClone(bark), leaves: structuredClone(leaves) });
    scope.postMessage({ dag, src: { bark, leaves }, radius, height }, [dag.vtx.buffer, dag.idx.buffer, dag.rec.buffer, dag.meta.buffer]);
  } catch (err) {
    scope.postMessage({ error: String(err instanceof Error ? (err.stack ?? err) : err) });
  }
};
