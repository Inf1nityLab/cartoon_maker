// Брусчатка: камни Вороного в мировых координатах, у каждого свой серо-коричневый тон, куполообразная нормаль (камень
// «выпуклый» к краям), в швах тёмная земля с мхом. Вдали, где узор мельче пикселя, — средний цвет и плоская нормаль:
// затухание по ПЛОЩАДИ следа пикселя, а не по длинной стороне (вдоль дороги под скользящим углом длинная сторона
// большая, и камни серели уже в 10 м). Идея и порядок затухания — по образцу ground/cobbles.ts из threejs-nanites (MIT,
// см. sources/catalog.json); код написан заново под наши seed и параметры.
import { abs, dFdx, dFdy, dot, float, hash, int, length, min, mix, mx_noise_float, select, smoothstep, uint, vec2, vec3 } from 'three/tsl';

type N = any;

/** След пикселя на земле: производные координат клетки и размер в камнях по площади. Брать в единой ветке (до If). */
export function cobbleFootprint(p: N, cell: number): { dx: N; dy: N; px: N } {
  const s = p.div(cell);
  const dx = dFdx(s).toVar(), dy = dFdy(s).toVar();
  return { dx, dy, px: length(dx).mul(length(dy)).sqrt().toVar() };
}
/** Выше этого следа (в камнях) узора нет: средний цвет, плоская нормаль. */
export const COBBLES_GONE = 2.5;

function voronoi(s: N, seed: N): { toward: N; edge: N; grad: N; r: N } {
  const cell = s.floor(), f = s.fract();
  const d1 = float(9).toVar(), d2 = float(9).toVar(), r = float(0).toVar();
  const toward = vec2(0).toVar(), second = vec2(0, 1).toVar();
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const c = cell.add(vec2(i, j));
      const h = uint(int(c.x).add(4096)).mul(73856093).bitXor(uint(int(c.y).add(4096)).mul(19349663)).bitXor(seed);
      const pt = vec2(i, j).add(vec2(hash(h), hash(h.add(7))).mul(0.7).add(0.15));
      const v = f.sub(pt).toVar(), d = v.length().toVar();
      const closer = d.lessThan(d1).toVar();
      second.assign(select(closer, toward, select(d.lessThan(d2), v, second)));
      d2.assign(select(closer, d1, min(d2, d)));
      r.assign(select(closer, hash(h.add(13)), r));
      toward.assign(select(closer, v, toward));
      d1.assign(min(d1, d));
    }
  }
  return { toward, edge: d2.sub(d1), grad: second.div(d2.max(1e-5)).sub(toward.div(d1.max(1e-5))), r };
}

/** Пятна износа и грязи по мощению: множитель яркости в мировой точке p. */
export const cobblePatches = (p: N): N => mx_noise_float(p.mul(0.35)).mul(0.25).add(mx_noise_float(p.mul(1.1).add(5)).mul(0.12)).add(1);
/** Цвет мощения вдали (мельче пикселя): среднее камней по пятнам; темнее среднего альбедо, потому что нормали-купола затеняют камни вблизи. */
export const cobbleAverage = (patches: N): N => vec3(0.05, 0.045, 0.038).mul(patches);

/** Цвет брусчатки и наклон нормали (x, z) в мировой точке p; след пикселя fp — из cobbleFootprint. Производных не берёт: можно строить внутри If. */
export function cobbles(p: N, seed: N, cell: number, fp: { dx: N; dy: N; px: N }): { colour: N; tilt: N } {
  const v = voronoi(p.div(cell), seed);
  // край шва: его производная из градиента двух ближайших камней (производные GPU на швах дают ступеньки)
  const aa = abs(dot(v.grad, fp.dx)).add(abs(dot(v.grad, fp.dy))).max(0.02);
  const stone = smoothstep(float(0.12).sub(aa), float(0.12).add(aa), v.edge);
  const tone = mix(vec3(0.03, 0.028, 0.024), vec3(0.14, 0.128, 0.11), v.r).mul(mx_noise_float(p.mul(9)).mul(0.25).add(1));
  const joint = mix(vec3(0.012, 0.01, 0.007), vec3(0.018, 0.03, 0.01), smoothstep(0.2, 0.6, mx_noise_float(p.mul(1.3))));
  const patches = cobblePatches(p);
  const near = float(1).sub(smoothstep(0.8, COBBLES_GONE, fp.px));
  const colour = mix(cobbleAverage(patches), mix(joint, tone.mul(patches), stone), near);
  // купол: нормаль наклонена от середины камня наружу, сильнее у края
  const lean = float(1).sub(smoothstep(0.05, 0.45, v.edge)).mul(1.4).mul(near);
  return { colour, tilt: v.toward.normalize().mul(lean) };
}
