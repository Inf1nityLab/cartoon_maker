import { describe, expect, it } from 'vitest';
import { hashWorldState } from '@cartoon/schema';
import { validateAgainstRegistry } from '@cartoon/engine';
import { registry, sunAt } from '@cartoon/components';
import { buildScene, generateDirectorDts, type Director } from '@cartoon/director';
import { readFileSync, writeFileSync } from 'node:fs';
import { makeEngine } from './helpers.ts';

const scene = (fn: (s: Director) => void, seed = 9) => buildScene(fn, { id: 'f', duration: 40, seed });
const forcesOf = (w: any) => w.world.forces;

describe('Forces: время суток', () => {
  it('солнце по часам: восход на востоке, полдень на юге, закат на западе, ночью под горизонтом', () => {
    expect(sunAt(5, 62)).toEqual({ elevation: expect.closeTo(0, 9), azimuth: 90 });
    expect(sunAt(12, 62)).toEqual({ elevation: expect.closeTo(62, 9), azimuth: 180 });
    expect(sunAt(19, 62)).toEqual({ elevation: expect.closeTo(0, 9), azimuth: 270 });
    expect(sunAt(0, 62).elevation).toBeCloseTo(-49.6, 9);
    expect(sunAt(0, 62).azimuth).toBeCloseTo(0, 9); // в полночь солнце на севере, под горизонтом
    expect(sunAt(6, 62).elevation).toBeGreaterThan(10); // утро: уже светло
  });

  it('time — ручка с кривой: «закат за 40 с», солнце и луна в WorldState', () => {
    const doc = scene((s) => {
      s.world.use('Sky', {});
      const f = s.world.use('Forces', { time: 12, cloudiness: 0 });
      s.at(0).do(f.to('time', 19.5, { over: 40, ease: 'linear' }));
    });
    expect(validateAgainstRegistry(doc, registry).ok).toBe(true);
    const e = makeEngine(doc);
    const noon = e.seek(0), later = e.seek(20), end = e.seek(40);
    expect(noon.sun.elevation).toBeCloseTo(62, 5);
    expect(later.sun.elevation).toBeCloseTo(sunAt(15.75, 62).elevation, 5);
    expect(end.sun.azimuth).toBeCloseTo(sunAt(19.5, 62).azimuth, 5);
    expect(forcesOf(end).time).toBeCloseTo(19.5, 6);
    expect(forcesOf(end).sunLight.strength).toBeLessThan(forcesOf(noon).sunLight.strength);
  });

  it('ночью светит луна, звёзды видны; днём наоборот', () => {
    const at = (time: number, extra = {}) => forcesOf(makeEngine(scene((s) => { s.world.use('Forces', { time, cloudiness: 0, ...extra }); })).seek(0));
    const day = at(12), night = at(0);
    expect(day.sunLight.strength).toBeGreaterThan(0.95);
    expect(day.moonLight.strength).toBe(0);
    expect(day.stars).toBe(0);
    expect(night.sunLight.strength).toBe(0);
    expect(night.moonLight.strength).toBeGreaterThan(0.9);
    expect(night.stars).toBe(1);
    expect(at(0, { moonPhase: 0 }).moonLight.strength).toBe(0);
  });

  it('ctx.light(p): облачность тускнеет свет, силы мира без Forces — нет света', () => {
    const light = (cloud: number, time = 12) => {
      const e = makeEngine(scene((s) => { s.world.use('Terrain', { style: 'flat' }); s.world.use('Forces', { time, cloudiness: cloud }); }));
      e.seek(0);
      return e.sim().services.forces!.light([0, 1, 0]);
    };
    expect(light(0).sun).toBeGreaterThan(0.95);
    expect(light(1).sun).toBeCloseTo(light(0).sun * 0.22, 2);
    expect(light(0, 0).sun).toBe(0);
    expect(light(0, 0).moon).toBeGreaterThan(0.9);
    expect(light(0).total).toBeGreaterThan(light(1).total);
    const none = makeEngine(scene((s) => { s.world.use('Terrain', { style: 'flat' }); }));
    expect(none.sim().services.forces).toBeUndefined();
  });

  it('тень рельефа: в чаше при низком солнце часть точек в тени, на гребне светло', () => {
    const e = makeEngine(scene((s) => {
      s.world.use('Terrain', { amplitude: 14, scale: 0.05, lake: { at: [0, 0], radius: 45, depth: 18 } });
      s.world.use('Forces', { time: 7, cloudiness: 0 });
    }));
    e.seek(0);
    const f = e.sim().services.forces!, h = e.sim().services.heightAt;
    const sun: number[] = [];
    for (let x = -60; x <= 60; x += 12) for (let z = -60; z <= 60; z += 12) sun.push(f.light([x, h(x, z) + 0.3, z]).sun);
    expect(Math.min(...sun)).toBeLessThan(0.3 * Math.max(...sun));
  });

  it('температура: базовая минус поправка на высоту; ручка меняется кривой', () => {
    const e = makeEngine(scene((s) => { s.world.use('Terrain', { amplitude: 14 }); const f = s.world.use('Forces', { temperature: 10 }); s.at(0).do(f.to('temperature', -10, { over: 10, ease: 'linear' })); }));
    e.seek(5);
    const f = e.sim().services.forces!, h = e.sim().services.heightAt(0, 0);
    expect(f.temperature([0, h, 0])).toBeCloseTo(0 - 0.0065 * h, 6);
  });
});

