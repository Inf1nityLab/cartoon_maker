import * as THREE from 'three';
import { defineView } from '../view.ts';
import { gridIndices, gridNormals, gridStep, sampleGrid } from '@cartoon/components';
import { dayK, sunLevels, sunVector } from '../light/math.ts';
import { createGroundMaterial } from '../ground/material.ts';

const lerpColor = (a: THREE.Color, b: THREE.Color, t: number) => a.clone().lerp(b, Math.max(0, Math.min(1, t)));
const NIGHT = new THREE.Color('#0a1226'), DUSK = new THREE.Color('#ff8a4c'), DAY = new THREE.Color('#8ec1ee');

/** Цвет неба по высоте солнца: ночь → закат → день. */
export function skyColor(elevation: number): THREE.Color {
  if (elevation >= 14) return DAY.clone();
  if (elevation >= 0) return lerpColor(DUSK, DAY, elevation / 14);
  return lerpColor(DUSK, NIGHT, -elevation / 8);
}

export const TerrainView = defineView('Terrain', {
  mount(three) {
    const { heightAt, waterLevel, terrain, road } = three.sim().services;
    if (!terrain) throw new Error('Terrain: в services нет terrain (компонент не прошёл setup)');
    // та же сетка и те же треугольники, по которым Terrain считает ctx.heightAt (components/terrain-grid.ts)
    const spec = { size: terrain.size, segments: terrain.segments };
    const heights = sampleGrid(spec, heightAt); // в вершинах heightAt равна значению сетки
    const n = spec.segments, w = n + 1, step = gridStep(spec), half = spec.size / 2;
    const pos = new Float32Array(w * w * 3);
    for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) pos.set([-half + i * step, heights[j * w + i]!, -half + j * step], (j * w + i) * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(gridIndices(spec), 1));
    let material: THREE.Material;
    if (terrain.ground === 'soil') {
      geo.setAttribute('normal', new THREE.BufferAttribute(gridNormals(spec, heights), 3));
      material = createGroundMaterial({ seed: terrain.seed, road });
    } else {
      // лоуполи (v1): граненая раскраска по высоте над водой
      const colors = new Float32Array(w * w * 3);
      const low = new THREE.Color('#6b5a3a'), mid = new THREE.Color('#4f7a3a'), high = new THREE.Color('#8a9a6a'), c = new THREE.Color();
      for (let k = 0; k < w * w; k++) {
        const r = heights[k]! - waterLevel; // высота над водой
        c.copy(r < 1.2 ? low : r < 6 ? lerpColor(low, mid, (r - 1.2) / 2) : lerpColor(mid, high, (r - 6) / 5));
        colors.set([c.r, c.g, c.b], k * 3);
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
    }
    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = true;
    mesh.castShadow = true; // тени рельефа: холмы затеняют низины
    three.scene.add(mesh);
    return mesh;
  },
  sync() {},
  dispose(mesh, three) { three.scene.remove(mesh); mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); },
});

export const WaterView = defineView('Water', {
  mount(three, inst) {
    const size = 600;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: (inst.params.color as string | undefined) ?? '#2a6f97', transparent: true, opacity: 0.82, roughness: 0.15, metalness: 0.1 }),
    );
    mesh.position.y = three.sim().services.waterLevel;
    three.scene.add(mesh);
    return mesh;
  },
  sync() {},
  dispose(mesh, three) { three.scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); },
});

type ForcesView = {
  sunLight: { strength: number }; moonLight: { elevation: number; azimuth: number; strength: number };
  cloudiness: number; fog: number;
};
const GREY = new THREE.Color('#9aa3ad'), FOG_GREY = new THREE.Color('#b8bec6'), SUN_LOW = new THREE.Color('#ff9a5a'), SUN_HIGH = new THREE.Color('#fff4e0'), MOON = new THREE.Color('#9db8ff');

