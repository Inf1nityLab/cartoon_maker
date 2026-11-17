import { z, type ZodType } from 'zod';
import type { HandleValue } from '@cartoon/schema';

/**
 * Ручки (ARCHITECTURE 6.7): один механизм на все компоненты.
 *
 * Ручка — поле параметров компонента, которое можно менять во времени. Имя, единицы, диапазон, описание и значение
 * по умолчанию берутся из zod-схемы того же поля (один источник правды: схема → ядро, director.d.ts, витрина объектов).
 * Три способа менять:
 *   1. сразу — `handle.set`: значение с момента t;
 *   2. по кривой — `handle.to`: к значению за `over` секунд с видом кривой (`ease`);
 *   3. поведением — глагол компонента (его действие), внутри которого готовые кривые: `ctx.handles.seq(...)`.
 * Значение ручки — чистая функция времени фильма от списка отрезков: перемотка = проигрывание, чекпоинты хранят только JSON.
 */

export const EASES = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'step'] as const;
export type Ease = (typeof EASES)[number];

/** Вид кривой: k — доля пути 0…1 → доля изменения 0…1. step держит старое значение до конца отрезка, потом прыгает. */
export function easeValue(ease: Ease, k: number): number {
  const x = Math.max(0, Math.min(1, k));
  switch (ease) {
    case 'linear': return x;
    case 'ease-in': return x * x;
    case 'ease-out': return 1 - (1 - x) * (1 - x);
    case 'ease-in-out': return x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x);
    case 'step': return x >= 1 ? 1 : 0;
  }
}

/** Объявление ручки в компоненте. Всё остальное (диапазон, описание, умолчание) — из схемы одноимённого поля params. */
export type HandleDef = {
  /** Единицы для витрины и director.d.ts, если их нет в описании поля: '°', 'м/с', 'ч'. */
  unit?: string;
  /** Описание, если нужно другое, чем в схеме поля. */
  describe?: string;
  /** Схема значения, если поле params не годится (обёртка, refine). По умолчанию params.shape[имя]. */
  schema?: ZodType;
  /** Записать значение в состояние компонента. По умолчанию self[имя] = значение. */
  apply?(self: any, value: HandleValue): void;
};

/** number и color меняются плавно; остальное (список, флаг, строка) — только скачком. */
export type HandleKind = 'number' | 'color' | 'step';

export type HandleInfo = {
  name: string;
  kind: HandleKind;
  unit: string;
  describe: string;
  min?: number;
  max?: number;
  integer?: boolean;
  options?: string[];
  default?: HandleValue;
  boolean?: true;
  schema: ZodType;
};

type DefLike = { params: ZodType; handles?: Record<string, HandleDef> };
const cache = new WeakMap<object, Record<string, HandleInfo>>();
const HEX = /^#[0-9a-fA-F]{6}$/;
const big = (x: unknown): x is number => typeof x === 'number' && Math.abs(x) < 1e15;

function describe(name: string, schema: ZodType, h?: HandleDef): HandleInfo {
  let js: Record<string, unknown> = {};
  try { js = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>; } catch { /* схема без JSON-вида: скачком */ }
  const type = js.type;
  const isColor = type === 'string' && typeof js.pattern === 'string' && js.pattern === HEX.source;
  const kind: HandleKind = type === 'number' || type === 'integer' ? 'number' : isColor ? 'color' : 'step';
  return {
    name, kind, unit: h?.unit ?? '', describe: h?.describe ?? (typeof js.description === 'string' ? js.description : ''),
    ...(big(js.minimum) ? { min: js.minimum } : {}), ...(big(js.maximum) ? { max: js.maximum } : {}),
    ...(type === 'integer' ? { integer: true } : {}),
    ...(Array.isArray(js.enum) ? { options: js.enum.map(String) } : {}),
    ...(js.default !== undefined ? { default: js.default as HandleValue } : {}),
    ...(type === 'boolean' ? { boolean: true } : {}),
    schema,
  };
}

/** Все поля params (витрина объектов строит по ним ползунки): ручки и обычные параметры. Вложенные объекты и кортежи не включаются. */
export function paramFields(def: DefLike): (HandleInfo & { handle: boolean })[] {
  const shape = (def.params as unknown as { shape?: Record<string, ZodType> }).shape ?? {};
  const handles = handleInfos(def);
  return Object.entries(shape).flatMap(([name, schema]) => {
    const h = handles[name];
    const info = h ?? describe(name, schema);
    const plain = info.kind !== 'step' || info.options || info.boolean;
    return plain ? [{ ...info, handle: !!h }] : [];
  });
}

/** Ручки компонента с описанием из схемы. Для компонента без ручек — пусто. */
export function handleInfos(def: DefLike): Record<string, HandleInfo> {
  const hit = cache.get(def);
  if (hit) return hit;
  const out: Record<string, HandleInfo> = {};
  const shape = (def.params as unknown as { shape?: Record<string, ZodType> }).shape ?? {};
  for (const [name, h] of Object.entries(def.handles ?? {})) {
    const schema = h.schema ?? shape[name];
    if (!schema) throw new Error(`Ручка «${name}»: нет поля в схеме params и не задан schema`);
    out[name] = describe(name, schema, h);
  }
  cache.set(def, out);
  return out;
}

// ---------- дорожка ручки: чистая функция времени ----------

