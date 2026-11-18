import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { SimSnapshot } from '@cartoon/engine';
import type { SceneDoc, WorldState } from '@cartoon/schema';
import type { ThreeCtx, ViewDef, ViewRegistry } from './view.ts';
import { resolveFrame, type FrameOptions } from './film.ts';
import { createFramePipeline, type DebugView } from './frame/pipeline.ts';
import { sunVector } from './light/math.ts';
import type { DofSettings, LookSettings, PostFrame } from './frame/post.ts';
import { MultipedView } from './views/multiped.ts';
import { RobotView } from './views/robot.ts';
import { TreeView } from './views/tree.ts';
import { SkyView, TerrainView } from './views/world.ts';
import { WaterView } from './views/water.ts';
import { createSunShadow, type CascadeInfo } from './light/sunShadow.ts';
import { createProbe, type ProbeOptions } from './light/probe.ts';

export * from './view.ts';
export type { FrameMode, FrameOptions, TaaOptions } from './film.ts';
export type { DebugView } from './frame/pipeline.ts';
export type { CascadeInfo } from './light/sunShadow.ts';
export type { ProbeOptions } from './light/probe.ts';

/** Единственное место, где живёт Three.js. Наружу не выходит ни один его объект. */
export interface RenderAdapter {
  mount(canvas: HTMLCanvasElement | OffscreenCanvas, doc: SceneDoc, sim: () => SimSnapshot): Promise<void>;
  sync(state: WorldState, sim: SimSnapshot): void;
  render(size: { w: number; h: number }): void;
  capture(): Promise<ImageBitmap>;
  /** Свободная камера для просмотра: не влияет на документ и на экспорт. */
  setFreeCamera(on: boolean): void;
  /** Отладочный вид вместо кадра: 'motion' — векторы движения цветом. null — обычный кадр. */
  setDebugView(v: DebugView): void;
  /** Замер GPU-времени последнего render(), мс (нужен trackGpu; null — браузер не умеет). Только для замеров. */
  gpuMs(): Promise<number | null>;
  /** Сколько раз three строил узловой шейдер (NodeBuilder) с запуска. Растёт только на новых материалах, не на кадрах; только для проверок. */
  shaderBuilds(): number;
  /** Пробный объект для проверки теней (тест, не данные сцены). null — убрать. */
  setProbe(p: ProbeOptions | null): void;
  /** Каскады теней солнца: до какого расстояния, размер карты и тексела (м), смещения. */
  shadowInfo(): CascadeInfo[];
  /** Следующий render() показывает момент, не следующий за прошлым (склейка, перемотка): история TAA сбрасывается и прогревается. */
  discontinuity(): void;
  /**
   * Пересобрать виды под новый документ без пересоздания рендерера (витрина объектов: смена пресета и облика).
   * Набор компонентов с FilmLook-ом не должен меняться (проходы кадра выбираются при mount).
   */
  /** Пересобрать виды под новый документ (облик сменился). Асинхронно: картинки видов, которых раньше в сцене не было, догружаются. */
  remount(doc: SceneDoc): Promise<void>;
  dispose(): void;
}

export const defaultViews: ViewRegistry = Object.fromEntries([TerrainView, WaterView, SkyView, MultipedView, RobotView, TreeView]) as ViewRegistry;

/**
 * backend: 'auto' — WebGPU, при его отсутствии WebGL2 (откат делает сам three).
 * 'webgl2' — принудительно WebGL2: скриншот-тесты и серверный рендер.
 */
