import type { ZodType } from 'zod';
import type { Target, Vec3 } from '@cartoon/schema';

export type PathSampler = {
  readonly length: number;
  getPointAt(u: number): Vec3; // u ∈ [0,1] (у замкнутых — по кругу)
  getTangentAt(u: number): Vec3; // единичный вектор
};

export type EntityHandle = { id: string; pos: Vec3; heading: number; state: Record<string, unknown> };
/** Глубина резкости в состоянии камеры: focus — метры или 'target' (расстояние до точки, на которую смотрит камера). */
export type CameraDofState = { focus: number | 'target'; range: number; strength: number };
export type CameraState = { shot: string; pos: Vec3; target: Vec3; fov: number; dof?: CameraDofState };

/** Сервисы, которые мир предоставляет компонентам (Terrain даёт heightAt, Water — waterLevel). */
export type Services = {
  heightAt: (x: number, z: number) => number;
  waterLevel: number;
};

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
  /** Компонент регистрирует сервис (только в setup). */
  provide<K extends keyof Services>(name: K, impl: Services[K]): void;
  /** Цель → точка: id места/сущности или координаты. */
  resolve(target: Target): Vec3;
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
  /** Что видит ИИ и тесты: попадает в WorldState. */
  state?(self: S): Record<string, unknown>;
  /** { 1: p => p2 }: переход параметров на следующую версию. */
  migrate?: Record<number, (params: any) => any>;
  examples: string[];
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