describe('Forces: ветер', () => {
  const windScene = (extra: Record<string, unknown> = {}, seed = 9) => scene((s) => { s.world.use('Terrain', { style: 'flat' }); s.world.use('Forces', { windStrength: 6, windDirection: 90, gustiness: 0.6, ...extra }); }, seed);
  const speeds = (doc: ReturnType<typeof windScene>) => {
    const e = makeEngine(doc);
    const out: number[] = [];
    for (let t = 0; t <= 30; t += 0.5) { e.seek(t); const w = e.sim().services.forces!.wind([0, 1, 0]); out.push(Math.hypot(w[0], w[2])); }
    return out;
  };

  it('детерминирован от seed: тот же seed — те же порывы, другой — другие; порывы действительно есть', () => {
    const a = speeds(windScene()), b = speeds(windScene()), c = speeds(windScene({}, 10));
    expect(a).toEqual(b);
    expect(c).not.toEqual(a);
    expect(Math.max(...a) - Math.min(...a)).toBeGreaterThan(2);
    expect(a.every((v) => v >= 0 && v < 20)).toBe(true);
  });

  it('направление: куда дует; без порывов — ровно сила', () => {
    const e = makeEngine(windScene({ gustiness: 0, windDirection: 90 }));
    e.seek(3);
    const w = e.sim().services.forces!.wind([5, 0, 5]);
    expect(w[0]).toBeCloseTo(6, 6);
    expect(w[2]).toBeCloseTo(0, 6);
  });

  it('поведение gust: быстрый подъём, долгий спад; seek в середину порыва = проигрывание', () => {
    const doc = scene((s) => { s.world.use('Forces', { windStrength: 3, gustiness: 0 }); const f = s.world.use('Forces', {}); void f; });
    void doc;
    const g = scene((s) => { const f = s.world.use('Forces', { windStrength: 3, gustiness: 0 }); s.at(2).do(f.gust({ strength: 10, duration: 4 })); });
    const v = validateAgainstRegistry(g, registry); expect(v.ok ? '' : v.errors.join('\n')).toBe('');
    const e = makeEngine(g);
    const speed = (t: number) => { e.seek(t); const w = e.sim().services.forces!.wind([0, 0, 0]); return Math.hypot(w[0], w[2]); };
    expect(speed(1.9)).toBeCloseTo(3, 6);
    expect(speed(3)).toBeCloseTo(13, 6); // пик через четверть длительности
    expect(speed(4.5)).toBeGreaterThan(3);
    expect(speed(4.5)).toBeLessThan(13);
    expect(speed(7)).toBeCloseTo(3, 6);
    const played = makeEngine(g); let h = '';
    for (let k = 1; k <= 4.5 * 60; k++) h = hashWorldState(played.step());
    expect(hashWorldState(makeEngine(g).seek(4.5))).toBe(h);
  });

  it('calm, sunset, sunrise — поведения-глаголы', () => {
    const d = scene((s) => { const f = s.world.use('Forces', { windStrength: 8, gustiness: 0.5, time: 12 }); s.at(1).do(f.calm({ over: 4 })); s.at(10).do(f.sunset({ over: 10 })); });
    const e = makeEngine(d);
    expect(forcesOf(e.seek(6)).wind.strength).toBe(0);
    expect(forcesOf(e.seek(20)).time).toBeCloseTo(19.5, 6);
  });
});

