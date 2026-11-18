import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { noiseTexture } from '../../vendor/threejs-nanites-demo/clouds-noise.ts';
import type { SkyLook, Rgb, Vec3 } from '../light/sky.ts';

type N = any;
// узлы TSL типизированы слишком строго для шейдерного кода: берём без типов (как в views/water.ts)
const { clamp, dot, exp, float, floor, fract, length, max, mix, normalize, pow, positionLocal, cameraPosition, select, sin, smoothstep, sqrt, texture, uniform, vec2, vec3 } = TSL as any;

/**
 * Небо одним узлом. Униформы (`SkyUniforms`) заполняет `applyLook` из `SkyLook` (light/sky.ts) на каждом кадре; они
 * общие на весь вид: купол неба, вода и всё, что отражает небо, берут цвет через `radiance(направление)`. Никаких
 * новых объектов на кадре: меняются только значения униформ.
 */
export type SkyUniforms = ReturnType<typeof makeUniforms>;

const v3 = (x = 0, y = 0, z = 0) => uniform(new THREE.Vector3(x, y, z));
const col = () => uniform(new THREE.Color());

function makeUniforms() {
  return {
    zenith: col(), horizon: col(), glow: col(), haze: col(), hazeK: uniform(0), fogAmount: uniform(0),
    sunDir: v3(0, 1, 0), sunDisk: col(),
    moonDir: v3(0, -1, 0), moonRight: v3(1, 0, 0), moonUp: v3(0, 0, 1), moonLightDir: v3(0, 0, 1), moonDisk: uniform(0), moonColor: col(),
    starK: uniform(0), starX: v3(1, 0, 0), starY: v3(0, 1, 0), starZ: v3(0, 0, 1),
    cloudCover: uniform(0), cloudOffset: uniform(new THREE.Vector2()), cloudLit: col(), cloudShade: col(),
  };
}

/** Угловые радиусы диска (преувеличены: мультфильм, настоящие — 0.27° и 0.26°). */
const SUN_RADIUS = 0.9 * (Math.PI / 180);
const MOON_RADIUS = 1.3 * (Math.PI / 180);
const STAR_SCALE = 95;
/** Высота «слоя» облаков в единицах проекции купола: чем меньше, тем сильнее облака сжимаются к горизонту. */
const CLOUD_LIFT = 0.14;

