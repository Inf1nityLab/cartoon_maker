import type { WorldState } from './types.ts';

/** FNV-1a: строка → 32-битное число. Одинаково везде. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function stable(v: unknown): unknown {
  if (typeof v === 'number') return Math.round(v * 1e4) / 1e4 + 0; // +0: убирает -0
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v as object)
        .sort()
        .map((k) => [k, stable((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

/** Стабильный хэш: ключи отсортированы, числа округлены до 1e-4. Для тестов детерминизма. */
export function hashWorldState(state: WorldState): string {
  const text = JSON.stringify(stable(state));
  // два разных хэша подряд — чтобы совпадение случайно было практически невозможным
  return hash32(text).toString(16).padStart(8, '0') + hash32('~' + text).toString(16).padStart(8, '0');
}
