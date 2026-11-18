import * as THREE from 'three';
import { defineView } from '../view.ts';
import { gridIndices, gridNormals, gridStep, sampleGrid } from '@cartoon/components';
import type { WorldState } from '@cartoon/schema';
import { fogColorAt, skyLook, type SkyInput } from '../light/sky.ts';
import { applyLook } from '../sky/nodes.ts';
import { createGroundMaterial } from '../ground/material.ts';

const lerpColor = (a: THREE.Color, b: THREE.Color, t: number) => a.clone().lerp(b, Math.max(0, Math.min(1, t)));

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

type ForcesView = {
  time: number; sunLight: { strength: number }; moonLight: { elevation: number; azimuth: number; strength: number; phase: number };
  stars: number; cloudiness: number; fog: number; cloud?: [number, number];
};

/** Подгонка света неба под наш материал земли и листвы (их цвета нарисованы тёмнее физических): коэффициент к SH, найден по кадрам заката. */
const SH_GAIN = 3.4;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/** Что небу известно о мире: силы мира, а без них — только солнце (старые сцены). */
function skyInput(state: WorldState, f: ForcesView | undefined): SkyInput {
  const { elevation, azimuth } = state.sun;
  if (f) {
    return { sunEl: elevation, sunAz: azimuth, moonEl: f.moonLight.elevation, moonAz: f.moonLight.azimuth, moonPhase: f.moonLight.phase, moonStrength: f.moonLight.strength, cloudiness: f.cloudiness, fog: f.fog, stars: f.stars, time: f.time };
  }
  const cloud = 0.15;
  return { sunEl: elevation, sunAz: azimuth, moonEl: -elevation, moonAz: azimuth + 180, moonPhase: 1, moonStrength: smooth(2, 14, -elevation) * (1 - 0.7 * cloud), cloudiness: cloud, fog: 0, stars: clamp01((-elevation - 4) / 10) * (1 - 0.8 * cloud), time: 0 };
}

/**
 * Небо и свет одним расчётом (light/sky.ts): купол неба (звёзды, луна с фазой, облака, дымка, солнце), главный свет
 * (солнце или ночью луна), свет неба на землю (LightProbe: сверху небо, снизу отражённый свет земли), экспозиция,
 * туман цвета неба у горизонта. Цвет неба для воды и всего, что его отражает, — из общих униформ (`three.sky`).
 * Всё создаётся один раз в mount и дальше меняются только значения (сторож шейдеров, задача 1.8).
 * Сам вид идёт первым в кадре (адаптер), чтобы остальные виды видели свет этого кадра.
 */
export const SkyView = defineView('Sky', {
  mount(three) {
    const dome = three.sky.createDome();
    three.scene.add(dome);
    return { dome, bg: new THREE.Color(), key: new THREE.Color(), fogTmp: new THREE.Color() };
  },
  sync(h, _self, three, state) {
    const f = Object.values(state.world ?? {}).find((w) => w.type === 'Forces') as unknown as ForcesView | undefined;
    const input = skyInput(state, f);
    const look = skyLook(input);
    const t = state.t;
    applyLook(three.sky.u, look, f?.cloud ?? [t * 0.004, t * 0.0015], input.fog);

    // фон и туман: небо у горизонта в сторону взгляда
    const cam = state.camera, target = cam.target;
    const viewAz = Math.atan2(target[0] - cam.pos[0], target[2] - cam.pos[2]) * (180 / Math.PI);
    const fc = fogColorAt(look, viewAz, input.sunAz, input.sunEl, input.fog);
    h.fogTmp.setRGB(fc[0], fc[1], fc[2], THREE.LinearSRGBColorSpace);
    h.bg.copy(h.fogTmp);
    three.scene.background = h.bg;
    // Туман создаём один раз и дальше меняем на месте.
    if (three.scene.fog instanceof THREE.Fog) three.scene.fog.color.copy(h.fogTmp);
    else three.scene.fog = new THREE.Fog(h.fogTmp, 60, 320);
    const fog = three.scene.fog as THREE.Fog;
    fog.near = 60 * (1 - 0.9 * input.fog);
    fog.far = 320 * (1 - 0.85 * input.fog);

    // главный свет: солнце или ночью луна; направление задают две точки, каскады теней сами встают под камеру
    h.key.setRGB(look.keyColor[0], look.keyColor[1], look.keyColor[2], THREE.LinearSRGBColorSpace);
    const d = look.keyDir;
    three.sunLight.target.position.set(target[0], target[1], target[2]);
    three.sunLight.position.set(target[0] + d[0] * 80, target[1] + d[1] * 80, target[2] + d[2] * 80);
    three.sunLight.color.copy(h.key);
    three.sunLight.intensity = look.keyIntensity;

    // свет неба на землю: коэффициенты SH; полусферический свет гасим (его роль у пробы)
    for (let i = 0; i < 9; i++) three.skyProbe.sh.coefficients[i]!.set(look.sh[i]![0] * SH_GAIN, look.sh[i]![1] * SH_GAIN, look.sh[i]![2] * SH_GAIN);
    three.skyProbe.intensity = 1;
    three.hemi.intensity = 0;
    three.skyState.ambient.setRGB(look.ambient[0], look.ambient[1], look.ambient[2], THREE.LinearSRGBColorSpace);
    three.skyState.active = true;
    three.skyState.shadowSoft = look.shadowSoft;
    three.skyState.daylight = look.daylight;
    three.renderer.toneMappingExposure = look.exposure;
  },
  dispose(h, three) { three.scene.remove(h.dome); h.dome.geometry.dispose(); (h.dome.material as THREE.Material).dispose(); three.skyState.active = false; },
});
