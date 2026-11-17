import { hash32 } from '@cartoon/schema';

/** Начальное состояние потока: seed сцены + id компонента. У каждого компонента свой поток. */
export function rngSeed(seed: number, componentId: string): number {
  return hash32(`${seed}:${componentId}`);
}

/** mulberry32. Возвращает [число 0..1, новое состояние]. Состояние — одно число: его можно клонировать. */
export function rngNext(state: number): [number, number] {
  const a = (state + 0x6d2b79f5) >>> 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, a];
}
