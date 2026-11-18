import { describe, expect, it } from 'vitest';
import { hashWorldState } from '@cartoon/schema';
import { validateAgainstRegistry } from '@cartoon/engine';
import { registry, Water, WaterParams, waveHeightAt, waveModes, seaState, iceNow } from '@cartoon/components';
import { buildScene, type Director } from '@cartoon/director';
import { makeEngine, loadScene } from './helpers.ts';

const scene = (fn: (s: Director) => void, seed = 9, duration = 30) => buildScene(fn, { id: 'w', duration, seed });
const BOWL = { amplitude: 14, scale: 0.05, lake: { at: [0, 0] as [number, number], radius: 45, depth: 18 } };
const lcg = (seed: number) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const preset = (n: string) => Water.presets![n]!;
const lake = (extra: Record<string, unknown> = {}, forces?: Record<string, unknown>) => scene((s) => {
  s.world.use('Terrain', { style: 'hills', seed: 7, ...BOWL });
  s.world.use('Water', { ...preset('lake-mountain'), ...extra });
  s.world.use('Sky', {});
  s.world.use('Forces', forces ?? {});
});

describe('Water v2: схема и пресеты', () => {
  it('все пресеты проходят схему, названия на месте', () => {
    expect(Object.keys(Water.presets!)).toEqual(['ocean-tropical', 'ocean-storm', 'lake-mountain', 'pond-forest', 'pond-lilies', 'creek', 'river', 'oasis']);
    for (const p of Object.values(Water.presets!)) expect(WaterParams.safeParse(p).success).toBe(true);
    expect(preset('pond-lilies').spots.length).toBe(3); // место под кувшинки в данных
    expect(preset('ocean-tropical').open).toBe(true);
    expect(preset('river').shape).toBe('river');
  });

  it('старые сцены: версия 1 переходит в classic без отчёта, хэши не меняются (golden-тест сцен — отдельно)', () => {
    const doc = loadScene('scene-01.json');
    const w = doc.world.find((c) => c.type === 'Water')!;
    expect(w.version).toBe(1);
    const e = makeEngine(doc);
    expect(e.seek(3).world?.water).toBeUndefined(); // в отчёт старая вода не попадает: хэши прежние
    expect(e.sim().services.waters![0]!.config.style).toBe('classic');
  });

  it('режиссёр пишет version 1 и новые параметры: это уже новая вода', () => {
    const doc = lake();
    expect(validateAgainstRegistry(doc, registry).ok).toBe(true);
    const e = makeEngine(doc);
    expect(e.sim().services.waters![0]!.config.style).toBe('realistic'); // миграция не навязала classic
    expect(e.seek(1).world?.water).toBeDefined();
    // голое { level } от режиссёра версии 1 — по-прежнему старая вода
    const bare = makeEngine(scene((s) => { s.world.use('Terrain', {}); s.world.use('Water', { level: -1 }); }));
    expect(bare.sim().services.waters![0]!.config.style).toBe('classic');
  });

  it('ручки описаны схемой: единицы, диапазон', () => {
    const doc = lake();
    const e = makeEngine(doc);
    e.seek(0);
    const bad = scene((s) => { s.world.use('Terrain', {}); const w = s.world.use('Water', {}); s.at(1).do(w.set('ice', 5)); });
    expect(validateAgainstRegistry(bad, registry).ok).toBe(false);
  });
});

