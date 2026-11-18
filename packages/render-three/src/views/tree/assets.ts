// Текстуры деревьев — картинки из пакета @dgreenheck/ez-tree (MIT; кора и листья), псевдоним `ez-tree-assets` задаёт vite.config.ts плеера.
// Грузятся один раз на страницу (preload до первого кадра: кадр не должен зависеть от того, успела ли подгрузиться картинка).
import * as THREE from 'three/webgpu';
import type { BarkKind, LeafKind } from '@cartoon/components';
import birchColor from 'ez-tree-assets/bark/birch_color_1k.jpg';
import birchNormal from 'ez-tree-assets/bark/birch_normal_1k.jpg';
import oakColor from 'ez-tree-assets/bark/oak_color_1k.jpg';
import oakNormal from 'ez-tree-assets/bark/oak_normal_1k.jpg';
import pineColor from 'ez-tree-assets/bark/pine_color_1k.jpg';
import pineNormal from 'ez-tree-assets/bark/pine_normal_1k.jpg';
import willowColor from 'ez-tree-assets/bark/willow_color_1k.jpg';
import willowNormal from 'ez-tree-assets/bark/willow_normal_1k.jpg';
import ashLeaf from 'ez-tree-assets/leaves/ash_color.png';
import aspenLeaf from 'ez-tree-assets/leaves/aspen_color.png';
import oakLeaf from 'ez-tree-assets/leaves/oak_color.png';
import pineLeaf from 'ez-tree-assets/leaves/pine_color.png';

const BARK: Record<BarkKind, [string, string]> = { oak: [oakColor, oakNormal], birch: [birchColor, birchNormal], pine: [pineColor, pineNormal], willow: [willowColor, willowNormal] };
const LEAF: Record<LeafKind, string> = { oak: oakLeaf, ash: ashLeaf, aspen: aspenLeaf, pine: pineLeaf };

export type BarkTex = { color: THREE.Texture; normal: THREE.Texture };
export type LeafTex = { map: THREE.Texture; /** средняя яркость видимых пикселей (для нормировки цвета) */ lum: number };

const bark = new Map<BarkKind, BarkTex>();
const leaf = new Map<LeafKind, LeafTex>();
let loading: Promise<void> | null = null;

async function bitmap(url: string): Promise<ImageBitmap> { return createImageBitmap(await (await fetch(url)).blob(), { premultiplyAlpha: 'none' }); }

async function loadBark(kind: BarkKind): Promise<void> {
  const [c, n] = await Promise.all(BARK[kind].map(async (u) => {
    const t = new THREE.Texture(await bitmap(u));
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
    t.needsUpdate = true;
    return t;
  }));
  c!.colorSpace = THREE.SRGBColorSpace;
  bark.set(kind, { color: c!, normal: n! });
}

/** Лист: прозрачным пикселям даём средний цвет видимых (иначе в мип-уровнях по краю листа остаётся тёмная кайма). */
async function loadLeaf(kind: LeafKind): Promise<void> {
  const img = await bitmap(LEAF[kind]);
  const w = img.width, h = img.height;
  const g = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, w, h).data;
  let r = 0, gr = 0, b = 0, n = 0;
  for (let p = 0; p < px.length; p += 4) if (px[p + 3]! > 128) { r += px[p]!; gr += px[p + 1]!; b += px[p + 2]!; n++; }
  r /= n; gr /= n; b /= n;
  for (let p = 0; p < px.length; p += 4) if (px[p + 3]! < 128) { px[p] = r; px[p + 1] = gr; px[p + 2] = b; }
  // строки картинки идут сверху вниз, строки текстуры — снизу вверх
  const flipped = new Uint8Array(px.length);
  for (let y = 0; y < h; y++) flipped.set(px.subarray(y * w * 4, (y + 1) * w * 4), (h - 1 - y) * w * 4);
  const t = new THREE.DataTexture(flipped, w, h, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.flipY = false; t.anisotropy = 8;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  leaf.set(kind, { map: t, lum: (0.299 * r + 0.587 * gr + 0.114 * b) / 255 });
}

/** Загрузить все картинки (один раз). */
export function preloadTreeAssets(): Promise<void> {
  loading ??= Promise.all([...(Object.keys(BARK) as BarkKind[]).map(loadBark), ...(Object.keys(LEAF) as LeafKind[]).map(loadLeaf)]).then(() => undefined);
  return loading;
}
export function barkTex(kind: BarkKind): BarkTex { const t = bark.get(kind); if (!t) throw new Error('Tree: текстуры коры не загружены (preload)'); return t; }
export function leafTex(kind: LeafKind): LeafTex { const t = leaf.get(kind); if (!t) throw new Error('Tree: текстуры листьев не загружены (preload)'); return t; }
