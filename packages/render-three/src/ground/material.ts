import * as THREE from 'three/webgpu';
import {
  Fn, If, abs, cameraViewMatrix, cos, dFdx, dFdy, dot, float, floor, fract, hash, int, length, mix, mx_noise_float, normalWorld, positionWorld,
  sin, smoothstep, texture, uint, uniform, vec2, vec3, vec4,
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

/** Поверхности (ground: surfaces): всё, что земля «знает о месте». Карта — из components/surface-map.ts. */
export type SurfaceOpts = {
  map: THREE.DataTexture; size: number; hasWater: boolean;
  /** куда дует ветер (°), от него гребни ряби песка поперёк */
  windDirection: number;
  /** есть ли песок, подстилка по карте; полоса песка у воды 0…1 */
  sand: boolean; litter: boolean; shoreSand: number;
};
/** Униформы поверхностей: вид меняет только их (снег и влажность не пересобирают шейдер). */
export type SurfaceUniforms = { snow: { value: number }; wet: { value: number }; ripple: { value: number } };

/**
 * Земля: почва и луг с вариациями (шум и хэш от координат и seed), камешки с куполообразной нормалью, обочина и
 * брусчатка по карте расстояний до дороги. Все шумы в мировых координатах: кадр зависит только от камеры и seed.
 * Тени и свет даёт материал (MeshStandardNodeMaterial), мы задаём цвет и нормаль.
 */
export function createGroundMaterial(opts: { seed: number; road?: RoadField; surface?: SurfaceOpts }): THREE.MeshStandardNodeMaterial & { surfaceUniforms?: SurfaceUniforms } {
  const mat = new THREE.MeshStandardNodeMaterial();
  const shV = shiftOf(opts.seed), sh = vec2(shV.x, shV.y), hseed = uint(mixSeed(opts.seed));
  const roadMap = opts.road ? buildRoadMap(opts.road) : null;
  const cell = opts.road?.stone ?? 0.22;
  const sf = opts.surface;
  const uSnow = uniform(0), uWet = uniform(0), uRipple = uniform(0.6);
  const wetV = sf ? float(0).toVar() : null, snowV = sf ? float(0).toVar() : null; // для шероховатости: объявлены до ветвей
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

    // поверхности по месту: песок, подстилка, берег — до дороги (мощение лежит поверх)
    let shoreWet: N = null, submerged: N = null;
    if (sf) {
      const uv = p.add(sf.size / 2).div(sf.size);
      const sm = texture(sf.map, uv);
      const nearWater = float(1).sub(smoothstep(8, 30, sm.b));
      // высота над водой в этой точке: берег по высоте, а не по текселю карты (линия воды ровная при любой карте)
      const above = positionWorld.y.sub(sm.a).add(mx_noise_float(p.mul(2.3).add(sh)).mul(0.015)).toVar();
      if (sf.hasWater) {
        shoreWet = float(0.92).mul(float(1).sub(smoothstep(0.02, 0.1, above))).add(float(0.38).mul(float(1).sub(smoothstep(0.08, 0.5, above)))).mul(nearWater).clamp(0, 1).toVar();
        submerged = float(1).sub(smoothstep(-0.04, 0.02, above)).mul(nearWater).toVar();
      }
      const sandW = float(sf.sand ? 1 : 0).mul(sm.r).toVar();
      if (sf.shoreSand > 0 && sf.hasWater) {
        const band = float(1).sub(smoothstep(0.1, float(0.85).add(mx_noise_float(p.mul(0.9).add(sh)).mul(0.35)), above)).mul(nearWater);
        sandW.assign(sandW.max(band.mul(sf.shoreSand)));
      }
      // песок: цвет, рябь поперёк ветра, склон подветренной стороны темнее
      const wa = (sf.windDirection * Math.PI) / 180, wd = vec2(Math.sin(wa), Math.cos(wa));
      const warp = mx_noise_float(p.mul(0.11).add(sh)).mul(1.6).add(mx_noise_float(p.mul(0.47).add(sh.yx)).mul(0.55));
      const rw = dot(p, wd).add(warp).div(0.62).toVar(); // фаза ряби, длина волны 0.62 м
      const rfw = abs(dFdx(rw)).add(abs(dFdy(rw))); // вдали рябь мельче пикселя: гасим, чтобы не мерцала
      const flat = smoothstep(0.82, 0.95, normalWorld.y);
      const ph = rw.mul(6.2831853);
      const g = cos(ph).add(cos(ph.mul(2).add(0.7)).mul(0.32)).mul(0.17).mul(float(1).sub(smoothstep(0.2, 0.6, rfw))).mul(flat)
        .mul(mx_noise_float(p.mul(0.045).add(sh)).mul(0.45).add(0.75)).toVar();
      const sA = vec3(0.4, 0.29, 0.155), sB = vec3(0.5, 0.375, 0.21);
      const sandCol = mix(sA, sB, mx_noise_float(p.mul(0.02).add(sh)).mul(0.5).add(0.5))
        .mul(float(1).add(mx_noise_float(p.mul(0.9).add(sh.yx)).mul(0.07).mul(detailFade(pm, 0.4)))).mul(float(1).add(cos(ph).mul(0.05).mul(flat))).toVar();
      sandCol.assign(mix(sandCol, sandCol.mul(vec3(0.9, 0.84, 0.8)), smoothstep(0.93, 0.8, normalWorld.y).mul(0.7)));
      colour.assign(mix(colour, sandCol, sandW));
      tilt.assign(tilt.mul(float(1).sub(sandW)).sub(wd.mul(g.mul(uRipple).mul(1.4).mul(sandW))));
      // подстилка из листьев: слои мелких листьев по клеткам, плотность — из карты (под деревьями)
      if (sf.litter) {
        const lw = sm.g.toVar();
        const duff = vec3(0.045, 0.03, 0.017);
        colour.assign(mix(colour, duff.mul(float(0.9).add(mx_noise_float(p.mul(1.7).add(sh)).mul(0.3))), lw.mul(0.75)));
        const LS = 0.17, lf = detailFade(pm, LS);
        const leafAcc = float(0).toVar();
        for (let layer = 0; layer < 3; layer++) {
          const q = p.div(LS).add(vec2(layer * 5.31, layer * 3.77)).toVar(), c0 = floor(q), f0 = fract(q);
          const hs = uint(int(c0.x).add(8192)).mul(73856093).bitXor(uint(int(c0.y).add(8192)).mul(19349663)).bitXor(hseed).add(layer * 977);
          const ang = hash(hs.add(2)).mul(6.2831853), ca = cos(ang), sa = sin(ang);
          const off = f0.sub(vec2(hash(hs.add(3)), hash(hs.add(5))).mul(0.5).add(0.25));
          const lx = off.x.mul(ca).add(off.y.mul(sa)), ly = off.y.mul(ca).sub(off.x.mul(sa));
          const d = lx.div(0.46).mul(lx.div(0.46)).add(ly.div(0.2).mul(ly.div(0.2)));
          const here = hash(hs.add(7)).lessThan(lw.mul(0.9).add(0.05)).select(float(1), float(0)); // у края подстилки листьев всё меньше
          const m = float(1).sub(smoothstep(0.7, 1.0, d)).mul(here).mul(lf);
          const t = hash(hs.add(11));
          const leafCol = mix(mix(vec3(0.19, 0.075, 0.02), vec3(0.3, 0.17, 0.035), t.mul(2).clamp(0, 1)), vec3(0.2, 0.15, 0.04), t.sub(0.5).mul(2).clamp(0, 1))
            .mul(float(1).sub(smoothstep(0.0, 0.05, abs(ly)).oneMinus().mul(0.35)).mul(float(0.75).add(float(layer).mul(0.12))));
          colour.assign(mix(colour, leafCol, m.mul(0.92)));
          tilt.assign(tilt.add(vec2(lx, ly).mul(m).mul(0.9)));
          leafAcc.addAssign(m);
        }
        // вдали листья мельче пикселя: средний цвет подстилки
        colour.assign(mix(colour, vec3(0.1, 0.05, 0.02), lw.mul(float(1).sub(lf)).mul(0.55)));
      }
    }

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
    if (sf) {
      // влажность: ручка и берег воды; темнее, глаже (шероховатость ниже)
      const wetAmt = (shoreWet ? uWet.max(shoreWet) : uWet).toVar();
      colour.assign(colour.mul(float(1).sub(wetAmt.mul(0.5))));
      // снег: где ляжет — по запасу, шуму и уклону (на крутом меньше); под водой не лежит
      const slopeK = smoothstep(0.18, 0.5, slope);
      const sn = mx_noise_float(p.mul(0.23).add(sh)).mul(0.5).add(mx_noise_float(p.mul(1.9).add(sh.yx)).mul(0.25)).add(mx_noise_float(p.mul(9)).mul(0.06).mul(detailFade(pm, 0.1)));
      const m = uSnow.mul(1.25).add(sn.mul(0.45)).sub(slopeK.mul(0.95)).sub(0.12);
      const snowAmt = smoothstep(0.32, 0.62, m).mul(submerged ? float(1).sub(submerged) : float(1)).toVar();
      const snowCol = vec3(0.6, 0.64, 0.7).mul(float(1).add(mx_noise_float(p.mul(14).add(sh)).mul(0.05).mul(detailFade(pm, 0.07))));
      colour.assign(mix(colour, snowCol, snowAmt));
      tilt.assign(tilt.mul(float(1).sub(snowAmt.mul(0.8))));
      wetV!.assign(wetAmt.mul(float(1).sub(snowAmt)));
      snowV!.assign(snowAmt);
    }
    return colour;
  })();
  // нормаль строим после цвета: наклон tilt заполняется внутри colorNode
  const nW = normalWorld.add(vec3(tilt.x, 0, tilt.y)).normalize();
  mat.normalNode = cameraViewMatrix.mul(vec4(nW, 0)).xyz.normalize();
  mat.roughness = 0.95;
  mat.metalness = 0;
  if (sf) {
    mat.roughnessNode = mix(mix(float(0.95), float(0.38), wetV!), float(0.72), snowV!);
    const out = mat as THREE.MeshStandardNodeMaterial & { surfaceUniforms?: SurfaceUniforms };
    out.surfaceUniforms = { snow: uSnow, wet: uWet, ripple: uRipple };
    return out;
  }
  return mat;
}
