import { describe, expect, it } from 'vitest';
import { hashWorldState } from '@cartoon/schema';
import { validateAgainstRegistry, handleInfos } from '@cartoon/engine';
import { registry, Tree, TreeParams, TREE_PRESETS, SPECIES, RECIPES, ezOptions, ageScale, ageStage } from '@cartoon/components';
import { buildScene, type Director } from '@cartoon/director';
import { makeEngine } from './helpers.ts';

type Fn = (s: Director, tree: any, forces: any) => void;
const scene = (params: Record<string, unknown> = {}, forces: Record<string, unknown> | null = { windStrength: 0, gustiness: 0 }, more: Fn = () => {}, seed = 9) =>
  buildScene((s) => {
    s.world.use('Terrain', { style: 'flat' });
    const f = forces ? s.world.use('Forces', forces) : null;
    s.places({ a: [0, 0, 0] });
    const t = s.add('Tree', params, { at: 'a', id: 'tree', heading: 20 });
    more(s, t, f);
  }, { id: 'tree-test', duration: 40, seed });
const tree = (w: { entities: Record<string, any> }) => w.entities.tree!;

describe('Tree: манифест, схема, пресеты (правило 7)', () => {
  it('зарегистрирован, версия, описание, примеры, ручки', () => {
    expect(registry.components.Tree).toBe(Tree);
    expect(Tree.version).toBe(1);
    expect(Tree.describe.length).toBeGreaterThan(50);
    expect(Tree.examples.length).toBeGreaterThan(0);
    expect(Object.keys(handleInfos(Tree)).sort()).toEqual(['age', 'season', 'shed', 'snow', 'windSensitivity']);
    expect(Object.keys(Tree.actions)).toEqual(['shedLeaves']);
  });

  it('есть все породы из задания и ива; каждый пресет проходит схему и зовёт свою породу', () => {
    for (const n of ['oak', 'ash', 'aspen', 'birch', 'pine', 'spruce', 'bush1', 'bush2', 'bush3', 'willow']) expect(TREE_PRESETS[n], n).toBeDefined();
    expect(Object.keys(TREE_PRESETS).sort()).toEqual([...SPECIES].sort());
    for (const [n, p] of Object.entries(TREE_PRESETS)) { expect(TreeParams.safeParse(p).success, n).toBe(true); expect(p.species).toBe(n); }
  });

  it('у параметров есть описание с единицами и диапазон (из схемы)', () => {
    const js = JSON.stringify(handleInfos(Tree));
    expect(js).toContain('листопад');
    for (const h of Object.values(handleInfos(Tree))) { expect(h.describe.length, h.name).toBeGreaterThan(10); expect(h.min).toBeDefined(); expect(h.max).toBeDefined(); }
  });

  it('ошибки параметров понятные, с путём', () => {
    const r = validateAgainstRegistry(scene({ species: 'baobab', height: 500, leafColor: 'green', season: 2 }), registry);
    expect(r.ok).toBe(false);
    const t = r.ok ? '' : r.errors.join('\n');
    expect(t).toMatch(/entities\.tree\.params\.species/);
    expect(t).toMatch(/entities\.tree\.params\.height: должен быть не больше 60, получено 500/);
    expect(t).toMatch(/entities\.tree\.params\.leafColor: цвет — hex-строка/);
    expect(t).toMatch(/entities\.tree\.params\.season/);
  });

  it('рецепт ez-tree: чистые данные, ступень возраста уменьшает уровни, ветви и листья; seed и ручки структуры доходят', () => {
    const p = TREE_PRESETS.oak!;
    const full = ezOptions(p, 2) as any, young = ezOptions(p, 0) as any;
    expect(full.branch.levels).toBe(3);
    expect(young.branch.levels).toBe(1);
    expect((ezOptions(p, 1) as any).branch.levels).toBe(2);
    expect(young.branch.children['0']).toBeLessThan(full.branch.children['0']);
    expect(young.leaves.count).toBeLessThan(full.leaves.count);
    expect(full.seed).toBe(p.seed);
    const thick = ezOptions({ ...p, trunk: 2, spread: 10, leafSize: 2 }, 2) as any;
    expect(thick.branch.radius['0']).toBeCloseTo(full.branch.radius['0'] * 2, 9);
    expect(thick.branch.angle['1']).toBe(full.branch.angle['1'] + 10);
    expect(thick.leaves.size).toBeCloseTo(full.leaves.size * 2, 9);
    expect(JSON.parse(JSON.stringify(full))).toEqual(full);
    expect(RECIPES.pine.evergreen && RECIPES.spruce.evergreen && !RECIPES.oak.evergreen).toBe(true);
    expect([ageStage(0), ageStage(0.2), ageStage(0.5)]).toEqual([0, 1, 2]);
  });
});

