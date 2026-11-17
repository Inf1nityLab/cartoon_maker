import { hashWorldState, type SceneDoc, type Vec3, type WorldState, type EntityState } from '@cartoon/schema';
import type { CameraState, ComponentDef, Ctx, EntityHandle, PathSampler, Registry, Services } from './component.ts';
import { createPath } from './paths.ts';
import { CameraFocusArgs } from './focus.ts';
import { rngNext, rngSeed } from './rng.ts';

export type CameraSim = CameraState & { args: Record<string, unknown>; start: number };

type Snapshot = {
  tick: number;
  nextEvent: number;
  rng: Record<string, number>;
  selves: Record<string, any>;
  camera: CameraSim;
};

/** Внутреннее состояние для адаптера рендера. Без three. Только чтение. */
export type SimSnapshot = {
  components: Record<string, { type: string; params: Record<string, unknown>; self: unknown; isWorld: boolean }>;
  services: Services;
  camera: CameraState;
};

export interface Engine {
  load(doc: SceneDoc): void;
  seek(t: number): WorldState; // детерминированно; через ближайший чекпоинт
  step(): WorldState; // +fixedStep
  readonly time: number;
  state(): WorldState;
  sim(): SimSnapshot;
}

const ASPECT = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1 } as const;

export function createEngine(opts: { registry: Registry; fixedStep?: number; checkpointEvery?: number }): Engine {
  const { registry } = opts;
  const dt = opts.fixedStep ?? 1 / 60;
  const cpTicks = Math.max(1, Math.round((opts.checkpointEvery ?? 1) / dt));

  let doc!: SceneDoc;
  let events: SceneDoc['timeline'] = [];
  let services: Services = { heightAt: () => 0, waterLevel: -Infinity };
  let order: { id: string; def: ComponentDef; params: any; isWorld: boolean }[] = [];
  let paths: Record<string, PathSampler> = {};
  let checkpoints = new Map<number, Snapshot>();

  let tick = 0;
  let nextEvent = 0;
  let rngState: Record<string, number> = {};
  let selves: Record<string, any> = {};
  let camera!: CameraSim;
  let current: string | null = null; // id компонента, чей rng сейчас доступен

  const time = () => tick * dt;

  const ctx: Ctx = {
    get time() { return time(); },
    dt,
    get seed() { return doc.settings.seed; },
    rng() {
      if (!current) throw new Error('ctx.rng доступен только внутри компонента');
      const [v, next] = rngNext(rngState[current]!);
      rngState[current] = next;
      return v;
    },
    heightAt: (x, z) => services.heightAt(x, z),
    get waterLevel() { return services.waterLevel; },
    place(id) {
      const p = doc.places[id];
      if (!p) throw new Error(`Нет места «${id}». Есть: ${Object.keys(doc.places).join(', ') || '—'}`);
      return [p[0], services.heightAt(p[0], p[2]) + p[1], p[2]];
    },
    path(id) {
      const p = paths[id];
      if (!p) throw new Error(`Нет пути «${id}». Есть: ${Object.keys(doc.paths).join(', ') || '—'}`);
      return p;
    },
    entity(id) {
      const e = entityHandle(id);
      if (!e) throw new Error(`Нет сущности «${id}». Есть: ${Object.keys(doc.entities).join(', ') || '—'}`);
      return e;
    },
    get camera() { return camera; },
    provide(name, impl) { (services as any)[name] = impl; },
    resolve(target) {
      if (typeof target !== 'string') return target;
      if (doc.entities[target]) return ctx.entity(target).pos;
      return ctx.place(target);
    },
  };

  function entityHandle(id: string): EntityHandle | undefined {
    const e = doc.entities[id];
    const self = selves[id];
    if (!e || !self) return undefined;
    const def = registry.components[e.type]!;
    return { id, pos: self.pos, heading: self.heading, state: def.state?.(self) ?? {} };
  }

  function as<T>(id: string, fn: () => T): T {
    const prev = current;
    current = id;
    try { return fn(); } finally { current = prev; }
  }

  function initCamera(): CameraSim {
    return { shot: 'none', pos: [0, 12, 24], target: [0, 0, 0], fov: 50, args: {}, start: 0 };
  }

  function load(d: SceneDoc): void {
    doc = d;
    events = d.timeline.map((e, i) => ({ e, i })).sort((a, b) => a.e.t - b.e.t || a.i - b.i).map((x) => x.e);
    services = { heightAt: () => 0, waterLevel: -Infinity };
    paths = Object.fromEntries(Object.entries(d.paths).map(([k, p]) => [k, createPath(p.points as Vec3[], p.closed)]));
    tick = 0; nextEvent = 0; rngState = {}; selves = {}; camera = initCamera(); checkpoints = new Map();

    const entityIds = Object.keys(d.entities).sort(); // стабильный порядок — по id
    order = [
      ...d.world.map((w) => ({ id: w.id, inst: w, isWorld: true })),
      ...entityIds.map((id) => ({ id, inst: d.entities[id]!, isWorld: false })),
    ].map(({ id, inst, isWorld }) => {
      const def = registry.components[inst.type];
      if (!def) throw new Error(`${id}: нет компонента «${inst.type}». Есть: ${Object.keys(registry.components).join(', ')}`);
      let params = inst.params;
      for (let v = inst.version; v < def.version; v++) {
        const m = def.migrate?.[v];
        if (!m) throw new Error(`${id}: нет миграции параметров ${inst.type} v${v} → v${v + 1}`);
        params = m(params);
      }
      return { id, def, params: def.params.parse(params), isWorld };
    });
    for (const o of order) {
      rngState[o.id] = rngSeed(d.settings.seed, o.id);
      if (o.isWorld) as(o.id, () => o.def.setup?.(ctx, o.params));
    }
    // сначала мир (сервисы), потом сущности
    for (const o of order) {
      if (o.isWorld) selves[o.id] = as(o.id, () => o.def.create(ctx, o.params));
    }
    for (const o of order) {
      if (o.isWorld) continue;
      const e = d.entities[o.id]!;
      const at = typeof e.spawn.at === 'string' ? ctx.resolve(e.spawn.at) : e.spawn.at;
      selves[o.id] = as(o.id, () => o.def.create(ctx, o.params, { at, heading: e.spawn.heading }));
    }
    applyEvents();
    updateCamera();
    checkpoints.set(0, snapshot());
  }

  function snapshot(): Snapshot {
    return structuredClone({ tick, nextEvent, rng: rngState, selves, camera });
  }
  function restore(s: Snapshot): void {
    const c = structuredClone(s);
    tick = c.tick; nextEvent = c.nextEvent; rngState = c.rng; selves = c.selves; camera = c.camera;
  }

  function applyEvents(): void {
    while (nextEvent < events.length && events[nextEvent]!.t <= time() + 1e-9) apply(events[nextEvent++]!);
  }

  function apply(e: SceneDoc['timeline'][number]): void {
    if (e.target === 'camera') {
      if (e.action === 'focus') {
        const r = CameraFocusArgs.safeParse(e.args);
        if (!r.success) throw new Error(`Событие ${e.id}: camera.focus: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
        camera.dof = r.data.strength > 0 ? { focus: r.data.focus, range: r.data.range, strength: r.data.strength } : undefined;
        return;
      }
      if (e.action !== 'shot') throw new Error(`Событие ${e.id}: у камеры есть действия shot и focus, получено «${e.action}»`);
      const { name, ...rest } = e.args as { name?: string };
      if (typeof name !== 'string') throw new Error(`Событие ${e.id}: camera.shot требует name`);
      camera.shot = name;
      camera.args = rest;
      camera.start = e.t;
      return;
    }
    let o: (typeof order)[number] | undefined;
    if (e.target === 'world') {
      o = order.find((x) => x.isWorld && e.action in x.def.actions);
      if (!o) throw new Error(`Событие ${e.id}: ни один компонент мира не умеет «${e.action}»`);
    } else {
      o = order.find((x) => x.id === e.target);
      if (!o) throw new Error(`Событие ${e.id}: нет сущности «${e.target}»`);
    }
    const schema = o.def.actions[e.action];
    if (!schema) throw new Error(`${o.def.type}.${e.action}: такого действия нет. Есть: ${Object.keys(o.def.actions).join(', ')}`);
    const args = schema.parse(e.args);
    as(o.id, () => o.def.onAction?.(selves[o.id], e.action, args, ctx));
  }

  function updateCamera(): void {
    if (camera.shot === 'none') return;
    const inst = doc.camera.shots[camera.shot];
    const def = registry.shots[inst?.type ?? camera.shot];
    if (!def) throw new Error(`Неизвестный кадр «${camera.shot}». Есть: ${Object.keys(registry.shots).join(', ')}`);
    const args = def.params.parse({ ...(inst?.params ?? {}), ...camera.args });
    const r = def.solve(args, ctx, time() - camera.start);
    camera.pos = r.pos; camera.target = r.target; camera.fov = r.fov;
  }

  function stepOnce(): void {
    for (const o of order) as(o.id, () => o.def.step(selves[o.id], dt, ctx));
    tick++;
    applyEvents();
    updateCamera();
    if (tick % cpTicks === 0 && !checkpoints.has(tick)) checkpoints.set(tick, snapshot());
  }

  function state(): WorldState {
    const entities: Record<string, EntityState> = {};
    let sun = { elevation: 30, azimuth: 180 };
    for (const o of order) {
      const self = selves[o.id];
      const extra = o.def.state?.(self) ?? {};
      if (o.isWorld) {
        if (extra.sun) sun = extra.sun as typeof sun;
      } else {
        entities[o.id] = { type: o.def.type, pos: [...self.pos] as Vec3, heading: self.heading, action: 'standing', speed: 0, ...extra };
      }
    }
    return {
      t: time(),
      sun: { ...sun },
      camera: {
        shot: camera.shot, pos: [...camera.pos], target: [...camera.target], fov: camera.fov,
        // ключ dof есть только пока глубина резкости включена: у сцен без неё хэш WorldState прежний
        ...(camera.dof ? { dof: { focus: camera.dof.focus === 'target' ? dist(camera.pos, camera.target) : camera.dof.focus, range: camera.dof.range, strength: camera.dof.strength } } : {}),
      },
      inFrame: inFrame(entities),
      entities,
    };
  }

  function inFrame(entities: Record<string, EntityState>): string[] {
    const f = norm(sub(camera.target, camera.pos));
    const half = (camera.fov / 2) * (Math.PI / 180);
    const halfH = Math.atan(Math.tan(half) * ASPECT[doc.settings.aspect]);
    const limit = Math.cos(Math.min(Math.PI / 2 - 1e-3, Math.max(half, halfH)));
    const visible = (p: Vec3) => {
      const d = sub(p, camera.pos);
      const dist = Math.hypot(d[0], d[1], d[2]);
      return dist > 1e-6 && dist < 400 && (f[0] * d[0] + f[1] * d[1] + f[2] * d[2]) / dist > limit;
    };
    const out: string[] = [];
    for (const [id, e] of Object.entries(entities)) if (visible(e.pos)) out.push(id);
    for (const id of Object.keys(doc.places)) if (!out.includes(id) && visible(ctx.place(id))) out.push(id);
    return out;
  }

  return {
    load,
    seek(t) {
      const target = Math.max(0, Math.round(t / dt));
      if (target < tick) {
        let k = Math.floor(target / cpTicks) * cpTicks;
        while (k > 0 && !checkpoints.has(k)) k -= cpTicks;
        restore(checkpoints.get(k)!);
      }
      while (tick < target) stepOnce();
      return state();
    },
    step() { stepOnce(); return state(); },
    get time() { return time(); },
    state,
    sim: () => ({
      components: Object.fromEntries(order.map((o) => [o.id, { type: o.def.type, params: o.params, self: selves[o.id], isWorld: o.isWorld }])),
      services,
      camera,
    }),
  };
}

export { hashWorldState };
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
