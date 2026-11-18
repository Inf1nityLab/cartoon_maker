import { describe, expect, it } from 'vitest';
import { hashWorldState } from '@cartoon/schema';
import { validateAgainstRegistry } from '@cartoon/engine';
import {
  registry, Terrain, TerrainParams, terrainHeight, gridIndices, sampleGrid, bakeSurfaceMap, beachInland, sandWeight, duneField, frostFactor, Water,
} from '@cartoon/components';
import { buildScene, type Director } from '@cartoon/director';
import { makeEngine, loadScene } from './helpers.ts';

const scene = (fn: (s: Director) => void, seed = 9, duration = 40) => buildScene(fn, { id: 't', duration, seed });
const lcg = (seed: number) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const preset = (n: string) => TerrainParams.parse(Terrain.presets![n]);
const withTerrain = (params: Record<string, unknown>, forces: Record<string, unknown> | null = {}, extra?: (s: Director) => void) => scene((s) => {
  s.world.use('Terrain', { ...params, ground: 'surfaces' });
  s.world.use('Sky', {});
  if (forces) s.world.use('Forces', forces);
  extra?.(s);
});

describe('Terrain v3: схема, пресеты, миграция', () => {
  it('все пресеты проходят схему; новые — на месте; старые не тронуты', () => {
    expect(Object.keys(Terrain.presets!)).toEqual(['hills', 'plain', 'bowl', 'soft', 'meadow-hills', 'desert-dunes', 'pond-shore', 'sea-beach', 'forest-glade', 'winter-meadow']);
    for (const p of Object.values(Terrain.presets!)) expect(TerrainParams.safeParse(p).success).toBe(true);
    expect(preset('desert-dunes').style).toBe('dunes');
    expect(preset('sea-beach').style).toBe('beach');
    expect(preset('hills').ground).toBe('soil'); // прежний вид по умолчанию
    expect(TerrainParams.parse({}).bank).toBe('smooth');
  });

  it('старые сцены: версия 1 и 2 не получают поверхностей и состояния, хэши прежние (golden-тест сцен — отдельно)', () => {
    const doc = loadScene('scene-01.json');
    const e = makeEngine(doc);
    expect(e.sim().services.terrain!.ground).toBe('lowpoly');
    expect(e.seek(3).world?.terrain).toBeUndefined();
    const t2 = makeEngine(loadScene('test-road.json'));
    expect(t2.sim().services.terrain!.ground).toBe('soil');
    expect(t2.seek(3).world?.terrain).toBeUndefined();
  });

  it('режиссёр пишет version 1 и новые параметры: это новая земля; поведения и ручки проверяются схемой', () => {
    const doc = withTerrain({ style: 'dunes', duneHeight: 7 });
    expect(validateAgainstRegistry(doc, registry).ok).toBe(true);
    const badHandle = scene((s) => { const t = s.world.use('Terrain', { ground: 'surfaces' }); s.at(1).do(t.set('snow', 5)); });
    expect(validateAgainstRegistry(badHandle, registry).ok).toBe(false);
  });
});

describe('Terrain: heightAt = отрисованная сетка (200 точек на форму)', () => {
  for (const name of ['hills', 'bowl', 'desert-dunes', 'pond-shore', 'sea-beach']) {
    it(`${name}: точка в треугольнике индексного буфера = heightAt (< 1e-5), от функции формы не дальше половины шага сетки`, () => {
      const doc = scene((s) => { s.world.use('Terrain', { ...Terrain.presets![name], ground: 'surfaces' }); });
      const e = makeEngine(doc), { heightAt, terrain } = e.sim().services;
      const p = preset(name);
      const spec = { size: terrain!.size, segments: terrain!.segments };
      const h = sampleGrid(spec, heightAt), idx = gridIndices(spec), n = spec.segments, w = n + 1, step = spec.size / n, half = spec.size / 2;
      const vx = (k: number) => -half + (k % w) * step, vz = (k: number) => -half + Math.floor(k / w) * step;
      const rnd = lcg(11);
      let worstMesh = 0, worstShape = 0;
      for (let s = 0; s < 200; s++) {
        const x = (rnd() - 0.5) * (spec.size - 2), z = (rnd() - 0.5) * (spec.size - 2);
        const cell = Math.floor((z + half) / step) * n + Math.floor((x + half) / step);
        let got: number | null = null;
        for (const t of [cell * 2, cell * 2 + 1]) {
          const [a, b, c] = [idx[t * 3]!, idx[t * 3 + 1]!, idx[t * 3 + 2]!];
          const det = (vz(b) - vz(c)) * (vx(a) - vx(c)) + (vx(c) - vx(b)) * (vz(a) - vz(c));
          const l1 = ((vz(b) - vz(c)) * (x - vx(c)) + (vx(c) - vx(b)) * (z - vz(c))) / det;
          const l2 = ((vz(c) - vz(a)) * (x - vx(c)) + (vx(a) - vx(c)) * (z - vz(c))) / det;
          const l3 = 1 - l1 - l2;
          if (l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9) { got = l1 * h[a]! + l2 * h[b]! + l3 * h[c]!; break; }
        }
        expect(got).not.toBeNull();
        worstMesh = Math.max(worstMesh, Math.abs(got! - heightAt(x, z)));
        // сетка против самой формы: между вершинами отличается не больше половины шага сетки (допуск задания)
        worstShape = Math.max(worstShape, Math.abs(heightAt(x, z) - terrainHeight(p, x, z)));
      }
      expect(worstMesh).toBeLessThan(1e-5);
      expect(worstShape).toBeLessThan(step / 2);
    });
  }
});

