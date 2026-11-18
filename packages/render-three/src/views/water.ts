import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { seaOf, waveHeightAt, waveModes, WaterParams, type WaterSelf, type WaveLayerName } from '@cartoon/components';
import type { WaterField } from '@cartoon/engine';
import { defineView } from '../view.ts';
import type { Sky } from '../sky/nodes.ts';
import { buildGridGeometry, buildRadialGeometry, buildWaterMap, mapDepthAt, type WaterMap } from './water-map.ts';

type N = any;
// узлы TSL типизированы слишком строго для шейдерного кода с вложенными выражениями: берём их без типов
const { Fn, mrt, velocity, attribute, clamp, cameraPosition, cos, exp, faceDirection, float, fract, mix, mx_noise_float, normalize, dot, length, max, min, positionWorld, pow, reflect, refract, select, sin, smoothstep, texture, uniform, vec2, vec3, vec4, abs } = TSL as any;

/**
 * Вода (ARCHITECTURE 6.5). Вид realistic: прозрачная поверхность с волнами слоями (зыбь, ветровые, рябь: сумма синусоид,
 * одна и та же функция на CPU в components/water-waves.ts и здесь), пеной у берега и на гребнях, бликами солнца и
 * отражением неба, цветом по глубине из карты воды (water-map.ts), льдом. Каустики на дне — отдельный накладной меш
 * по дну (умножает цвет земли), под водой — туман и фон цвета воды, лучи света сверху и поверхность снизу.
 * Вид classic — прежний простой лист (старые сцены).
 *
 * Правило сторожа шейдеров: после mount ничего не создаётся — значения меняются в uniform-ах и на месте в туман/фон сцены.
 * Приёмы волн, пены и бликов — по открытым статьям (спектр волн, Gerstner, Френель) и по наблюдению за демо океана;
 * код свой, из демо без лицензии строки не взяты.
 */

const G = 9.81;
const PI = Math.PI;
const CLASSIC_SIZE = 600;
const SHAFT_CELL = 16, SHAFT_GRID = 7, SHAFT_DEPTH = 40;
const MAX_RINGS = 8;

type Layer = { gain: N; sinP: N; cosP: N; inv: N; sq: N };
type U = ReturnType<typeof makeUniforms>;

const colorU = () => uniform(new THREE.Color());
const vec3U = (x = 0, y = 0, z = 0) => uniform(new THREE.Vector3(x, y, z));

function makeUniforms(seed: number, sky: Sky) {
  const layer = (): Layer => ({ gain: uniform(0), sinP: uniform(0), cosP: uniform(1), inv: uniform(1), sq: uniform(1) });
  return {
    seed, sky,
    time: uniform(0), drift: uniform(0),
    layers: { swell: layer(), wind: layer(), ripple: layer() } as Record<WaveLayerName, Layer>,
    rings: Array.from({ length: MAX_RINGS }, () => uniform(new THREE.Vector4(0, 0, 0, 0))),
    shallow: colorU(), deep: colorU(), bed: colorU(),
    bedBlend: uniform(0), vis: uniform(5), kScale: uniform(1), reflection: uniform(0.8), foam: uniform(0.5), ice: uniform(0), foamWave: uniform(0), flowOn: uniform(0),
    sunDir: vec3U(0, 1, 0), sunRad: vec3U(), light: vec3U(),
    uwColor: colorU(), uwLight: uniform(1),
    mapOrigin: uniform(new THREE.Vector2()), mapSize: uniform(new THREE.Vector2(1, 1)),
    center: uniform(new THREE.Vector2()), ripple01: uniform(0),
    bedLight: uniform(0), caustic: uniform(0), uwK: uniform(0),
    camCell: uniform(new THREE.Vector2()), shaftY: uniform(1e6), shaftK: uniform(0), shaftShear: uniform(new THREE.Vector2()),
  };
}

