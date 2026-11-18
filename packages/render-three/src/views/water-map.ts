import * as THREE from 'three/webgpu';
import type { WaterField } from '@cartoon/engine';

/**
 * Карта воды: CPU считает по сервису water (то есть по ctx.heightAt) и кладёт в текстуру.
 * Канал R — глубина со знаком, м (на воде > 0, на берегу < 0: нулевая линия и есть береговая линия),
 * G, B — единичное направление течения, A — уровень поверхности, продолженный за берег.
 * Так цвет по глубине, береговая линия и пена в шейдере берутся из той же высоты земли, что и у логики.
 */
export type WaterMap = {
  texture: THREE.DataTexture;
  x0: number; z0: number; w: number; h: number; nx: number; nz: number;
  /** R-канал (глубина со знаком) на CPU: для отсечения сухих клеток меша */
  depth: Float32Array;
};

const MAX_TEXELS = 384;

export function buildWaterMap(water: WaterField, heightAt: (x: number, z: number) => number, level: number, deepDepth: number): WaterMap {
  const b = water.bounds;
  const w = b.x1 - b.x0, h = b.z1 - b.z0;
  const cell = Math.max(w, h) / MAX_TEXELS;
  const nx = Math.max(2, Math.ceil(w / cell)), nz = Math.max(2, Math.ceil(h / cell));
  const data = new Uint16Array(nx * nz * 4);
  const depth = new Float32Array(nx * nz);
  const half = THREE.DataUtils.toHalfFloat;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = b.x0 + ((i + 0.5) / nx) * w, z = b.z0 + ((j + 0.5) / nz) * h;
      const edge = i === 0 || j === 0 || i === nx - 1 || j === nz - 1;
      const l = water.level(x, z);
      let d: number;
      if (l !== null) d = Math.max(0.0005, l - heightAt(x, z));
      else d = -Math.max(0.12, heightAt(x, z) - level + 0.0);
      if (water.open && edge) d = deepDepth;
      d = Math.max(-4, Math.min(deepDepth, d));
      const f = water.flowDir(x, z), k = (j * nx + i) * 4;
      depth[j * nx + i] = d;
      data[k] = half(d); data[k + 1] = half(f[0]); data[k + 2] = half(f[1]); data[k + 3] = half(water.surface(x, z));
    }
  }
  const texture = new THREE.DataTexture(data, nx, nz, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping; texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return { texture, x0: b.x0, z0: b.z0, w, h, nx, nz, depth };
}

/** Глубина со знаком в точке по карте на CPU (билинейно, как в шейдере). */
export function mapDepthAt(m: WaterMap, x: number, z: number): number {
  const u = Math.min(m.nx - 1, Math.max(0, ((x - m.x0) / m.w) * m.nx - 0.5)), v = Math.min(m.nz - 1, Math.max(0, ((z - m.z0) / m.h) * m.nz - 0.5));
  const i = Math.min(m.nx - 2, Math.floor(u)), j = Math.min(m.nz - 2, Math.floor(v)), fx = u - i, fz = v - j;
  const d = m.depth, a = d[j * m.nx + i]!, bb = d[j * m.nx + i + 1]!, c = d[(j + 1) * m.nx + i]!, e = d[(j + 1) * m.nx + i + 1]!;
  return (a + (bb - a) * fx) * (1 - fz) + (c + (e - c) * fx) * fz;
}

export type GridOpts = { x0: number; z0: number; w: number; h: number; cells: number; keep: (x: number, z: number, cell: number) => boolean };

/**
 * Плоская сетка воды по прямоугольнику: вершины (x, 0, z) — высота берётся в шейдере из карты. Клетки, где воды нет
 * (по keep), в индексы не попадают: не рисуем лишнее.
 */
export function buildGridGeometry(o: GridOpts): THREE.BufferGeometry {
  const nx = Math.max(2, Math.min(o.cells, Math.ceil(o.w / 0.3))), nz = Math.max(2, Math.min(o.cells, Math.ceil(o.h / 0.3)));
  const pos = new Float32Array((nx + 1) * (nz + 1) * 3);
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) pos.set([o.x0 + (i / nx) * o.w, 0, o.z0 + (j / nz) * o.h], (j * (nx + 1) + i) * 3);
  const idx: number[] = [];
  const cw = o.w / nx, ch = o.h / nz;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    if (!o.keep(o.x0 + (i + 0.5) * cw, o.z0 + (j + 0.5) * ch, Math.max(cw, ch))) continue;
    const a = j * (nx + 1) + i, b = a + nx + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx.length ? new THREE.BufferAttribute(new Uint32Array(idx), 1) : new THREE.BufferAttribute(new Uint32Array([0, 0, 0]), 1));
  return g;
}

/**
 * Сетка океана вокруг центра: сгущается к центру (шаг растёт с расстоянием), чтобы рядом с камерой были волны,
 * а до горизонта хватило поверхности. Позиции — смещения от центра; центр ставит шейдер по камере.
 */
export function buildRadialGeometry(radius: number, cells: number, power = 1.8): THREE.BufferGeometry {
  const n = cells, pos = new Float32Array((n + 1) * (n + 1) * 3);
  const f = (u: number) => Math.sign(u) * Math.abs(u) ** power * radius;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) pos.set([f((i / n) * 2 - 1), 0, f((j / n) * 2 - 1)], (j * (n + 1) + i) * 3);
  const idx = new Uint32Array(n * n * 6);
  let k = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i, b = a + n + 1; idx[k++] = a; idx[k++] = b; idx[k++] = a + 1; idx[k++] = b; idx[k++] = b + 1; idx[k++] = a + 1; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}
