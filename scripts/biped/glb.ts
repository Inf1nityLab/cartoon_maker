import { readFileSync } from 'node:fs';
import { mul, rotate, slerp } from '../../packages/components/src/biped/quat.ts';
import type { SrcMotion, SrcRig } from './source.ts';

type GNode = { name?: string; children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] };
type Gltf = { nodes: GNode[]; skins: { joints: number[] }[]; animations: { name: string; channels: { sampler: number; target: { node: number; path: string } }[]; samplers: { input: number; output: number }[] }[]; accessors: { bufferView: number; count: number; componentType: number; type: string; byteOffset?: number }[]; bufferViews: { byteOffset?: number; byteLength: number }[] };

export type Glb = { j: Gltf; bin: Buffer };
export const readGlb = (path: string): Glb => {
  const b = readFileSync(path);
  const l = b.readUInt32LE(12);
  const j = JSON.parse(b.subarray(20, 20 + l).toString()) as Gltf;
  const binStart = 20 + l + 8;
  return { j, bin: b.subarray(binStart) };
};
const accessor = (g: Glb, idx: number): Float32Array => {
  const a = g.j.accessors[idx]!, v = g.j.bufferViews[a.bufferView]!;
  const comps = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type as 'SCALAR']!;
  const off = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  return new Float32Array(g.bin.buffer.slice(g.bin.byteOffset + off, g.bin.byteOffset + off + a.count * comps * 4));
};

/** Скелет glTF: суставы skin[0]; корень сцены даёт мировое преобразование (Z-вверх в Y-вверх). */
function structure(g: Glb) {
  const sk = g.j.skins[0]!.joints;
  const parentOf = new Map<number, number>();
  g.j.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parentOf.set(c, i)));
  // порядок обхода: от корня сцены вниз по всем узлам, содержащим суставы
  const chain = (n: number): number[] => { const r: number[] = []; for (let x: number | undefined = n; x !== undefined; x = parentOf.get(x)) r.unshift(x); return r; };
  return { sk, parentOf, chain };
}

/** Все локальные TRS узлов на кадр → мировые повороты и положения указанных узлов. */
function worldOf(g: Glb, nodes: number[], trs: (n: number) => { t: number[]; q: number[] }, parentOf: Map<number, number>) {
  const cache = new Map<number, { p: number[]; q: number[] }>();
  const get = (n: number): { p: number[]; q: number[] } => {
    const c = cache.get(n); if (c) return c;
    const { t, q } = trs(n), par = parentOf.get(n);
    let r: { p: number[]; q: number[] };
    if (par === undefined) r = { p: t.slice(), q: q.slice() };
    else {
      const pw = get(par), o = [0, 0, 0];
      rotate(pw.q, 0, t, o);
      r = { p: [pw.p[0]! + o[0]!, pw.p[1]! + o[1]!, pw.p[2]! + o[2]!], q: mul(pw.q, q) };
    }
    cache.set(n, r); return r;
  };
  return nodes.map(get);
}

export function glbRig(g: Glb): SrcRig {
  const { sk, parentOf } = structure(g);
  const rest = (n: number) => ({ t: g.j.nodes[n]!.translation ?? [0, 0, 0], q: g.j.nodes[n]!.rotation ?? [0, 0, 0, 1] });
  const w = worldOf(g, sk, rest, parentOf);
  const idx = new Map(sk.map((n, i) => [n, i]));
  const parent = sk.map((n) => { let x = parentOf.get(n); while (x !== undefined && !idx.has(x)) x = parentOf.get(x); return x === undefined ? -1 : idx.get(x)!; });
  const restPos = new Float64Array(sk.length * 3), restQ = new Float64Array(sk.length * 4);
  w.forEach((x, i) => { restPos.set(x.p, i * 3); restQ.set(x.q, i * 4); });
  return { names: sk.map((n) => g.j.nodes[n]!.name!), parent, restPos, restQ };
}

/** Анимация по имени, на сетке 30 к/с (как в файле): мировые повороты суставов и положение таза. Корневой узел 'root' даёт движение корня. */
export function glbMotion(g: Glb, name: string, hipsName = 'pelvis'): SrcMotion & { rootPos: Float64Array } {
  const { sk, parentOf } = structure(g);
  const rig = glbRig(g);
  const an = g.j.animations.find((a) => a.name === name);
  if (!an) throw new Error(`нет анимации ${name}`);
  type Track = { times: Float32Array; vals: Float32Array; comps: number };
  const tr = new Map<string, Track>();
  let dur = 0;
  for (const c of an.channels) {
    const s = an.samplers[c.sampler]!, times = accessor(g, s.input), vals = accessor(g, s.output);
    if (c.target.path === 'scale') continue;
    tr.set(`${c.target.node}:${c.target.path}`, { times, vals, comps: c.target.path === 'rotation' ? 4 : 3 });
    dur = Math.max(dur, times[times.length - 1]!);
  }
  const fps = 30, frames = Math.round(dur * fps) + 1;
  const nj = sk.length, hi = rig.names.indexOf(hipsName), ri = g.j.nodes.findIndex((n) => n.name === 'root');
  const hips = new Float64Array(frames * 3), rootPos = new Float64Array(frames * 3), wq = new Float64Array(frames * nj * 4);
  const sample = (node: number, path: 'translation' | 'rotation', time: number): number[] => {
    const t = tr.get(`${node}:${path}`);
    if (!t) return path === 'rotation' ? (g.j.nodes[node]!.rotation ?? [0, 0, 0, 1]) : (g.j.nodes[node]!.translation ?? [0, 0, 0]);
    let k = 0; while (k < t.times.length - 2 && t.times[k + 1]! <= time) k++;
    const k1 = Math.min(k + 1, t.times.length - 1), span = t.times[k1]! - t.times[k]!, u = span > 0 ? Math.min(1, Math.max(0, (time - t.times[k]!) / span)) : 0;
    const A = Array.from(t.vals.subarray(k * t.comps, k * t.comps + t.comps)), Bv = Array.from(t.vals.subarray(k1 * t.comps, k1 * t.comps + t.comps));
    if (path === 'rotation') { const o = [0, 0, 0, 1]; slerp(A, 0, Bv, 0, u, o, 0); return o; }
    return A.map((a, i) => a + (Bv[i]! - a) * u);
  };
  for (let f = 0; f < frames; f++) {
    const time = f / fps;
    const trs = (n: number) => ({ t: sample(n, 'translation', time), q: sample(n, 'rotation', time) });
    const w = worldOf(g, sk, trs, parentOf);
    w.forEach((x, i) => wq.set(x.q, (f * nj + i) * 4));
    hips.set(w[hi]!.p, f * 3);
    rootPos.set(worldOf(g, [ri], trs, parentOf)[0]!.p, f * 3);
  }
  return { rig, fps, frames, hips, wq, rootPos };
}
