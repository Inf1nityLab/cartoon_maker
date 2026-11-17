import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { SimSnapshot } from '@cartoon/engine';
import type { SceneDoc, WorldState } from '@cartoon/schema';
import type { ThreeCtx, ViewDef, ViewRegistry } from './view.ts';
import { MultipedView } from './views/multiped.ts';
import { SkyView, TerrainView, WaterView } from './views/world.ts';

export * from './view.ts';

/** Единственное место, где живёт Three.js. Наружу не выходит ни один его объект. */
export interface RenderAdapter {
  mount(canvas: HTMLCanvasElement | OffscreenCanvas, doc: SceneDoc, sim: () => SimSnapshot): Promise<void>;
  sync(state: WorldState, sim: SimSnapshot): void;
  render(size: { w: number; h: number }): void;
  capture(): Promise<ImageBitmap>;
  /** Свободная камера для просмотра: не влияет на документ и на экспорт. */
  setFreeCamera(on: boolean): void;
  dispose(): void;
}

export const defaultViews: ViewRegistry = Object.fromEntries([TerrainView, WaterView, SkyView, MultipedView]) as ViewRegistry;

/**
 * backend: 'auto' — WebGPU, при его отсутствии WebGL2 (откат делает сам three).
 * 'webgl2' — принудительно WebGL2: скриншот-тесты и серверный рендер.
 */
export function createThreeAdapter(opts: { views?: ViewRegistry; pixelRatio?: number; backend?: 'auto' | 'webgl2' } = {}): RenderAdapter {
  const views = opts.views ?? defaultViews;
  let canvas!: HTMLCanvasElement | OffscreenCanvas;
  let three!: ThreeCtx;
  let camera!: THREE.PerspectiveCamera;
  let controls: OrbitControls | null = null;
  let free = false;
  let lastTarget: [number, number, number] = [0, 0, 0];
  const mounted: { handle: unknown; view: ViewDef; id: string }[] = [];

  return {
    async mount(c, doc, sim) {
      canvas = c;
      const renderer = new WebGPURenderer({ canvas: c as HTMLCanvasElement, antialias: true, forceWebGL: opts.backend === 'webgl2' });
      await renderer.init();
      renderer.setPixelRatio(opts.pixelRatio ?? 1);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoftShadowMap удалён в текущей версии three
      const scene = new THREE.Scene();
      const sunLight = new THREE.DirectionalLight('#ffffff', 2);
      sunLight.castShadow = true;
      sunLight.shadow.mapSize.set(2048, 2048);
      const sc = sunLight.shadow.camera;
      sc.left = sc.bottom = -40; sc.right = sc.top = 40; sc.near = 1; sc.far = 220;
      const hemi = new THREE.HemisphereLight('#bcd8ff', '#3b4a2a', 0.6);
      scene.add(sunLight, sunLight.target, hemi);
      three = { scene, renderer, sunLight, hemi, sim };
      camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 800);
      for (const inst of [...doc.world, ...Object.values(doc.entities)]) {
        const view = views[inst.type];
        if (view) mounted.push({ id: inst.id, view, handle: view.mount(three, inst) });
      }
    },
    sync(state, snap) {
      for (const m of mounted) m.view.sync(m.handle, snap.components[m.id]!.self, three, state);
      lastTarget = state.camera.target;
      if (!free) {
        camera.position.set(...state.camera.pos);
        camera.lookAt(...state.camera.target);
        camera.fov = state.camera.fov;
      }
    },
    render({ w, h }) {
      three.renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      controls?.update();
      three.renderer.render(three.scene, camera);
    },
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
      three.renderer.dispose();
    },
  };
}