describe('Terrain: формы', () => {
  it('дюны: гребни поперёк ветра (вдоль гребня высота меняется мало, поперёк — много), наветренный склон длиннее подветренного', () => {
    const p = TerrainParams.parse({ style: 'dunes', duneHeight: 8, duneSpacing: 60, windDirection: 90, lake: { at: [0, 0], radius: 1, depth: 0 } });
    // ветер на +x: гребни тянутся вдоль z
    let across = 0, along = 0;
    for (let i = 0; i < 100; i++) {
      const x = -60 + i * 1.2;
      across += Math.abs(duneField(p, x + 1, 5) - duneField(p, x, 5));
      along += Math.abs(duneField(p, 10, x + 1) - duneField(p, 10, x));
    }
    expect(across).toBeGreaterThan(along * 2.5);
    // профиль вдоль ветра: от подошвы до гребня — дольше, чем от гребня до подошвы
    let up = 0, down = 0, crestRuns = 0;
    const hs = Array.from({ length: 1200 }, (_, i) => duneField(p, -300 + i * 0.5, 0));
    for (let i = 1; i < hs.length; i++) { if (hs[i]! > hs[i - 1]!) up++; else down++; }
    expect(up).toBeGreaterThan(down * 1.15);
    for (let i = 1; i < hs.length - 1; i++) if (hs[i]! > hs[i - 1]! && hs[i]! >= hs[i + 1]! && hs[i]! > 8) crestRuns++;
    expect(crestRuns).toBeGreaterThan(3); // несколько гребней на 600 м при шаге 60
    expect(Math.max(...hs)).toBeGreaterThan(6);
    expect(Math.max(...hs)).toBeLessThan(14);
  });

  it('берег чаши: steep круче gentle, smooth как раньше', () => {
    const slope = (bank: string) => {
      const p = TerrainParams.parse({ amplitude: 0, lake: { at: [0, 0], radius: 30, depth: 8 }, bank });
      let worst = 0;
      for (let d = 0; d < 60; d += 0.25) worst = Math.max(worst, Math.abs(terrainHeight(p, d + 0.25, 0) - terrainHeight(p, d, 0)) / 0.25);
      return worst;
    };
    expect(slope('steep')).toBeGreaterThan(slope('smooth') * 1.3);
    expect(slope('gentle')).toBeLessThan(slope('smooth'));
    const old = TerrainParams.parse({ amplitude: 7 }), smooth = TerrainParams.parse({ amplitude: 7, bank: 'smooth' });
    for (const [x, z] in [[3, 4], [58, -4], [40, 10]] as unknown as [number, number][]) expect(terrainHeight(smooth, x, z)).toBe(terrainHeight(old, x, z));
  });

  it('пляж: море — ниже нуля, суша — выше, берег около нуля; поворот shoreAngle переносит море', () => {
    const p = TerrainParams.parse({ style: 'beach', shoreAngle: 270, amplitude: 3 });
    expect(terrainHeight(p, -80, 0)).toBeLessThan(-2); // на -x: море
    expect(terrainHeight(p, 60, 0)).toBeGreaterThan(0.5);
    expect(beachInland(p, -50, 0)).toBeLessThan(0);
    expect(beachInland(p, 50, 0)).toBeGreaterThan(0);
    const q = TerrainParams.parse({ style: 'beach', shoreAngle: 0, amplitude: 3 }); // море на +z
    expect(terrainHeight(q, 0, 80)).toBeLessThan(-2);
    expect(terrainHeight(q, 0, -60)).toBeGreaterThan(0.5);
    // береговая линия по шагу: от моря к суше высота растёт монотонно в среднем (скользящее среднее)
    let prev = -Infinity, ok = true;
    for (let x = -100; x <= 40; x += 10) { const h = terrainHeight(p, x, 0); if (h < prev - 0.35) ok = false; prev = h; }
    expect(ok).toBe(true);
  });

  it('песок по форме: дюны — везде, пляж — у воды, дальше трава; base перебивает', () => {
    const beach = TerrainParams.parse({ style: 'beach', shoreAngle: 270, beachWidth: 14 });
    expect(sandWeight(beach, -40, 0)).toBe(1); // дно
    expect(sandWeight(beach, 6, 0)).toBeGreaterThan(0.9); // пляж
    expect(sandWeight(beach, 70, 0)).toBe(0); // за пляжем — луг
    expect(sandWeight(TerrainParams.parse({ style: 'dunes' }), 3, 3)).toBe(1);
    expect(sandWeight(TerrainParams.parse({ style: 'hills' }), 3, 3)).toBe(0);
    expect(sandWeight(TerrainParams.parse({ style: 'hills', base: 'sand' }), 3, 3)).toBe(1);
    expect(sandWeight(TerrainParams.parse({ style: 'dunes', base: 'meadow' }), 3, 3)).toBe(0);
  });
});

