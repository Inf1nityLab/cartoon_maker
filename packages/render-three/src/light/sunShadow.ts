import type * as THREE from 'three/webgpu';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import { pcfRadius, SPLITS } from './math.ts';

export type CascadeInfo = { to: number; extent: number; texel: number; radius: number; normalBias: number; bias: number };

/** Сторона карты каждого каскада, пикселей. 4 каскада × 2048². */
const MAP = 2048;
/** Смещения в текселях каскада (как в песочнице): нормальное — вдоль нормали приёмника, глубинное — вдоль света. */
const NORMAL_BIAS_TEXELS = 1.5;
const DEPTH_BIAS_TEXELS = 1.0;
/** Свет ставится за верхней точкой куска камеры на это расстояние, м: ловит рельеф и деревья, что отбрасывают тень в кадр. */
const LIGHT_MARGIN = 200;

/**
 * Каскадные тени солнца (CSMShadowNode из three/addons). Каскады режут пирамиду камеры по SPLITS (м), у каждого своя
 * карта 2048². Блики и резкий край карты прячут: плавный переход между каскадами (fade), за последним каскадом туман
 * уже закрыл всё (Fog до 320 м). Смещения и мягкость считаются из размера тексела КАЖДОГО каскада (кадр за кадром:
 * тексель зависит от fov и aspect), а не заданы метрами — как в песочнице.
 */
export function createSunShadow(light: THREE.DirectionalLight, renderer: THREE.WebGPURenderer, camera: THREE.PerspectiveCamera) {
  light.castShadow = true;
  light.shadow.mapSize.set(MAP, MAP);
  const sc = light.shadow.camera;
  sc.near = 1; sc.far = 2000; // уточняется на каждый каскад в update()
  const maxFar = SPLITS[SPLITS.length - 1]!;
  const csm = new CSMShadowNode(light, {
    cascades: SPLITS.length,
    maxFar,
    mode: 'custom',
    lightMargin: LIGHT_MARGIN,
    // границы — доли от far = min(camera.far, maxFar) = maxFar
    customSplitsCallback: (_n: number, _near: number, _far: number, target: number[]) => { for (const d of SPLITS) target.push(d / maxFar); },
  });
  csm.fade = true;
  // Каскады заводятся при первой сборке материалов, то есть уже внутри первого render(): настроить смещения до него
  // нельзя, и холодный первый кадр отличался бы от остальных. Поэтому init вызываем сами сейчас (метод закрытый, но
  // публичного пути нет; три-версия зафиксирована 0.187.0).
  (csm as unknown as { _init(b: { camera: THREE.Camera; renderer: THREE.WebGPURenderer }): void })._init({ camera, renderer });
  light.shadow.shadowNode = csm;

  let info: CascadeInfo[] = [];
  /** Перед каждым render(): подогнать каскады под текущие fov/aspect камеры и пересчитать смещения. */
  function update(soft = 0): CascadeInfo[] {
    csm.updateFrustums();
    info = csm.lights.map((l, i) => {
      const s = l.shadow!, cam = s.camera;
      const extent = cam.right - cam.left, texel = extent / s.mapSize.width;
      // глубина света: от света (LIGHT_MARGIN за куском) до самой дальней точки куска ≤ extent·1.5
      cam.near = 1; cam.far = LIGHT_MARGIN + extent * 1.5 + 50;
      cam.updateProjectionMatrix();
      s.radius = pcfRadius(texel) * (1 + 2 * soft); // сплошная облачность: тень мягче и бледнее
      s.intensity = 1 - 0.7 * soft;
      s.normalBias = NORMAL_BIAS_TEXELS * texel;
      s.bias = (-DEPTH_BIAS_TEXELS * texel) / (cam.far - cam.near);
      return { to: SPLITS[i]!, extent, texel, radius: s.radius, normalBias: s.normalBias, bias: s.bias };
    });
    return info;
  }
  return {
    update,
    info: () => info,
    dispose() { csm.dispose(); },
  };
}
