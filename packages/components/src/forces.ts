import { z } from 'zod';
import { defineComponent, type Ctx, type ForcesField, type LightAt } from '@cartoon/engine';
import type { Vec3 } from '@cartoon/schema';
import { seedFrom, valueNoise } from './noise.ts';

/**
 * Силы мира (ARCHITECTURE 6.6): время суток, ветер, облачность и туман, температура. Одна на мир.
 * Режиссёр задаёт причины (ручки: `time`, `windStrength`, `cloudiness`…), следствия считают объекты через ctx:
 * `ctx.wind(p)`, `ctx.light(p)`, `ctx.temperature(p)`, `ctx.timeOfDay`. Всё — функции времени фильма и seed.
 *
 * Почему отдельный компонент, а не расширение `Sky`: Sky — картинка неба и ручное солнце (высота и азимут для старых сцен),
 * Forces — причины и сервисы. Когда Forces есть, солнце берётся из часов суток, а Sky его только показывает
 * (облака, луна и звёзды как картинка — задача Б5, и они будут слушать эти же числа). Старые сцены без Forces не меняются.
 */

const RAD = Math.PI / 180;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const smoothstep = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const wrap360 = (a: number) => ((a % 360) + 360) % 360;
/** Часы суток по кругу: 26 → 2, −1 → 23. Ручка `time` идёт вперёд через полночь (to('time', 26) = к 02:00 следующих суток). */
export const wrapHours = (h: number): number => ((h % 24) + 24) % 24;
const dirOf = (elevation: number, azimuth: number): Vec3 => {
  const el = elevation * RAD, az = azimuth * RAD;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
};

export const ForcesParams = z.object({
  time: z.number().min(0).max(24).default(12).describe('время суток, часы (0–24; 5 — восход, 12 — полдень, 19 — закат, 0 — полночь). Ручкой можно дойти до 96: больше 24 — следующие сутки (26 = 02:00)'),
  sunArc: z.number().min(10).max(90).default(62).describe('наибольшая высота солнца в полдень, ° (меньше — севернее или зимой)'),
  windDirection: z.number().min(0).max(360).default(90).describe('куда дует ветер, ° (0 — на север, +z; 90 — на восток, +x)'),
  windStrength: z.number().min(0).max(30).default(2).describe('сила ветра, м/с (2 — лёгкий, 8 — свежий, 15 — шторм)'),
  gustiness: z.number().min(0).max(1).default(0.3).describe('порывистость: доля, на которую сила ветра гуляет вверх-вниз сама'),
  gustBoost: z.number().min(0).max(30).default(0).describe('добавка к силе ветра от порыва, м/с (обычно 0; меняется поведением gust)'),
  cloudiness: z.number().min(0).max(1).default(0.15).describe('облачность: 0 ясно, 1 сплошные тучи (тускнеет свет солнца и луны)'),
  fog: z.number().min(0).max(1).default(0).describe('туман: 0 нет, 1 густой'),
  temperature: z.number().min(-50).max(60).default(15).describe('температура воздуха у земли, °C'),
  moonPhase: z.number().min(0).max(1).default(1).describe('освещённость луны: 0 новолуние, 1 полнолуние'),
});
export type ForcesParams = z.infer<typeof ForcesParams>;

/**
 * Высота и азимут солнца по часам. Восход в 5:00 на востоке (90°), полдень в 12:00 на юге (180°, высота = arc),
 * закат в 19:00 на западе (270°); ночью солнце под горизонтом (до 0.8·arc), проходит через север в 0:00.
 */
export function sunAt(time: number, arc: number): { elevation: number; azimuth: number } {
  if (time >= 5 && time < 19) return { elevation: arc * Math.sin(((time - 5) / 14) * Math.PI), azimuth: wrap360(90 + (180 * (time - 5)) / 14) };
  const u = time >= 19 ? time - 19 : time + 5; // часы с заката, 0…10
  return { elevation: -arc * 0.8 * Math.sin((u / 10) * Math.PI) + 0, azimuth: wrap360(270 + 18 * u) };
}

/** Сила прямого солнца 0…1 по его высоте (до облаков и теней): с горизонта до 30° нарастает, дальше — полная. */
export const sunStrength = (elevation: number): number => smoothstep(-1, 10, elevation) * (0.3 + 0.7 * clamp(elevation / 30, 0, 1));

/** Лунный свет по высоте луны и фазе. */
export const moonStrength = (elevation: number, phase: number): number => smoothstep(2, 14, elevation) * phase;

/** Облака плывут со скоростью ветра ×CLOUD_DRIFT (в единицах текстуры неба в секунду на м/с): быстрее настоящих, чтобы дрейф был виден в кадре. */
const CLOUD_DRIFT = 0.006;

