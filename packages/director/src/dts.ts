import { z } from 'zod';
import { handleInfos, type ComponentDef, type Registry } from '@cartoon/engine';

type Js = Record<string, any>;

/** JSON Schema (из zod) → тип TypeScript. Только то, что встречается в схемах компонентов. */
function ts(js: Js | undefined, indent = ''): string {
  if (!js) return 'unknown';
  if (js.enum) return js.enum.map((v: unknown) => JSON.stringify(v)).join(' | ');
  if (js.const !== undefined) return JSON.stringify(js.const);
  if (js.anyOf || js.oneOf) return (js.anyOf ?? js.oneOf).map((x: Js) => ts(x, indent)).join(' | ');
  switch (js.type) {
    case 'number': case 'integer': return 'number';
    case 'string': return js.pattern === '^#[0-9a-fA-F]{6}$' ? `string /* '#rrggbb' */` : 'string';
    case 'boolean': return 'boolean';
    case 'null': return 'null';
    case 'array':
      if (js.prefixItems) return `[${js.prefixItems.map((x: Js) => ts(x, indent)).join(', ')}]`;
      return `${ts(js.items, indent)}[]`;
    case 'object': {
      const props = Object.entries(js.properties ?? {}) as [string, Js][];
      if (!props.length) return 'Record<string, unknown>';
      const req = new Set<string>(js.required ?? []);
      const inner = indent + '  ';
      return `{\n${props.map(([k, v]) => `${doc(v, inner)}${inner}${k}${req.has(k) ? '' : '?'}: ${ts(v, inner)}`).join(';\n')};\n${indent}}`;
    }
    default: return 'unknown';
  }
}

function doc(js: Js, indent: string): string {
  const parts: string[] = [];
  if (js.description) parts.push(String(js.description));
  if (typeof js.minimum === 'number' && Math.abs(js.minimum) < 1e15) parts.push(`от ${js.minimum}`);
  if (typeof js.maximum === 'number' && Math.abs(js.maximum) < 1e15) parts.push(`до ${js.maximum}`);
  if (js.default !== undefined) parts.push(`по умолчанию ${JSON.stringify(js.default)}`);
  return parts.length ? `${indent}/** ${parts.join('; ')} */\n` : '';
}

const schemaOf = (s: z.ZodType, io: 'input' | 'output' = 'input'): Js => {
  try { return z.toJSONSchema(s, { io, unrepresentable: 'any' }) as Js; } catch { return {}; }
};

const cap = (t: string) => t[0]!.toUpperCase() + t.slice(1);

function componentDts(def: ComponentDef): string {
  const T = cap(def.type);
  const lines: string[] = [];
  lines.push(`/** ${def.describe} */`);
  lines.push(`export interface ${T}Params ${ts(schemaOf(def.params))}`);
  if (def.presets) lines.push(`/** Пресеты ${def.type}: ${Object.keys(def.presets).join(', ')} */\nexport type ${T}Preset = ${Object.keys(def.presets).map((k) => JSON.stringify(k)).join(' | ')};`);
  const body: string[] = [];
  for (const [name, schema] of Object.entries(def.actions)) {
    const js = schemaOf(schema);
    const hasRequired = Array.isArray(js.required) && js.required.length > 0;
    body.push(`  ${doc(js, '').trim() || `/** действие ${name} */`}\n  ${name}(args${hasRequired ? '' : '?'}: ${ts(js, '  ')}): Command;`);
  }
  const infos = handleInfos(def);
  const names = Object.keys(infos);
  if (names.length) {
    for (const h of Object.values(infos)) {
      const range = h.min !== undefined || h.max !== undefined ? ` Диапазон ${h.min ?? '−∞'}…${h.max ?? '∞'}.` : '';
      const type = h.kind === 'number' ? 'number' : h.kind === 'color' ? 'string /* \'#rrggbb\' */' : h.options ? h.options.map((o) => JSON.stringify(o)).join(' | ') : 'string | number | boolean';
      const unit = h.unit ? ` Единицы: ${h.unit}.` : '';
      const how = h.kind === 'step' ? ' Только скачком (set); to держит старое до конца отрезка.' : '';
      body.push(`  /** Ручка «${h.name}»: ${h.describe}.${unit}${range}${how} */\n  set(handle: ${JSON.stringify(h.name)}, value: ${type}): Command;\n  to(handle: ${JSON.stringify(h.name)}, value: ${type}, opts?: { over?: number; ease?: Ease }): Command;`);
    }
  }
  lines.push(body.length ? `export interface ${T} extends HandleBase {\n${body.join('\n')}\n}` : `export type ${T} = HandleBase;`);
  if (def.examples.length) lines.push(`/* Примеры:\n${def.examples.map((e) => ` *   ${e}`).join('\n')}\n */`);
  return lines.join('\n');
}

/**
 * director.d.ts (ARCHITECTURE 8): типы API режиссёра из реестра, целиком идут ИИ в контекст.
 * Схема компонента → типы параметров и действий; ручки → перегрузки set/to с диапазоном, единицами и описанием.
 */
export function generateDirectorDts(reg: Registry): string {
  const head = `// director.d.ts — сгенерировано из реестра компонентов (pnpm test проверяет, что файл не устарел).
// Время задаётся снаружи: s.at(t).do(команда). Команда — значение: её можно сохранить в настроение (s.mood).
export type Ease = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'step';
export type Force = 'wind' | 'light' | 'temperature';
export type Command = { target: string; action: string; args: Record<string, unknown> };
/** Общее для любого компонента (механизм ручек, 6.7, и перебивка связей, 6.6). */
export interface HandleBase {
  readonly id: string;
  /** Перебивка: объект перестаёт слышать силу мира (ветер, свет, температура) до link. */
  unlink(force: Force): Command;
  link(force: Force): Command;
}
`;
  const comps = Object.values(reg.components).map(componentDts).join('\n\n');
  const shots = Object.values(reg.shots).map((s) => `/** кадр «${s.type}»: ${s.describe} */\nexport type ${cap(s.type)}ShotArgs = ${ts(schemaOf(s.params))};`).join('\n\n');
  const tail = `
export interface Director {
  places(p: Record<string, [number, number, number]>): void;
  path(id: string, p: { points: [number, number, number][]; closed?: boolean }): void;
  /** Поставить компонент мира; возвращает ручку для команд (forces.to('time', 19.5, { over: 40 })). */
  world: { use<K extends keyof Components>(type: K, params?: Partial<${'Components'}[K]['params']>): Components[K]['handle'] };
  add(type: string, params?: Record<string, unknown>, spawn?: { at: string | [number, number, number]; heading?: number; id?: string }): any;
  /** Настроение: набор изменений ручек разных объектов; s.at(t).mood(name) применяет. */
  mood(name: string, changes: Command[]): void;
  at(t: number): {
    do(...cmds: Command[]): void;
    mood(name: string): void;
    camera: { shot(name: string, args?: Record<string, unknown>): void; focus(a?: { focus?: number | 'target'; range?: number; strength?: number }): void };
  };
}
export interface Components {
${Object.values(reg.components).map((d) => `  ${d.type}: { params: ${cap(d.type)}Params; handle: ${cap(d.type)} };`).join('\n')}
}
`;
  return `${head}\n${comps}\n\n${shots}\n${tail}`;
}
