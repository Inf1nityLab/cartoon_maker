import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { hashWorldState } from '@cartoon/schema';
import { validateAgainstRegistry } from '@cartoon/engine';
import { Forces, registry, sunAt, wrapHours } from '@cartoon/components';
import { buildScene, type Director } from '@cartoon/director';
import { fogColorAt, skyAt, skyLook, starRotation, type SkyInput } from '../packages/render-three/src/light/sky.ts';
import { makeEngine } from './helpers.ts';

const scene = (fn: (s: Director) => void, seed = 9, duration = 40) => buildScene(fn, { id: 'sky', duration, seed });
const forcesOf = (w: any) => w.world.forces;

/** Вход неба для часа суток: те же числа, что даёт Forces (солнце по часам, луна напротив). */
const at = (time: number, extra: Partial<SkyInput> = {}): SkyInput => {
  const s = sunAt(time, 62), moonEl = -s.elevation;
  const moonStrength = Math.min(1, Math.max(0, (moonEl - 2) / 12));
  return { sunEl: s.elevation, sunAz: s.azimuth, moonEl, moonAz: s.azimuth + 180, moonPhase: 1, moonStrength, cloudiness: 0.15, fog: 0, stars: Math.min(1, Math.max(0, (moonEl - 4) / 10)), time, ...extra };
};
const lum = (c: number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;

describe('время суток: ручка time идёт по кругу (Б5)', () => {
  it('wrapHours: 26 → 2, 24 → 0, −1 → 23', () => {
    expect(wrapHours(26)).toBe(2);
    expect(wrapHours(24)).toBe(0);
    expect(wrapHours(-1)).toBe(23);
    expect(wrapHours(12.5)).toBe(12.5);
  });

  it("to('time', 26) из 22 плавно приходит к 02:00 вперёд через полночь, а не назад через весь день", () => {
    const doc = scene((s) => { const f = s.world.use('Forces', { time: 22 }); s.at(0).do(f.to('time', 26, { over: 20, ease: 'linear' })); });
    expect(validateAgainstRegistry(doc, registry).ok).toBe(true);
    const e = makeEngine(doc);
    const hours = (t: number) => forcesOf(e.seek(t)).time as number;
    expect(hours(0)).toBeCloseTo(22, 9);
    expect(hours(5)).toBeCloseTo(23, 6);
    expect(hours(10)).toBeCloseTo(0, 6); // в полночь ровно на середине пути
    expect(hours(15)).toBeCloseTo(1, 6);
    expect(hours(20)).toBeCloseTo(2, 6);
    // солнце за это время ни разу не взошло: всё время под горизонтом
    for (let t = 0; t <= 20; t += 1) expect(e.seek(t).sun.elevation).toBeLessThan(0);
    // и непрерывно: за секунду солнце не прыгает
    for (let t = 0; t < 20; t += 1) {
      const a = e.seek(t).sun, b = e.seek(t + 1).sun;
      expect(Math.abs(b.elevation - a.elevation)).toBeLessThan(8);
    }
  });

  it('сутки подряд: to(time, 5 + 24) возвращает к рассвету; значение выше 24 принимает проверка, ниже 0 и выше 96 — нет', () => {
    const ok = scene((s) => { const f = s.world.use('Forces', { time: 5 }); s.at(0).do(f.to('time', 29, { over: 20, ease: 'linear' })); });
    expect(validateAgainstRegistry(ok, registry).ok).toBe(true);
    expect(forcesOf(makeEngine(ok).seek(20)).time).toBeCloseTo(5, 6);
    const bad = scene((s) => { const f = s.world.use('Forces', {}); s.at(0).do(f.to('time', 100, { over: 5 })); });
    expect(validateAgainstRegistry(bad, registry).ok).toBe(false);
  });

  it('seek в середину = проигрывание, холодные запуски дают один хэш', () => {
    const doc = scene((s) => { const f = s.world.use('Forces', { time: 22, windStrength: 5 }); s.at(0).do(f.to('time', 26, { over: 20, ease: 'ease-in-out' })); });
    const played = makeEngine(doc); let h = '';
    for (let k = 1; k <= 13 * 60; k++) h = hashWorldState(played.step());
    expect(hashWorldState(makeEngine(doc).seek(13))).toBe(h);
  });
});

describe('Forces: пресеты и облака по ветру', () => {
  it('семь пресетов проходят схему, время каждого — свой час', () => {
    const names = ['dawn', 'noon', 'golden-hour', 'sunset', 'moonlit-night', 'overcast', 'foggy-morning'];
    expect(Object.keys(Forces.presets ?? {})).toEqual(names);
    const times = names.map((n) => (Forces.presets![n] as { time: number }).time);
    expect(new Set(times).size).toBe(names.length);
    expect((Forces.presets!['overcast'] as { cloudiness: number }).cloudiness).toBe(1);
    expect((Forces.presets!['foggy-morning'] as { fog: number }).fog).toBeGreaterThan(0.5);
  });

  const cloudAt = (wind: number, dir: number, t: number) => forcesOf(makeEngine(scene((s) => { s.world.use('Forces', { windStrength: wind, windDirection: dir, gustiness: 0 }); })).seek(t)).cloud as [number, number];

  it('облака плывут по ветру: вдоль направления, быстрее при сильном ветре, стоят при штиле', () => {
    const calm = cloudAt(0, 90, 10), light = cloudAt(2, 90, 10), strong = cloudAt(8, 90, 10);
    expect(calm).toEqual([0, 0]);
    expect(light[0]).toBeGreaterThan(0.05);
    expect(Math.abs(light[1])).toBeLessThan(1e-6);
    expect(strong[0]).toBeCloseTo(light[0] * 4, 3);
    const north = cloudAt(4, 0, 10); // на север: +z
    expect(north[1]).toBeGreaterThan(0.1);
    expect(Math.abs(north[0])).toBeLessThan(1e-6);
  });

  it('смещение облаков — функция времени: seek = проигрывание', () => {
    const doc = scene((s) => { s.world.use('Forces', { windStrength: 6, gustiness: 0.5 }); });
    const played = makeEngine(doc); let w: any;
    for (let k = 1; k <= 7 * 60; k++) w = played.step();
    expect(forcesOf(makeEngine(doc).seek(7)).cloud).toEqual(forcesOf(w).cloud);
  });
});

describe('небо и свет (light/sky.ts)', () => {
  it('день: зенит синий, у горизонта светлее; полдень ярче заката', () => {
    const noon = skyLook(at(12));
    expect(noon.zenith[2]).toBeGreaterThan(noon.zenith[0] * 2); // синего больше красного
    expect(lum(noon.horizon)).toBeGreaterThan(lum(noon.zenith));
    expect(lum(noon.ambient)).toBeGreaterThan(lum(skyLook(at(19)).ambient));
    expect(noon.keyIntensity).toBeGreaterThan(2);
  });

  it('закат: у горизонта тёплый цвет (красного больше синего), свечение у солнца, а земля НЕ чёрная (свет неба)', () => {
    const l = skyLook(at(18.95));
    expect(l.horizon[0]).toBeGreaterThan(l.horizon[2] * 2);
    expect(l.glow[0]).toBeGreaterThan(l.glow[2]);
    expect(lum(l.glow)).toBeGreaterThan(0.3);
    // освещённость земли без прямого солнца: среднее небо × отражение; рядом с нулём было бы «чёрная земля»
    expect(lum(l.ambient)).toBeGreaterThan(0.08);
    expect(lum([l.sh[0]![0] * 0.282, l.sh[0]![1] * 0.282, l.sh[0]![2] * 0.282])).toBeGreaterThan(0.05);
    expect(l.keyIntensity).toBeLessThan(1);
  });

  it('ночь: звёзды и луна видны, солнца нет, главный свет — луна, и он холодный (синего больше красного)', () => {
    const night = skyLook(at(22)), noon = skyLook(at(12));
    expect(night.starK).toBe(1);
    expect(noon.starK).toBe(0);
    expect(night.moonDisk).toBeGreaterThan(0.8);
    expect(noon.moonDisk).toBe(0);
    expect(night.keyColor[2]).toBeGreaterThan(night.keyColor[0]);
    expect(night.keyDir[1]).toBeGreaterThan(0); // свет сверху: луна над горизонтом
    expect(night.exposure).toBeGreaterThan(noon.exposure);
    expect(lum(night.ambient)).toBeGreaterThan(0.01); // ночью не чёрное
    expect(lum(night.zenith)).toBeLessThan(0.01);
  });

  it('фаза луны: новолуние — диск без света (свет «из-за диска»), полнолуние — лицом к зрителю', () => {
    const full = skyLook(at(22, { moonPhase: 1 })).moonLightDir, newm = skyLook(at(22, { moonPhase: 0 })).moonLightDir;
    expect(full[2]).toBeCloseTo(1, 6);
    expect(newm[2]).toBeCloseTo(-1, 6);
    expect(Math.hypot(...full)).toBeCloseTo(1, 9);
  });

  it('облачность: небо тускнеет и сереет, тени мягче; сплошная — свечения у солнца почти нет', () => {
    const clear = skyLook(at(12, { cloudiness: 0 })), over = skyLook(at(12, { cloudiness: 1 }));
    const sat = (c: number[]) => (Math.max(...c) - Math.min(...c)) / (Math.max(...c) + 1e-6);
    expect(sat(over.zenith)).toBeLessThan(sat(clear.zenith) * 0.5);
    expect(over.keyIntensity).toBeLessThan(clear.keyIntensity * 0.4);
    expect(clear.shadowSoft).toBe(0);
    expect(over.shadowSoft).toBe(1);
    expect(lum(over.glow)).toBeLessThan(lum(clear.glow) * 0.3);
    expect(over.cloudCover).toBe(1);
  });

  it('туман: дымка у горизонта, цвет тумана на земле тянется к дымке и темнее/светлее без резких скачков', () => {
    const l0 = skyLook(at(7, { fog: 0 })), l1 = skyLook(at(7, { fog: 0.7 }));
    expect(l0.hazeK).toBe(0);
    expect(l1.hazeK).toBeGreaterThan(0.6);
    const dir: [number, number, number] = [0, 0.02, 1];
    const fogged = skyAt({ ...l1, sunTrue: l1.sunDir, fogAmount: 0.7 }, dir);
    const hz = l1.haze;
    expect(Math.abs(fogged[0] - hz[0])).toBeLessThan(0.25 * hz[0] + 0.02);
    const fc = fogColorAt(l1, 180, 100, 8, 0.7);
    expect(Math.abs(fc[0] - hz[0])).toBeLessThan(0.25 * hz[0] + 0.02);
  });

  it('непрерывность по времени суток: соседние минуты (шаг 1 мин) дают близкие цвета, без скачков (включая полночь)', () => {
    let prev = skyLook(at(0)), worst = 0;
    for (let m = 1; m <= 24 * 60; m++) {
      const l = skyLook(at(m / 60));
      for (const k of ['zenith', 'horizon', 'ambient', 'glow'] as const) worst = Math.max(worst, Math.abs(lum(l[k]) - lum(prev[k])));
      worst = Math.max(worst, Math.abs(l.keyIntensity - prev.keyIntensity) * 0.2, Math.abs(l.exposure - prev.exposure));
      prev = l;
    }
    expect(worst).toBeLessThan(0.04); // рассвет и закат быстрые (3° за 12 минут), но без скачков
    // через полночь: 23:55 и 00:05 почти одинаковы
    const a = skyLook(at(23.99)), b = skyLook(at(0.01));
    expect(Math.abs(lum(a.zenith) - lum(b.zenith))).toBeLessThan(0.002);
  });

  it('детерминизм: те же числа — тот же результат (никаких часов и случайности)', () => {
    expect(skyLook(at(19.3, { cloudiness: 0.4 }))).toEqual(skyLook(at(19.3, { cloudiness: 0.4 })));
  });

  it('звёзды поворачиваются вокруг полюса: через 24 часа на месте, ось не двигается, матрица ортогональна', () => {
    const r0 = starRotation(0), r24 = starRotation(24), r6 = starRotation(6);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(r24[i]![j]).toBeCloseTo(r0[i]![j]!, 9);
    expect(r6[0]![0]).not.toBeCloseTo(r0[0]![0], 3);
    for (let i = 0; i < 3; i++) expect(Math.hypot(...r6[i]!)).toBeCloseTo(1, 9);
  });

  it('SH окружения конечны, по всем часам и облачности', () => {
    for (let h = 0; h < 24; h += 1.5) for (const c of [0, 0.5, 1]) for (const co of skyLook(at(h, { cloudiness: c })).sh) for (const x of co) expect(Number.isFinite(x)).toBe(true);
  });
});

describe('единый источник цвета неба (Б5)', () => {
  it('вода берёт небо из общего узла sky/nodes.ts, а не из своего градиента по цвету фона', () => {
    const water = readFileSync('packages/render-three/src/views/water.ts', 'utf8');
    expect(water).toContain('u.sky.radiance(');
    expect(water).not.toContain('skyHorizon');
    expect(water).not.toContain('skyZenith');
    expect(readFileSync('packages/render-three/src/views/world.ts', 'utf8')).toContain('three.sky.u');
  });
});
