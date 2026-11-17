// Часть B: минимальный показ nanite-lib на нашем three 0.187.0: 5×5 деревьев ez-tree одного типа, земля, один кадр.
// Не компонент Forest и не SceneDoc: проверка, что библиотека рисует, и стенд для теста детерминизма.
// Без TAA, без импосторов, без программного растеризатора, без теней, без ветра.
import * as THREE from 'three/webgpu';
import { float, texture } from 'three/tsl';
import { NaniteRenderer, PHASE2_LAYER, coverageScales, maskOf, type NaniteType } from '../../vendor/threejs-nanites/index.ts';
import type { LeafMask } from '../../vendor/threejs-nanites/dag/types.ts';
import barkUrl from 'ez-tree-assets/bark/oak_color_1k.jpg';
import leafUrl from 'ez-tree-assets/leaves/oak_color.png';
import type { GrowJob, GrowReply } from './types.ts';

const SIZE = 1024;
export interface DemoStats { gpuMs: number | null; computeMs: number | null; clusters: number; trees: number; adapter: string }

/** Целочисленный хэш (без Math.random): раскладка деревьев одна и та же при любом запуске. */
const h32 = (n: number): number => {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};

async function loadLayer(url: string, leaf: boolean): Promise<{ px: Uint8ClampedArray; mask: LeafMask | null; scales: number[] }> {
  const img = await createImageBitmap(await (await fetch(url)).blob());
  const ctx = new OffscreenCanvas(SIZE, SIZE).getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, SIZE, SIZE);
  const px = ctx.getImageData(0, 0, SIZE, SIZE).data;
  if (!leaf) return { px, mask: null, scales: [] };
  const mask = maskOf(px, SIZE); // (по альфе, до подмены цвета прозрачных пикселей)
  let r = 0, g = 0, b = 0, n = 0;
  for (let p = 0; p < px.length; p += 4) if (px[p + 3] > 128) { r += px[p]; g += px[p + 1]; b += px[p + 2]; n++; }
  for (let p = 0; p < px.length; p += 4) if (px[p + 3] < 128) { px[p] = r / n; px[p + 1] = g / n; px[p + 2] = b / n; }
  return { px, mask, scales: coverageScales(px, SIZE, Math.log2(SIZE) + 1) };
}

const arrayTexture = (px: Uint8ClampedArray, scales: number[]): THREE.DataArrayTexture => {
  const t = new THREE.DataArrayTexture(new Uint8Array(px.buffer, px.byteOffset, px.byteLength), SIZE, SIZE, 1);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.flipY = false;
  t.needsUpdate = true;
  t.userData.alphaScales = scales;
  t.userData.levels = Math.log2(SIZE) + 1;
  return t;
};

export interface DemoOptions {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  /** Режим экспорта: без отсечения по прошлому кадру (occlusion), tau зафиксирован. Остальное — URL-параметры vendor (listguard=0&leafpre=0). */
  fixed: boolean;
}

