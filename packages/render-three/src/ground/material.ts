import * as THREE from 'three/webgpu';
import {
  Fn, If, cameraViewMatrix, dFdx, dFdy, float, floor, fract, hash, int, length, mix, mx_noise_float, normalWorld, positionWorld,
  smoothstep, uint, vec2, vec3, vec4,
} from 'three/tsl';
import type { RoadField } from '@cartoon/engine';
import { buildRoadMap, roadDistanceNode } from './road-map.ts';
import { COBBLES_GONE, cobbleAverage, cobblePatches, cobbleFootprint, cobbles } from './cobbles.ts';

type N = any;

/** Перемешанный целый seed для хэшей шейдера и сдвиг шума: только числа: ни часов, ни генератора случайных чисел. */
const mixSeed = (seed: number) => Math.imul(seed | 0, 0x9e3779b1) >>> 0;
const shiftOf = (seed: number) => new THREE.Vector2(((mixSeed(seed) >>> 8) % 997) * 0.37, ((mixSeed(seed + 1) >>> 8) % 991) * 0.41);

/** Как быстро деталь размера `size` (м) исчезает по размеру пикселя на земле `pm` (м): нет мерцания вдали, среднее остаётся. */
const detailFade = (pm: N, size: number): N => float(1).sub(smoothstep(size * 0.25, size * 0.9, pm));

/**
 * Земля: почва и луг с вариациями (шум и хэш от координат и seed), камешки с куполообразной нормалью, обочина и
 * брусчатка по карте расстояний до дороги. Все шумы в мировых координатах: кадр зависит только от камеры и seed.
 * Тени и свет даёт материал (MeshStandardNodeMaterial), мы задаём цвет и нормаль.
 */
export function createGroundMaterial(opts: { seed: number; road?: RoadField }): THREE.MeshStandardNodeMaterial {
  const mat = new THREE.MeshStandardNodeMaterial();
  const shV = shiftOf(opts.seed), sh = vec2(shV.x, shV.y), hseed = uint(mixSeed(opts.seed));
  const roadMap = opts.road ? buildRoadMap(opts.road) : null;
  const cell = opts.road?.stone ?? 0.22;
  const tilt = vec2(0).toVar(); // (x, z: добавка к нормали рельефа; объявлена до ветвей, иначе узел из ветки вне области)

  mat.colorNode = Fn(() => {
    tilt.assign(vec2(0));
    const p = positionWorld.xz.toVar();
    // производные берём здесь, в единой ветке: в If они недопустимы
    const pm = length(dFdx(p)).mul(length(dFdy(p))).sqrt().toVar(); // размер пикселя на земле, м (по площади)
    const cfp = cobbleFootprint(p, cell);
    const slope = float(1).sub(normalWorld.y).toVar();

    // крупные пятна луга и сухой травы, средние проплешины почвы, мелкая зернистость
    const big = mx_noise_float(p.mul(0.035).add(sh)).toVar();
    const mid = mx_noise_float(p.mul(0.33).add(sh.yx)).toVar();
    const fine = mx_noise_float(p.mul(3.1).add(sh.add(7))).mul(detailFade(pm, 0.3)).toVar();
    const grass = vec3(0.052, 0.098, 0.028), dry = vec3(0.15, 0.13, 0.055), soil = vec3(0.085, 0.058, 0.038);
    const meadow = mix(grass, dry, smoothstep(-0.15, 0.55, big.add(mid.mul(0.35))));
    const bare = smoothstep(0.18, 0.5, mid.mul(0.55).add(big.mul(0.45))).add(smoothstep(0.12, 0.4, slope)).clamp(0, 1);
    const colour = mix(meadow, soil, bare).mul(float(1).add(fine.mul(0.2)).add(mid.mul(0.12))).toVar();

    // камешки: клетка 14 см, в каждой третьей — камень со своим радиусом и положением; тают вместе с размером пикселя
    const PEB = 0.14;
    const q = p.div(PEB), pc = floor(q), pf = fract(q);
    const hs = uint(int(pc.x).add(8192)).mul(73856093).bitXor(uint(int(pc.y).add(8192)).mul(19349663)).bitXor(hseed);
    const has = hash(hs).lessThan(0.16).select(float(1), float(0));
    const centre = vec2(hash(hs.add(3)), hash(hs.add(5))).mul(0.4).add(0.3);
    const rad = hash(hs.add(11)).mul(0.12).add(0.1);
    const off = pf.sub(centre);
    const aa = pm.div(PEB).mul(0.8).add(0.02);
    const peb = float(1).sub(smoothstep(rad.sub(aa), rad.add(aa), length(off))).mul(has).mul(detailFade(pm, PEB)).toVar();
    const pebTone = mix(vec3(0.07, 0.06, 0.05), vec3(0.16, 0.14, 0.115), hash(hs.add(17)));
    colour.assign(mix(colour, pebTone, peb.mul(0.8)));
    tilt.assign(off.div(rad).mul(peb).mul(0.7).add(vec2(mx_noise_float(p.mul(5.3).add(sh)), mx_noise_float(p.mul(5.3).add(sh.yx.add(3)))).mul(0.12).mul(detailFade(pm, 0.2))));

    if (roadMap) {
      const dist = roadDistanceNode(roadMap, p).add(mx_noise_float(p.mul(1.7).add(sh)).mul(0.25)).toVar();
      // обочина: утоптанная тёмная земля у края, дальше по лугу она тает
      const verge = float(1).sub(smoothstep(0.0, 1.6, dist)).mul(smoothstep(-0.1, 0.1, dist));
      colour.assign(mix(colour, soil.mul(0.8), verge.mul(0.7)));
      const paved = float(1).sub(smoothstep(-0.12, 0.12, dist)).toVar();
      If(paved.greaterThan(0).and(cfp.px.lessThan(COBBLES_GONE)), () => {
        const cob = cobbles(p, hseed, cell, cfp);
        colour.assign(mix(colour, cob.colour, paved));
        tilt.assign(mix(tilt, cob.tilt, paved));
      }).Else(() => {
        colour.assign(mix(colour, cobbleAverage(cobblePatches(p)), paved));
        tilt.assign(tilt.mul(float(1).sub(paved)));
      });
    }
    return colour;
  })();
  // нормаль строим после цвета: наклон tilt заполняется внутри colorNode
  const nW = normalWorld.add(vec3(tilt.x, 0, tilt.y)).normalize();
  mat.normalNode = cameraViewMatrix.mul(vec4(nW, 0)).xyz.normalize();
  mat.roughness = 0.95;
  mat.metalness = 0;
  return mat;
}