describe('Tree: возраст и сезон', () => {
  it('возраст: саженец → взрослое → старое, рост монотонно', () => {
    const h = (age: number) => tree(makeEngine(scene({ height: 12, age })).seek(0)).height as number;
    expect(h(0)).toBeCloseTo(12 * 0.12, 6);
    expect(h(0.5)).toBeCloseTo(12, 6);
    expect(h(1)).toBeCloseTo(12 * 1.12, 6);
    expect(h(0.25)).toBeGreaterThan(h(0)); expect(h(0.25)).toBeLessThan(h(0.5));
    expect(ageScale(0.1)).toBeLessThan(ageScale(0.3));
  });

  it('сезон: густота листвы весна → лето → осень → голое; цвет жёлтеет; вечнозелёные не облетают', () => {
    const at = (season: number, species = 'oak') => tree(makeEngine(scene({ species, season, leafColor: '#5a9433', autumnColor: '#d98a1c' })).seek(0));
    const d = [0, 0.3, 0.4, 0.6, 0.8, 1].map((x) => at(x).leafDensity as number);
    expect(d[0]).toBeLessThan(d[1]!); // весной почки
    expect(d[1]).toBeCloseTo(1, 6);
    expect(d[3]).toBeGreaterThan(0.95);
    expect(d[4]).toBeLessThan(0.5);
    expect(d[5]).toBeLessThan(0.01);
    expect(at(0.3).autumn).toBe(0); expect(at(0.4).autumn).toBeGreaterThan(0); expect(at(0.6).autumn).toBeCloseTo(1, 6);
    expect(at(1, 'pine').leafDensity).toBeCloseTo(1, 6);
    expect(at(1, 'spruce').autumn).toBe(0);
  });

  it('ручки age/season/shed — кривая и поведение shedLeaves; seek = проигрывание', () => {
    const doc = scene({ season: 0.3 }, null, (s, t) => {
      s.at(1).do(t.to('season', 0.58, { over: 4, ease: 'linear' }));
      s.at(6).do(t.shedLeaves({ over: 4 }));
    });
    expect(validateAgainstRegistry(doc, registry).ok).toBe(true);
    const e = makeEngine(doc);
    expect(tree(e.seek(0.9)).autumn).toBe(0);
    expect(tree(e.seek(3)).autumn).toBeGreaterThan(0.2);
    const d = [5.9, 7, 8, 9, 10.5].map((t) => tree(e.seek(t)).leafDensity as number);
    for (let i = 1; i < d.length; i++) expect(d[i]!).toBeLessThan(d[i - 1]! + 1e-9);
    expect(d[4]).toBeLessThan(0.05);
    let h = ''; const played = makeEngine(doc);
    for (let k = 1; k <= 8 * 60; k++) h = hashWorldState(played.step());
    expect(hashWorldState(makeEngine(doc).seek(8))).toBe(h);
  });
});

