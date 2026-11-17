import * as THREE from 'three';
import { defineView } from '../view.ts';
import { dayK, sunLevels, sunVector } from '../light/math.ts';

const lerpColor = (a: THREE.Color, b: THREE.Color, t: number) => a.clone().lerp(b, Math.max(0, Math.min(1, t)));
const NIGHT = new THREE.Color('#0a1226'), DUSK = new THREE.Color('#ff8a4c'), DAY = new THREE.Color('#8ec1ee');

/** Цвет неба по высоте солнца: ночь → закат → день. */
export function skyColor(elevation: number): THREE.Color {
  if (elevation >= 14) return DAY.clone();
  if (elevation >= 0) return lerpColor(DUSK, DAY, elevation / 14);
  return lerpColor(DUSK, NIGHT, -elevation / 8);
}

export const TerrainView = defineView('Terrain', {
  mount(three, inst) {
    const size = (inst.params.size as number | undefined) ?? 240;
    const seg = 192;
    const { heightAt, waterLevel } = three.sim().services;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position!, colors = new Float32Array(pos.count * 3);
    const low = new THREE.Color('#6b5a3a'), mid = new THREE.Color('#4f7a3a'), high = new THREE.Color('#8a9a6a'), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const h = heightAt(pos.getX(i), pos.getZ(i));
      pos.setY(i, h);
      const r = h - waterLevel; // высота над водой
      c.copy(r < 1.2 ? low : r < 6 ? lerpColor(low, mid, (r - 1.2) / 2) : lerpColor(mid, high, (r - 6) / 5));
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
    mesh.receiveShadow = true;
    mesh.castShadow = true; // тени рельефа: холмы затеняют низины
    three.scene.add(mesh);
    return mesh;
  },
  sync() {},
  dispose(mesh, three) { three.scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); },
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
