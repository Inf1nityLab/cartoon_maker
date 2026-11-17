/**
 * Пост-эффекты кино: чистая математика и данные без Three.js (тестируется в node). TSL-код в pipeline.ts повторяет
 * эти формулы один в один; тесты держат обе стороны на одном поведении (cocRadius ↔ узел coc).
 */

export type Vec3 = [number, number, number];
export type CropKind = 'none' | '2.39:1' | '9:16';

/** Вид плёнки (из компонента FilmLook). */
export type LookSettings = { warmth: number; contrast: number; saturation: number; vignette: number; crop: CropKind; rays: number };
/** Глубина резкости камеры (из WorldState.camera.dof, focus уже в метрах). */
export type DofSettings = { focus: number; range: number; strength: number };
/** Всё, что кадру нужно сверх сцены. null — пост-проходов нет вовсе. */
export type PostFrame = { look: LookSettings | null; dof: DofSettings | null; sunDir: Vec3 | null };

/** Высота кадра, при которой strength — радиус в пикселях. */
export const DOF_REF_HEIGHT = 720;
/** Число выборок сборки (спираль «подсолнух»). */
export const DOF_TAPS = 40;

/**
 * Радиус нерезкости, пиксели. z — расстояние вдоль взгляда (линейная глубина, м). Внутри focus±range резко (0);
 * дальше растёт как dz/z (тонкая линза: близкое размывается быстро, далёкое выходит на предел) и не превышает
 * strength·(высота/720). Бесконечность (небо) = предел.
 */
export function cocRadius(z: number, focus: number, range: number, strength: number, height: number): number {
  const dz = Math.max(Math.abs(z - focus) - range, 0);
  const k = z > 0 ? Math.min(dz / z, 1) : 1;
  return strength * (height / DOF_REF_HEIGHT) * k;
}

/** Линейная глубина (м вдоль взгляда) из значения буфера глубины 0…1 перспективной камеры. */
export function linearDepth(d: number, near: number, far: number): number {
  return (near * far) / (far - (far - near) * d); // модуль perspectiveDepthToViewZ из three
}

/**
 * Прямоугольник видимого кадра в пикселях [x0, y0, x1, y1) для рамки crop в холсте w×h. Границы целые: край полос
 * резкий и не зависит от дробей. none — весь холст.
 */
export function cropRect(w: number, h: number, crop: CropKind): [number, number, number, number] {
  if (crop === 'none') return [0, 0, w, h];
  const A = crop === '2.39:1' ? 2.39 : 9 / 16;
  const a = w / h;
  if (a > A) { const cw = Math.round(h * A), x0 = Math.floor((w - cw) / 2); return [x0, 0, x0 + cw, h]; }
  const ch = Math.round(w / A), y0 = Math.floor((h - ch) / 2);
  return [0, y0, w, y0 + ch];
}

/** Положение солнца на экране: uv (y вниз) и «смотрит ли камера в его сторону». Матрицы — три колонко-мажорных массива 4×4. */
export function sunScreen(sunDir: Vec3, camPos: Vec3, viewInv: ArrayLike<number>, proj: ArrayLike<number>): { u: number; v: number; facing: boolean; off: number } {
  const far = 1e5;
  const p: Vec3 = [camPos[0] + sunDir[0] * far, camPos[1] + sunDir[1] * far, camPos[2] + sunDir[2] * far];
  const mul = (m: ArrayLike<number>, x: number, y: number, z: number, w: number): [number, number, number, number] => [
    m[0]! * x + m[4]! * y + m[8]! * z + m[12]! * w, m[1]! * x + m[5]! * y + m[9]! * z + m[13]! * w,
    m[2]! * x + m[6]! * y + m[10]! * z + m[14]! * w, m[3]! * x + m[7]! * y + m[11]! * z + m[15]! * w,
  ];
  const e = mul(viewInv, p[0], p[1], p[2], 1);
  const c = mul(proj, e[0], e[1], e[2], 1);
  const facing = e[2] < 0 && c[3] > 0;
  const x = c[0] / (c[3] || 1), y = c[1] / (c[3] || 1);
  return { u: x * 0.5 + 0.5, v: 0.5 - y * 0.5, facing, off: Math.max(Math.abs(x), Math.abs(y)) };
}

/** Множитель силы лучей по тому, насколько солнце ушло за край кадра: 1 в кадре, плавно до 0 в 1.6 «радиуса» от центра. */
export function raysFade(off: number): number {
  const t = Math.max(0, Math.min(1, (1.6 - off) / 0.6));
  return t * t * (3 - 2 * t);
}
