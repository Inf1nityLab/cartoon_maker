import { validateSceneDoc, zodErrors, type SceneDoc } from '@cartoon/schema';
import type { Registry } from './component.ts';
import { CameraFocusArgs } from './focus.ts';
import { checkHandleEvent, isEngineAction } from './handles.ts';

/**
 * Полная проверка для ИИ: структура + параметры компонентов + аргументы событий.
 * Ошибки — текстом с путём: «timeline[3].args.speed: должен быть не больше 5, получено 12».
 */
export function validateAgainstRegistry(raw: unknown, reg: Registry): { ok: true; doc: SceneDoc } | { ok: false; errors: string[] } {
  const base = validateSceneDoc(raw);
  if (!base.ok) return base;
  const doc = base.doc;
  const errors: string[] = [];

  const check = (path: string, id: string, type: string, params: unknown) => {
    const def = reg.components[type];
    if (!def) { errors.push(`${path}.type: нет компонента «${type}». Есть: ${Object.keys(reg.components).join(', ')}`); return undefined; }
    const r = def.params.safeParse(params);
    if (!r.success) errors.push(...zodErrors(r.error, params, `${path}.params.`));
    void id;
    return def;
  };
  doc.world.forEach((w, i) => check(`world[${i}]`, w.id, w.type, w.params));
  const typeOf: Record<string, string> = {};
  for (const [id, e] of Object.entries(doc.entities)) {
    check(`entities.${id}`, id, e.type, e.params);
    typeOf[id] = e.type;
  }
  doc.timeline.forEach((ev, i) => {
    const at = `timeline[${i}]`;
    if (ev.target === 'camera') {
      if (ev.action === 'focus') {
        const r = CameraFocusArgs.safeParse(ev.args);
        if (!r.success) errors.push(...zodErrors(r.error, ev.args, `${at}.args.`));
        return;
      }
      const name = ev.args.name;
      if (ev.action !== 'shot') return void errors.push(`${at}.action: у камеры есть shot и focus, получено «${ev.action}»`);
      if (typeof name !== 'string') return void errors.push(`${at}.args.name: имя кадра обязательно`);
      const inst = doc.camera.shots[name];
      const def = reg.shots[inst?.type ?? name];
      if (!def) return void errors.push(`${at}.args.name: нет кадра «${name}». Есть: ${Object.keys(reg.shots).join(', ')}`);
      const { name: _n, ...rest } = ev.args;
      const r = def.params.safeParse({ ...(inst?.params ?? {}), ...rest });
      if (!r.success) errors.push(...zodErrors(r.error, { ...(inst?.params ?? {}), ...rest }, `${at}.args.`));
      return;
    }
    if (isEngineAction(ev.action)) {
      // ручки и перебивка: цель — id компонента мира или сущности
      const inst = doc.world.find((w) => w.id === ev.target) ?? doc.entities[ev.target];
      if (!inst) return void errors.push(`${at}.target: ${ev.action} требует id компонента, получено «${ev.target}»`);
      const d = reg.components[inst.type];
      if (!d) return;
      for (const [p, m] of checkHandleEvent(d, ev.action, ev.args)) errors.push(`${at}.args.${p}: ${m}`);
      return;
    }
    const defs = ev.target === 'world' ? doc.world.map((w) => reg.components[w.type]).filter(Boolean) : [reg.components[typeOf[ev.target] ?? doc.world.find((w) => w.id === ev.target)?.type ?? '']].filter(Boolean);
    const def = defs.find((d) => d && ev.action in d.actions);
    if (!def) {
      const all = defs.flatMap((d) => Object.keys(d!.actions));
      return void errors.push(`${at}.action: «${ev.action}» не существует у «${ev.target}». Есть: ${all.join(', ') || '—'}`);
    }
    const r = def.actions[ev.action]!.safeParse(ev.args);
    if (!r.success) errors.push(...zodErrors(r.error, ev.args, `${at}.args.`));
    // ссылки на места, пути и сущности внутри аргументов
    const a = ev.args as Record<string, unknown>;
    for (const key of ['to', 'target'] as const) {
      const v = a[key];
      if (typeof v === 'string' && v !== 'camera' && !(v in doc.places) && !(v in doc.entities)) errors.push(`${at}.args.${key}: нет места или сущности «${v}»`);
    }
    if (typeof a.path === 'string' && !(a.path in doc.paths)) errors.push(`${at}.args.path: нет пути «${a.path}». Есть: ${Object.keys(doc.paths).join(', ') || '—'}`);
  });
  return errors.length ? { ok: false, errors } : { ok: true, doc };
}
