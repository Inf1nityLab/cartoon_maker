// threejs-nanites (MIT, (c) 2026 Victor Zakharov), src/clouds.ts @ cde2f4d: only the tileable value-noise fbm texture
// (function noiseTexture, copied verbatim; the cloud sheets, planet curvature and the rest of the file are not taken).
// OURS: the function is exported and the tile size is a parameter (SIZE); the pixel generator itself is unchanged.
import * as THREE from 'three/webgpu';

export function noiseTexture(SIZE = 512) {
  // tileable value-noise fbm, 5 octaves
  const hash = (x: number, y: number, p: number): number => {
    x = ((x % p) + p) % p;
    y = ((y % p) + p) % p;
    let h = (x * 374761393 + y * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const sm = (t: number): number => t * t * (3 - 2 * t);
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      let v = 0, amp = 0.5, norm = 0;
      for (let o = 0; o < 5; o++) {
        const period = 4 << o; // lattice cells per tile at this octave
        const fx = (x / SIZE) * period, fy = (y / SIZE) * period;
        const ix = Math.floor(fx), iy = Math.floor(fy), tx = sm(fx - ix), ty = sm(fy - iy);
        const a = hash(ix, iy, period), b = hash(ix + 1, iy, period), c = hash(ix, iy + 1, period), d = hash(ix + 1, iy + 1, period);
        v += (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty) * amp;
        norm += amp;
        amp *= 0.5;
      }
      const i = (y * SIZE + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = Math.round((v / norm) * 255);
      data[i + 3] = 255;
    }
  const tex = new THREE.DataTexture(data, SIZE, SIZE);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
