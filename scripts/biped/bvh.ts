import { readFileSync } from 'node:fs';
import { fromAxisAngle, mul } from '../../packages/components/src/biped/quat.ts';
import type { SrcMotion, SrcRig } from './source.ts';

type Joint = { name: string; parent: number; offset: [number, number, number]; channels: string[]; first: number };

/**
 * Чтение BVH (100STYLE: сантиметры, Y вверх, поза покоя Т, оси суставов в покое совпадают с мировыми).
 * Повороты в порядке каналов файла: R = R1·R2·R3 (первый канал — внешний). Единицы переводим в метры.
 * Берутся кадры [from, to).
 */
export function readBvh(path: string, from = 0, to = Infinity): SrcMotion {
  const text = readFileSync(path, 'utf8');
  const mi = text.indexOf('MOTION');
  const tk = text.slice(0, mi).split(/\s+/).filter(Boolean);
  const joints: Joint[] = [];
  let p = 0, nch = 0;
  const parseJoint = (parent: number): void => {
    // tk[p] — имя после ROOT/JOINT
    const j: Joint = { name: tk[p++]!, parent, offset: [0, 0, 0], channels: [], first: 0 };
    const id = joints.push(j) - 1;
    if (tk[p++] !== '{') throw new Error('ожидалась {');
    while (tk[p] !== '}') {
      const t = tk[p++]!;
      if (t === 'OFFSET') { j.offset = [Number(tk[p]), Number(tk[p + 1]), Number(tk[p + 2])]; p += 3; }
      else if (t === 'CHANNELS') { const n = Number(tk[p++]); j.channels = tk.slice(p, p + n); p += n; j.first = nch; nch += n; }
      else if (t === 'JOINT') parseJoint(id);
      else if (t === 'End') { p++; /* Site */ p++; /* { */ while (tk[p] !== '}') p++; p++; }
      else throw new Error(`неожиданный токен ${t}`);
    }
    p++; // }
  };
  if (tk[p++] !== 'HIERARCHY' || tk[p++] !== 'ROOT') throw new Error('не BVH');
  parseJoint(-1);

  const lines = text.slice(mi).split('\n');
  const total = Number(lines[1]!.split(':')[1]);
  const dt = Number(lines[2]!.split(':')[1]);
  const a = Math.max(0, from), b = Math.min(total, to);
  const n = b - a, nj = joints.length;
  const CM = 0.01;

  const names = joints.map((j) => j.name), parent = joints.map((j) => j.parent);
  const restPos = new Float64Array(nj * 3), restQ = new Float64Array(nj * 4);
  joints.forEach((j, i) => {
    restQ.set([0, 0, 0, 1], i * 4);
    for (let k = 0; k < 3; k++) restPos[i * 3 + k] = (j.parent < 0 ? 0 : restPos[j.parent * 3 + k]!) + j.offset[k]! * CM;
  });

  const hips = new Float64Array(n * 3), wq = new Float64Array(n * nj * 4);
  const axis: Record<string, [number, number, number]> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
  const vals = new Float64Array(nch);
  for (let f = 0; f < n; f++) {
    const row = lines[3 + a + f]!.trim().split(/\s+/);
    for (let k = 0; k < nch; k++) vals[k] = Number(row[k]);
    for (let ji = 0; ji < nj; ji++) {
      const j = joints[ji]!;
      let q: number[] = [0, 0, 0, 1];
      j.channels.forEach((c, k) => {
        if (c.endsWith('rotation')) { const ax = axis[c[0]!]!; q = mul(q, fromAxisAngle(ax[0], ax[1], ax[2], (vals[j.first + k]! * Math.PI) / 180)); }
      });
      if (j.parent < 0) {
        const pos = [0, 0, 0];
        j.channels.forEach((c, k) => { if (c.endsWith('position')) pos['XYZ'.indexOf(c[0]!)] = vals[j.first + k]! * CM; });
        hips.set(pos, f * 3);
        wq.set(q, (f * nj + ji) * 4);
      } else {
        const pq = wq.subarray((f * nj + j.parent) * 4, (f * nj + j.parent) * 4 + 4);
        wq.set(mul(pq, q), (f * nj + ji) * 4);
      }
    }
  }
  const rig: SrcRig = { names, parent, restPos, restQ };
  return { rig, fps: Math.round(1 / dt), frames: n, hips, wq };
}