export function createThreeAdapter(opts: { views?: ViewRegistry; backend?: 'auto' | 'webgl2'; trackGpu?: boolean } & FrameOptions = {}): RenderAdapter {
  const views = opts.views ?? defaultViews;
  const frame = resolveFrame(opts);
  let pipeline!: ReturnType<typeof createFramePipeline>;
  let debugView: DebugView = null;
  let canvas!: HTMLCanvasElement | OffscreenCanvas;
  let three!: ThreeCtx;
  let camera!: THREE.PerspectiveCamera;
  let controls: OrbitControls | null = null;
  let free = false;
  let probeOpts: ProbeOptions | null = null; // задают до mount()
  let sunShadow!: ReturnType<typeof createSunShadow>;
  let probe!: ReturnType<typeof createProbe>;
  let lastTarget: [number, number, number] = [0, 0, 0];
  let lookId: string | null = null; // компонент FilmLook сцены (вид плёнки)
  let post: PostFrame | null = null;
  let shaderBuilds = 0;
  const mounted: { handle: unknown; view: ViewDef; id: string }[] = [];

  return {
    async mount(c, doc, sim) {
      canvas = c;
      const renderer = new WebGPURenderer({ canvas: c as HTMLCanvasElement, antialias: false, forceWebGL: opts.backend === 'webgl2', trackTimestamp: opts.trackGpu === true });
      await renderer.init();
      // счёт построений узловых шейдеров: после прогрева в установившемся режиме не должно быть ни одного (задача 1.8)
      renderer.debug.onNodeBuilderCreated = () => { shaderBuilds++; };
      renderer.setPixelRatio(frame.pixelRatio);
      lookId = [...doc.world, ...Object.values(doc.entities)].find((c) => c.type === 'FilmLook')?.id ?? null;
      pipeline = createFramePipeline(renderer, { samples: frame.samples, aa: frame.aa, post: frame.fx, rays: frame.fx && lookId !== null });
      pipeline.setDebug(debugView);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoftShadowMap удалён в текущей версии three
      const scene = new THREE.Scene();
      const sunLight = new THREE.DirectionalLight('#ffffff', 2);
      const hemi = new THREE.HemisphereLight('#bcd8ff', '#3b4a2a', 0.6);
      scene.add(sunLight, sunLight.target, hemi);
      three = { scene, renderer, sunLight, hemi, sim };
      camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 800);
      sunShadow = createSunShadow(sunLight, renderer, camera);
      probe = createProbe(scene);
      probe.set(probeOpts);
      const types = new Set([...doc.world, ...Object.values(doc.entities)].map((i) => i.type));
      await Promise.all([...types].map((t) => views[t]?.preload?.()));
      for (const inst of [...doc.world, ...Object.values(doc.entities)]) {
        const view = views[inst.type];
        if (view) mounted.push({ id: inst.id, view, handle: view.mount(three, inst) });
      }
    },
    async remount(doc) {
      for (const m of mounted) m.view.dispose(m.handle, three);
      mounted.length = 0;
      const types = new Set([...doc.world, ...Object.values(doc.entities)].map((i) => i.type));
      await Promise.all([...types].map((t) => views[t]?.preload?.())); // пресет мог добавить деревья, которых не было при первом mount
      for (const inst of [...doc.world, ...Object.values(doc.entities)]) {
        const view = views[inst.type];
        if (view) mounted.push({ id: inst.id, view, handle: view.mount(three, inst) });
      }
      lookId = [...doc.world, ...Object.values(doc.entities)].find((c) => c.type === 'FilmLook')?.id ?? null;
    },
    sync(state, snap) {
      for (const m of mounted) m.view.sync(m.handle, snap.components[m.id]!.self, three, state);
      for (const m of mounted) m.view.late?.(m.handle, snap.components[m.id]!.self, three, state);
      lastTarget = state.camera.target;
      if (frame.fx) {
        const look = lookId ? (snap.components[lookId]?.self as LookSettings | undefined) ?? null : null;
        const dof: DofSettings | null = state.camera.dof ? { ...state.camera.dof } : null;
        post = look || dof ? { look, dof, sunDir: sunVector(state.sun.elevation, state.sun.azimuth) } : null;
      }
      if (!free) {
        camera.position.set(...state.camera.pos);
        camera.lookAt(...state.camera.target);
        camera.fov = state.camera.fov;
        probe.place(camera, state.camera.pos, state.camera.target, snap.services.heightAt);
      }
    },
    render(requested) {
      const { w, h } = frame.size(requested); // film: всегда filmSize, окно и экран не влияют
      three.renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      controls?.update();
      sunShadow.update(); // каскады и смещения под текущие fov/aspect: до рендера, чтобы кадр не зависел от прошлого
      const px = frame.pixels({ w, h });
      pipeline.render(three.scene, camera, px, post);
    },
    async gpuMs() {
      await three.renderer.resolveTimestampsAsync('render');
      const ms = three.renderer.info.render.timestamp;
      return ms > 0 ? ms : null;
    },
    shaderBuilds: () => shaderBuilds,
    setProbe(p) { probeOpts = p; probe?.set(p); },
    shadowInfo: () => sunShadow.info().map((c) => ({ ...c })),
    setDebugView(v) { debugView = v; pipeline?.setDebug(v); },
    discontinuity() { pipeline?.discontinuity(); },
    capture: () => createImageBitmap(canvas as HTMLCanvasElement),
    setFreeCamera(on) {
      free = on;
      if (on && !controls) controls = new OrbitControls(camera, three.renderer.domElement);
      if (controls) { controls.enabled = on; controls.target.set(...lastTarget); }
    },
    dispose() {
      controls?.dispose();
      for (const m of mounted) m.view.dispose(m.handle, three);
      mounted.length = 0;
      probe.dispose();
      sunShadow.dispose();
      pipeline.dispose();
      three.renderer.dispose();
    },
  };
}
