import type { ZodType } from 'zod';
import type { HandleValue, Target, Vec3 } from '@cartoon/schema';
import type { Ease, HandleDef, HandleStep } from './handles.ts';

export type PathSampler = {
  readonly length: number;
  getPointAt(u: number): Vec3; // u ∈ [0,1] (у замкнутых — по кругу)
  getTangentAt(u: number): Vec3; // единичный вектор
};

export type EntityHandle = { id: string; pos: Vec3; heading: number; state: Record<string, unknown> };
/** Глубина резкости в состоянии камеры: focus — метры или 'target' (расстояние до точки, на которую смотрит камера). */
export type CameraDofState = { focus: number | 'target'; range: number; strength: number };
export type CameraState = { shot: string; pos: Vec3; target: Vec3; fov: number; dof?: CameraDofState };

/** Дорога как поле: данные для вида (карта расстояний) и для рельефа. Только числа и функции, без three. */
export type RoadField = {
  halfWidth: number; // половина ширины мощения, м
  shoulder: number; // ширина обочины и выравнивания рельефа, м
  stone: number; // размер камня брусчатки, м
  bounds: { x0: number; x1: number; z0: number; z1: number }; // где дорога влияет на землю (с обочиной)
  /** Расстояние от (x, z) до края мощения, м; отрицательно на дороге. Далеко от дороги — любое число ≥ bounds-расстояния. */
  edgeDistance(x: number, z: number): number;
};

/** Параметры сетки рельефа, по которой нарисована земля: вид берёт их отсюда, а не из сырых params (там нет умолчаний). */
export type TerrainInfo = { size: number; segments: number; ground: 'lowpoly' | 'soil'; seed: number };

/** Сколько света в точке (6.6): доли относительно полного солнца в зените / полной луны. Всё в 0…1. */
export type LightAt = {
  /** прямой солнечный свет: высота солнца, облачность и тень рельефа уже учтены */
  sun: number;
  /** лунный свет (фаза, облачность) */
  moon: number;
  /** итог для глаза: солнце плюс слабая добавка от луны */
  total: number;
  /** единичные векторы на солнце и на луну */
  sunDir: Vec3;
  moonDir: Vec3;
};
export const NO_LIGHT: LightAt = { sun: 0, moon: 0, total: 0, sunDir: [0, 1, 0], moonDir: [0, 1, 0] };

/** Силы мира (6.6): время суток, ветер, свет, температура. Даёт компонент Forces. Все функции — от времени фильма и seed. */
export type ForcesField = {
  /** Часы суток 0…24. */
  timeOfDay(): number;
  /** Ветер в точке, м/с (вектор, куда дует): направление, сила, порывы. */
  wind(p: Vec3): Vec3;
  light(p: Vec3): LightAt;
  /** °C в точке (с поправкой на высоту). */
  temperature(p: Vec3): number;
  /** Сводка для WorldState и вида: числа, как в ключе world[id]. */
  summary(): Record<string, unknown>;
  /** Солнце сейчас: высота, азимут, градусы. */
  sun(): { elevation: number; azimuth: number };
};

/** Вода как поле (6.5): где она, какой глубины, куда течёт. Даёт компонент Water; только числа и функции. */
export type WaterField = {
  /** id компонента Water: в мире можно несколько вод (пруд и ручей), у каждой свой уровень */
  id: string;
  /** Разобранные параметры воды (с умолчаниями): вид берёт форму и цвета отсюда. */
  config: Record<string, any>;
  /** Центр воды [x, z] и область, в которой считается карта глубины. */
  center: [number, number];
  bounds: { x0: number; x1: number; z0: number; z1: number };
  /** Вода продолжается за область до горизонта (океан). */
  open: boolean;
  /** Средний уровень поверхности в точке, м; null — воды здесь нет. */
  level(x: number, z: number): number | null;
  /** Глубина воды в точке, м (0 на суше). Всегда level − heightAt или 0. */
  depth(x: number, z: number): number;
  /** Уровень поверхности, продолженный за берег (для меша и карты глубины): у basin — level, у реки — уровень ближайшей точки оси. */
  surface(x: number, z: number): number;
  /** Единичное направление течения в точке ([0,0] — течения нет). */
  flowDir(x: number, z: number): [number, number];
};

