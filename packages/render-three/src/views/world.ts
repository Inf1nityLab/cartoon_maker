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

export const SkyView = defineView('Sky', {
  mount: () => ({}),
  sync(_h, _self, three, state) {
    const { elevation, azimuth } = state.sun;
    const sky = skyColor(elevation);
    three.scene.background = sky;
    three.scene.fog = new THREE.Fog(sky, 60, 320);
    const k = dayK(elevation), lv = sunLevels(elevation);
    const d = sunVector(elevation, azimuth), target = state.camera.target;
    // направление света задают только эти две точки; каскады теней (light/sunShadow.ts) сами встают под камеру
    three.sunLight.target.position.set(target[0], target[1], target[2]);
    three.sunLight.position.set(target[0] + d[0] * 80, target[1] + d[1] * 80, target[2] + d[2] * 80);
    three.sunLight.color.set(lerpColor(new THREE.Color('#ff9a5a'), new THREE.Color('#fff4e0'), k));
    three.sunLight.intensity = lv.sun;
    three.hemi.intensity = lv.hemi;
    three.hemi.color.copy(sky);
    three.renderer.toneMappingExposure = lv.exposure;
  },
  dispose() {},
});
