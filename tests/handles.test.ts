import { describe, expect, it } from 'vitest';
import { hashWorldState } from '@cartoon/schema';
import { evalTrack, applySteps, easeValue, mixHex, handleInfos, validateAgainstRegistry, type Track } from '@cartoon/engine';
import { registry, Sky, FilmLook, Robot, Forces } from '@cartoon/components';
import { buildScene, type Director } from '@cartoon/director';
import { makeEngine } from './helpers.ts';

const scene = (fn: (s: Director) => void, duration = 20) => buildScene(fn, { id: 't', duration, seed: 5 });
const errors = (doc: unknown) => { const r = validateAgainstRegistry(doc, registry); return r.ok ? '' : r.errors.join('\n'); };

describe('ручки: кривые', () => {
  const elevationAt = (ease: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'step') => {
    const doc = scene((s) => {
      const sky = s.world.use('Sky', { elevation: 10, azimuth: 180 });
      s.at(1).do(sky.to('elevation', 50, { over: 10, ease }));
    });
    const e = makeEngine(doc);
    // 5 точек кривой: начало, четверть, середина, три четверти, конец (событие на 1-й секунде, over: 10)
    return [1, 3.5, 6, 8.5, 11].map((t) => e.seek(t).sun.elevation);
  };

  it('to(…, { over: 10, ease }) даёт ожидаемые значения в 5 точках', () => {
    const k = [0, 0.25, 0.5, 0.75, 1];
    const want = (f: (x: number) => number) => k.map((x) => 10 + 40 * f(x));
    expect(elevationAt('linear')).toEqual(want((x) => x).map((v) => expect.closeTo(v, 6)));
    expect(elevationAt('ease-in')).toEqual(want((x) => x * x).map((v) => expect.closeTo(v, 6)));
    expect(elevationAt('ease-out')).toEqual(want((x) => 1 - (1 - x) ** 2).map((v) => expect.closeTo(v, 6)));
    expect(elevationAt('ease-in-out')).toEqual(want((x) => (x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) ** 2)).map((v) => expect.closeTo(v, 6)));
    // step: держит старое до конца отрезка, потом прыгает
    expect(elevationAt('step')).toEqual([10, 10, 10, 10, 50].map((v) => expect.closeTo(v, 6)));
  });

  it('seek в середину кривой = проигрывание с нуля', () => {
    const doc = scene((s) => {
      const sky = s.world.use('Sky', { elevation: 10 });
      const look = s.world.use('FilmLook', {});
      s.at(1).do(sky.to('elevation', 50, { over: 10, ease: 'ease-in-out' }), look.to('warmth', -0.5, { over: 6 }));
      s.at(4).do(look.set('crop', '9:16'));
    });
    const played = makeEngine(doc), hashes = new Map<number, string>();
    for (let k = 1; k <= 12 * 60; k++) { const w = played.step(); if (k % 30 === 0 || k === 333) hashes.set(k, hashWorldState(w)); }
    const jumper = makeEngine(doc);
    for (const k of [333, 720, 90, 360, 90, 330]) expect(hashWorldState(jumper.seek(k / 60)), `seek ${k}`).toBe(hashes.get(k));
    const mid = jumper.seek(333 / 60);
    expect(mid.handles?.sky?.elevation).toBeGreaterThan(10);
    expect(mid.handles?.sky?.elevation).toBeLessThan(50);
  });

  it('новая команда обрывает идущую кривую и стартует от текущего значения', () => {
    const doc = scene((s) => {
      const sky = s.world.use('Sky', { elevation: 0 });
      s.at(0).do(sky.to('elevation', 40, { over: 10, ease: 'linear' }));
      s.at(5).do(sky.to('elevation', 0, { over: 5, ease: 'linear' }));
    });
    const e = makeEngine(doc);
    expect(e.seek(5).handles!.sky!.elevation).toBeCloseTo(20, 6);
    expect(e.seek(7.5).handles!.sky!.elevation).toBeCloseTo(10, 6);
    expect(e.seek(10).handles!.sky!.elevation).toBeCloseTo(0, 6);
  });

  it('чистые функции: easeValue, смешивание цветов, дорожка', () => {
    expect(easeValue('ease-in-out', 0.5)).toBe(0.5);
    expect(mixHex('#000000', '#ff8000', 0.5)).toBe('#804000');
    const tr: Track = { base: 0, segs: [] };
    applySteps(tr, 2, 'number', [{ to: 10, over: 2, ease: 'linear' }, { to: 0, over: 2, ease: 'linear' }]); // «порыв»: подъём и спад
    expect([2, 3, 4, 5, 6, 9].map((t) => evalTrack(tr, t, 'number'))).toEqual([0, 5, 10, 5, 0, 0]);
  });
});

