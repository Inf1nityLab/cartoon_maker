import type { SceneDoc, Target, TimelineEvent, Vec3 } from '@cartoon/schema';

/** Ручка сущности: любой метод превращается в команду для таймлайна. В документ идут только данные. */
const HANDLE = Symbol('handle');
export type Command = { target: string; action: string; args: Record<string, unknown> };
export type EntityHandle = { readonly id: string; [action: string]: any };

function handle(id: string): EntityHandle {
  return new Proxy({ id, [HANDLE]: true } as EntityHandle, {
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
type ShotName = 'establishing' | 'follow' | 'lowAngle' | 'orbit' | 'closeup' | 'crane' | 'fixed';

export type Director = {
  places(p: Record<string, Vec3>): void;
  path(id: string, p: { points: Vec3[]; closed?: boolean }): void;
  world: { use(type: string, params?: Record<string, unknown>): void; sun(a: Sun): void; look(a: Record<string, unknown>): void; lookPreset(name: string): void };
  add(type: string, params?: Record<string, unknown>, spawn?: { at: Target; heading?: number; id?: string }): EntityHandle;
  at(t: number): {
    do(...cmds: Command[]): void;
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

  const s: Director = {
    places: (p) => void Object.assign(doc.places, p),
    path: (id, p) => void (doc.paths[id] = { points: p.points, closed: p.closed ?? false }),
    world: {
      use(type, params = {}) { doc.world.push({ id: type.toLowerCase(), type, version: 1, params }); },
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
