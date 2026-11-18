import { fbm, valueNoise } from './noise.ts';
import type { TerrainParams } from './world.ts';

/**
 * Формы рельефа (ARCHITECTURE 6.5): холмы, дюны, пляж, чаша под воду. Чистые функции от параметров и (x, z): ни часов,
 * ни случайных чисел. Высоту по ним берёт сетка Terrain (heightAt), поэтому вода, деревья и робот стоят на той же земле,
 * что нарисована. Приёмы дюн (поперечные гребни, длинный наветренный склон и крутой подветренный, меандр гребня,
 * неравномерная высота) и берега (мелководье переходит в пляж) подсмотрены у оазиса и пруда duck-days; код свой.
 */

const RAD = Math.PI / 180;
export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** Гладкий минимум (полиномиальный): скругляет гребень там, где сходятся склоны. */
const smin = (a: number, b: number, k: number) => {
  const h = clamp01(0.5 + (0.5 * (b - a)) / k);
  return b + (a - b) * h - k * h * (1 - h);
};

/** Профиль чаши: 1 в центре, 0 за краем. smooth — прежний (мягкий конус), gentle — пологий берег и ровное дно, steep — обрыв. */
export function bowlProfile(bank: TerrainParams['bank'], d: number, radius: number): number {
  switch (bank) {
    case 'gentle': return smoothstep(radius * 1.45, radius * 0.25, d);
    case 'steep': return smoothstep(radius, radius * 0.8, d);
    default: return smoothstep(radius, 0, d);
  }
}

/** Дюны: гребни поперёк ветра. u — вдоль ветра, v — поперёк. Высота от 0 до примерно duneHeight·1.3. */
export function duneField(p: TerrainParams, x: number, z: number): number {
  const a = p.windDirection * RAD, dx = Math.sin(a), dz = Math.cos(a);
  const u = x * dx + z * dz, v = x * dz - z * dx, L = p.duneSpacing;
  // гребень меандрирует: фаза сдвинута шумом вдоль гребня
  const phase = u / L + 0.55 * fbm(v / (L * 2.2), u / (L * 5), p.seed + 3, 3);
  const f = phase - Math.floor(phase), K = 0.7; // K — где гребень внутри шага (наветренный склон длиннее подветренного)
  const windward = Math.pow(f / K, 1.4), lee = Math.pow((1 - f) / (1 - K), 0.92);
  const profile = smin(windward, lee, 0.09);
  // высота гребней гуляет вдоль них: где-то мелкие, где-то высокие
  const amp = 0.45 + 0.55 * clamp01(0.5 + 0.9 * fbm(v / (L * 3.5), u / (L * 8), p.seed + 9, 3));
  // вторая, мелкая система под углом: ломает идеальную параллельность
  const a2 = a + 0.9, u2 = x * Math.sin(a2) + z * Math.cos(a2);
  const phase2 = u2 / (L * 0.42) + 0.5 * fbm(x / (L * 1.7), z / (L * 1.7), p.seed + 17, 2);
  const f2 = phase2 - Math.floor(phase2);
  const sub = smin(Math.pow(f2 / 0.65, 1.3), Math.pow((1 - f2) / 0.35, 0.9), 0.12);
  const broad = fbm(x / (L * 5), z / (L * 5), p.seed + 5, 3);
  return p.duneHeight * (0.35 + profile * amp + 0.16 * sub * (0.4 + 0.6 * amp) + 0.3 * broad);
}

/** Берег: расстояние вглубь суши от линии воды, м (минус — в море), с изгибом береговой линии. */
export function beachInland(p: TerrainParams, x: number, z: number): number {
  const a = p.shoreAngle * RAD, nx = Math.sin(a), nz = Math.cos(a);
  const q = x * nx + z * nz, along = x * nz - z * nx;
  const wobble = 5.5 * fbm(along / 40, q / 70 + 0.5, p.seed + 21, 3) + 1.2 * valueNoise(along / 9, q / 25, p.seed + 22);
  return -q + wobble;
}

/** Пляж: море — плавный спуск, пляж — подъём с уклоном beachSlope на ширину beachWidth, дальше холмы. Берег на высоте 0. */
export function beachHeight(p: TerrainParams, x: number, z: number): number {
  const s = beachInland(p, x, z), W = p.beachWidth, k = p.beachSlope;
  if (s <= 0) {
    const bars = 0.16 * fbm(x / 14, z / 14, p.seed + 31, 2) * smoothstep(0, 12, -s); // песчаные валы на дне
    return -10 * Math.tanh((k * -s) / 10) + bars;
  }
  const rise = W * k * (1 - Math.exp(-s / W));
  const hills = (fbm(x * p.scale, z * p.scale, p.seed, 4) + 0.55) * p.amplitude * smoothstep(W * 0.7, W * 0.7 + 45, s);
  const swash = 0.05 * valueNoise(x / 3.2, z / 3.2, p.seed + 41) * smoothstep(0, W * 0.5, s) * (1 - smoothstep(W * 0.8, W * 1.6, s));
  return rise + hills + swash;
}

/** Доля сухого песка 0…1 по форме и основе поверхности (без воды: мокрый песок и берег пруда считает вид по карте воды). */
export function sandWeight(p: TerrainParams, x: number, z: number): number {
  if (p.base === 'sand') return 1;
  if (p.base === 'meadow') return 0;
  if (p.style === 'dunes') return 1;
  if (p.style === 'beach') {
    const s = beachInland(p, x, z), W = p.beachWidth;
    const edge = 0.35 * valueNoise(x / 6, z / 6, p.seed + 51); // кромка травы неровная
    return 1 - smoothstep(W * 0.95, W * 1.5 + 8, s + edge * W);
  }
  return 0;
}
