// Своя математика кватернионов и векторов для Biped (three в components нельзя). Кватернион — [x, y, z, w],
// все функции пишут в массив `out` (можно подставлять один из входов) и ничего не выделяют на горячем пути.
export type Q = [number, number, number, number];
export type V3 = [number, number, number];

export const qIdentity = (): Q => [0, 0, 0, 1];

export function qMul(a: ArrayLike<number>, ai: number, b: ArrayLike<number>, bi: number, out: number[] | Float64Array, oi: number): void {
  const ax = a[ai]!, ay = a[ai + 1]!, az = a[ai + 2]!, aw = a[ai + 3]!;
  const bx = b[bi]!, by = b[bi + 1]!, bz = b[bi + 2]!, bw = b[bi + 3]!;
  out[oi] = aw * bx + ax * bw + ay * bz - az * by;
  out[oi + 1] = aw * by - ax * bz + ay * bw + az * bx;
  out[oi + 2] = aw * bz + ax * by - ay * bx + az * bw;
  out[oi + 3] = aw * bw - ax * bx - ay * by - az * bz;
}

export const mul = (a: ArrayLike<number>, b: ArrayLike<number>): Q => { const o: Q = [0, 0, 0, 1]; qMul(a, 0, b, 0, o, 0); return o; };
export const conj = (a: ArrayLike<number>): Q => [-a[0]!, -a[1]!, -a[2]!, a[3]!];

export function normalize(a: number[] | Float64Array, i = 0): void {
  const l = Math.hypot(a[i]!, a[i + 1]!, a[i + 2]!, a[i + 3]!) || 1;
  a[i] = a[i]! / l; a[i + 1] = a[i + 1]! / l; a[i + 2] = a[i + 2]! / l; a[i + 3] = a[i + 3]! / l;
}

export function fromAxisAngle(x: number, y: number, z: number, angle: number): Q {
  const l = Math.hypot(x, y, z) || 1, s = Math.sin(angle / 2) / l;
  return [x * s, y * s, z * s, Math.cos(angle / 2)];
}

/** Поворот вектора кватернионом. */
export function rotate(q: ArrayLike<number>, qi: number, v: ArrayLike<number>, out: number[] | Float64Array, oi = 0, vi = 0): void {
  const x = q[qi]!, y = q[qi + 1]!, z = q[qi + 2]!, w = q[qi + 3]!;
  const vx = v[vi]!, vy = v[vi + 1]!, vz = v[vi + 2]!;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  out[oi] = vx + w * tx + (y * tz - z * ty);
  out[oi + 1] = vy + w * ty + (z * tx - x * tz);
  out[oi + 2] = vz + w * tz + (x * ty - y * tx);
}

/** Сферическая интерполяция по кратчайшему пути. a, b → out. */
export function slerp(a: ArrayLike<number>, ai: number, b: ArrayLike<number>, bi: number, t: number, out: number[] | Float64Array, oi: number): void {
  let bx = b[bi]!, by = b[bi + 1]!, bz = b[bi + 2]!, bw = b[bi + 3]!;
  const ax = a[ai]!, ay = a[ai + 1]!, az = a[ai + 2]!, aw = a[ai + 3]!;
  let d = ax * bx + ay * by + az * bz + aw * bw;
  if (d < 0) { d = -d; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  let k0: number, k1: number;
  if (d > 0.9995) { k0 = 1 - t; k1 = t; } else {
    const th = Math.acos(d), s = Math.sin(th);
    k0 = Math.sin((1 - t) * th) / s; k1 = Math.sin(t * th) / s;
  }
  out[oi] = ax * k0 + bx * k1; out[oi + 1] = ay * k0 + by * k1; out[oi + 2] = az * k0 + bz * k1; out[oi + 3] = aw * k0 + bw * k1;
  if (d > 0.9995) normalize(out, oi);
}

/** Кратчайший поворот, переводящий направление a в направление b (оба ненулевые). */
export function fromTo(a: ArrayLike<number>, b: ArrayLike<number>): Q {
  const la = Math.hypot(a[0]!, a[1]!, a[2]!), lb = Math.hypot(b[0]!, b[1]!, b[2]!);
  const ax = a[0]! / la, ay = a[1]! / la, az = a[2]! / la, bx = b[0]! / lb, by = b[1]! / lb, bz = b[2]! / lb;
  const d = ax * bx + ay * by + az * bz;
  if (d < -0.999999) { // противоположны: любая перпендикулярная ось
    let px = -ay, py = ax, pz = 0;
    if (Math.hypot(px, py) < 1e-6) { px = 0; py = -az; pz = ay; }
    return fromAxisAngle(px, py, pz, Math.PI);
  }
  const q: Q = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx, 1 + d];
  normalize(q);
  return q;
}

/** Угол поворота между двумя кватернионами, рад. */
export function angleBetween(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const d = Math.abs(a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!);
  return 2 * Math.acos(Math.min(1, d));
}

/** Поворот вокруг вертикали (курс): 0 = +Z, растёт влево (как heading в мире), рад. */
export const yawQ = (yaw: number): Q => fromAxisAngle(0, 1, 0, yaw);

/** Евклидовы углы (X, Y, Z порядком «сначала X в локальных осях, затем…» = q = qx·qy·qz) для удобства ручных поз. */
export const eulerXYZ = (x: number, y: number, z: number): Q => mul(mul(fromAxisAngle(1, 0, 0, x), fromAxisAngle(0, 1, 0, y)), fromAxisAngle(0, 0, 1, z));
