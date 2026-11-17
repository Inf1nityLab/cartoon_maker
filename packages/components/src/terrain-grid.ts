/**
 * Сетка высот земли: единственный источник высоты и для CPU (`ctx.heightAt`), и для GPU (меш рисуется по тем же
 * вершинам и тем же треугольникам). Чистая математика, без three: тестируется в node.
 *
 * Вершина (i, j), i и j от 0 до n: x = −size/2 + i·step, z = −size/2 + j·step. Клетка (i, j) режется диагональю
 * (i, j+1)–(i+1, j) на два треугольника — как у PlaneGeometry после rotateX(−π/2), поэтому прежний вид лоуполи сохранён.
 */
export type GridSpec = { size: number; segments: number };

export const gridStep = (g: GridSpec) => g.size / g.segments;

/** Высоты вершин: f вызывается ровно в вершинах. Индекс j·(n+1) + i. */
export function sampleGrid(g: GridSpec, f: (x: number, z: number) => number): Float32Array {
  const n = g.segments, step = gridStep(g), half = g.size / 2;
  const h = new Float32Array((n + 1) * (n + 1));
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) h[j * (n + 1) + i] = f(-half + i * step, -half + j * step);
  return h;
}

/** Высота на поверхности меша в точке (x, z): интерполяция по тому треугольнику, где лежит точка. null — за краем. */
export function gridHeight(g: GridSpec, h: Float32Array, x: number, z: number): number | null {
  const n = g.segments, step = gridStep(g), half = g.size / 2;
  const u = (x + half) / step, v = (z + half) / step;
  if (!(u >= 0 && v >= 0 && u <= n && v <= n)) return null;
  const i = Math.min(n - 1, Math.floor(u)), j = Math.min(n - 1, Math.floor(v));
  const fx = u - i, fz = v - j, w = n + 1;
  const h00 = h[j * w + i]!, h10 = h[j * w + i + 1]!, h01 = h[(j + 1) * w + i]!, h11 = h[(j + 1) * w + i + 1]!;
  return fx + fz <= 1 ? h00 + fx * (h10 - h00) + fz * (h01 - h00) : h11 + (1 - fx) * (h01 - h11) + (1 - fz) * (h10 - h11);
}

/** Индексы треугольников (против часовой, нормаль вверх). Те же два треугольника на клетку, что в gridHeight. */
export function gridIndices(g: GridSpec): Uint32Array {
  const n = g.segments, w = n + 1, idx = new Uint32Array(n * n * 6);
  let k = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * w + i, b = (j + 1) * w + i, c = (j + 1) * w + i + 1, d = j * w + i + 1;
      idx[k++] = a; idx[k++] = b; idx[k++] = d;
      idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
  }
  return idx;
}

/** Сглаженные нормали вершин по соседним высотам (центральные разности), единичные, y вверх. */
export function gridNormals(g: GridSpec, h: Float32Array): Float32Array {
  const n = g.segments, w = n + 1, step = gridStep(g), out = new Float32Array(w * w * 3);
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(n, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(n, j + 1);
      const dx = (h[j * w + i1]! - h[j * w + i0]!) / ((i1 - i0) * step), dz = (h[j1 * w + i]! - h[j0 * w + i]!) / ((j1 - j0) * step);
      const l = Math.hypot(dx, 1, dz), o = (j * w + i) * 3;
      out[o] = -dx / l; out[o + 1] = 1 / l; out[o + 2] = -dz / l;
    }
  }
  return out;
}