const SHADOW_STEPS = [0.4, 0.9, 1.8, 3.5, 7, 14, 28, 56];
/** Тень рельефа: идём от точки к солнцу и смотрим, не заслонил ли склон. 1 — открыто, 0.18 — в тени (рассеянный свет остаётся). */
function terrainShade(ctx: Ctx, p: Vec3, dir: Vec3): number {
  if (dir[1] <= 0.005) return 1;
  for (const s of SHADOW_STEPS) {
    const x = p[0] + dir[0] * s, z = p[2] + dir[2] * s, y = p[1] + dir[1] * s;
    if (ctx.heightAt(x, z) > y) return 0.18;
  }
  return 1;
}

export const Forces = defineComponent({
  type: 'Forces',
  version: 1,
  describe: 'Силы мира: время суток (солнце, луна, звёзды), ветер (направление, сила, порывы), облачность, туман, температура. Объекты слушают их через ctx.wind(p), ctx.light(p), ctx.temperature(p), ctx.timeOfDay с собственной чувствительностью. Ручка time идёт по кругу: to(time, 26) приходит к 02:00 вперёд через полночь. Небо (облака, луна с фазой, звёзды, дымка) и свет на земле считает вид Sky по этим силам; облака плывут по ветру. Пресеты: dawn, noon, golden-hour, sunset, moonlit-night, overcast, foggy-morning. Ручки: time, windStrength, windDirection, gustiness, cloudiness, fog, temperature, moonPhase. Поведения: gust, calm, sunset, sunrise.',
  params: ForcesParams,
  // пресеты времени суток и погоды: рассвет, полдень, золотой час, закат, ночь с луной, пасмурно, туманное утро
  presets: {
    dawn: ForcesParams.parse({ time: 5.5, cloudiness: 0.25, fog: 0.12, windStrength: 1, gustiness: 0.2 }),
    noon: ForcesParams.parse({ time: 12.5, cloudiness: 0.12 }),
    'golden-hour': ForcesParams.parse({ time: 18.2, cloudiness: 0.3, windStrength: 2 }),
    sunset: ForcesParams.parse({ time: 18.95, cloudiness: 0.4, windStrength: 1.5 }),
    'moonlit-night': ForcesParams.parse({ time: 22, cloudiness: 0.1, moonPhase: 1, windStrength: 1 }),
    overcast: ForcesParams.parse({ time: 13, cloudiness: 1, windStrength: 4, gustiness: 0.4 }),
    'foggy-morning': ForcesParams.parse({ time: 6.8, cloudiness: 0.35, fog: 0.7, windStrength: 0.5, gustiness: 0.1 }),
  },
  handles: {
    // ручка шире параметра: время идёт по кругу, to('time', 26) приходит к 02:00 вперёд через полночь, а не назад через весь день
    time: { unit: 'ч', schema: z.number().min(0).max(96).default(12).describe('время суток, часы; больше 24 — следующие сутки (26 = 02:00), мир показывает остаток от деления на 24') },
    windDirection: { unit: '°' },
    windStrength: { unit: 'м/с' },
    gustiness: {},
    gustBoost: { unit: 'м/с' },
    cloudiness: {},
    fog: {},
    temperature: { unit: '°C' },
    moonPhase: {},
  },
  actions: {
    gust: z.object({
      strength: z.number().min(0.5).max(30).default(8).describe('на сколько м/с сильнее на пике'),
      duration: z.number().min(0.4).max(60).default(3).describe('сколько длится порыв, с'),
    }),
    calm: z.object({ over: z.number().min(0).max(600).default(5).describe('за сколько секунд ветер стихает, с') }),
    sunset: z.object({ over: z.number().min(0).max(3600).default(40).describe('за сколько секунд, с') }),
    sunrise: z.object({ over: z.number().min(0).max(3600).default(40).describe('за сколько секунд, с') }),
  },
  setup(ctx, p) {
    const id = ctx.componentId;
    const v = <K extends keyof ForcesParams>(name: K): ForcesParams[K] => (ctx.handleOf(id, name) as ForcesParams[K] | undefined) ?? p[name];
    const noise = seedFrom(ctx.seed, id);
    const hours = () => wrapHours(v('time'));
    const sunNow = () => sunAt(hours(), p.sunArc);

    /** Сила ветра в точке сейчас (м/с) и его направление (°): ровный ветер плюс порывы, бегущие вдоль ветра. */
    const windAt = (pt: Vec3): Vec3 => {
      const t = ctx.time, dirDeg = v('windDirection');
      const along = (pt[0] * Math.sin(dirDeg * RAD) + pt[2] * Math.cos(dirDeg * RAD)) * 0.06; // порыв доходит до дальних точек позже
      const g = 0.65 * valueNoise(t * 0.45 - along, 0.5, noise) + 0.35 * valueNoise(t * 1.7 - along * 1.6, 7.5, noise + 1);
      const k = v('gustiness');
      const speed = Math.max(0, v('windStrength') * (1 + k * g * 1.4) + v('gustBoost'));
      const a = (dirDeg + k * 25 * valueNoise(t * 0.3 - along, 3.3, noise + 2)) * RAD;
      return [Math.sin(a) * speed, 0, Math.cos(a) * speed];
    };

    const field: ForcesField = {
      timeOfDay: hours,
      sun: sunNow,
      wind: windAt,
      light(pt): LightAt {
        const s = sunNow(), cloud = v('cloudiness');
        const sunDir = dirOf(s.elevation, s.azimuth), moonDir = dirOf(-s.elevation, s.azimuth + 180);
        const sun = sunStrength(s.elevation) * (1 - 0.78 * cloud);
        const moon = moonStrength(-s.elevation, v('moonPhase')) * (1 - 0.7 * cloud);
        // тень рельефа важна только когда солнце действительно светит
        const shade = sun > 0.02 ? terrainShade(ctx, pt, sunDir) : 1;
        const sunHere = sun * shade;
        return { sun: sunHere, moon, total: Math.min(1, sunHere + 0.12 * moon), sunDir, moonDir };
      },
      temperature: (pt) => v('temperature') - 0.0065 * ctx.heightAt(pt[0], pt[2]),
      summary() {
        const s = sunNow(), cloud = v('cloudiness'), w = windAt([0, 0, 0]);
        const moonEl = -s.elevation;
        return {
          time: hours(),
          sunLight: { elevation: s.elevation, azimuth: s.azimuth, strength: sunStrength(s.elevation) * (1 - 0.78 * cloud) },
          moonLight: { elevation: moonEl, azimuth: wrap360(s.azimuth + 180), strength: moonStrength(moonEl, v('moonPhase')) * (1 - 0.7 * cloud), phase: v('moonPhase') },
          stars: clamp((-s.elevation - 4) / 10, 0, 1) * (1 - 0.8 * cloud),
          wind: { direction: v('windDirection'), strength: v('windStrength'), speed: Math.hypot(w[0], w[2]), gust: v('gustBoost') },
          cloudiness: cloud,
          fog: v('fog'),
          temperature: v('temperature'),
        };
      },
    };
    ctx.provide('forces', field);
  },
  // облака плывут по ветру: смещение накапливается по тактам (перемотка = проигрывание, лежит в чекпоинтах)
  create: () => ({ cloud: [0, 0] as [number, number] }),
  step(self, dt, ctx) {
    const w = ctx.service('forces')?.wind([0, 0, 0]);
    if (w) { self.cloud[0] += w[0] * dt * CLOUD_DRIFT; self.cloud[1] += w[2] * dt * CLOUD_DRIFT; }
  },
  onAction(_s, name, a, ctx) {
    switch (name) {
      case 'gust':
        // поведение: порыв — быстрый подъём и долгий спад одной ручки gustBoost
        ctx.handles.seq('gustBoost', [{ to: a.strength, over: a.duration * 0.25, ease: 'ease-out' }, { to: 0, over: a.duration * 0.75, ease: 'ease-in-out' }]);
        break;
      case 'calm': ctx.handles.to('windStrength', 0, { over: a.over, ease: 'ease-in-out' }); ctx.handles.to('gustiness', 0, { over: a.over, ease: 'ease-in-out' }); break;
      case 'sunset': ctx.handles.to('time', 19.5, { over: a.over, ease: 'ease-in-out' }); break;
      case 'sunrise': ctx.handles.to('time', 5.5, { over: a.over, ease: 'ease-in-out' }); break;
    }
  },
  state: (s, ctx) => {
    const f = ctx.service('forces');
    if (!f) return {};
    return { sun: f.sun(), ...f.summary(), cloud: [Math.round(s.cloud[0] * 1e5) / 1e5, Math.round(s.cloud[1] * 1e5) / 1e5] };
  },
  showcase: {
    kind: 'world', size: 40, eye: 1.5, ground: 'hills',
    demos: [{
      title: 'Сутки за 20 с (через полночь)',
      duration: 22,
      steps: [
        { t: 0, action: 'handle.set', args: { handle: 'time', value: 5 } },
        { t: 0.5, action: 'handle.to', args: { handle: 'time', value: 29, over: 20, ease: 'linear' } },
      ],
    }, {
      title: 'Закат за 12 с, порыв ветра, облака',
      duration: 14,
      steps: [
        { t: 0, action: 'handle.set', args: { handle: 'time', value: 12 } },
        { t: 1, action: 'handle.to', args: { handle: 'time', value: 19.5, over: 8, ease: 'ease-in-out' } },
        { t: 3, action: 'gust', args: { strength: 9, duration: 3 } },
        { t: 6, action: 'handle.to', args: { handle: 'cloudiness', value: 0.8, over: 6, ease: 'linear' } },
        { t: 9, action: 'handle.to', args: { handle: 'time', value: 23, over: 4, ease: 'ease-in' } },
      ],
    }],
  },
  migrate: {},
  examples: [
    "const forces = s.world.use('Forces', { time: 12, windStrength: 4 })",
    "s.at(10).do(forces.to('time', 19.5, { over: 40 }))   // закат за 40 с",
    "s.at(20).do(forces.gust({ strength: 10, duration: 3 }))",
    "s.at(30).do(robot.unlink('wind'))   // робот не слышит ветер",
  ],
});
