import { describe, expect, it } from 'vitest';
import { hashWorldState, type SceneDoc } from '@cartoon/schema';
import { createEngine, validateAgainstRegistry } from '@cartoon/engine';
import { registry, FilmLook, FILM_LOOK_PRESETS } from '@cartoon/components';
import { buildScene } from '@cartoon/director';
import { cocRadius, cropRect, linearDepth, raysFade, sunScreen } from '../packages/render-three/src/frame/post.ts';
import { resolveFrame } from '../packages/render-three/src/film.ts';
import { loadScene, makeEngine } from './helpers.ts';

describe('пост-эффекты: глубина резкости (задача 1.7)', () => {
  it('cocRadius: резко в зоне фокуса, растёт вне её, потолок = strength·высота/720', () => {
    expect(cocRadius(10, 10, 2, 12, 720)).toBe(0);
    expect(cocRadius(11.9, 10, 2, 12, 720)).toBe(0); // внутри focus ± range
    expect(cocRadius(14, 10, 2, 12, 720)).toBeCloseTo(12 * (2 / 14), 9);
    expect(cocRadius(1e6, 10, 2, 12, 720)).toBeCloseTo(12, 3); // далеко: предел
    expect(cocRadius(1e6, 10, 2, 12, 1080)).toBeCloseTo(18, 3); // масштаб от высоты кадра
    expect(cocRadius(0.5, 10, 2, 12, 720)).toBe(12); // близко: предел, не бесконечность
    expect(cocRadius(50, 10, 2, 0, 720)).toBe(0); // strength 0 — выключено
  });
  it('linearDepth: ближняя и дальняя плоскости', () => {
    expect(linearDepth(0, 0.1, 800)).toBeCloseTo(0.1, 9);
    expect(linearDepth(1, 0.1, 800)).toBeCloseTo(800, 6);
    expect(linearDepth(0.5, 0.1, 800)).toBeGreaterThan(0.1);
  });
});

describe('пост-эффекты: рамка кадра', () => {
  it('none — весь холст', () => expect(cropRect(1920, 1080, 'none')).toEqual([0, 0, 1920, 1080]));
  it('2.39:1 на 16:9: полосы сверху и снизу, края целые и симметричные', () => {
    const [x0, y0, x1, y1] = cropRect(1920, 1080, '2.39:1');
    expect([x0, x1]).toEqual([0, 1920]);
    expect(y1 - y0).toBe(Math.round(1920 / 2.39));
    expect(Math.abs(y0 - (1080 - y1))).toBeLessThanOrEqual(1);
  });
  it('9:16 на 16:9: чёрное справа и слева, центр 9:16', () => {
    const [x0, y0, x1, y1] = cropRect(1920, 1080, '9:16');
    expect([y0, y1]).toEqual([0, 1080]);
    expect(x1 - x0).toBe(Math.round(1080 * 9 / 16));
    expect(Math.abs(x0 - (1920 - x1))).toBeLessThanOrEqual(1);
  });
  it('2.39:1 на вертикальном холсте: полосы сверху и снизу (холст уже кадра)', () => {
    const [x0, y0, x1, y1] = cropRect(1080, 1920, '2.39:1');
    expect([x0, x1]).toEqual([0, 1080]);
    expect(y1 - y0).toBe(Math.round(1080 / 2.39));
    expect(y0 + y1).toBe(1920);
  });
});

describe('пост-эффекты: лучи', () => {
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  // перспектива fov 90°, aspect 1, near 0.1, far 100 (как у three, колонки подряд)
  const P = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -(100.1 / 99.9), -1, 0, 0, -(2 * 100 * 0.1) / 99.9, 0];
  it('солнце прямо по взгляду — в центре кадра', () => {
    const s = sunScreen([0, 0, -1], [0, 0, 0], I, P);
    expect(s.facing).toBe(true);
    expect(s.u).toBeCloseTo(0.5, 6);
    expect(s.v).toBeCloseTo(0.5, 6);
  });
  it('солнце за спиной — не смотрит', () => expect(sunScreen([0, 0, 1], [0, 0, 0], I, P).facing).toBe(false));
  it('выше по взгляду — выше на экране (v меньше, y вниз)', () => expect(sunScreen([0, 0.3, -1], [0, 0, 0], I, P).v).toBeLessThan(0.5));
  it('raysFade: 1 в кадре, 0 далеко за краем, монотонно', () => {
    expect(raysFade(0.5)).toBe(1);
    expect(raysFade(1)).toBe(1);
    expect(raysFade(1.6)).toBe(0);
    expect(raysFade(1.3)).toBeGreaterThan(0);
    expect(raysFade(1.3)).toBeLessThan(1);
  });
});

describe('пост-эффекты: режим fx', () => {
  it('по умолчанию включены, fx:false — выключены', () => {
    expect(resolveFrame().fx).toBe(true);
    expect(resolveFrame({ fx: false }).fx).toBe(false);
  });
});

const sorted = (doc: SceneDoc): SceneDoc => { doc.timeline.sort((a, b) => a.t - b.t); return doc; }; // валидатор требует порядок по t