describe('Tree слушает ветер и температуру', () => {
  const gustScene = (species: string, extra: Record<string, unknown> = {}) => scene({ species, height: 12, ...extra }, { windStrength: 3, windDirection: 90, gustiness: 0 }, (_s, _t, f) => { _s.at(2).do(f.gust({ strength: 10, duration: 3 })); });
  const peak = (species: string, extra: Record<string, unknown> = {}) => {
    const e = makeEngine(gustScene(species, extra)); let m = 0;
    for (let t = 1; t <= 12; t += 0.1) m = Math.max(m, tree(e.seek(t)).sway as number);
    return m;
  };

  it('нет ветра — нет качания; ветер на +x гнёт верхушку на +x', () => {
    expect(tree(makeEngine(scene()).seek(5)).sway).toBe(0);
    const w = tree(makeEngine(scene({}, { windStrength: 8, windDirection: 90, gustiness: 0 })).seek(8));
    expect(w.swayX).toBeGreaterThan(0.05);
    expect(Math.abs(w.swayZ)).toBeLessThan(1e-6);
  });

  it('порыв: качание растёт, потом затухает колебаниями; берёза качается сильнее дуба (числа амплитуды)', () => {
    const e = makeEngine(gustScene('birch'));
    const series = [1.9, 2.6, 3.2, 4, 5, 8].map((t) => +(tree(e.seek(t)).swayX as number).toFixed(3));
    expect(series[2]!).toBeGreaterThan(series[0]! + 0.05);
    expect(series[5]!).toBeLessThan(series[2]!);
    const birch = peak('birch'), oak = peak('oak'), pine = peak('pine'), aspen = peak('aspen');
    console.log(`амплитуда верхушки в порыве 3→13 м/с, м (рост 12 м): берёза ${birch.toFixed(3)}, осина ${aspen.toFixed(3)}, дуб ${oak.toFixed(3)}, сосна ${pine.toFixed(3)}`);
    expect(birch).toBeGreaterThan(oak * 2);
    expect(aspen).toBeGreaterThan(oak);
    expect(oak).toBeGreaterThan(pine);
  });

  it('windSensitivity: 0 не качается, больше — сильнее; перебивка link wind снимает ветер', () => {
    expect(peak('oak', { windSensitivity: 0 })).toBe(0);
    expect(peak('oak', { windSensitivity: 2 })).toBeGreaterThan(peak('oak', { windSensitivity: 1 }) * 1.5);
    const doc = scene({}, { windStrength: 8, windDirection: 90, gustiness: 0 }, (s, t) => { s.at(5).do(t.unlink('wind')); });
    const e = makeEngine(doc);
    expect(tree(e.seek(4)).sway).toBeGreaterThan(0.05);
    expect(tree(e.seek(12)).sway).toBeLessThan(0.01);
  });

  it('снег ложится только в мороз и тает в тепле', () => {
    const snowAt = (temperature: number, t = 12) => tree(makeEngine(scene({ snow: 1 }, { temperature, windStrength: 0 })).seek(t)).snow as number;
    expect(snowAt(-8)).toBeCloseTo(1, 6);
    expect(snowAt(15)).toBe(0);
    const doc = scene({ snow: 1 }, { temperature: -8, windStrength: 0 }, (_s, _t, f) => { _s.at(10).do(f.to('temperature', 8, { over: 2 })); _s.at(1).do(_t.to('snow', 1, { over: 1 })); });
    const e = makeEngine(doc);
    expect(tree(e.seek(9)).snow).toBeCloseTo(1, 4);
    expect(tree(e.seek(25)).snow).toBeLessThan(0.1);
    // снег накапливается по ручке: из чистого дерева за секунды
    const grow = scene({ snow: 0 }, { temperature: -8, windStrength: 0 }, (s, t) => { s.at(2).do(t.to('snow', 1, { over: 3 })); });
    const g = makeEngine(grow);
    expect(tree(g.seek(1)).snow).toBe(0);
    expect(tree(g.seek(6)).snow).toBeGreaterThan(0.5);
  });
});

describe('Tree: детерминизм', () => {
  it('два запуска с ветром — один хэш; другой seed сцены (ветер) — другой', () => {
    const mk = (seed: number) => scene({ species: 'aspen' }, { windStrength: 6, gustiness: 0.6 }, () => {}, seed);
    const a = hashWorldState(makeEngine(mk(9)).seek(7)), b = hashWorldState(makeEngine(mk(9)).seek(7)), c = hashWorldState(makeEngine(mk(10)).seek(7));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
  it('состояние — только числа, строки, массивы (чекпоинты)', () => {
    const e = makeEngine(scene({}, { windStrength: 5 }));
    e.seek(3);
    const self = e.sim().components.tree!.self;
    expect(JSON.parse(JSON.stringify(self))).toEqual(structuredClone(self));
  });
});