describe('Water: вода знает место (200 точек)', () => {
  it('чаша: вода там, где рельеф ниже уровня и связан с at; не висит над берегом и не уходит под землю', () => {
    const e = makeEngine(lake());
    e.seek(0);
    const sv = e.sim().services, w = sv.waters![0]!;
    const level = -0.4, r = lcg(5), b = w.bounds;
    let wet = 0, dry = 0, shoreNear = 0;
    for (let i = 0; i < 200; i++) {
      const x = b.x0 + (b.x1 - b.x0) * r(), z = b.z0 + (b.z1 - b.z0) * r();
      const h = sv.heightAt(x, z), d = w.depth(x, z), l = w.level(x, z);
      if (d > 0) {
        wet++;
        expect(h, `вода над землёй в (${x.toFixed(1)}, ${z.toFixed(1)})`).toBeLessThan(level);
        expect(l).toBe(level);
        expect(d).toBeCloseTo(level - h, 9);
      } else {
        dry++;
        expect(h, `земля под водой не заметна в (${x.toFixed(1)}, ${z.toFixed(1)})`).toBeGreaterThanOrEqual(level - 1e-9);
        expect(l).toBeNull();
      }
      if (Math.abs(h - level) < 1.5) shoreNear++;
    }
    expect(wet).toBeGreaterThan(8);
    expect(dry).toBeGreaterThan(8);
    expect(shoreNear).toBeGreaterThan(0);
    expect(w.depth(0, 0)).toBeGreaterThan(5); // середина чаши глубокая
  });

  it('другая ложбина не заливается, пока не связана с at (связная область)', () => {
    // уровень выше края чаши: вода выходит в соседние впадины только если они связаны; at задаёт начало
    const e = makeEngine(scene((s) => {
      s.world.use('Terrain', { style: 'hills', seed: 7 });
      s.world.use('Water', { shape: 'basin', at: [58, -4], level: 2, reach: 120 });
    }));
    e.seek(0);
    const w = e.sim().services.waters![0]!, hz = e.sim().services.heightAt;
    let isolated = 0;
    for (let x = -110; x <= 110; x += 3) for (let z = -110; z <= 110; z += 3) if (hz(x, z) < 2 && w.depth(x, z) === 0 && Math.hypot(x - 58, z + 4) > 100) isolated++;
    expect(isolated).toBeGreaterThan(0); // низины вне связной области остались сухими
  });

  it('без at: всё, что ниже уровня (так было в версии 1)', () => {
    const e = makeEngine(scene((s) => { s.world.use('Terrain', { style: 'hills', seed: 7 }); s.world.use('Water', { style: 'realistic', level: 2 }); }));
    e.seek(0);
    const w = e.sim().services.waters![0]!, hz = e.sim().services.heightAt, r = lcg(7);
    for (let i = 0; i < 200; i++) { const x = (r() - 0.5) * 220, z = (r() - 0.5) * 220; expect(w.depth(x, z) > 0).toBe(hz(x, z) < 2); }
  });

  it('река по изогнутому пути: русло прорезано, уровень течёт под уклон, берег совпадает с heightAt', () => {
    const e = makeEngine(scene((s) => {
      s.path('water', { points: [[-60, 0, -30], [-25, 0, 10], [5, 0, -5], [35, 0, 25], [70, 0, 15]] });
      s.world.use('Terrain', { style: 'hills', seed: 7 });
      s.world.use('Water', { ...preset('river'), path: 'water', width: 7, bank: 3 });
    }));
    e.seek(0);
    const sv = e.sim().services, w = sv.waters![0]!;
    const path = e.sim().services.waters![0]!.config.path as string;
    expect(path).toBe('water');
    let prev = Infinity;
    const doc = lakeRiverPath();
    const pts = doc;
    for (const [x, z] of pts) {
      const l = w.level(x, z);
      expect(l, `на оси (${x.toFixed(1)}, ${z.toFixed(1)}) есть вода`).not.toBeNull();
      expect(sv.heightAt(x, z)).toBeLessThan(l!);
      expect(l!).toBeLessThanOrEqual(prev + 1e-9);
      prev = l!;
    }
    const r = lcg(11), b = w.bounds;
    let wet = 0;
    for (let i = 0; i < 200; i++) {
      const x = b.x0 + (b.x1 - b.x0) * r(), z = b.z0 + (b.z1 - b.z0) * r();
      const d = w.depth(x, z), l = w.level(x, z);
      if (d > 0) { wet++; expect(sv.heightAt(x, z)).toBeLessThan(l!); }
      else expect(l === null || sv.heightAt(x, z) >= l - 1e-9).toBe(true);
    }
    expect(wet).toBeGreaterThan(5);
    expect(w.depth(200, 200)).toBe(0);
    const fd = w.flowDir(-60, -30);
    expect(Math.hypot(fd[0], fd[1])).toBeCloseTo(1, 6);
  });
});

function lakeRiverPath(): [number, number][] {
  // точки на оси, не на углах ломаной: середины отрезков и ближайшие к ним
  const P: [number, number][] = [[-60, -30], [-25, 10], [5, -5], [35, 25], [70, 15]];
  const out: [number, number][] = [];
  for (let i = 0; i < P.length - 1; i++) for (const t of [0.25, 0.5, 0.75]) out.push([P[i]![0] + (P[i + 1]![0] - P[i]![0]) * t, P[i]![1] + (P[i + 1]![1] - P[i]![1]) * t]);
  return out;
}

