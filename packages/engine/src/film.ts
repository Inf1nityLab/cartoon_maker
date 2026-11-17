import type { FilmDoc } from '@cartoon/schema';

export type SceneSlot = { sceneId: string; start: number; end: number };

/**
 * Раскладка сцен по времени фильма. Начало сцены не хранится, а вычисляется:
 * конец предыдущей минус наложение перехода (fade/dissolve). Удлинил сцену — следующие сдвинулись сами.
 * @param durations длительность каждой сцены по её sceneDocId
 */
export function layout(film: FilmDoc, durations: Record<string, number>): SceneSlot[] {
  const out: SceneSlot[] = [];
  for (const [i, s] of film.scenes.entries()) {
    const dur = durations[s.sceneDocId];
    if (dur === undefined) throw new Error(`scenes[${i}]: нет длительности сцены «${s.sceneDocId}»`);
    const prev = out[i - 1];
    const overlap = prev && s.transition.kind !== 'cut' ? Math.min(s.transition.duration, dur, prev.end - prev.start) : 0;
    const start = prev ? prev.end - overlap : 0;
    out.push({ sceneId: s.id, start, end: start + dur });
  }
  return out;
}

/** Время фильма → сцена и время внутри неё. В наложении побеждает следующая сцена. */
export function toSceneTime(slots: SceneSlot[], t: number): { sceneId: string; t: number } {
  if (!slots.length) throw new Error('В фильме нет сцен');
  let hit = slots[0]!;
  for (const s of slots) if (s.start <= t + 1e-9) hit = s;
  return { sceneId: hit.sceneId, t: Math.max(0, Math.min(hit.end - hit.start, t - hit.start)) };
}

export function toFilmTime(slots: SceneSlot[], sceneId: string, t: number): number {
  const s = slots.find((x) => x.sceneId === sceneId);
  if (!s) throw new Error(`Нет сцены «${sceneId}» в раскладке`);
  return s.start + t;
}