describe('Terrain: земля знает место (карта поверхностей)', () => {
  const pondDoc = () => withTerrain({ ...Terrain.presets!['pond-shore'] }, {}, (s) => { s.world.use('Water', { ...Water.presets!['pond-forest'], at: [0, 0], reach: 60 }); });
  it('вода: расстояние до воды растёт от берега, уровень — уровень воды; воды нет — карта без воды', () => {
    const e = makeEngine(pondDoc());
    const { waters, terrain } = e.sim().services;
    const map = bakeSurfaceMap(preset('pond-shore'), terrain!.size, waters!, [], 256);
    expect(map.hasWater).toBe(true);
    const at = (x: number, z: number) => { const i = Math.floor((x + terrain!.size / 2) / terrain!.size * map.n), j = Math.floor((z + terrain!.size / 2) / terrain!.size * map.n), k = (j * map.n + i) * 4; return { dist: map.data[k + 2]!, level: map.data[k + 3]! }; };
    expect(at(0, 0).dist).toBe(0); // середина пруда — вода
    expect(at(0, 0).level).toBeCloseTo(-0.4, 3);
    const a = at(0, -30).dist, b = at(0, -50).dist;
    expect(a).toBeGreaterThan(1); expect(b).toBeGreaterThan(a);
    const dry = bakeSurfaceMap(preset('desert-dunes'), 240, [], [], 64);
    expect(dry.hasWater).toBe(false);
    expect(dry.data[2]).toBe(40);
  });

  it('подстилка: под деревом выше, чем на лугу; litterArea all — везде; litter 0 — нигде', () => {
    const p = { ...preset('forest-glade') };
    const at = (m: ReturnType<typeof bakeSurfaceMap>, x: number, z: number) => { const i = Math.floor((x + 120) / 240 * m.n), j = Math.floor((z + 120) / 240 * m.n); return m.data[(j * m.n + i) * 4 + 1]!; };
    const m = bakeSurfaceMap(p, 240, [], [{ x: 10, z: 10, r: 5 }], 256);
    expect(at(m, 10, 10)).toBeGreaterThan(0.95);
    expect(at(m, 10, 22)).toBe(0);
    expect(at(m, 14, 10)).toBeGreaterThan(at(m, 17, 10)); // край мягкий: убывает от ствола
    expect(at(bakeSurfaceMap({ ...p, litterArea: 'all' }, 240, [], [], 64), -50, 70)).toBe(1);
    expect(at(bakeSurfaceMap({ ...p, litter: 0 }, 240, [], [{ x: 10, z: 10, r: 5 }], 64), 10, 10)).toBe(0);
  });
});