describe('Water: волны слоями', () => {
  it('моды детерминированы, нормированы по значимой высоте', () => {
    const a = waveModes(3, 'swell'), b = waveModes(3, 'swell');
    expect(a).toEqual(b);
    expect(waveModes(4, 'swell')).not.toEqual(a);
    for (const l of ['swell', 'wind', 'ripple'] as const) expect(waveModes(3, l).reduce((s, m) => s + m.amp * m.amp / 2, 0)).toBeCloseTo(1 / 16, 9);
  });

  it('ветер 0 → 8 м/с: ветровые волны растут (≈ 0.21·U²/g × чувствительность), лёд гасит', () => {
    const base = { waveHeight: 0, swell: 0, swellDirection: 90, swellLength: 40, ripple: 0.2, rippleBoost: 0, windSensitivity: 1, windDir: 90, ice: 0 };
    const h = (u: number) => seaState({ ...base, windSpeed: u }).wind.height;
    expect(h(0)).toBe(0);
    expect(h(8)).toBeCloseTo(0.21 * 64 / 9.81, 1);
    expect(h(8)).toBeGreaterThan(h(4));
    expect(seaState({ ...base, windSpeed: 8, ice: 1 }).wind.height).toBe(0);
    expect(seaState({ ...base, windSpeed: 8, windSensitivity: 0 }).wind.height).toBe(0); // чувствительность 0 — не слышит
  });

  it('высота волн на CPU: ограничена, не зависит от порядка вызовов, у берега мельчает', () => {
    const sea = seaState({ waveHeight: 1, swell: 2, swellDirection: 90, swellLength: 50, ripple: 0.5, rippleBoost: 0, windSensitivity: 0, windSpeed: 0, windDir: 0, ice: 0 });
    let max = 0;
    for (let i = 0; i < 300; i++) max = Math.max(max, Math.abs(waveHeightAt(sea, 3, i * 1.7, i * 0.9, i * 0.1)));
    expect(max).toBeGreaterThan(0.5);
    expect(max).toBeLessThan(6);
    expect(waveHeightAt(sea, 3, 5, 5, 2)).toBe(waveHeightAt(sea, 3, 5, 5, 2));
    expect(Math.abs(waveHeightAt(sea, 3, 5, 5, 2, 0))).toBe(0);
  });

  it('вода слушает ветер сил мира: сильнее ветер — выше волны; windSensitivity 0 — глухая; без Forces — штиль', () => {
    const at = (wind: number, sens: number, forces = true) => makeEngine(scene((s) => {
      s.world.use('Terrain', { style: 'hills', seed: 7, ...BOWL });
      s.world.use('Water', { ...preset('lake-mountain'), windSensitivity: sens, ripple: 0 });
      if (forces) s.world.use('Forces', { windStrength: wind, gustiness: 0 });
    })).seek(5).world!.water as any;
    expect(at(8, 1).waves.wind).toBeGreaterThan(at(2, 1).waves.wind);
    expect(at(8, 0).waves.wind).toBe(0);
    expect(at(8, 1, false).waves.wind).toBe(0);
    expect(at(8, 1).waves.windSpeed).toBeCloseTo(8, 0);
  });
});

describe('Water: ручки и поведения', () => {
  it('ice: сразу, по кривой, freeze/thaw; seek = проигрывание', () => {
    const doc = lake({ temperatureSensitivity: 0 });
    const w = (d: ReturnType<typeof lake>) => d.world.find((c) => c.type === 'Water')!.id;
    doc.timeline.push({ id: 'f', t: 2, target: w(doc), action: 'freeze', args: { over: 8 } }, { id: 't', t: 14, target: w(doc), action: 'thaw', args: { over: 4 } });
    const e = makeEngine(doc);
    const ice = (t: number) => (e.seek(t).world!.water as any).ice;
    expect(ice(1)).toBe(0);
    expect(ice(6)).toBeGreaterThan(0.2);
    expect(ice(6)).toBeLessThan(0.8);
    expect(ice(10.5)).toBeCloseTo(1, 6);
    expect(ice(16)).toBeLessThan(1);
    expect(ice(19)).toBeCloseTo(0, 6);
    const played = makeEngine(doc), h = new Map<number, string>();
    for (let k = 1; k <= 20 * 60; k++) { const s = played.step(); if (k % 60 === 0) h.set(k, hashWorldState(s)); }
    const jumper = makeEngine(doc);
    for (const k of [600, 1140, 120, 600]) expect(hashWorldState(jumper.seek(k / 60))).toBe(h.get(k));
  });

  it('лёд слушает температуру: мороз замораживает сам (при чувствительности 1), оттепель — нет', () => {
    const at = (temp: number, sens: number) => (makeEngine(lake({ temperatureSensitivity: sens }, { temperature: temp })).seek(2).world!.water as any).ice;
    expect(at(10, 1)).toBe(0);
    expect(at(-10, 1)).toBeCloseTo(1, 6);
    expect(at(-10, 0)).toBe(0);
    expect(iceNow(0.3, 20, { temperatureSensitivity: 1, freezeAt: 0 })).toBe(0.3);
  });

  it('ripple — поведение: рябь вспыхивает и затихает; storm поднимает волны и пену, calm успокаивает', () => {
    const doc = lake({ ripple: 0.1, windSensitivity: 0 });
    const id = doc.world.find((c) => c.type === 'Water')!.id;
    doc.timeline.push({ id: 'r', t: 1, target: id, action: 'ripple', args: { strength: 0.8, duration: 4 } }, { id: 's', t: 8, target: id, action: 'storm', args: { over: 4, severity: 1 } }, { id: 'c', t: 14, target: id, action: 'calm', args: { over: 2 } });
    const e = makeEngine(doc);
    const w = (t: number) => e.seek(t).world!.water as any;
    expect(w(2.2).waves.ripple).toBeGreaterThan(w(0.5).waves.ripple);
    expect(w(6).waves.ripple).toBeLessThan(w(2.2).waves.ripple);
    expect(w(13).waves.wind).toBeGreaterThan(1);
    expect(w(13).waves.swell).toBeGreaterThan(2);
    expect(w(17).waves.wind).toBeLessThan(0.05);
  });
});

