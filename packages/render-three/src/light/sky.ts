/**
 * Небо и свет одним расчётом, без Three.js (тестируется в node). Из сил мира (высота солнца и луны, облачность, туман,
 * время) получается `SkyLook` — всё, что нужно виду: цвета неба, солнце, луна, звёзды, облака, свет на землю
 * (сферические гармоники окружения), экспозиция, цвет тумана. Небо в шейдере (sky/nodes.ts) и вода берут отсюда одни
 * и те же числа; формула градиента и свечения неба здесь (`skyAt`) и в узле повторяют друг друга.
 *
 * Палитра по высоте солнца — наша: опорные точки подобраны по виду реального неба (синий час, закат, золотой час, день),
 * ни из какого демо не взяты. Все цвета линейные (не sRGB).
 */

export type Vec3 = [number, number, number];
export type Rgb = [number, number, number];

const RAD = Math.PI / 180;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const smoothstep = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mixN = (a: number, b: number, t: number) => a + (b - a) * t;
const mix3 = (a: Rgb, b: Rgb, t: number): Rgb => [mixN(a[0], b[0], t), mixN(a[1], b[1], t), mixN(a[2], b[2], t)];
const scale3 = (a: Rgb, k: number): Rgb => [a[0] * k, a[1] * k, a[2] * k];
const add3 = (a: Rgb, b: Rgb): Rgb => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const luma = (c: Rgb) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a: Vec3): Vec3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** '#rrggbb' (sRGB) → линейный цвет. */
export const hex = (h: string): Rgb => [1, 3, 5].map((i) => toLin(parseInt(h.slice(i, i + 2), 16) / 255)) as Rgb;

/** Единичный вектор «на точку неба»: высота и азимут в градусах (0 — север, +z; 90 — восток, +x). Без зажима: ниже горизонта можно. */
export const dirOf = (elevation: number, azimuth: number): Vec3 => {
  const el = elevation * RAD, az = azimuth * RAD;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
};

type Stop = { el: number; zenith: Rgb; horizon: Rgb; glow: Rgb; sun: Rgb };
const stop = (el: number, zenith: string, horizon: string, glow: string, glowGain: number, sun: string): Stop => ({ el, zenith: hex(zenith), horizon: hex(horizon), glow: scale3(hex(glow), glowGain), sun: hex(sun) });
/** Опорные точки по высоте солнца, °: ночь, глубокие сумерки, синий час, закат, золотой час, день. */
const STOPS: Stop[] = [
  stop(-20, '#02050f', '#070c1c', '#0a1226', 0.0, '#8aa4ff'),
  stop(-12, '#050b20', '#141b36', '#2a2850', 0.35, '#8aa4ff'),
  stop(-6, '#0e1d44', '#3b3a62', '#8a4f78', 1.0, '#ff7a4a'),
  stop(-2, '#1f3a72', '#c8666c', '#ff6a3a', 1.7, '#ff6a2c'),
  stop(1, '#2d5a9e', '#f59058', '#ff7a2a', 2.0, '#ff8a3d'),
  stop(5, '#3a72c0', '#f6a86c', '#ff8f3e', 1.7, '#ffa457'),
  stop(12, '#3f78cc', '#eec497', '#ffb870', 1.5, '#ffc48c'),
  stop(20, '#4283d6', '#cdd5e2', '#ffd9a8', 1.0, '#ffe0b8'),
  stop(30, '#3a82dc', '#a9cdf0', '#fff0d2', 0.5, '#fff1de'),
  stop(90, '#2f78d8', '#a1c8f0', '#fff0d2', 0.4, '#fff4e4'),
];

function stopsAt(el: number): Omit<Stop, 'el'> {
  if (el <= STOPS[0]!.el) return STOPS[0]!;
  for (let i = 1; i < STOPS.length; i++) {
    const a = STOPS[i - 1]!, b = STOPS[i]!;
    if (el <= b.el) {
      const t = smoothstep(a.el, b.el, el);
      return { zenith: mix3(a.zenith, b.zenith, t), horizon: mix3(a.horizon, b.horizon, t), glow: mix3(a.glow, b.glow, t), sun: mix3(a.sun, b.sun, t) };
    }
  }
  return STOPS[STOPS.length - 1]!;
}

