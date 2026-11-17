/** Джиттер проекции для TAA: чистая математика без Three.js (тестируется в node). Всё считается от НОМЕРА кадра, не от часов. */

/** i-й член последовательности Хэлтона по основанию b (i ≥ 1): число в (0, 1). */
export function halton(i: number, b: number): number {
  let f = 1, r = 0;
  for (; i > 0; i = Math.floor(i / b)) r += (f /= b) * (i % b);
  return r;
}

/** Длина цикла джиттера обычного TAA, кадров. */
export const TAA_PHASES = 8;

/** Смещение центра сэмпла внутри пикселя, в пикселях, диапазон (−0.5, 0.5), y вверх. frame — номер кадра после сброса истории. */
export function taaJitter(frame: number): [number, number] {
  const i = (frame % TAA_PHASES) + 1;
  return [halton(i, 2) - 0.5, halton(i, 3) - 0.5];
}

/**
 * N смещений для режима накопления: Хэлтон 1..N, сдвинутый так, чтобы среднее было нулевым (иначе изображение
 * смещается на доли пикселя). N = 1 даёт нулевое смещение: кадр без джиттера.
 */
export function accumulationOffsets(n: number): [number, number][] {
  const raw: [number, number][] = [];
  for (let i = 1; i <= n; i++) raw.push([halton(i, 2) - 0.5, halton(i, 3) - 0.5]);
  const mx = raw.reduce((a, o) => a + o[0], 0) / n, my = raw.reduce((a, o) => a + o[1], 0) / n;
  return raw.map(([x, y]) => [x - mx, y - my]);
}
