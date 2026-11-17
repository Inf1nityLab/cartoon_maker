import type { ZodError } from 'zod';
import './locale.ts';
import { FilmDocSchema, SceneDocSchema, type FilmDoc, type SceneDoc } from './types.ts';

export type Result<T> = { ok: true; doc: T } | { ok: false; errors: string[] };

/** Путь в виде timeline[3].args.speed */
export function formatPath(path: readonly PropertyKey[]): string {
  let s = '';
  for (const p of path) s += typeof p === 'number' ? `[${p}]` : s ? `.${String(p)}` : String(p);
  return s || 'документ';
}

function at(input: unknown, path: readonly PropertyKey[]): unknown {
  let cur: any = input;
  for (const p of path) cur = cur == null ? undefined : cur[p as any];
  return cur;
}

/** Сообщения zod по-русски; если передан исходный объект — дописываем, что именно пришло. */
export function zodErrors(err: ZodError, input?: unknown, prefix = ''): string[] {
  return err.issues.map((i) => {
    let msg = i.message;
    if (input !== undefined && ['too_big', 'too_small', 'invalid_value', 'invalid_type', 'invalid_format'].includes(i.code)) {
      const got = at(input, i.path);
      msg += got === undefined ? ' (поле не задано)' : `, получено ${JSON.stringify(got)}`;
    }
    return `${prefix}${formatPath(i.path)}: ${msg}`;
  });
}

/** Структура + ссылки внутри документа. Параметры компонентов проверяет engine (у него есть реестр). */
export function validateSceneDoc(raw: unknown): Result<SceneDoc> {
  const p = SceneDocSchema.safeParse(raw);
  if (!p.success) return { ok: false, errors: zodErrors(p.error, raw) };
  const doc = p.data;
  const errors: string[] = [];

  const ids = new Set<string>();
  for (const w of doc.world) {
    if (ids.has(w.id)) errors.push(`world: повторяется id «${w.id}»`);
    ids.add(w.id);
  }
  for (const [key, e] of Object.entries(doc.entities)) {
    if (e.id !== key) errors.push(`entities.${key}.id: «${e.id}» не совпадает с ключом «${key}»`);
    if (ids.has(key)) errors.push(`entities.${key}: id уже занят компонентом мира`);
    if (key === 'world' || key === 'camera') errors.push(`entities.${key}: имя зарезервировано`);
    if (typeof e.spawn.at === 'string' && !(e.spawn.at in doc.places)) {
      errors.push(`entities.${key}.spawn.at: нет места «${e.spawn.at}». Есть: ${Object.keys(doc.places).join(', ') || '—'}`);
    }
  }
  const evIds = new Set<string>();
  doc.timeline.forEach((ev, i) => {
    if (evIds.has(ev.id)) errors.push(`timeline[${i}].id: повторяется «${ev.id}»`);
    evIds.add(ev.id);
    if (i > 0 && ev.t < doc.timeline[i - 1]!.t) errors.push(`timeline[${i}].t: таймлайн должен быть отсортирован по t (${ev.t} после ${doc.timeline[i - 1]!.t})`);
    if (ev.t > doc.settings.duration) errors.push(`timeline[${i}].t: ${ev.t} с — после конца сцены (${doc.settings.duration} с)`);
    if (ev.target !== 'world' && ev.target !== 'camera' && !(ev.target in doc.entities) && !doc.world.some((w) => w.id === ev.target)) {
      errors.push(`timeline[${i}].target: нет сущности «${ev.target}» (и компонента мира с таким id). Есть: ${[...doc.world.map((w) => w.id), ...Object.keys(doc.entities)].join(', ') || '—'}`);
    }
  });
  return errors.length ? { ok: false, errors } : { ok: true, doc };
}

export function validateFilmDoc(raw: unknown): Result<FilmDoc> {
  const p = FilmDocSchema.safeParse(raw);
  if (!p.success) return { ok: false, errors: zodErrors(p.error, raw) };
  const doc = p.data;
  const errors: string[] = [];
  const sceneIds = new Set<string>();
  doc.scenes.forEach((s, i) => {
    if (sceneIds.has(s.id)) errors.push(`scenes[${i}].id: повторяется «${s.id}»`);
    sceneIds.add(s.id);
    if (i === 0 && s.link === 'continue') errors.push('scenes[0].link: у первой сцены не может быть continue — нет предыдущей');
  });
  doc.acts.forEach((a, i) =>
    a.sceneIds.forEach((id, j) => {
      if (!sceneIds.has(id)) errors.push(`acts[${i}].sceneIds[${j}]: нет сцены «${id}»`);
    }),
  );
  for (const [i, t] of doc.tracks.entries()) {
    t.clips.forEach((c, j) => {
      if (c.end < c.start) errors.push(`tracks[${i}].clips[${j}]: конец (${c.end}) раньше начала (${c.start})`);
    });
  }
  return errors.length ? { ok: false, errors } : { ok: true, doc };
}