export async function startNaniteDemo(o: DemoOptions) {
  const { canvas, width, height } = o;
  canvas.width = width; canvas.height = height;
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, trackTimestamp: true });
  await renderer.init();
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);

  // дерево: ez-tree → DAG в worker
  const [bark, leaf] = await Promise.all([loadLayer(barkUrl, false), loadLayer(leafUrl, true)]);
  const worker = new Worker(new URL('./grow-worker.ts', import.meta.url), { type: 'module' });
  const grown = await new Promise<Extract<GrowReply, { dag: unknown }>>((res, rej) => {
    worker.onmessage = (e: MessageEvent<GrowReply>) => ('error' in e.data ? rej(new Error(e.data.error)) : res(e.data));
    worker.onerror = (e) => rej(new Error(`grow-worker: ${e.message}`));
    worker.postMessage({ preset: 'Oak Medium', seed: 77, height: 15, leafMask: leaf.mask! } satisfies GrowJob);
  });
  worker.terminate();
  const type: NaniteType = { ...grown.dag, name: 'Oak Medium', radius: grown.radius, height: grown.height, src: grown.src };

  // деревья: сетка 5×5 с детерминированным разбросом
  const N = 25, a = new Float32Array(N * 4), b = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const gx = (i % 5) - 2, gz = Math.floor(i / 5) - 2;
    const ang = h32(i * 3 + 1) * Math.PI * 2;
    a.set([gx * 11 + (h32(i * 3 + 2) - 0.5) * 4, 0, gz * 11 + (h32(i * 3 + 3) - 0.5) * 4, 0.8 + h32(i + 99) * 0.5], i * 4);
    b.set([Math.cos(ang), Math.sin(ang), 0, 0], i * 4);
  }
  const nanite = new NaniteRenderer(renderer, [type], { a, b }, {
    bark: arrayTexture(bark.px, []), leaf: arrayTexture(leaf.px, leaf.scales),
    barkLayerOf: () => float(0), leafLayerOf: () => float(0),
    alphaToCoverage: false, leafDither: false,
  });
  nanite.u.impostorPx.value = 0; // импосторов нет (атлас не запекаем)
  nanite.u.tau.value = 1;
  nanite.u.maxDist.value = 400;
  if (nanite.u.sw) nanite.u.sw.value = 0; // программный растеризатор без resolve-меша рисовать некому
  nanite.sw.idle = true; nanite.splats.idle = true;
  if (o.fixed) { nanite.occlusionOn = false; nanite.u.occlusion.value = 0; }

  const scene = new THREE.Scene();
  renderer.setClearColor('#9ec3e6'); // (не scene.background: он очищает кадр и во втором проходе, и стирает первый)
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new THREE.MeshLambertNodeMaterial({ color: '#58783a' }));
  scene.add(ground, nanite.group);
  const sun = new THREE.DirectionalLight('#fff1d6', 2.4); sun.position.set(40, 60, 25); scene.add(sun, new THREE.HemisphereLight('#bcd6ff', '#5b4a32', 0.9));
  const camera = new THREE.PerspectiveCamera(50, width / height, 0.3, 1500);
  camera.position.set(-14, 5, 36); camera.lookAt(0, 6, 0);
  camera.updateMatrixWorld();
  const size = new THREE.Vector2(width, height);
  // Кадр всегда идёт в цель с текстурой глубины: из неё occlusion строит HZB (в холст без depthTexture его строить не из чего).
  const depth = new THREE.DepthTexture(width, height);
  const rt = new THREE.RenderTarget(width, height, { type: THREE.UnsignedByteType, depthBuffer: true, depthTexture: depth });
  const quad = new THREE.QuadMesh(new THREE.NodeMaterial());
  (quad.material as THREE.NodeMaterial).colorNode = texture(rt.texture);

  /** Один кадр в момент `t` (время сцены — аргумент, не часы). Результат в `rt` (его читает pixels()); `present`: ещё и на холст. */
  async function renderFrame(t: number, present = true): Promise<void> {
    nanite.update(camera, size, t, null);
    renderer.setRenderTarget(rt);
    camera.layers.set(0);
    renderer.render(scene, camera);
    nanite.occlusion(camera, width, height);
    nanite.rasterize(camera, width, height);
    const clear = renderer.autoClear;
    renderer.autoClear = false;
    camera.layers.set(PHASE2_LAYER);
    renderer.render(scene, camera);
    camera.layers.set(0);
    renderer.autoClear = clear;
    renderer.setRenderTarget(null);
    if (present) quad.render(renderer);
  }
  async function pixels(): Promise<Uint8Array> {
    return new Uint8Array((await renderer.readRenderTargetPixelsAsync(rt, 0, 0, width, height)).buffer);
  }
  /** GPU-время на кадр: накопленные таймстемпы сбрасываются, рисуем `frames` кадров, берём среднее (проходы отрисовки и compute отдельно). */
  async function stats(frames = 30): Promise<DemoStats> {
    await renderer.resolveTimestampsAsync(THREE.TimestampQuery.RENDER);
    await renderer.resolveTimestampsAsync(THREE.TimestampQuery.COMPUTE);
    for (let f = 0; f < frames; f++) await renderFrame(1 + f / 30);
    await renderer.resolveTimestampsAsync(THREE.TimestampQuery.RENDER);
    await renderer.resolveTimestampsAsync(THREE.TimestampQuery.COMPUTE);
    const s = await nanite.readStats();
    const info = renderer.info as unknown as { render: { timestamp: number }; compute: { timestamp: number } };
    return { gpuMs: info.render.timestamp / frames, computeMs: info.compute.timestamp / frames, clusters: s.barkClusters + s.leafClusters, trees: N, adapter: 'webgpu' };
  }
  return { renderFrame, pixels, stats, nanite, dagStats: grown.dag.stats };
}