/** Волны: сумма мод трёх слоёв (та же формула, что waveHeightAt). q — точка с учётом сноса течением. Возвращает высоту, градиент, лапласиан, сдвиг и якобиан сдвига. */
function waves(u: U, q: N, depth: N, want: { grad?: boolean; lap?: boolean; disp?: boolean; jac?: boolean }, ripFade: N = float(1)) {
  const big = smoothstep(0, 1.2, depth), small = smoothstep(0, 0.15, depth).mul(ripFade);
  let h: N = float(0), gx: N = float(0), gz: N = float(0), lap: N = float(0), dX: N = float(0), dZ: N = float(0);
  let jxx: N = float(0), jzz: N = float(0), jxz: N = float(0);
  for (const name of ['swell', 'wind', 'ripple'] as const) {
    const L = u.layers[name], gain = L.gain.mul(name === 'ripple' ? small : big);
    const chop = name === 'ripple' ? 0 : name === 'swell' ? 0.9 : 0.7;
    for (const m of waveModes(u.seed, name)) {
      const k0 = (2 * PI) / m.len, cd = Math.cos(m.da), sd = Math.sin(m.da);
      const k = L.inv.mul(k0);
      const dx = L.sinP.mul(cd).add(L.cosP.mul(sd)), dz = L.cosP.mul(cd).sub(L.sinP.mul(sd));
      const phase = k.mul(dx.mul(q.x).add(dz.mul(q.y))).sub(L.sq.mul(Math.sqrt(G * k0)).mul(u.time)).add(m.phase);
      const s = sin(phase), c = cos(phase), A = gain.mul(m.amp);
      h = h.add(A.mul(s.sub(c.mul(c).sub(s.mul(s)).mul(0.07))));
      if (want.grad) { const dh = A.mul(c.add(s.mul(c).mul(0.28))).mul(k); gx = gx.add(dh.mul(dx)); gz = gz.add(dh.mul(dz)); }
      if (want.lap) lap = lap.sub(A.mul(k).mul(k).mul(s));
      if (chop > 0 && (want.disp || want.jac)) {
        const ac = A.mul(c).mul(chop);
        if (want.disp) { dX = dX.sub(ac.mul(dx)); dZ = dZ.sub(ac.mul(dz)); }
        if (want.jac) { const as = A.mul(s).mul(k).mul(chop); jxx = jxx.add(as.mul(dx).mul(dx)); jzz = jzz.add(as.mul(dz).mul(dz)); jxz = jxz.add(as.mul(dx).mul(dz)); }
      }
    }
  }
  const jac = jxx.add(1).mul(jzz.add(1)).sub(jxz.mul(jxz));
  return { h, gx, gz, lap, dX, dZ, jac };
}

/** Круги от падений и движущихся в воде: высота и градиент, 8 источников в uniform-ах (x, z, возраст, сила). */
function rings(u: U, p: N) {
  let h: N = float(0), gx: N = float(0), gz: N = float(0);
  for (const r of u.rings) {
    const d = p.sub(vec2(r.x, r.y)), dist = max(length(d), 0.001), age = r.z, amp = r.w;
    const x = dist.sub(age.mul(0.9));
    const env = exp(x.mul(x).div(age.mul(0.05).add(0.06)).negate()).mul(amp).mul(exp(age.mul(-0.55))).mul(smoothstep(0, 0.15, age));
    const ph = x.mul(15);
    h = h.add(sin(ph).mul(env).mul(0.014));
    const dh = cos(ph).mul(env).mul(0.014 * 15);
    gx = gx.add(dh.mul(d.x).div(dist)); gz = gz.add(dh.mul(d.y).div(dist));
  }
  return { h, gx, gz };
}

const mapUv = (u: U, p: N) => p.sub(u.mapOrigin).div(u.mapSize);

/** Цвет неба в направлении r: единый источник (sky/nodes.ts): тот же узел, что рисует купол неба (градиент, закат, облака, луна, звёзды). */
const skyColor = (u: U, r: N) => u.sky.radiance(r, true);

/**
 * ТОЧКА РАСШИРЕНИЯ (задача Б1в): отражение предметов. Сейчас вода отражает только небо. Б1в добавит сюда отражение в экранном
 * пространстве (по нашей глубине и цвету кадра): вернуть mix(небо, цвет кадра в точке отражённого луча, вес попадания).
 * R — отражённый луч (мир), P — точка поверхности, N — нормаль волн.
 */