/**
 * Сервисы, которые мир предоставляет компонентам (Terrain даёт heightAt, Water — waterLevel, Road — grade и road).
 * grade: рельеф под дорогой; Terrain вызывает его при сборке сетки высот (base — высота без дороги).
 */
export type Services = {
  heightAt: (x: number, z: number) => number;
  waterLevel: number;
  grade?: (x: number, z: number, base: (x: number, z: number) => number) => number;
  road?: RoadField;
  terrain?: TerrainInfo;
  forces?: ForcesField;
  waters?: WaterField[];
};

/** Какая вода в точке: id, уровень поверхности, глубина (м). */
export type WaterHit = { id: string; level: number; depth: number; field: WaterField };

/** Мировые сервисы. Компоненты не ссылаются друг на друга напрямую — только через ctx. */
export interface Ctx {
  time: number;
  dt: number;
  seed: number;
  /** Поток этого компонента: seed + id. */
  rng: () => number;
  heightAt(x: number, z: number): number;
  waterLevel: number;
  /** Место по id; y проецируется на рельеф. */
  place(id: string): Vec3;
  path(id: string): PathSampler;
  entity(id: string): EntityHandle;
  camera: CameraState;
  /** Сервис, зарегистрированный другим компонентом (читать лениво, после setup всех: порядок setup — порядок world). */
  service<K extends keyof Services>(name: K): Services[K];
  /** Компонент регистрирует сервис (только в setup). */
  provide<K extends keyof Services>(name: K, impl: Services[K]): void;
  /** Цель → точка: id места/сущности или координаты. */
  resolve(target: Target): Vec3;
  /** id компонента, чей код сейчас выполняется. */
  readonly componentId: string;
  /**
   * Силы мира для объекта, который сейчас считается (6.6). Режиссёр может отключить связь объекта с силой
   * (перебивка, `link.set`): тогда вместо значения — «нет силы» (ветер 0, света 0, 15 °C). Без компонента Forces — то же.
   */
  wind(p: Vec3): Vec3;
  light(p: Vec3): LightAt;
  temperature(p: Vec3): number;
  /** Вода в точке (x, z): та, где глубже (пруд и ручей рядом — у каждого свой уровень); null — суши. */
  waterAt(x: number, z: number): WaterHit | null;
  /** Часы суток 0…24 (12 без Forces). */
  readonly timeOfDay: number;
  /** Ручки текущего компонента (6.7): внутри действия — поведение (набор кривых), от момента события. */
  readonly handles: HandleApi;
  /** Текущее значение ручки любого компонента (с учётом режиссуры); undefined — такого компонента или ручки нет. */
  handleOf(id: string, name: string): HandleValue | undefined;
}

/** Ручки текущего компонента, из его действия (поведение). Время старта — момент события. */
export interface HandleApi {
  /** Сразу. */
  set(name: string, value: HandleValue): void;
  /** По кривой: к значению за over секунд. */
  to(name: string, value: HandleValue, opts?: { over?: number; ease?: Ease }): void;
  /** Несколько кривых подряд по одной ручке («порыв»: подъём, пик, спад). */
  seq(name: string, steps: HandleStep[]): void;
}

/**
 * Контракт логики. Состояние `self` — только числа, массивы и обычные объекты (никаких классов и three):
 * его клонируют для перемотки. У сущностей в `self` обязательны `pos: Vec3` и `heading: number`.
 */
