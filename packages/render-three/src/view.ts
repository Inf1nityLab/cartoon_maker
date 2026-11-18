import type * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import type { SimSnapshot } from '@cartoon/engine';
import type { ComponentInstance, WorldState } from '@cartoon/schema';
import type { Sky } from './sky/nodes.ts';

/** Всё, что видам нужно от Three.js. Живёт только внутри render-three. */
export type ThreeCtx = {
  scene: THREE.Scene;
  renderer: WebGPURenderer;
  sunLight: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  /** Окружение неба для света на земле (сферические гармоники); значения пишет вид Sky. */
  skyProbe: THREE.LightProbe;
  /** Единый источник цвета неба: узел `radiance(направление)` и униформы солнца, луны, облаков. Им пользуются все виды, что отражают небо (вода). */
  sky: Sky;
  /** Состояние неба кадра для видов (заполняет Sky первым в кадре): средняя яркость неба (линейная) и признак, что небо управляет светом. */
  skyState: { ambient: THREE.Color; active: boolean; shadowSoft: number; daylight: number };
  sim: () => SimSnapshot;
};

/** Контракт вида: логика компонента не знает про меши, вид только рисует по состоянию. */
export type ViewDef<H = any> = {
  /** Асинхронная подготовка (картинки) до первого кадра: adapter.mount ждёт её у всех видов сцены. */
  preload?(): Promise<void>;
  mount(three: ThreeCtx, inst: ComponentInstance): H;
  sync(handle: H, self: any, three: ThreeCtx, state: WorldState): void;
  /** Необязательно: после sync всех видов кадра (вода переопределяет туман и фон под водой поверх неба). */
  late?(handle: H, self: any, three: ThreeCtx, state: WorldState): void;
  dispose(handle: H, three: ThreeCtx): void;
};
export const defineView = <H>(type: string, def: ViewDef<H>): [string, ViewDef<H>] => [type, def];
export type ViewRegistry = Record<string, ViewDef>;