describe('ручки: сразу, цвет, список, схема', () => {
  it('set меняет значение с момента команды; цвет идёт по кривой; список — скачком', () => {
    const doc = scene((s) => {
      s.places({ a: [0, 0, 0] });
      s.world.use('Terrain', { style: 'flat' });
      const look = s.world.use('FilmLook', { vignette: 0.1 });
      const r = s.add('Robot', {}, { at: 'a', id: 'robot' });
      s.at(2).do(look.set('vignette', 0.9), look.set('crop', '2.39:1'));
      s.at(3).do(r.to('lightColor', '#ff0000', { over: 2, ease: 'linear' }));
    });
    const e = makeEngine(doc);
    expect(e.seek(1.9).handles).toBeUndefined();
    const w = e.seek(2.1);
    expect(w.handles!.filmlook).toEqual({ vignette: 0.9, crop: '2.39:1' });
    expect((e.sim().components.filmlook!.self as any).vignette).toBe(0.9);
    expect(e.seek(4).handles!.robot!.lightColor).toBe(mixHex('#59fff3', '#ff0000', 0.5));
    expect((e.sim().components.robot!.self as any).lightColor).toBe(mixHex('#59fff3', '#ff0000', 0.5));
    expect(e.seek(6).handles!.robot!.lightColor).toBe('#ff0000');
  });

  it('диапазон, единицы и описание берутся из схемы', () => {
    const info = handleInfos(Forces);
    expect(Object.keys(info).sort()).toEqual(['cloudiness', 'fog', 'gustBoost', 'gustiness', 'moonPhase', 'temperature', 'time', 'windDirection', 'windStrength']);
    expect(info.time).toMatchObject({ kind: 'number', unit: 'ч', min: 0, max: 96, default: 12 }); // Б5: ручка time шире параметра (0–24): больше 24 — следующие сутки, to(time, 26) = к 02:00
    expect(info.time!.describe).toMatch(/время суток/);
    expect(handleInfos(Robot).lightColor).toMatchObject({ kind: 'color', default: '#59fff3' });
    expect(handleInfos(FilmLook).crop).toMatchObject({ kind: 'step', options: ['none', '2.39:1', '9:16'] });
    expect(handleInfos(Sky).elevation).toMatchObject({ min: -10, max: 90, unit: '°' });
  });

  it('ошибки: нет такой ручки, значение вне диапазона, неверный цвет, нет компонента', () => {
    const bad = scene((s) => {
      s.places({ a: [0, 0, 0] });
      const f = s.world.use('Forces', {});
      const r = s.add('Robot', {}, { at: 'a', id: 'robot' });
      s.at(1).do(f.set('windStrength', 99), f.to('wind', 3), r.set('lightColor', 'red'), r.set('bodyColor', '#ffffff'));
    });
    const t = errors(bad);
    expect(t).toMatch(/ручка Forces\.windStrength \(м\/с\): должен быть не больше 30, получено 99/);
    expect(t).toMatch(/у Forces нет ручки «wind»\. Есть: time, windDirection/);
    expect(t).toMatch(/Robot\.lightColor: цвет — hex-строка #rrggbb, получено "red"/);
    expect(t).toMatch(/у Robot нет ручки «bodyColor»/);
    const noComp = scene((s) => { s.at(1).do({ target: 'ghost', action: 'handle.set', args: { handle: 'x', value: 1 } }); });
    expect(errors(noComp)).toMatch(/нет сущности «ghost»/);
  });

  it('старые действия FilmLook и Sky идут через ручки, но в WorldState не попадают (хэши сцен прежние)', () => {
    const doc = scene((s) => {
      const sky = s.world.use('Sky', { elevation: 9 });
      s.world.use('FilmLook', {});
      s.at(1).world.look({ vignette: 0.7 });
      s.at(2).world.lookPreset('neutral');
      s.at(3).world.sun({ elevation: 1, duration: 4 });
      void sky;
    });
    const e = makeEngine(doc);
    const w = e.seek(5);
    expect(w.handles).toBeUndefined();
    expect((e.sim().components.filmlook!.self as any)).toMatchObject({ vignette: 0, warmth: 0, crop: 'none' });
    expect(w.sun.elevation).toBeCloseTo(9 + (1 - 9) * 0.5, 6);
  });
});

describe('настроения и перебивка', () => {
  it('настроение — набор изменений ручек разных объектов, применяется одной командой', () => {
    const doc = scene((s) => {
      s.places({ a: [0, 0, 0] });
      const f = s.world.use('Forces', {});
      const look = s.world.use('FilmLook', {});
      const r = s.add('Robot', {}, { at: 'a', id: 'robot' });
      s.mood('alarm', [f.to('time', 22, { over: 4, ease: 'linear' }), look.set('vignette', 0.8), r.set('lightColor', '#ff3030')]);
      s.at(2).mood('alarm');
    });
    expect(doc.timeline.map((e) => `${e.target}:${e.action}:${e.args.mood}`)).toEqual(['forces:handle.to:alarm', 'filmlook:handle.set:alarm', 'robot:handle.set:alarm']);
    expect(errors(doc)).toBe('');
    const w = makeEngine(doc).seek(4);
    expect(w.handles!.forces!.time).toBeCloseTo(17, 6);
    expect(w.handles!.filmlook!.vignette).toBe(0.8);
    expect(w.handles!.robot!.lightColor).toBe('#ff3030');
  });

  it('настроение принимает только команды ручек', () => {
    expect(() => scene((s) => { s.places({ a: [0, 0, 0] }); const r = s.add('Robot', {}, { at: 'a' }); s.mood('x', [r.blink({})]); })).toThrow(/можно только set, to, link, unlink/);
  });

  it('перебивка: отключённая связь видна в WorldState и возвращается по link', () => {
    const doc = scene((s) => {
      s.places({ a: [0, 0, 0] });
      s.world.use('Forces', { windStrength: 12, windDirection: 0, gustiness: 0 });
      const r = s.add('Robot', {}, { at: 'a', id: 'robot', heading: 0 });
      s.at(4).do(r.unlink('wind'));
      s.at(8).do(r.link('wind'));
    });
    const e = makeEngine(doc);
    expect(Math.abs((e.seek(3).entities.robot!.antenna as number[])[0]!)).toBeGreaterThan(5);
    expect(e.seek(6).unlinked).toEqual({ robot: ['wind'] });
    expect(Math.abs((e.seek(7).entities.robot!.antenna as number[])[0]!)).toBeLessThan(0.5);
    const back = e.seek(10);
    expect(back.unlinked).toBeUndefined();
    expect(Math.abs((back.entities.robot!.antenna as number[])[0]!)).toBeGreaterThan(5);
  });
});