export type ComponentDef<P = any, S extends object = any> = {
  type: string;
  version: number;
  describe: string;
  params: ZodType<P>;
  /** Схемы аргументов действий: событие таймлайна проверяется по ним. */
  actions: Record<string, ZodType>;
  /** Один раз при загрузке документа: регистрация сервисов. Не входит в чекпоинт, поэтому зависит только от params. */
  setup?(ctx: Ctx, params: P): void;
  create(ctx: Ctx, params: P, spawn?: { at: Vec3; heading: number }): S;
  step(self: S, dt: number, ctx: Ctx): void;
  onAction?(self: S, name: string, args: any, ctx: Ctx): void;
  /** Что видит ИИ и тесты: попадает в WorldState. ctx — мировые сервисы (для состояния, которое зависит от сил мира). */
  state?(self: S, ctx: Ctx): Record<string, unknown>;
  /**
   * Ручки (6.7): имена полей params, которые можно менять во времени. Диапазон, единицы и описание берутся из схемы;
   * `set`/`to` и поведения меняют их, значение в момент t — `self[имя]` (или `apply`).
   */
  handles?: Record<string, HandleDef>;
  /** Витрина объектов (library.html): как показывать и что демонстрировать. Только данные. */
  showcase?: Showcase;
  /** { 1: p => p2 }: переход параметров на следующую версию. */
  migrate?: Record<number, (params: any) => any>;
  /** Готовые наборы параметров (облики): имя → params. Каждый обязан проходить схему params. */
  presets?: Record<string, P>;
  examples: string[];
};

/** Шаг демо-показа: событие для самого объекта. action — 'handle.set', 'handle.to' или действие компонента. */
export type DemoStep = { t: number; action: string; args: Record<string, unknown>; /** true — событие для силы мира (компонент Forces витрины), а не для самого объекта */ world?: true; /** id другого компонента мира (например 'forces'); по умолчанию — сам объект */ target?: string };
export type Demo = { title: string; duration: number; steps: DemoStep[] };

/** Сцена вокруг объекта мира в витрине: свой рельеф, путь и камеры (под пресет). Только данные. */
export type ShowSetup = {
  /** Параметры Terrain для сцены витрины (по умолчанию холмы seed 7) */
  terrain?: Record<string, unknown>;
  /** Путь scene.paths.water для рек и ручьёв */
  path?: [number, number, number][];
  /** Именованные виды: at и look — [x, высота, z]; abs — высоты абсолютные, иначе над землёй; dive — вид «под водой» для кнопки «нырнуть» */
  views?: Record<string, { at: [number, number, number]; look: [number, number, number]; fov?: number; abs?: boolean }>;
};

/** Подсказки витрине: какого размера объект, где он (в мире или сам по себе) и что умеет показать. */
export type Showcase = {
  /** entity — объект ставят на землю в центр; world — компонент мира, витрина строит вокруг него сцену. */
  kind: 'entity' | 'world';
  /** Характерный размер, м: по нему считаются камеры. */
  size: number;
  /** Высота центра взгляда над землёй, м (по умолчанию size/2). */
  eye?: number;
  /** Земля под объектом: плоская (по умолчанию) или холмы. */
  ground?: 'flat' | 'hills';
  /** Пресеты для «семейной фотографии»: все в ряд одним кадром (library.html?family=1). Только для kind entity. */
  family?: string[];
  /** Короткие показы ручек во времени, 8–15 с. Первый — основной. */
  demos?: Demo[];
  /** Пресет, с которого открывается витрина (по умолчанию первый) */
  defaultPreset?: string;
  /** Сцена под пресет: ключ — имя пресета, 'default' — для остальных */
  setups?: Record<string, ShowSetup>;
  /** Показывать кнопку «нырнуть»: камера плавно уходит из вида general в вид dive и обратно */
  dive?: boolean;
};

export function defineComponent<P, S extends object>(def: ComponentDef<P, S>): ComponentDef<P, S> {
  return def;
}

/** Кадр камеры — тоже компонент со схемой параметров, но без состояния: позиция — чистая функция от времени шота. */
export type ShotDef<P = any> = {
  type: string;
  describe: string;
  params: ZodType<P>;
  solve(args: P, ctx: Ctx, shotTime: number): { pos: Vec3; target: Vec3; fov: number };
  examples: string[];
};

export function defineShot<P>(def: ShotDef<P>): ShotDef<P> {
  return def;
}

export type Registry = {
  components: Record<string, ComponentDef>;
  shots: Record<string, ShotDef>;
};

export function createRegistry(components: ComponentDef[], shots: ShotDef[]): Registry {
  return {
    components: Object.fromEntries(components.map((c) => [c.type, c])),
    shots: Object.fromEntries(shots.map((s) => [s.type, s])),
  };
}
