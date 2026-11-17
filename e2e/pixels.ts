/** Сравнение двух RGBA-буферов одного размера: общий для e2e-тестов допуск (≤0.01 % пикселей, ≤2/255 по каналу). */
export const MAX_SHARE = 0.0001;
export const MAX_CHANNEL = 2;

export const diff = (a: Buffer, b: Buffer, width: number) => {
  let n = 0, max = 0;
  const where: { x: number; y: number; a: number[]; b: number[] }[] = [];
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.max(Math.abs(a[i]! - b[i]!), Math.abs(a[i + 1]! - b[i + 1]!), Math.abs(a[i + 2]! - b[i + 2]!), Math.abs(a[i + 3]! - b[i + 3]!));
    if (d) { n++; if (d > max) max = d; if (where.length < 5) where.push({ x: (i / 4) % width, y: Math.floor(i / 4 / width), a: [...a.subarray(i, i + 4)], b: [...b.subarray(i, i + 4)] }); }
  }
  return { differing: n, total: a.length / 4, maxChannelDiff: max, firstDifferences: where };
};