/**
 * Небо, солнце и (если в мире есть Forces) луна, облачность и туман. Объекты three создаются один раз в mount и дальше
 * меняются на месте (новый Fog или Color на каждый кадр пересобирал бы все шейдеры сцены, задача 1.8).
 * Без Forces — прежний расчёт по высоте солнца, кадры старых сцен не меняются.
 */
export const SkyView = defineView('Sky', {
  mount: () => ({ bg: new THREE.Color(), key: new THREE.Color(), tmp: new THREE.Color(), grey: new THREE.Color() }),
  sync(h, _self, three, state) {
    const { elevation, azimuth } = state.sun;
    const f = Object.values(state.world ?? {}).find((w) => w.type === 'Forces') as unknown as ForcesView | undefined;
    h.bg.copy(skyColor(elevation));
    if (f) h.bg.lerp(h.grey.copy(GREY).multiplyScalar(0.25 + 0.75 * Math.min(1, Math.max(0, elevation / 20 + 0.5))), f.cloudiness * 0.55);
    three.scene.background = h.bg;
    const fogColor = f ? h.tmp.copy(h.bg).lerp(h.grey.copy(FOG_GREY).multiplyScalar(0.25 + 0.75 * dayK(elevation + 10)), f.fog * 0.8) : h.bg;
    // Туман создаём один раз и дальше меняем на месте.
    if (three.scene.fog instanceof THREE.Fog) three.scene.fog.color.copy(fogColor);
    else three.scene.fog = new THREE.Fog(fogColor, 60, 320);
    const fog = three.scene.fog as THREE.Fog;
    fog.near = f ? 60 * (1 - 0.9 * f.fog) : 60;
    fog.far = f ? 320 * (1 - 0.85 * f.fog) : 320;
    const target = state.camera.target;
    let dir: [number, number, number], intensity: number, hemi: number, exposure: number;
    if (f && f.moonLight.strength > f.sunLight.strength) {
      // ночь: главный свет — луна (холодный, слабый); переключение там, где оба света почти нулевые, поэтому без скачка
      dir = sunVector(f.moonLight.elevation, f.moonLight.azimuth);
      h.key.copy(MOON);
      intensity = 0.75 * f.moonLight.strength;
      hemi = 0.24 + 0.3 * f.moonLight.strength;
      exposure = 1.35;
    } else if (f) {
      const k = dayK(elevation), lv = sunLevels(elevation);
      dir = sunVector(elevation, azimuth);
      h.key.copy(SUN_LOW).lerp(SUN_HIGH, k);
      const fade = Math.max(0, Math.min(1, (elevation + 1.5) / 3)); // солнце гаснет у горизонта: к -1.5° света нет
      intensity = lv.sun * fade * (1 - 0.7 * f.cloudiness);
      const dusk = 1 - Math.min(1, Math.abs(elevation - 1) / 8); // закат и рассвет: небо светит сильнее прямого света
      hemi = Math.max(0.5 + 0.4 * dusk, lv.hemi * (0.35 + 0.65 * fade)) * (1 - 0.25 * f.cloudiness);
      exposure = lv.exposure;
    } else {
      const k = dayK(elevation), lv = sunLevels(elevation);
      dir = sunVector(elevation, azimuth);
      h.key.copy(SUN_LOW).lerp(SUN_HIGH, k);
      intensity = lv.sun; hemi = lv.hemi; exposure = lv.exposure;
    }
    // направление света задают только эти две точки; каскады теней (light/sunShadow.ts) сами встают под камеру
    three.sunLight.target.position.set(target[0], target[1], target[2]);
    three.sunLight.position.set(target[0] + dir[0] * 80, target[1] + dir[1] * 80, target[2] + dir[2] * 80);
    three.sunLight.color.copy(h.key);
    three.sunLight.intensity = intensity;
    three.hemi.intensity = hemi;
    three.hemi.color.copy(h.bg);
    three.renderer.toneMappingExposure = exposure;
  },
  dispose() {},
});