export function createSky() {
  const u = makeUniforms();
  const noise = noiseTexture(512);
  const tex = texture(noise);

  const hash = (p: N) => fract(sin(dot(p, vec3(127.1, 311.7, 74.7))).mul(43758.5453));

  /** Плотность облаков (0…1) и освещённость (0…1) по направлению. Одна проекция «плоскости на высоте» + шум из текстуры леса. */
  const clouds = (d: N) => {
    const y = max(d.y, 0);
    const plane = vec2(d.x, d.z).div(y.add(CLOUD_LIFT));
    const uv = plane.mul(0.22).add(u.cloudOffset);
    const n = tex.sample(uv).r.mul(0.62).add(tex.sample(uv.mul(3.1).add(0.37)).r.mul(0.38));
    const cut = mix(float(0.72), float(0.31), u.cloudCover);
    // сплошная облачность закрывает небо целиком, без просветов
    const dens = mix(smoothstep(cut, cut.add(0.13), n), float(1), smoothstep(0.82, 1.0, u.cloudCover)).mul(smoothstep(0.0, 0.12, y));
    // свет: смотрим, что лежит ближе к солнцу; плотнее — значит мы в тени, реже — край на свету
    const toSun = normalize(vec2(u.sunDir.x, u.sunDir.z).add(0.0001));
    const n2 = tex.sample(uv.add(toSun.mul(0.035))).r.mul(0.62).add(tex.sample(uv.mul(3.1).add(0.37).add(toSun.mul(0.1))).r.mul(0.38));
    const thick = smoothstep(cut.add(0.1), cut.add(0.3), n);
    const lit = clamp(float(0.78).sub(n2.sub(n).mul(4.5)).sub(thick.mul(0.5)), 0.05, 1);
    return { dens, lit };
  };

  /** Звёзды: ячейки 3D-шума на сфере, повёрнутые вокруг полюса мира; плюс слабая полоса Млечного Пути. */
  const stars = (d: N) => {
    const sd = vec3(dot(d, u.starX), dot(d, u.starY), dot(d, u.starZ));
    const p = sd.mul(STAR_SCALE);
    const cell = floor(p), f = p.sub(cell);
    const h1 = hash(cell), h2 = hash(cell.add(17.17)), h3 = hash(cell.add(41.3)), h4 = hash(cell.add(7.7)), h5 = hash(cell.add(63.1));
    const at = vec3(h1, h2, h3).mul(0.7).add(0.15);
    const dist = length(f.sub(at));
    const present = smoothstep(0.78, 0.8, h4);
    const spot = pow(smoothstep(0.13, 0.0, dist), 1.5).mul(present);
    const mag = mix(float(0.5), float(3.2), pow(h5, 4));
    const tint = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.88, 0.7), h1);
    const dust = tex.sample(sd.xz.mul(0.7).add(sd.y.mul(0.43)).add(0.5)).r;
    const band = exp(dot(sd, vec3(0.31, 0.88, 0.36)).pow(2).mul(-14));
    const milky = band.mul(smoothstep(0.38, 0.72, dust)).mul(0.07);
    return tint.mul(spot.mul(mag)).add(vec3(0.52, 0.58, 0.9).mul(milky));
  };

  /** Луна: диск с фазой и тёмными морями, ореол. */
  const moon = (d: N) => {
    const mc = dot(d, u.moonDir);
    const x = dot(d, u.moonRight), y = dot(d, u.moonUp);
    const r = length(vec2(x, y)).div(MOON_RADIUS);
    const disc = float(1).sub(smoothstep(0.9, 1.0, r)).mul(select(mc.greaterThan(0), float(1), float(0)));
    const nz = sqrt(max(float(1).sub(r.mul(r)), 0));
    const nrm = vec3(x.div(MOON_RADIUS), y.div(MOON_RADIUS), nz);
    const lit = smoothstep(-0.04, 0.08, dot(nrm, u.moonLightDir));
    const maria = smoothstep(0.42, 0.62, tex.sample(vec2(nrm.x, nrm.y).mul(0.21).add(0.5)).r);
    const albedo = mix(float(1.0), float(0.45), maria).mul(float(0.85).add(nz.mul(0.15)));
    const body = u.moonColor.mul(albedo).mul(lit.add(0.03)).mul(1.15).mul(disc);
    const m = max(mc, 0);
    const halo = u.moonColor.mul(pow(m, 600).mul(0.16).add(pow(m, 40).mul(0.02)));
    return body.add(halo).mul(u.moonDisk);
  };

  /**
   * Цвет неба в направлении d (мировое, единичное), линейный. withClouds=false — без облаков, луны и звёзд
   * (для подводного вида и дальних отражений, где они не видны).
   */
  const radiance = (d_: N, withClouds = true) => {
    const d = normalize(d_), y = d.y;
    const t = pow(clamp(y, 0, 1), 0.42);
    let c: N = mix(u.horizon, u.zenith, t);
    c = mix(c, u.horizon.mul(0.55), float(1).sub(smoothstep(-0.35, 0.0, y)));
    const cs = max(dot(d, u.sunDir), 0);
    const g = pow(cs, 3.5).mul(exp(max(y, 0).mul(-2.2))).mul(0.55).add(pow(cs, 24).mul(0.5)).add(pow(cs, 220).mul(1.4));
    c = c.add(u.glow.mul(g));
    c = mix(c, u.haze, u.hazeK.mul(exp(max(y, 0).mul(float(3).sub(u.fogAmount.mul(2))).negate())));
    if (!withClouds) return c;
    const cl = clouds(d);
    const upper = smoothstep(-0.02, 0.05, y);
    // диск солнца: край размыт на ~0.1°; облако его закрывает
    const sunDisc = smoothstep(Math.cos(SUN_RADIUS), Math.cos(SUN_RADIUS * 0.85), cs).mul(upper);
    const lining = u.glow.mul(pow(cs, 6)).mul(0.6).mul(float(1).sub(smoothstep(0.2, 0.8, cl.dens)));
    const cloudCol = mix(u.cloudShade, u.cloudLit, cl.lit).add(lining);
    c = mix(c, cloudCol, cl.dens);
    const free = float(1).sub(cl.dens);
    c = c.add(u.sunDisk.mul(sunDisc).mul(free));
    c = c.add(moon(d).mul(free).mul(upper));
    c = c.add(stars(d).mul(u.starK).mul(smoothstep(0.0, 0.08, y)).mul(free));
    return c;
  };

  /** Купол неба: большая сфера вокруг камеры (положение берётся из камеры в шейдере, на CPU ничего не двигаем). */
  function createDome(): THREE.Mesh {
    const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, depthTest: false });
    mat.fog = false;
    mat.positionNode = cameraPosition.add(positionLocal.mul(500));
    mat.colorNode = radiance(positionLocal);
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -1000;
    mesh.name = 'sky-dome';
    return mesh;
  }

  return { u, radiance, createDome, noise };
}
export type Sky = ReturnType<typeof createSky>;

const setC = (c: THREE.Color, v: Rgb) => c.setRGB(v[0], v[1], v[2], THREE.LinearSRGBColorSpace);
const setV = (t: THREE.Vector3, v: Vec3) => t.set(v[0], v[1], v[2]);

/** Записать расчёт неба в униформы. Только значения: ни одного нового объекта three. */
export function applyLook(u: SkyUniforms, look: SkyLook, cloudOffset: [number, number], fogAmount: number): void {
  setC(u.zenith.value as THREE.Color, look.zenith); setC(u.horizon.value as THREE.Color, look.horizon);
  setC(u.glow.value as THREE.Color, look.glow); setC(u.haze.value as THREE.Color, look.haze);
  u.hazeK.value = look.hazeK; u.fogAmount.value = fogAmount;
  setV(u.sunDir.value as THREE.Vector3, look.sunDir); setC(u.sunDisk.value as THREE.Color, look.sunDisk);
  setV(u.moonDir.value as THREE.Vector3, look.moonDir); setV(u.moonRight.value as THREE.Vector3, look.moonRight); setV(u.moonUp.value as THREE.Vector3, look.moonUp);
  setV(u.moonLightDir.value as THREE.Vector3, look.moonLightDir); u.moonDisk.value = look.moonDisk; setC(u.moonColor.value as THREE.Color, look.moonColor);
  u.starK.value = look.starK;
  setV(u.starX.value as THREE.Vector3, look.starRot[0]); setV(u.starY.value as THREE.Vector3, look.starRot[1]); setV(u.starZ.value as THREE.Vector3, look.starRot[2]);
  u.cloudCover.value = look.cloudCover; (u.cloudOffset.value as THREE.Vector2).set(cloudOffset[0], cloudOffset[1]);
  setC(u.cloudLit.value as THREE.Color, look.cloudLit); setC(u.cloudShade.value as THREE.Color, look.cloudShade);
}