/** Сила прямого солнца (лк в единицах three), по высоте: с горизонта нарастает, с 22° — полная. */
export const sunIntensityAt = (el: number): number => 3.1 * Math.sqrt(smoothstep(-1.5, 22, el));
/** Сила лунного света в единицах three при полной луне над головой. */
export const MOON_LIGHT = 0.75;

export type SkyInput = {
  sunEl: number; sunAz: number; moonEl: number; moonAz: number;
  /** Освещённость луны 0…1 (фаза). */
  moonPhase: number;
  /** Сила лунного света 0…1 уже с облаками и высотой луны (из Forces.summary). */
  moonStrength: number;
  cloudiness: number; fog: number;
  /** Видимость звёзд 0…1 (из Forces.summary). */
  stars: number;
  /** Часы суток 0…24: звёзды поворачиваются вокруг полюса. */
  time: number;
};

export type SkyLook = {
  zenith: Rgb; horizon: Rgb; glow: Rgb; haze: Rgb;
  hazeK: number;
  sunDir: Vec3; sunDisk: Rgb;
  moonDir: Vec3; moonRight: Vec3; moonUp: Vec3; moonLightDir: Vec3; moonDisk: number; moonColor: Rgb;
  starK: number; starRot: [Vec3, Vec3, Vec3];
  cloudCover: number; cloudLit: Rgb; cloudShade: Rgb;
  /** Главный направленный свет: солнце или (ночью) луна. */
  keyDir: Vec3; keyColor: Rgb; keyIntensity: number;
  /** Экспозиция тонмаппинга. */
  exposure: number;
  /** Средняя яркость неба над землёй (косинус-взвешенная, линейная): для воды и пены. */
  ambient: Rgb;
  /** Окружение (небо сверху, земля снизу) в сферических гармониках 2-го порядка, как LightProbe. */
  sh: Rgb[];
  /** 0…1: насколько мягкие тени (сплошная облачность). */
  shadowSoft: number;
  /** 0…1: сколько света вокруг (день 1, ночь ~0.05): листва и кора светятся сами не сильнее этого. */
  daylight: number;
};

const GREY_PULL = 0.9;
/** Облачность тускнит и обесцвечивает небо: цвет тянется к серому той же яркости. */
const overcast = (c: Rgb, cloud: number): Rgb => {
  const l = luma(c);
  return mix3(c, [l * 0.92, l * 0.94, l], cloud * GREY_PULL);
};

/** Небо в направлении dir (градиент, свечение у солнца, дымка): без солнечного диска, облаков, луны и звёзд. Формула повторена в sky/nodes.ts. */
export function skyAt(look: Pick<SkyLook, 'zenith' | 'horizon' | 'glow' | 'haze' | 'hazeK'> & { sunTrue: Vec3; fogAmount: number }, dir: Vec3): Rgb {
  const y = dir[1];
  const t = Math.pow(clamp(y, 0, 1), 0.42);
  let c = mix3(look.horizon, look.zenith, t);
  if (y < 0) c = mix3(c, scale3(look.horizon, 0.55), smoothstep(0, -0.35, y));
  const cs = Math.max(dot3(dir, look.sunTrue), 0);
  const g = Math.pow(cs, 3.5) * Math.exp(-Math.max(y, 0) * 2.2) * 0.55 + Math.pow(cs, 24) * 0.5 + Math.pow(cs, 220) * 1.4;
  c = add3(c, scale3(look.glow, g));
  if (look.hazeK > 0) c = mix3(c, look.haze, look.hazeK * Math.exp(-Math.max(y, 0) * (3 - 2 * look.fogAmount)));
  return c;
}

const GROUND_ALBEDO: Rgb = [0.27, 0.3, 0.17];
/** Широта: ось вращения звёзд (полюс мира над севером под этим углом). */
const LATITUDE = 45;

