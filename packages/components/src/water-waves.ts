import { hash32 } from '@cartoon/schema';

/**
 * Волны воды слоями (ARCHITECTURE 6.5): океанская зыбь, ветровые волны, рябь. Чистая математика без three:
 * одна и та же формула считается на CPU (поплавки, тесты, круги от объектов) и в шейдере вида (render-three/views/water.ts).
 *
 * Идея спектра известна по открытым статьям: поверхность — сумма десятков синусоид со случайными фазами, длины волн
 * разложены по логарифмической шкале, амплитуда растёт с длиной волны, направления лежат в узком веере вокруг
 * направления слоя (зыбь, ветер) или по кругу (рябь), частота — глубоководная дисперсия ω = √(g·k). Набор мод
 * зависит только от seed, он одинаков на CPU и GPU. Код свой.
 */

export const GRAVITY = 9.81;

export type WaveMode = {
  /** угол направления относительно направления слоя, рад */
  da: number;
  /** длина волны при масштабе слоя 1, м */
  len: number;
  /** амплитуда, м, при значимой высоте слоя 1 м (для всего слоя Σa²/2 = 1/16) */
  amp: number;
  /** начальная фаза, рад */
  phase: number;
};

export type WaveLayerName = 'swell' | 'wind' | 'ripple';

type Spec = { count: number; minLen: number; maxLen: number; spread: number; ampExp: number; salt: number; omni: boolean };

/** Длины заданы в долях «масштаба слоя» (м): у зыби это swellLength, у ветровых — длина по ветру, у ряби — 1 м. */
const SPECS: Record<WaveLayerName, Spec> = {
  swell: { count: 10, minLen: 0.55, maxLen: 1.8, spread: 0.35, ampExp: 0.92, salt: 1, omni: false },
  wind: { count: 14, minLen: 0.12, maxLen: 1.6, spread: 0.9, ampExp: 0.92, salt: 2, omni: false },
  ripple: { count: 14, minLen: 0.13, maxLen: 1.45, spread: Math.PI, ampExp: 1.08, salt: 3, omni: true },
};
export const LAYER_COUNT: Record<WaveLayerName, number> = { swell: 10, wind: 14, ripple: 14 };

/** Детерминированный генератор для набора мод (mulberry32): только от seed. */
function rng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cache = new Map<string, WaveMode[]>();

/** Моды слоя: зависят только от seed и названия слоя. Кэш — чистая оптимизация. */
export function waveModes(seed: number, layer: WaveLayerName): WaveMode[] {
  const key = `${seed}:${layer}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const sp = SPECS[layer];
  const r = rng(hash32(`water:${seed}:${sp.salt}`));
  const raw: WaveMode[] = [];
  for (let i = 0; i < sp.count; i++) {
    const frac = (i + r()) / sp.count;
    const len = sp.minLen * (sp.maxLen / sp.minLen) ** frac;
    const da = sp.omni ? (r() * 2 - 1) * Math.PI : (r() + r() + r() - 1.5) * sp.spread;
    const amp = len ** sp.ampExp * (0.65 + r() * 0.7);
    raw.push({ da, len, amp, phase: r() * Math.PI * 2 });
  }
  // нормировка: значимая высота слоя Hs = 4σ, σ² = Σ a²/2; при Hs = 1 м получаем Σ a² / 2 = 1/16
  const sigma = Math.sqrt(raw.reduce((s, m) => s + (m.amp * m.amp) / 2, 0));
  const k = 0.25 / sigma;
  const out = raw.map((m) => ({ ...m, amp: m.amp * k }));
  cache.set(key, out);
  return out;
}

/** Состояние моря: из ручек, местного ветра и льда. Все слои в метрах (значимая высота) и градусах. */
export type SeaInput = {
  waveHeight: number; swell: number; swellDirection: number; swellLength: number;
  ripple: number; rippleBoost: number; windSensitivity: number;
  windSpeed: number; windDir: number; ice: number;
};
export type SeaLayer = { height: number; dir: number; scale: number };
export type SeaState = { swell: SeaLayer; wind: SeaLayer; ripple: SeaLayer };

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
/** Азимут из вектора ветра (как в Forces: 0 — на север +z, 90 — на восток +x). */
export const windAzimuth = (wx: number, wz: number): number => ((Math.atan2(wx, wz) * 180) / Math.PI + 360) % 360;

/**
 * Что даёт ветер: у воды с чувствительностью s ветровые волны растут как у полностью развитого моря Hs = 0.21·U²/g
 * (8 м/с → 1.4 м; 15 м/с → 4.8 м), ограничены крутизной 1/7 от длины волны, лёд гасит всё.
 */
export function seaState(i: SeaInput): SeaState {
  const u = Math.max(0, i.windSpeed);
  const wlen = clamp(Math.max(0.35 * u * u, 10 * i.waveHeight), 1.5, 60); // длина основной ветровой волны, м
  const windH = Math.min(0.21 * (u * u) / GRAVITY * i.windSensitivity + i.waveHeight, 0.14 * wlen);
  const calm = 1 - clamp(i.ice, 0, 1);
  const rip = clamp(i.ripple + i.rippleBoost + i.windSensitivity * clamp(u / 10, 0, 1) * 0.8, 0, 1.5);
  return {
    swell: { height: i.swell * calm, dir: i.swellDirection, scale: i.swellLength },
    wind: { height: windH * calm, dir: i.windDir, scale: wlen },
    ripple: { height: 0.12 * rip * (1 - 0.9 * clamp(i.ice, 0, 1)), dir: 0, scale: 1 },
  };
}

/** Одна мода: вклад в высоту в точке (x, z) в момент t (дрейф — смещение волн течением, м). */
const modeHeight = (m: WaveMode, ly: SeaLayer, x: number, z: number, t: number): number => {
  const k = (2 * Math.PI) / (m.len * ly.scale);
  const a = ((ly.dir + 0) * Math.PI) / 180 + m.da;
  const omega = Math.sqrt(GRAVITY * k);
  const phase = k * (Math.sin(a) * x + Math.cos(a) * z) - omega * t + m.phase;
  const s = Math.sin(phase), c = Math.cos(phase);
  return ly.height * m.amp * (s - 0.07 * (c * c - s * s));
};

/**
 * Высота волн над средним уровнем в точке, м (CPU-копия шейдера). x, z — уже со сдвигом от течения;
 * depth — глубина воды в точке (волны мельчают у берега: зыбь и ветровые — на глубине меньше ~1.2 м, рябь — меньше 0.15 м).
 */
export function waveHeightAt(sea: SeaState, seed: number, x: number, z: number, t: number, depth = 1e9): number {
  let h = 0;
  const big = smooth01(depth / 1.2), small = smooth01(depth / 0.15);
  for (const [name, ly, damp] of [['swell', sea.swell, big], ['wind', sea.wind, big], ['ripple', sea.ripple, small]] as const) {
    if (ly.height <= 0 || damp <= 0) continue;
    let sum = 0;
    for (const m of waveModes(seed, name)) sum += modeHeight(m, ly, x, z, t);
    h += sum * damp;
  }
  return h;
}

export const smooth01 = (x: number): number => { const k = clamp(x, 0, 1); return k * k * (3 - 2 * k); };
