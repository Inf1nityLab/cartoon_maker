import type { SceneDoc } from './types.ts';

/** Чистая функция: документ версии scene@N → scene@N+1. */
export type Migration = (doc: any) => any;

/** Цепочка миграций. Ключ — версия, из которой уходим. В этапе 0 пустая: scene@1 — текущая. */
export const SCENE_MIGRATIONS: Record<string, { to: string; run: Migration }> = {};

export const CURRENT_SCENE_SCHEMA = 'scene@1';

/** Приводит документ любой известной версии к текущей. Валидацию делает validateSceneDoc. */
export function migrate(doc: unknown, chain: Record<string, { to: string; run: Migration }> = SCENE_MIGRATIONS, current = CURRENT_SCENE_SCHEMA): SceneDoc {
  let cur: any = doc;
  for (let guard = 0; guard < 100; guard++) {
    const v = cur?.schema;
    if (v === current) return cur as SceneDoc;
    const step = typeof v === 'string' ? chain[v] : undefined;
    if (!step) throw new Error(`Не знаю, как открыть документ с schema «${String(v)}». Текущая версия — ${current}`);
    cur = { ...step.run(cur), schema: step.to };
  }
  throw new Error('Цепочка миграций зациклилась');
}
