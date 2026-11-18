import type { HandleValue, SceneDoc, Target, TimelineEvent, Vec3 } from '@cartoon/schema';

export { generateDirectorDts } from './dts.ts';

/** Ручка сущности: любой метод превращается в команду для таймлайна. В документ идут только данные. */
const HANDLE = Symbol('handle');
export type Command = { target: string; action: string; args: Record<string, unknown> };
export type EaseName = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'step';
export type ForceName = 'wind' | 'light' | 'temperature';
/**
 * Ручка компонента (мир или сущность). Любой метод — действие компонента; четыре метода общие для всех (6.7, 6.6):
 *   set(ручка, значение)                  — сразу, с момента команды;
 *   to(ручка, значение, { over, ease })   — по кривой за over секунд;
 *   unlink(сила) / link(сила)             — перебивка: объект перестаёт/начинает слушать ветер, свет, температуру.
 * Поведения (глаголы) — обычные действия компонента: forces.gust({ strength: 9 }), sky.sun({ … }).
 * Время задаётся снаружи, как у всех команд: `s.at(30).do(sky.to('time', 19.5, { over: 40 }))`. Это в духе раздела 8:
 * «когда» и «что» отдельно, команда — значение, её можно собрать в настроение и повторить.
 */
export type EntityHandle = {
  readonly id: string;
  set(handle: string, value: HandleValue): Command;
  to(handle: string, value: HandleValue, opts?: { over?: number; ease?: EaseName }): Command;
  link(force: ForceName): Command;
  unlink(force: ForceName): Command;
  [action: string]: any;
};

function handle(id: string): EntityHandle {
  const own = {
    id,
    set: (name: string, value: HandleValue): Command => ({ target: id, action: 'handle.set', args: { handle: name, value } }),
    to: (name: string, value: HandleValue, opts: { over?: number; ease?: EaseName } = {}): Command => ({ target: id, action: 'handle.to', args: { handle: name, value, over: opts.over ?? 1, ease: opts.ease ?? 'ease-in-out' } }),
    link: (force: ForceName): Command => ({ target: id, action: 'link.set', args: { force, on: true } }),
    unlink: (force: ForceName): Command => ({ target: id, action: 'link.set', args: { force, on: false } }),
    [HANDLE]: true,
  };
  return new Proxy(own as unknown as EntityHandle, {
    get(t, prop) {
      if (prop in t) return (t as any)[prop];
      if (typeof prop !== 'string') return undefined;
      return (args: Record<string, unknown> = {}): Command => ({ target: id, action: prop, args: plain(args) });
    },
  });
}

/** Ручки в аргументах → id. */
function plain(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).map(([k, v]) => [k, v && (v as any)[HANDLE] ? (v as EntityHandle).id : v]));
}

type Focus = { focus?: number | 'target'; range?: number; strength?: number };
type Sun = { elevation?: number; azimuth?: number; duration?: number };
type ShotName = 'establishing' | 'follow' | 'lowAngle' | 'orbit' | 'closeup' | 'crane' | 'fixed' | 'glide';

export type Director = {
  places(p: Record<string, Vec3>): void;
  path(id: string, p: { points: Vec3[]; closed?: boolean }): void;
  world: { use(type: string, params?: Record<string, unknown>, id?: string): EntityHandle; sun(a: Sun): void; look(a: Record<string, unknown>): void; lookPreset(name: string): void };
  add(type: string, params?: Record<string, unknown>, spawn?: { at: Target; heading?: number; id?: string }): EntityHandle;
  /** Настроение: именованный набор изменений ручек разных объектов (команды set/to/link). Применить: s.at(t).mood(name). */
  mood(name: string, changes: Command[]): void;
  at(t: number): {
    do(...cmds: Command[]): void;
    mood(name: string): void;
    camera: { shot(name: ShotName, args?: Record<string, unknown>): void; focus(a?: Focus): void };
    world: { sun(a: Sun): void; look(a: Record<string, unknown>): void; lookPreset(name: string): void };
  };
};

export type SceneMeta = { id: string; title?: string; duration: number; seed?: number; fps?: 30 | 60; aspect?: '16:9' | '9:16' | '1:1' };

/** Код ИИ — генератор документа сцены: исполнение кода даёт SceneDoc. */
export function buildScene(fn: (s: Director) => void, meta: SceneMeta): SceneDoc {
  const doc: SceneDoc = {
    schema: 'scene@1', id: meta.id, title: meta.title ?? meta.id,
    settings: { fps: meta.fps ?? 60, duration: meta.duration, seed: meta.seed ?? 1, aspect: meta.aspect ?? '16:9' },
    world: [], entities: {}, places: {}, paths: {}, camera: { shots: {} }, timeline: [], assets: [],
  };
  const counts: Record<string, number> = {};
  const events: TimelineEvent[] = [];
  let n = 0;
  const push = (t: number, c: Command) => events.push({ id: `e${++n}`, t, ...c });
  const worldApi = (t: number) => ({
    sun: (a: Sun) => push(t, { target: 'world', action: 'sun', args: { ...a } }),
    look: (a: Record<string, unknown>) => push(t, { target: 'world', action: 'look', args: { ...a } }),
    lookPreset: (name: string) => push(t, { target: 'world', action: 'lookPreset', args: { name } }),
  });

  const moods: Record<string, Command[]> = {};
  const MOOD_ACTIONS = ['handle.set', 'handle.to', 'link.set'];

  const s: Director = {
    mood(name, changes) {
      const bad = changes.find((c) => !MOOD_ACTIONS.includes(c.action));
      if (bad) throw new Error(`Настроение «${name}»: можно только set, to, link, unlink; получено «${bad.action}» у «${bad.target}»`);
      moods[name] = changes;
    },
    places: (p) => void Object.assign(doc.places, p),
    path: (id, p) => void (doc.paths[id] = { points: p.points, closed: p.closed ?? false }),
    world: {
      use(type, params = {}, idOverride) {
        const id = idOverride ?? type.toLowerCase();
        doc.world.push({ id, type, version: 1, params });
        return handle(id);
      },
      sun: worldApi(0).sun,
      look: worldApi(0).look,
      lookPreset: worldApi(0).lookPreset,
    },
    add(type, params = {}, spawn = { at: [0, 0, 0] }) {
      const id = spawn.id ?? `${type.toLowerCase()}${(counts[type] = (counts[type] ?? 0) + 1)}`;
      doc.entities[id] = { id, type, version: 1, params, spawn: { at: spawn.at, heading: spawn.heading ?? 0 } };
      return handle(id);
    },
    at: (t) => ({
      do: (...cmds) => cmds.forEach((c) => push(t, c)),
      mood(name) {
        const m = moods[name];
        if (!m) throw new Error(`Нет настроения «${name}». Есть: ${Object.keys(moods).join(', ') || '—'}`);
        for (const c of m) push(t, c.action === 'link.set' ? c : { ...c, args: { ...c.args, mood: name } });
      },
      camera: {
        shot: (name, args = {}) => push(t, { target: 'camera', action: 'shot', args: plain({ name, ...args }) }),
        focus: (a = {}) => push(t, { target: 'camera', action: 'focus', args: { ...a } }),
      },
      world: worldApi(t),
    }),
  };
  fn(s);
  doc.timeline = events.map((e, i) => ({ e, i })).sort((a, b) => a.e.t - b.e.t || a.i - b.i).map((x) => x.e);
  return doc;
}