const reflectedColor = (u: U, R: N, _P: N, _N: N) => skyColor(u, R);

function surfaceMaterial(u: U, map: WaterMap, open: boolean): THREE.NodeMaterial {
  const mat = new THREE.NodeMaterial();
  mat.transparent = true; mat.depthWrite = false; mat.side = THREE.DoubleSide;
  // свет уже в цвете: смешиваем «поверх» без повторного умножения на альфу (premultiplied)
  mat.blending = THREE.CustomBlending; mat.blendEquation = THREE.AddEquation;
  mat.blendSrc = THREE.OneFactor; mat.blendDst = THREE.OneMinusSrcAlphaFactor; mat.blendSrcAlpha = THREE.OneFactor; mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  const mapTex = texture(map.texture);

  // --- вершины: высота уровня из карты, волны и сдвиг по гребням
  const vp = Fn(() => {
    const base = attribute('position', 'vec3');
    const off = vec2(base.x, base.z);
    const p = open ? off.add(u.center) : off;
    const mv = mapTex.sample(mapUv(u, p)).level(0);
    const depth = max(mv.r, 0);
    const q = p.sub(vec2(mv.g, mv.b).mul(u.drift));
    const w = waves(u, q, depth, { disp: true });
    const rg = rings(u, p);
    const iceDamp = float(1).sub(u.ice.mul(0.0));
    return vec3(p.x.add(w.dX.mul(iceDamp)), mv.a.add(w.h).add(rg.h), p.y.add(w.dZ.mul(iceDamp)));
  });
  mat.positionNode = vp();

  // --- пиксели
  const out = Fn(() => {
    const P = positionWorld, p = vec2(P.x, P.z);
    const mv = mapTex.sample(mapUv(u, p));
    const sd = mv.r, depth = max(sd, 0), shore = smoothstep(0.0, 0.04, sd);
    const q = p.sub(vec2(mv.g, mv.b).mul(u.drift));
    const dist = length(cameraPosition.sub(P));
    const w = waves(u, q, depth, { grad: true, jac: true }, float(1).sub(smoothstep(40, 160, dist).mul(0.75)));
    const rg = rings(u, p);

    // лёд: кромка у берега, мелкие поля; крупный шум задаёт, где лёд встаёт первым
    const nL = mx_noise_float(p.mul(0.09)), nM = mx_noise_float(p.mul(0.7).add(7.3));
    const cover = u.ice.mul(1.35).add(float(1).sub(smoothstep(0, 3.5, depth)).mul(0.4)).add(nL.mul(0.22)).add(nM.mul(0.06)).sub(0.42);
    const iceMask = smoothstep(0.46, 0.56, cover);
    const slope = float(1).sub(iceMask.mul(0.92));
    const gx = w.gx.add(rg.gx).mul(slope), gz = w.gz.add(rg.gz).mul(slope);
    const N0 = normalize(vec3(gx.negate(), 1, gz.negate()));
    const Nf = N0.mul(faceDirection);
    const V = normalize(cameraPosition.sub(P));
    const cosV = clamp(dot(Nf, V), 0, 1);

    // ---- сверху
    const fres = float(0.02).add(float(0.98).mul(pow(float(1).sub(cosV), 5)));
    const R = reflect(V.negate(), Nf);
    const Rs = vec3(R.x, max(R.y, 0.01), R.z);
    const sky = reflectedColor(u, Rs, P, Nf);
    const rl = max(dot(Rs, u.sunDir), 0);
    const spec = u.sunRad.mul(pow(rl, 1600).mul(140).add(pow(rl, 260).mul(0.3)));
    const refl = sky.mul(0.4).add(spec).mul(fres).mul(u.reflection);
    // вода: прозрачность по глубине и ясности, цвет мелководья переходит в цвет глубины
    // поглощение по каналам: красный гаснет первым, дно уходит в бирюзу и синеву; kScale растёт с мутностью
    const Tc = exp(vec3(0.55, 0.13, 0.07).mul(u.kScale).mul(depth.div(max(cosV, 0.3))).negate());
    const T = Tc.y;
    const mixD = float(1).sub(exp(depth.mul(u.kScale).mul(0.8).negate()));
    const bodyCol = mix(u.shallow, u.deep, mixD).mul(u.light).mul(0.85);
    const sandCol = u.bed.mul(u.light).mul(0.42);
    const sandK = u.bedBlend.mul(exp(depth.mul(u.kScale).mul(0.3).negate())); // песок виден до глубины, дальше — только вода
    const body = bodyCol.mul(float(1).sub(T)).add(sandCol.mul(Tc).mul(sandK));
    const aWater = float(1).sub(T.mul(float(1).sub(sandK)));
    let rgb: N = body.add(refl).mul(shore);
    let a: N = aWater.mul(shore);

    // пена: у берега (накат) и на гребнях волн; хлопья разбиты шумом
    const fn1 = mx_noise_float(q.mul(2.3).add(vec2(u.time.mul(0.15), 3)));
    const fn2 = mx_noise_float(q.mul(7.1).sub(u.time.mul(0.3)));
    const flakes = smoothstep(-0.15, 0.35, fn1.mul(0.65).add(fn2.mul(0.35)));
    const reach = float(0.28).add(u.foamWave.mul(1.1));
    const wash = float(0.55).add(sin(u.time.mul(0.9).add(mx_noise_float(p.mul(0.6)).mul(5))).mul(0.45));
    const shoreFoam = float(1).sub(smoothstep(0, reach.mul(wash), depth)).mul(smoothstep(-0.01, 0.03, sd)).mul(flakes);
    const crest = smoothstep(0.62, 0.2, w.jac).mul(u.foamWave.mul(1.2)).mul(smoothstep(0.1, 0.6, depth)).mul(flakes);
    const foamK = clamp(shoreFoam.mul(0.95).add(crest).mul(u.foam), 0, 1).mul(shore);
    const foamCol = vec3(0.92, 0.96, 0.97).mul(u.light.mul(0.9).add(0.06));
    rgb = mix(rgb, foamCol.mul(1), foamK);
    a = foamK.add(float(1).sub(foamK).mul(a));

    // лёд: молочно-голубой, трещины, глянцевое отражение неба
    const crack = float(1).sub(smoothstep(0.0, 0.06, abs(mx_noise_float(p.mul(1.6).add(3.1)))));
    const iceCol = mix(vec3(0.66, 0.82, 0.9), vec3(0.9, 0.96, 0.98), nM.mul(0.5).add(0.5)).mul(u.light.mul(0.95).add(0.05)).mul(float(1).sub(crack.mul(0.5))).mul(0.85);
    const iceRefl = sky.mul(0.06).add(spec.mul(0.25)).mul(float(1).sub(float(0.5).mul(cosV)).mul(float(0.4)).add(fres));
    const ice = iceMask.mul(0.93).mul(shore);
    const above = vec4(mix(rgb, iceCol.add(iceRefl), ice), ice.add(float(1).sub(ice).mul(a)));

    // ---- снизу (камера под водой): окно Снелла, полное внутреннее отражение, лёд сверху
    const I = V.negate();
    const k = float(1).sub(float(1.33 * 1.33).mul(float(1).sub(cosV.mul(cosV))));
    const win = smoothstep(0.0, 0.18, k);
    const Rt = refract(I, Nf, float(1.33));
    const skyT = skyColor(u, vec3(Rt.x, max(Rt.y, 0.02), Rt.z)).mul(0.96);
    const tir = u.uwColor.mul(u.uwLight).mul(0.75);
    const bellow = mix(tir, skyT, win);
    const underIce = mix(bellow, iceCol.mul(0.5), iceMask.mul(0.9));
    const under = vec4(underIce, 1);

    return select(faceDirection.greaterThan(0), above, under);
  })();
  mat.colorNode = out;
  // вектор движения для TAA смешивается по той же формуле «поверх», что и цвет
  mat.mrtNode = mrt({ motion: velocity.mul(out.a) });
  mat.fog = true;
  return mat;
}