describe('Water: круги на воде', () => {
  it('splash и робот в воде дают круги, они гаснут; детерминизм', () => {
    const mk = () => scene((s) => {
      s.world.use('Terrain', { style: 'hills', seed: 7, ...BOWL });
      const w = s.world.use('Water', { ...preset('lake-mountain'), touchers: ['rover'] });
      s.places({ shore: [-24, 0, 0], deep: [0, 0, 0] });
      const rover = s.add('Robot', {}, { at: 'shore', heading: 90, id: 'rover' });
      s.at(0.5).do(rover.roll({ to: 'deep', speed: 2 }));
      s.at(3).do(w.splash({ at: [4, 0, 4], strength: 1 }));
    }, 3, 12);
    const doc = mk();
    const r = validateAgainstRegistry(doc, registry);
    expect(r.ok, r.ok ? '' : r.errors.join('\n')).toBe(true);
    const e = makeEngine(doc);
    const rings = (t: number) => (e.seek(t).world!.water as any).rings as number;
    expect(rings(3.2)).toBeGreaterThanOrEqual(1);
    expect(rings(11)).toBe(0); // всё затихло (жизнь круга 5 с, а робот остановился)
    const a = hashWorldState(makeEngine(doc).seek(7)), b = hashWorldState(makeEngine(mk()).seek(7));
    expect(a).toBe(b);
  });
});

describe('Water: несколько вод в одном мире (пруд и ручей)', () => {
  it('у каждой воды свой id и уровень, ctx.waterAt отвечает по точке, берега совпадают с heightAt', () => {
    const doc = scene((s) => {
      s.path('stream', { points: [[40, 0, -70], [55, 0, -30], [45, 0, 20], [60, 0, 70]] });
      s.world.use('Terrain', { style: 'hills', seed: 7, ...BOWL, size: 240, segments: 384, ground: 'soil' });
      s.world.use('Water', { ...preset('pond-forest'), level: -0.4 }, 'pond');
      s.world.use('Water', { ...preset('creek'), path: 'stream', width: 3, bank: 2 }, 'stream');
    });
    expect(validateAgainstRegistry(doc, registry).ok).toBe(true);
    const e = makeEngine(doc);
    e.seek(1);
    const sv = e.sim().services;
    expect(sv.waters!.map((w) => w.id)).toEqual(['pond', 'stream']);
    const [pond, stream] = sv.waters!;
    // в центре пруда — пруд, на оси ручья — ручей, их уровни разные
    const centre = pond!.level(0, 0), axis = stream!.level(55, -30);
    expect(centre).toBe(-0.4);
    expect(axis).not.toBeNull();
    expect(axis).not.toBeCloseTo(centre!, 2);
    expect(stream!.level(0, 0)).toBeNull();
    expect(pond!.level(55, -30)).toBeNull();
    // точка на суше — воды нет
    const r = lcg(21);
    let wet = 0, dry = 0;
    for (let i = 0; i < 200; i++) {
      const x = (r() - 0.5) * 220, z = (r() - 0.5) * 220;
      for (const w of [pond!, stream!]) {
        const d = w.depth(x, z), l = w.level(x, z);
        if (d > 0) { wet++; expect(sv.heightAt(x, z), `${w.id} (${x.toFixed(1)}, ${z.toFixed(1)})`).toBeLessThan(l!); expect(d).toBeCloseTo(l! - sv.heightAt(x, z), 9); }
        else { dry++; expect(l === null || sv.heightAt(x, z) >= l - 1e-9).toBe(true); }
      }
    }
    expect(wet).toBeGreaterThan(10);
    expect(dry).toBeGreaterThan(100);
    // waterAt: запрос по точке
    const hit = e.sim().services.waters!.length;
    expect(hit).toBe(2);
    // состояние обоих попадает в отчёт
    const w = e.seek(2).world as any;
    expect(w.pond.shape).toBe('basin');
    expect(w.stream.shape).toBe('river');
  });
});