describe('FilmLook v1 (данные вида плёнки)', () => {
  it('схема: значения по умолчанию, границы и ошибки с путём', () => {
    expect(FilmLook.params.parse({})).toMatchObject({ crop: 'none', warmth: 0.35 });
    const bad = FilmLook.params.safeParse({ crop: '4:3', vignette: 3 });
    expect(bad.success).toBe(false);
  });
  it('пресеты проходят схему', () => {
    for (const [name, p] of Object.entries(FILM_LOOK_PRESETS)) expect(FilmLook.params.safeParse(p).success, name).toBe(true);
  });
  const withLook = (): SceneDoc => {
    const doc = structuredClone(loadScene());
    doc.world.push({ id: 'filmlook', type: 'FilmLook', version: 1, params: { ...FILM_LOOK_PRESETS.neutral } });
    return doc;
  };
  it('действия look и lookPreset меняют только названное; перемотка даёт то же', () => {
    const doc = withLook();
    doc.timeline.push({ id: 'l1', t: 5, target: 'world', action: 'look', args: { vignette: 0.7 } });
    doc.timeline.push({ id: 'l2', t: 9, target: 'world', action: 'lookPreset', args: { name: 'cinema' } });
    const r = validateAgainstRegistry(sorted(doc), registry);
    expect(r.ok, r.ok ? '' : r.errors.join('\n')).toBe(true);
    const e = makeEngine(doc);
    const self = () => e.sim().components['filmlook']!.self as Record<string, unknown>;
    e.seek(6);
    expect(self()).toMatchObject({ vignette: 0.7, warmth: 0, crop: 'none' });
    e.seek(10);
    expect(self()).toMatchObject({ ...FILM_LOOK_PRESETS.cinema });
    e.seek(6); // назад: чекпоинт
    expect(self()).toMatchObject({ vignette: 0.7, crop: 'none' });
  });
  it('вид плёнки не меняет хэш WorldState (это не «что видит ИИ»)', () => {
    const a = makeEngine(), b = makeEngine(withLook());
    for (const t of [0, 7, 30]) expect(hashWorldState(b.seek(t))).toBe(hashWorldState(a.seek(t)));
  });
  it('неверное действие: ошибка с путём', () => {
    const doc = withLook();
    doc.timeline.push({ id: 'l1', t: 5, target: 'world', action: 'lookPreset', args: { name: 'nope' } });
    const r = validateAgainstRegistry(sorted(doc), registry);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join('\n')).toContain('timeline[');
  });
});

describe('камера: глубина резкости (действие camera.focus)', () => {
  const withFocus = (args: Record<string, unknown>, t = 2): SceneDoc => {
    const doc = structuredClone(loadScene());
    doc.timeline.push({ id: 'f1', t, target: 'camera', action: 'focus', args });
    return sorted(doc);
  };
  it('без focus ключа dof нет: хэш WorldState прежний', () => {
    expect(makeEngine().seek(10).camera).not.toHaveProperty('dof');
  });
  it('до события нет, после есть; 8 м — как задано', () => {
    const e = makeEngine(withFocus({ focus: 8, range: 2, strength: 10 }, 5));
    expect(e.seek(4).camera.dof).toBeUndefined();
    expect(e.seek(6).camera.dof).toEqual({ focus: 8, range: 2, strength: 10 });
  });
  it("focus 'target' — расстояние до точки взгляда, следует за камерой", () => {
    const e = makeEngine(withFocus({ focus: 'target', range: 1, strength: 8 }, 0));
    for (const t of [2, 16, 30]) {
      const c = e.seek(t).camera;
      expect(c.dof!.focus).toBeCloseTo(Math.hypot(c.target[0] - c.pos[0], c.target[1] - c.pos[1], c.target[2] - c.pos[2]), 9);
    }
  });
  it('strength 0 выключает; план камеры (shot) фокус не сбрасывает', () => {
    const doc = withFocus({ focus: 10, range: 1, strength: 8 }, 1);
    doc.timeline.push({ id: 'f2', t: 40, target: 'camera', action: 'focus', args: { strength: 0 } });
    const e = makeEngine(sorted(doc));
    expect(e.seek(20).camera.dof).toBeDefined(); // между ними были shot-события (7, 16, 21, 29 с)
    expect(e.seek(41).camera.dof).toBeUndefined();
  });
  it('seek(t) = шаги с нуля (хэш), в том числе с прыжками назад', () => {
    const doc = withFocus({ focus: 'target', range: 1.5, strength: 12 }, 3);
    const a = makeEngine(doc), b = makeEngine(doc);
    const want = new Map<number, string>();
    for (let k = 1; k <= 31 * 60; k++) { const s = a.step(); if (k % 600 === 0 || k === 29.3 * 60) want.set(k, hashWorldState(s)); }
    for (const k of [600, 1200, 1800, 600]) expect(hashWorldState(b.seek(k / 60)), `t=${k / 60}`).toBe(want.get(k));
  });
  it('ошибки: неверные аргументы дают путь', () => {
    for (const args of [{ strength: -1 }, { focus: 'far' }, { range: 'x' }]) {
      const r = validateAgainstRegistry(withFocus(args), registry);
      expect(r.ok, JSON.stringify(args)).toBe(false);
      if (!r.ok) expect(r.errors.join('\n')).toContain('timeline[');
    }
  });
  it('режиссёр: camera.focus, world.look и lookPreset пишут события', () => {
    const doc = buildScene((s) => {
      s.world.use('FilmLook', { ...FILM_LOOK_PRESETS.cinema });
      s.at(2).camera.focus({ focus: 'target', range: 1, strength: 10 });
      s.at(3).world.look({ vignette: 0.5 });
      s.at(4).world.lookPreset('vertical');
    }, { id: 'x', duration: 10 });
    expect(doc.timeline.map((e) => `${e.target}.${e.action}`)).toEqual(['camera.focus', 'world.look', 'world.lookPreset']);
    expect(createEngine({ registry })).toBeDefined();
  });
});