describe('Robot слушает силы мира', () => {
  const robotScene = (forces: Record<string, unknown> | null, robot: Record<string, unknown> = {}, heading = 0, more: (s: Director, r: any) => void = () => {}) =>
    scene((s) => {
      s.world.use('Terrain', { style: 'flat' });
      if (forces) s.world.use('Forces', forces);
      s.places({ a: [0, 0, 0] });
      const r = s.add('Robot', robot, { at: 'a', id: 'robot', heading });
      more(s, r);
    });
  const ant = (doc: ReturnType<typeof robotScene>, t = 3) => (makeEngine(doc).seek(t).entities.robot!.antenna as number[]);

  it('антенна пружинит от ветра: по ветру вперёд, сильнее при большей чувствительности, 0 без ветра', () => {
    const calm = ant(robotScene({ windStrength: 0 }));
    expect(calm).toEqual([0, 0]);
    const wind = ant(robotScene({ windStrength: 10, windDirection: 0, gustiness: 0 })); // дует на +z, робот смотрит на +z
    expect(wind[0]).toBeGreaterThan(8);
    expect(Math.abs(wind[1]!)).toBeLessThan(1);
    expect(ant(robotScene({ windStrength: 10, windDirection: 0, gustiness: 0 }, { windSensitivity: 0 }))[0]).toBeCloseTo(0, 6);
    expect(ant(robotScene({ windStrength: 10, windDirection: 0, gustiness: 0 }, { windSensitivity: 2 }))[0]).toBeGreaterThan(wind[0]!);
    const side = ant(robotScene({ windStrength: 10, windDirection: 90, gustiness: 0 })); // ветер на +x, т.е. влево от робота (heading 0)
    expect(side[1]).toBeGreaterThan(8);
  });

  it('порыв раскачивает антенну: серия значений растёт и падает', () => {
    const doc = robotScene({ windStrength: 1, windDirection: 0, gustiness: 0 }, {}, 0, (s) => { s.at(2).do(s.world.use('Forces', {}).gust({ strength: 12, duration: 3 })); });
    void doc;
    const d2 = scene((s) => {
      s.world.use('Terrain', { style: 'flat' }); const f = s.world.use('Forces', { windStrength: 1, windDirection: 0, gustiness: 0 });
      s.places({ a: [0, 0, 0] }); s.add('Robot', {}, { at: 'a', id: 'robot', heading: 0 });
      s.at(2).do(f.gust({ strength: 12, duration: 3 }));
    });
    const e = makeEngine(d2);
    const series = [1.9, 2.5, 3, 3.5, 4.5, 6].map((t) => (e.seek(t).entities.robot!.antenna as number[])[0]!);
    expect(series[2]!).toBeGreaterThan(series[0]! + 8);
    expect(series[5]!).toBeLessThan(series[2]! - 5);
  });

  it('глаз щурится, когда солнце бьёт в лицо; спиной к солнцу и в облаках — нет', () => {
    const open = (heading: number, cloud = 0, extra: Record<string, unknown> = {}) => (makeEngine(robotScene({ time: 15, cloudiness: cloud }, extra, heading)).seek(3).entities.robot!.eyeOpen as number);
    const az = sunAt(15, 62).azimuth;
    expect(open(az)).toBeLessThan(0.7);
    expect(open(az + 180)).toBe(1);
    expect(open(az, 1)).toBeGreaterThan(open(az));
    expect(open(az, 0, { lightSensitivity: 0 })).toBe(1);
    const noForces = makeEngine(robotScene(null, {}, az)).seek(3).entities.robot!;
    expect(noForces.eyeOpen).toBe(1);
    expect(noForces).not.toHaveProperty('glare');
  });
});

describe('director.d.ts', () => {
  it('сгенерирован из реестра: ручки с диапазоном и единицами, пресеты, примеры; файл в репозитории свежий', () => {
    const dts = generateDirectorDts(registry);
    expect(dts).toContain('export interface Forces extends HandleBase');
    expect(dts).toMatch(/Ручка «windStrength»: сила ветра, м\/с[^\n]*Единицы: м\/с\. Диапазон 0…30/);
    expect(dts).toContain('set(handle: "lightColor", value: string');
    expect(dts).toContain('gust(args?:');
    expect(dts).toContain('export type RobotPreset = "explorer" | "scout" | "hauler"');
    expect(dts).toContain('s.at(10).do(forces.to(\'time\', 19.5');
    const file = new URL('../packages/director/director.d.ts', import.meta.url);
    if (process.env.UPDATE_DTS) writeFileSync(file, dts);
    expect(readFileSync(file, 'utf8'), 'director.d.ts устарел: UPDATE_DTS=1 pnpm test').toBe(dts);
  });
});