/** Дно под водой: умножает цвет земли на (1 + каустика): свет, собранный волнами. Волны считаются в точке поверхности над дном (с учётом наклона солнца). */
function bedMaterial(u: U, map: WaterMap): THREE.NodeMaterial {
  const mat = new THREE.NodeMaterial();
  mat.transparent = true; mat.depthWrite = false; mat.fog = false;
  mat.blending = THREE.CustomBlending; mat.blendEquation = THREE.AddEquation;
  mat.blendSrc = THREE.DstColorFactor; mat.blendDst = THREE.OneFactor; mat.blendSrcAlpha = THREE.ZeroFactor; mat.blendDstAlpha = THREE.OneFactor;
  mat.polygonOffset = true; mat.polygonOffsetFactor = -2; mat.polygonOffsetUnits = -2;
  const mapTex = texture(map.texture);
  mat.mrtNode = mrt({ motion: vec4(0, 0, 0, 0) });
  mat.colorNode = Fn(() => {
    const P = positionWorld, p = vec2(P.x, P.z);
    const mv = mapTex.sample(mapUv(u, p));
    const depth = max(mv.r, 0);
    const wet = smoothstep(0.0, 0.12, mv.r);
    const sh = vec2(u.sunDir.x, u.sunDir.z).div(max(u.sunDir.y, 0.2)).mul(0.75).mul(min(depth, 6));
    const q = p.add(sh).sub(vec2(mv.g, mv.b).mul(u.drift));
    const w = waves(u, q, depth, { lap: true }, float(1).sub(smoothstep(5, 18, length(cameraPosition.sub(P)))));
    const rg = rings(u, p);
    const d = min(depth, 2.5);
    // якобиан преломления: 1 + c·d·Δh; Δh < 0 на выпуклых гребнях — лучи собираются
    const det = max(float(1).add(w.lap.mul(d).mul(0.28)), 0.22);
    const focus = clamp(float(1).div(det), 0.0, 5.0);
    const lit = exp(depth.div(max(u.vis, 0.05).mul(1.4)).negate());
    const c = focus.sub(0.55).mul(u.caustic).mul(lit).mul(wet).mul(u.bedLight);
    void rg;
    const k = max(c, 0).mul(0.55);
    return vec4(k.mul(u.sunRad.mul(0.45).add(0.04)), 1);
  })();
  return mat;
}