/** Отрезок кривой: с t0 за dur секунд от from к to. dur 0 — скачок в t0. */
export type Seg = { t0: number; dur: number; from: HandleValue; to: HandleValue; ease: Ease };
/** base — значение до первого отрезка. Только JSON: входит в чекпоинты. */
export type Track = { base: HandleValue; segs: Seg[]; /** касалась команда режиссёра (set/to), а не только поведение: такие ручки входят в WorldState */ direct?: true };
/** Шаг кривой: к значению `to` за `over` секунд. */
export type HandleStep = { to: HandleValue; over?: number; ease?: Ease };

const hex2 = (n: number): string => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
/** Смешивание цветов в sRGB-каналах (как в редакторах); результат — '#rrggbb'. */
export function mixHex(a: string, b: string, k: number): string {
  const ch = (s: string, i: number) => parseInt(s.slice(1 + i * 2, 3 + i * 2), 16);
  return '#' + [0, 1, 2].map((i) => hex2(ch(a, i) + (ch(b, i) - ch(a, i)) * k)).join('');
}

const EPS = 1e-9;

function at(s: Seg, t: number, kind: HandleKind): HandleValue {
  if (t >= s.t0 + s.dur - EPS) return s.to;
  const k = easeValue(s.ease, (t - s.t0) / s.dur);
  if (kind === 'number') return (s.from as number) + ((s.to as number) - (s.from as number)) * k;
  if (kind === 'color') return mixHex(s.from as string, s.to as string, k);
  return s.from; // скачком: до конца отрезка держим старое
}

/** Значение ручки в момент t. Последний начавшийся отрезок решает. */
export function evalTrack(tr: Track, t: number, kind: HandleKind): HandleValue {
  let hit: Seg | undefined;
  for (const s of tr.segs) if (s.t0 <= t + EPS) hit = s; else break;
  return hit ? at(hit, t, kind) : tr.base;
}

/**
 * Применить ручке шаги в момент t: прежние отрезки, не успевшие закончиться, обрываются (новая команда сильнее),
 * кривая стартует от текущего значения. Шаги идут друг за другом (поведение = последовательность кривых).
 */
export function applySteps(tr: Track, t: number, kind: HandleKind, steps: HandleStep[]): void {
  let cur = evalTrack(tr, t, kind);
  tr.base = cur;
  tr.segs = [];
  let t0 = t;
  for (const s of steps) {
    const dur = Math.max(0, s.over ?? 0);
    if (kind !== 'step' && dur === 0) { tr.segs.push({ t0, dur: 0, from: s.to, to: s.to, ease: 'linear' }); }
    else tr.segs.push({ t0, dur, from: cur, to: s.to, ease: s.ease ?? 'ease-in-out' });
    cur = s.to; t0 += dur;
  }
}

// ---------- проверка команд ----------

export const HandleSetArgs = z.object({
  handle: z.string().min(1).describe('имя ручки'),
  value: z.union([z.number(), z.string(), z.boolean()]).describe('значение с этого момента'),
  mood: z.string().optional().describe('настроение, из которого пришла команда (для отчёта)'),
});
export const HandleToArgs = z.object({
  handle: z.string().min(1).describe('имя ручки'),
  value: z.union([z.number(), z.string(), z.boolean()]).describe('к какому значению идти'),
  over: z.number().min(0).max(3600).default(1).describe('за сколько секунд, с'),
  ease: z.enum(EASES).default('ease-in-out').describe('вид кривой: linear, ease-in, ease-out, ease-in-out, step'),
  mood: z.string().optional().describe('настроение, из которого пришла команда (для отчёта)'),
});
/** Силы мира, с которыми объект может быть связан. */
export const FORCES = ['wind', 'light', 'temperature'] as const;
export type ForceName = (typeof FORCES)[number];
export const LinkArgs = z.object({
  force: z.enum(FORCES).describe('сила мира: wind, light, temperature'),
  on: z.boolean().describe('true — связь включена, false — объект не слышит эту силу (перебивка)'),
});

export const HANDLE_ACTIONS = ['handle.set', 'handle.to', 'link.set'] as const;
export const isEngineAction = (a: string): boolean => (HANDLE_ACTIONS as readonly string[]).includes(a);

/**
 * Проверка события-ручки по описанию компонента: текст ошибки без пути (путь добавляет вызывающий) или [].
 * Возвращает пары «путь после args → сообщение».
 */
export function checkHandleEvent(def: DefLike & { type: string }, action: string, args: unknown): [path: string, msg: string][] {
  if (action === 'link.set') {
    const r = LinkArgs.safeParse(args);
    return r.success ? [] : r.error.issues.map((i) => [i.path.join('.'), i.message] as [string, string]);
  }
  const r = (action === 'handle.set' ? HandleSetArgs : HandleToArgs).safeParse(args);
  if (!r.success) return r.error.issues.map((i) => [i.path.join('.'), i.message] as [string, string]);
  const infos = handleInfos(def);
  const info = infos[r.data.handle];
  if (!info) {
    const names = Object.keys(infos);
    return [['handle', `у ${def.type} нет ручки «${r.data.handle}». Есть: ${names.join(', ') || '— (ручек нет)'}`]];
  }
  const v = info.schema.safeParse(r.data.value);
  if (!v.success) {
    const why = v.error.issues[0]?.message ?? 'неверное значение';
    return [['value', `ручка ${def.type}.${info.name}${info.unit ? ` (${info.unit})` : ''}: ${why}, получено ${JSON.stringify(r.data.value)}`]];
  }
  return [];
}