describe('Terrain: снег и влажность — ручки и связи с силами мира', () => {
  const snowAt = (e: ReturnType<typeof makeEngine>, t: number) => (e.seek(t).world?.terrain as { snow: number } | undefined)?.snow;

  it('снег ложится только в мороз: snow=1 при -6 °C → снег, при +15 → нет', () => {
    expect(frostFactor(-6)).toBe(1); expect(frostFactor(15)).toBe(0);
    const cold = makeEngine(withTerrain({ snow: 1 }, { temperature: -6 }));
    expect(snowAt(cold, 0)).toBe(1);
    const warm = makeEngine(withTerrain({ snow: 1 }, { temperature: 15 }));
    expect(snowAt(warm, 5)).toBe(0);
    expect(snowAt(makeEngine(withTerrain({ snow: 1 }, null)), 5)).toBe(0); // без Forces температура 15: снега нет
  });

  it('snowfall: ляжет за over секунд, thaw: сойдёт; тепло топит то, что лежало', () => {
    const doc = scene((s) => {
      s.world.use('Terrain', { ground: 'surfaces' }); s.world.use('Sky', {});
      s.world.use('Forces', { temperature: -6 });
    });
    const withBehaviour = scene((s) => {
      const t = s.world.use('Terrain', { ground: 'surfaces' }); s.world.use('Sky', {});
      s.world.use('Forces', { temperature: -6 });
      s.at(1).do(t.snowfall({ over: 8 }));
      s.at(20).do(t.thaw({ over: 8 }));
    });
    expect(snowAt(makeEngine(doc), 10)).toBe(0);
    const e = makeEngine(withBehaviour);
    const a = snowAt(e, 5)!, b = snowAt(e, 12)!, c = snowAt(e, 19)!, d = snowAt(e, 34)!;
    expect(a).toBeGreaterThan(0.05); expect(a).toBeLessThan(b); expect(b).toBeGreaterThan(0.9); expect(c).toBeGreaterThan(0.9); expect(d).toBeLessThan(0.1);
    // оттепель: температура поднялась, ручка snow осталась 1 — снег тает сам
    const melt = scene((s) => {
      const t = s.world.use('Terrain', { ground: 'surfaces', snow: 1 }); void t; s.world.use('Sky', {});
      const f = s.world.use('Forces', { temperature: -6 });
      s.at(2).do(f.to('temperature', 8, { over: 2 }));
    });
    const m = makeEngine(melt);
    expect(snowAt(m, 1)).toBe(1); expect(snowAt(m, 4)!).toBeLessThan(0.97); expect(snowAt(m, 18)!).toBeLessThan(0.05);
  });

  it('влажность — ручка: set и to; в отчёте', () => {
    const doc = scene((s) => {
      const t = s.world.use('Terrain', { ground: 'surfaces' }); s.world.use('Sky', {}); s.world.use('Forces', {});
      s.at(1).do(t.to('wetness', 1, { over: 4 }));
    });
    const e = makeEngine(doc);
    const w = (t: number) => (e.seek(t).world?.terrain as { wetness: number }).wetness;
    expect(w(0)).toBe(0); expect(w(3)).toBeGreaterThan(0.2); expect(w(3)).toBeLessThan(0.9); expect(w(6)).toBe(1);
  });

  it('связь с силами мира можно отключить (перебивка): Terrain не слышит температуру', () => {
    const doc = scene((s) => {
      const t = s.world.use('Terrain', { ground: 'surfaces', snow: 1 }); s.world.use('Sky', {}); s.world.use('Forces', { temperature: -6 });
      s.at(0).do(t.unlink('temperature'));
    });
    expect(snowAt(makeEngine(doc), 30)).toBe(0); // нет силы — 15 °C: то, что лежало при открытии, растаяло
  });

  it('детерминизм: seek(t) = проигрывание; два движка дают один хэш', () => {
    const build = scene((s) => {
      const t = s.world.use('Terrain', { ground: 'surfaces' }); s.world.use('Sky', {});
      const f = s.world.use('Forces', { temperature: -6 });
      s.at(2).do(t.snowfall({ over: 6 })); s.at(12).do(f.to('temperature', 6, { over: 3 })); s.at(14).do(t.thaw({ over: 6 }));
    });
    const a = makeEngine(build), b = makeEngine(build);
    const hashes = (e: ReturnType<typeof makeEngine>, ts: number[]) => ts.map((t) => hashWorldState(e.seek(t)));
    const ts = [0, 3, 7.5, 13, 16, 22];
    const h1 = hashes(a, ts), h2 = hashes(b, ts); // два движка
    expect(h1).toEqual(h2);
    // проигрывание шагами = перемотка на то же время
    const p = makeEngine(build);
    for (let i = 0; i < 13 * 60; i++) p.step();
    expect(hashWorldState(p.state())).toBe(hashWorldState(makeEngine(build).seek(13)));
  });
});