/** Лучи света под водой: вертикальные полосы, сдвинутые вдоль преломлённого солнца; расположение — от хэша клетки мира (не прыгает при движении камеры). */
function shaftsMesh(u: U): THREE.Mesh {
  const cells = SHAFT_GRID, quads = cells * cells;
  const pos = new Float32Array(quads * 4 * 3), cellA = new Float32Array(quads * 4 * 2), idx = new Uint32Array(quads * 6);
  for (let c = 0; c < quads; c++) {
    const ci = (c % cells) - (cells - 1) / 2, cj = Math.floor(c / cells) - (cells - 1) / 2;
    for (let v = 0; v < 4; v++) {
      const cx = v % 2 === 0 ? -1 : 1, cy = v < 2 ? 0 : 1;
      pos.set([cx, cy, 0], (c * 4 + v) * 3); cellA.set([ci, cj], (c * 4 + v) * 2);
    }
    idx.set([c * 4, c * 4 + 2, c * 4 + 1, c * 4 + 1, c * 4 + 2, c * 4 + 3], c * 6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('cell', new THREE.BufferAttribute(cellA, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  const mat = new THREE.NodeMaterial();
  mat.transparent = true; mat.depthWrite = false; mat.side = THREE.DoubleSide; mat.fog = false;
  mat.blending = THREE.AdditiveBlending;
  const rnd = (c: N, s: number) => fract(sin(dot(c, vec2(12.9898, 78.233)).add(s)).mul(43758.5453));
  mat.positionNode = Fn(() => {
    const corner = attribute('position', 'vec3'), cell = attribute('cell', 'vec2');
    const abs2 = u.camCell.add(cell);
    const jx = rnd(abs2, 1.0), jz = rnd(abs2, 2.0), ang = rnd(abs2, 3.0).mul(PI), hw = mix(float(1.2), float(3.4), rnd(abs2, 4.0));
    const base = abs2.add(vec2(jx, jz)).mul(SHAFT_CELL);
    const dir = vec2(cos(ang), sin(ang));
    const depth = corner.y.mul(SHAFT_DEPTH);
    const xz = base.add(dir.mul(corner.x.mul(hw))).add(u.shaftShear.mul(depth));
    return vec3(xz.x, u.shaftY.sub(depth), xz.y);
  })();
  mat.mrtNode = mrt({ motion: vec4(0, 0, 0, 0) });
  mat.colorNode = Fn(() => {
    const corner = attribute('position', 'vec3'), cell = attribute('cell', 'vec2');
    const abs2 = u.camCell.add(cell);
    const strength = smoothstep(0.25, 0.9, rnd(abs2, 5.0));
    const across = float(1).sub(abs(corner.x));
    const edge = smoothstep(0, 0.6, across);
    const depth = corner.y.mul(SHAFT_DEPTH);
    const fade = exp(depth.div(max(u.vis, 0.5).mul(1.6)).negate()).mul(smoothstep(0, 0.04, corner.y));
    const flicker = mx_noise_float(vec2(corner.x.mul(3).add(rnd(abs2, 6.0).mul(40)), u.time.mul(0.35).add(corner.y.mul(1.5)))).mul(0.5).add(0.62);
    const k = edge.mul(fade).mul(strength).mul(flicker).mul(u.shaftK);
    return vec4(u.sunRad.mul(0.5).add(u.uwColor.mul(0.2)).mul(k), k);
  })();
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false; mesh.renderOrder = 3;
  return mesh;
}

type Handle = {
  classic: THREE.Mesh | null;
  surface: THREE.Mesh | null; bed: THREE.Mesh | null; shafts: THREE.Mesh | null;
  u: U | null; map: WaterMap | null; water: WaterField | null; cfg: WaterParams | null;
  under: number; ownFog: boolean; ownBg: boolean; savedBg: THREE.Color; tmpA: THREE.Color; tmpB: THREE.Color; v3: THREE.Vector3;
  heightAt: (x: number, z: number) => number;
};

const empty = (): Handle => ({ classic: null, surface: null, bed: null, shafts: null, u: null, map: null, water: null, cfg: null, under: 0, ownFog: false, ownBg: false, savedBg: new THREE.Color(), tmpA: new THREE.Color(), tmpB: new THREE.Color(), v3: new THREE.Vector3(), heightAt: () => 0 });

export const WaterView = defineView<Handle>('Water', {
  mount(three, inst) {
    const h = empty();
    const sv = three.sim().services;
    const water = sv.waters?.find((w) => w.id === inst.id);
    const cfg = water ? (WaterParams.parse(water.config)) : null;
    if (!water || !cfg || cfg.style === 'classic') {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(CLASSIC_SIZE, CLASSIC_SIZE).rotateX(-Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: (inst.params.color as string | undefined) ?? '#2a6f97', transparent: true, opacity: 0.82, roughness: 0.15, metalness: 0.1 }),
      );
      mesh.position.y = sv.waterLevel;
      three.scene.add(mesh);
      h.classic = mesh;
      return h;
    }
    h.water = water; h.cfg = cfg; h.heightAt = sv.heightAt;
    const u = makeUniforms(cfg.seed, three.sky);
    const map = buildWaterMap(water, sv.heightAt, cfg.level, cfg.deepDepth);
    h.u = u; h.map = map;
    u.mapOrigin.value.set(map.x0, map.z0); u.mapSize.value.set(map.w, map.h);
    u.shallow.value.set(cfg.shallowColor); u.deep.value.set(cfg.deepColor); u.bed.value.set(cfg.bedColor);
    u.bedBlend.value = cfg.bedBlend;

    const open = cfg.open;
    const b = water.bounds;
    const geo = open
      ? buildRadialGeometry(700, 300)
      : buildGridGeometry({ x0: b.x0, z0: b.z0, w: b.x1 - b.x0, h: b.z1 - b.z0, cells: 384, keep: (x, z, c) => mapDepthAt(map, x, z) > -Math.max(0.8, c * 0.9) });
    const surface = new THREE.Mesh(geo, surfaceMaterial(u, map, open));
    surface.frustumCulled = false; surface.renderOrder = 2;
    three.scene.add(surface);
    h.surface = surface;

    // дно с каустиками: сетка по земле под водой (y из heightAt)
    const bedGeo = buildGridGeometry({ x0: b.x0, z0: b.z0, w: b.x1 - b.x0, h: b.z1 - b.z0, cells: 300, keep: (x, z, c) => mapDepthAt(map, x, z) > -Math.max(0.5, c * 0.8) });
    const bp = bedGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < bp.count; i++) bp.setY(i, sv.heightAt(bp.getX(i), bp.getZ(i)) + 0.02);
    bp.needsUpdate = true;
    const bed = new THREE.Mesh(bedGeo, bedMaterial(u, map));
    bed.frustumCulled = false; bed.renderOrder = 1;
    three.scene.add(bed);
    h.bed = bed;

    const shafts = shaftsMesh(u);
    three.scene.add(shafts);
    h.shafts = shafts;
    return h;
  },

  sync(h, self: WaterSelf, three, state) {
    const u = h.u, cfg = h.cfg, water = h.water;
    if (!u || !cfg || !water) return;
    u.time.value = state.t;
    u.drift.value = self.drift;
    const sea = seaOf(self, cfg.swellLength);
    for (const name of ['swell', 'wind', 'ripple'] as const) {
      const L = u.layers[name], s = sea[name], a = (s.dir * Math.PI) / 180;
      L.gain.value = s.height; L.sinP.value = Math.sin(a); L.cosP.value = Math.cos(a);
      L.inv.value = 1 / s.scale; L.sq.value = 1 / Math.sqrt(s.scale);
    }
    u.foamWave.value = Math.min(1, (sea.wind.height + sea.swell.height * 0.5) / 1.6);
    u.shallow.value.set(self.shallowColor); u.deep.value.set(self.deepColor);
    u.vis.value = 0.35 + 18 * self.clarity ** 1.6;
    u.kScale.value = 1 / (0.25 + 4 * self.clarity * self.clarity);
    u.reflection.value = self.reflection;
    u.foam.value = self.foam;
    u.ice.value = self.iceEff;
    // кольца: возраст в секундах, неактивные — сила 0
    for (let i = 0; i < MAX_RINGS; i++) {
      const r = self.rings[i], v = u.rings[i]!.value as THREE.Vector4;
      if (r) v.set(r.x, r.z, state.t - r.t0, r.amp); else v.set(0, 0, 0, 0);
    }
    if (water.open) u.center.value.set(state.camera.pos[0], state.camera.pos[2]);

    // свет: из источников сцены (их выставил Sky); вид «late» повторит это после неба, здесь нужен свет кадра
    const sun = three.sunLight, hemi = three.hemi;
    const dir = h.v3.copy(sun.position).sub(sun.target.position);
    if (dir.lengthSq() > 0) dir.normalize();
    (u.sunDir.value as THREE.Vector3).copy(dir);
    const sunRad = u.sunRad.value as THREE.Vector3;
    sunRad.set(sun.color.r, sun.color.g, sun.color.b).multiplyScalar(sun.intensity);
    // свет неба: из общего расчёта неба (ambient — средняя яркость неба над землёй), без неба в сцене — из полусферического света
    const sky = three.skyState.active ? h.tmpA.copy(three.skyState.ambient).multiplyScalar(PI) : h.tmpA.copy(hemi.color).multiplyScalar(hemi.intensity);
    (u.light.value as THREE.Vector3).set(sunRad.x * Math.max(dir.y, 0) + sky.r, sunRad.y * Math.max(dir.y, 0) + sky.g, sunRad.z * Math.max(dir.y, 0) + sky.b).multiplyScalar(1 / PI);
    const sunUp = Math.max(0, Math.min(1, dir.y * 4)) * (sun.intensity > 0.01 ? 1 : 0);
    u.bedLight.value = sunUp * Math.max(0, 1 - self.iceEff * 0.9);
    u.caustic.value = 1.6;
    u.uwK.value = h.under;
    // каустики и лучи: прозрачность и яркость
    u.shaftK.value = 0.6 * sunUp * (1 - self.iceEff * 0.8);
    (u.shaftShear.value as THREE.Vector2).set(-dir.x / Math.max(dir.y, 0.2) * 0.75, -dir.z / Math.max(dir.y, 0.2) * 0.75);
  },

  late(h, self: WaterSelf, three, state) {
    const u = h.u, cfg = h.cfg, water = h.water;
    if (!u || !cfg || !water || !h.shafts) return;
    const cam = state.camera.pos;
    const lvl = water.level(cam[0], cam[2]);
    let surfaceY = -Infinity;
    if (lvl !== null) {
      const sea = seaOf(self, cfg.swellLength);
      const depthHere = water.depth(cam[0], cam[2]);
      surfaceY = lvl + waveHeightAt(sea, cfg.seed, cam[0] - flowShift(h, water, cam, self.drift)[0], cam[2] - flowShift(h, water, cam, self.drift)[1], state.t, depthHere);
    }
    const below = lvl !== null ? surfaceY - cam[1] : -1;
    const k = Math.max(0, Math.min(1, below / 0.35));
    h.under = k;
    const fog = three.scene.fog;
    // меш лучей виден всегда, чтобы шейдер собрался в прогреве, а не при первом нырке; над водой он вынесен за кадр
    if (below <= 0) {
      u.shaftY.value = 1e6;
      if (h.ownFog && fog instanceof THREE.Fog) { fog.near = 1e5; fog.far = 2e5; }
      if (h.ownBg) { three.scene.background = null; h.ownBg = false; }
      return;
    }
    const vis = u.vis.value as number;
    const depthCam = Math.max(0, below);
    const mixD = 1 - Math.exp(-depthCam / (vis * 0.75 + 0.4));
    const light = u.light.value as THREE.Vector3;
    const uw = u.uwColor.value as THREE.Color;
    uw.copy(u.shallow.value as THREE.Color).lerp(u.deep.value as THREE.Color, mixD);
    const atten = Math.exp(-depthCam / (vis * 2.2 + 1));
    u.uwLight.value = (0.55 * (light.x + light.y + light.z) / 3 + 0.04) * atten + 0.015;
    const fogColor = h.tmpA.copy(uw).multiplyScalar((u.uwLight.value as number) * 1.35);
    if (!(fog instanceof THREE.Fog)) { three.scene.fog = new THREE.Fog(fogColor, 0.1, vis * 3.2 + 4); h.ownFog = true; }
    const f = three.scene.fog as THREE.Fog;
    // плавный вход: между воздухом и водой — доля k
    const aboveNear = f.near, aboveFar = f.far;
    f.color.lerp(fogColor, k);
    f.near = aboveNear * (1 - k) + 0.1 * k;
    f.far = aboveFar * (1 - k) + (vis * 3.2 + 4) * k;
    if (three.scene.background instanceof THREE.Color) three.scene.background.lerp(fogColor, k);
    else { h.savedBg.copy(fogColor); three.scene.background = h.savedBg; h.ownBg = true; }
    // лучи привязаны к клетке мира
    (u.camCell.value as THREE.Vector2).set(Math.floor(cam[0] / SHAFT_CELL), Math.floor(cam[2] / SHAFT_CELL));
    u.shaftY.value = surfaceY;
  },

  dispose(h, three) {
    for (const m of [h.classic, h.surface, h.bed, h.shafts]) {
      if (!m) continue;
      three.scene.remove(m); m.geometry.dispose(); (m.material as THREE.Material).dispose();
    }
    h.map?.texture.dispose();
  },
});

/** Смещение волн течением в точке камеры, м (для CPU-высоты поверхности: как в шейдере q = p − flow·drift). */
function flowShift(_h: Handle, water: WaterField, cam: [number, number, number], drift: number): [number, number] {
  const f = water.flowDir(cam[0], cam[2]);
  return [f[0] * drift, f[1] * drift];
}