/** Базис SH 2-го порядка (как SphericalHarmonics3.getBasisAt в three). */
const shBasis = (x: number, y: number, z: number): number[] => [0.282095, 0.488603 * y, 0.488603 * z, 0.488603 * x, 1.092548 * x * y, 1.092548 * y * z, 0.315392 * (3 * z * z - 1), 1.092548 * x * z, 0.546274 * (x * x - y * y)];

/** Поворот звёзд на `hours` часов вокруг полюса мира (Родриг): три строки матрицы, шейдер берёт dot(dir, строка). */
export function starRotation(hours: number): [Vec3, Vec3, Vec3] {
  const a = hours * 15 * RAD, c = Math.cos(a), s = Math.sin(a), k = 1 - c;
  const [x, y, z] = dirOf(LATITUDE, 0);
  return [
    [c + x * x * k, x * y * k - z * s, x * z * k + y * s],
    [y * x * k + z * s, c + y * y * k, y * z * k - x * s],
    [z * x * k - y * s, z * y * k + x * s, c + z * z * k],
  ];
}

export function skyLook(input: SkyInput): SkyLook {
  const { sunEl, sunAz, moonEl, moonAz, cloudiness: cloud, fog } = input;
  const st = stopsAt(sunEl);
  const sunTrue = dirOf(sunEl, sunAz);
  const clearK = 1 - cloud;
  // цвета неба: облачность обесцвечивает и чуть тускнит, туман тянет к дымке
  const zenith = overcast(scale3(st.zenith, 1 - 0.18 * cloud), cloud);
  const horizon = overcast(scale3(st.horizon, 1 - 0.1 * cloud), cloud);
  const glow = scale3(st.glow, 1 - 0.8 * cloud);
  const haze = mix3(horizon, [luma(horizon) * 0.95, luma(horizon) * 0.97, luma(horizon)], 0.45);
  const hazeK = clamp(fog * 0.92, 0, 1);

  const sunI = sunIntensityAt(sunEl) * (1 - 0.7 * cloud);
  const moonI = MOON_LIGHT * input.moonStrength;
  const useMoon = moonI > sunI;
  const sunLight = scale3(st.sun, 1);
  const moonColor = hex('#a9bcff');

  // луна: базис диска (видимая «вправо» и «вверх» при взгляде на неё) и направление света в этом базисе по фазе
  const moonDir = dirOf(moonEl, moonAz);
  const up: Vec3 = [0, 1, 0];
  const moonRight = norm3(cross3(moonDir, Math.abs(moonDir[1]) > 0.999 ? [0, 0, 1] : up));
  const moonUp = cross3(moonRight, moonDir);
  const a = (1 - input.moonPhase) * Math.PI, tilt = 35 * RAD;
  const moonLightDir: Vec3 = [Math.sin(a) * Math.cos(tilt), Math.sin(a) * Math.sin(tilt), Math.cos(a)];
  const moonDisk = smoothstep(-1, 3, moonEl) * smoothstep(4, -5, sunEl) * (1 - 0.85 * cloud) * (1 - 0.8 * fog);
  const starK = clamp(input.stars, 0, 1) * (1 - 0.9 * fog);

  // облака: освещённая сторона берёт цвет солнца, тень — цвет неба; ночью облака слегка подсвечены луной
  const illum = clamp(sunI / 3.1, 0, 1);
  const moonLit = scale3(moonColor, 0.1 * input.moonStrength + 0.012);
  const cloudLit = add3(scale3(mix3(sunLight, [1, 1, 1], 0.35 * dayKOf(sunEl)), 0.95 * illum + 0.05 * Math.sqrt(illum)), moonLit);
  const cloudShade = add3(scale3(mix3(zenith, horizon, 0.5), 0.55 + 0.2 * clearK), scale3(sunLight, 0.12 * illum));

  const base = { zenith, horizon, glow, haze, hazeK, sunTrue, fogAmount: fog };
  // окружение для света на землю: сверху небо (сэмплы по сфере), снизу — отражённый свет земли
  const NI = 8, NJ = 16, W = (4 * Math.PI) / (NI * NJ);
  const sh: Rgb[] = Array.from({ length: 9 }, () => [0, 0, 0] as Rgb);
  const fill: Rgb = add3(scale3(moonColor, 0.045 * input.moonStrength), [0.004, 0.005, 0.009]); // лунный и звёздный рассеянный свет
  let avg: Rgb = [0, 0, 0], wsum = 0;
  const cloudDim = 1 - 0.25 * cloud;
  const samples: { d: Vec3; c: Rgb }[] = [];
  for (let i = 0; i < NI; i++) {
    const y = 1 - (2 * (i + 0.5)) / NI, r = Math.sqrt(1 - y * y);
    for (let j = 0; j < NJ; j++) {
      const az = ((j + 0.5) / NJ) * 2 * Math.PI, d: Vec3 = [r * Math.sin(az), y, r * Math.cos(az)];
      if (y > 0) {
        const c = add3(scale3(skyAt(base, d), cloudDim), fill);
        avg = add3(avg, scale3(c, y)); wsum += y; // косинус-взвешенная средняя
        samples.push({ d, c });
      } else samples.push({ d, c: [0, 0, 0] });
    }
  }
  const ambient: Rgb = wsum > 0 ? scale3(avg, 1 / wsum) : [0, 0, 0];
  const keyDir = useMoon ? dirOf(Math.max(moonEl, 0.5), moonAz) : dirOf(Math.max(sunEl, 0.5), sunAz);
  const keyColor = useMoon ? moonColor : sunLight;
  const keyIntensity = useMoon ? moonI : sunI;
  // земля отвечает на небо и на прямой свет (горизонтальная поверхность получает key·sin(высота)/π)
  const keyUp = Math.max(keyDir[1], 0) * keyIntensity / Math.PI;
  const bounce: Rgb = [GROUND_ALBEDO[0] * (ambient[0] + keyColor[0] * keyUp), GROUND_ALBEDO[1] * (ambient[1] + keyColor[1] * keyUp), GROUND_ALBEDO[2] * (ambient[2] + keyColor[2] * keyUp)];
  for (const s of samples) {
    const c = s.d[1] > 0 ? s.c : bounce;
    const b = shBasis(s.d[0], s.d[1], s.d[2]);
    for (let k = 0; k < 9; k++) { sh[k]![0] += b[k]! * c[0] * W; sh[k]![1] += b[k]! * c[1] * W; sh[k]![2] += b[k]! * c[2] * W; }
  }

  // экспозиция: день 1.15…1.35 (как раньше), ночью выше
  const day = clamp(sunEl / 30, 0, 1);
  const night = smoothstep(-2, -12, sunEl);
  return {
    zenith, horizon, glow, haze, hazeK,
    sunDir: sunTrue, sunDisk: scale3(sunLight, 55),
    moonDir, moonRight, moonUp, moonLightDir, moonDisk, moonColor,
    starK, starRot: starRotation(input.time),
    cloudCover: cloud, cloudLit, cloudShade,
    keyDir, keyColor, keyIntensity,
    exposure: mixN(1.15 + 0.2 * day, 1.55, night),
    ambient, sh,
    shadowSoft: clamp((cloud - 0.3) / 0.7, 0, 1),
    daylight: clamp(Math.max(sunI / 3.1, luma(ambient) * 3), 0.05, 1),
  };
}

function dayKOf(el: number) { return clamp(el / 30, 0, 1); }

/** Цвет тумана на земле: небо у горизонта в направлении взгляда (азимут камеры), с дымкой по силе тумана. */
export function fogColorAt(look: SkyLook, viewAzimuth: number, sunAz: number, sunEl: number, fog: number): Rgb {
  const base = { zenith: look.zenith, horizon: look.horizon, glow: look.glow, haze: look.haze, hazeK: look.hazeK, sunTrue: dirOf(sunEl, sunAz), fogAmount: fog };
  const c = skyAt(base, dirOf(1.5, viewAzimuth));
  return mix3(c, look.haze, clamp(fog * 0.8, 0, 1));
}
