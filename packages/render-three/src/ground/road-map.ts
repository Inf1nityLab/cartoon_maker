import * as THREE from 'three/webgpu';
import { float, texture, vec2 } from 'three/tsl';
import type { RoadField } from '@cartoon/engine';

/** Расстояния в карте обрезаются на ±FAR, м (полуфлоаты: линейная фильтрация 32-битных текстур в WebGPU необязательна). */
export const ROAD_FAR = 8;
const MAX_RES = 1024;
const MIN_TEXEL = 0.08; // м

export type RoadMap = { tex: THREE.DataTexture; x0: number; z0: number; w: number; h: number };

/**
 * Карта «метры до края мощения» (минус — на дороге) по прямоугольнику влияния дороги. Считается на CPU той же
 * edgeDistance, что и логика (components/road.ts): GPU и CPU видят одну дорогу. Вне карты — ROAD_FAR.
 */
export function buildRoadMap(road: RoadField): RoadMap {
  const { x0, x1, z0, z1 } = road.bounds;
  const texel = Math.max(MIN_TEXEL, (x1 - x0) / MAX_RES, (z1 - z0) / MAX_RES);
  const rx = Math.ceil((x1 - x0) / texel), rz = Math.ceil((z1 - z0) / texel);
  const w = rx * texel, h = rz * texel;
  const data = new Uint16Array(rx * rz);
  for (let j = 0; j < rz; j++) {
    for (let i = 0; i < rx; i++) {
      const d = road.edgeDistance(x0 + (i + 0.5) * texel, z0 + (j + 0.5) * texel);
      data[j * rx + i] = THREE.DataUtils.toHalfFloat(Math.max(-ROAD_FAR, Math.min(ROAD_FAR, d)));
    }
  }
  const tex = new THREE.DataTexture(data, rx, rz, THREE.RedFormat, THREE.HalfFloatType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return { tex, x0, z0, w, h };
}

/** В шейдере: метры от мирового xz `p` до края мощения (минус — на дороге; вне карты ROAD_FAR). */
export function roadDistanceNode(m: RoadMap, p: any): any {
  const uv = p.sub(vec2(m.x0, m.z0)).div(vec2(m.w, m.h));
  const inside = uv.x.greaterThan(0).and(uv.x.lessThan(1)).and(uv.y.greaterThan(0)).and(uv.y.lessThan(1));
  return inside.select(texture(m.tex, uv).r, float(ROAD_FAR));
}
