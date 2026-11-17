import type { Vec3 } from '@cartoon/schema';
import type { PathSampler } from './component.ts';

/** Путь по точкам: сглаженная кривая (Catmull-Rom), параметр u — доля длины. */
export function createPath(points: Vec3[], closed: boolean): PathSampler {
  const n = points.length;
  const get = (i: number): Vec3 => (closed ? points[((i % n) + n) % n]! : points[Math.max(0, Math.min(n - 1, i))]!);
  const segs = closed ? n : n - 1;
  const PER = 24;
  const dense: Vec3[] = [];
  for (let s = 0; s < segs; s++) {
    const p0 = get(s - 1), p1 = get(s), p2 = get(s + 1), p3 = get(s + 2);
    for (let k = 0; k < PER; k++) {
      const t = k / PER, t2 = t * t, t3 = t2 * t;
      dense.push([0, 1, 2].map((a) =>
        0.5 * (2 * p1[a]! + (-p0[a]! + p2[a]!) * t + (2 * p0[a]! - 5 * p1[a]! + 4 * p2[a]! - p3[a]!) * t2 + (-p0[a]! + 3 * p1[a]! - 3 * p2[a]! + p3[a]!) * t3),
      ) as Vec3);
    }
  }
  dense.push(closed ? dense[0]! : points[n - 1]!);
  const acc: number[] = [0];
  for (let i = 1; i < dense.length; i++) {
    const a = dense[i - 1]!, b = dense[i]!;
    acc.push(acc[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  }
  const length = acc[acc.length - 1]!;
  const norm = (u: number) => (closed ? ((u % 1) + 1) % 1 : Math.max(0, Math.min(1, u)));
  const locate = (u: number): [number, number] => {
    const d = norm(u) * length;
    let lo = 0, hi = acc.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (acc[mid]! <= d) lo = mid; else hi = mid;
    }
    const span = acc[hi]! - acc[lo]!;
    return [lo, span > 0 ? (d - acc[lo]!) / span : 0];
  };
  return {
    length,
    getPointAt(u) {
      const [i, f] = locate(u);
      const a = dense[i]!, b = dense[i + 1]!;
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    },
    getTangentAt(u) {
      const [i] = locate(u);
      const a = dense[i]!, b = dense[Math.min(i + 1, dense.length - 1)]!;
      const l = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1;
      return [(b[0] - a[0]) / l, (b[1] - a[1]) / l, (b[2] - a[2]) / l];
    },
  };
}
