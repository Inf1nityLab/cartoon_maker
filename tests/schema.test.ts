import { describe, expect, it } from 'vitest';
import { migrate, validateFilmDoc, validateSceneDoc, type SceneDoc } from '@cartoon/schema';
import { validateAgainstRegistry, layout, toSceneTime, toFilmTime } from '@cartoon/engine';
import { registry } from '@cartoon/components';
import { buildScene } from '@cartoon/director';
import { loadScene, readJson, sceneFiles } from './helpers.ts';

const text = (r: { ok: boolean; errors?: string[] }) => (r.ok ? '' : r.errors!.join('\n'));

describe('схема: ошибки понятны (тест 3)', () => {
  it('невалидная структура — с путём', () => {
    const doc: any = structuredClone(loadScene());
    doc.settings.fps = 24;
    delete doc.places;
    const t = text(validateSceneDoc(doc));
    expect(t).toMatch(/settings\.fps/);
    expect(t).toMatch(/places/);
  });

  it('ссылки внутри документа', () => {
    const doc = structuredClone(loadScene());
    doc.timeline.push({ id: 'x', t: 1, target: 'ghost', action: 'stop', args: {} });
    doc.entities.spider!.spawn.at = 'nowhere';
    const t = text(validateSceneDoc(doc));
    expect(t).toMatch(/нет места «nowhere»/);
    expect(t).toMatch(/нет сущности «ghost»/);
    expect(t).toMatch(/отсортирован/);
  });

  it('параметры и аргументы событий — по реестру, с путём и значением', () => {
    const bad = buildScene((s) => {
      s.world.use('Terrain');
      s.places({ meadow: [0, 0, 0] });
      const sp = s.add('Multiped', { color: 'red', legs: 99 }, { at: 'meadow' });
      s.at(0).do(sp.walkTo({ to: 'lakeShore', speed: 12 }), sp.fly({}));
      s.at(1).camera.shot('closeup', { target: sp, distance: -3 });
    }, { id: 'bad', duration: 10 });
    const t = text(validateAgainstRegistry(bad, registry));
    expect(t).toMatch(/entities\.multiped1\.params\.color: цвет — hex-строка/);
    expect(t).toMatch(/entities\.multiped1\.params\.legs: должен быть не больше 12, получено 99/);
    expect(t).toMatch(/timeline\[0\]\.args\.speed: должен быть не больше 5, получено 12/);
    expect(t).toMatch(/timeline\[0\]\.args\.to: нет места или сущности «lakeShore»/);
    expect(t).toMatch(/«fly» не существует/);
    expect(t).toMatch(/timeline\[2\]\.args\.distance: должен быть не меньше 0.5, получено -3/);
  });

  it('фильм: ссылки на сцены', () => {
    const film: any = structuredClone(readJson('scenes/film-01.json'));
    expect(validateFilmDoc(film).ok).toBe(true);
    film.acts[0].sceneIds.push('s9');
    film.scenes[0].link = 'continue';
    const t = text(validateFilmDoc(film));
    expect(t).toMatch(/нет сцены «s9»/);
    expect(t).toMatch(/у первой сцены не может быть continue/);
  });
});

describe('миграции (тест 4)', () => {
  it('все сцены из scenes/ проходят migrate + validate', () => {
    expect(sceneFiles().length).toBeGreaterThan(0);
    for (const f of sceneFiles()) {
      const doc = migrate(readJson(`scenes/${f}`));
      expect(text(validateAgainstRegistry(doc, registry)), f).toBe('');
    }
  });

  it('цепочка работает: старая версия доезжает до текущей', () => {
    const old: any = { ...structuredClone(loadScene()), schema: 'scene@0', name: 'Старое имя' };
    delete old.title;
    const chain = { 'scene@0': { to: 'scene@1', run: (d: any) => { const { name, ...rest } = d; return { ...rest, title: name }; } } };
    const out: SceneDoc = migrate(old, chain);
    expect(out.schema).toBe('scene@1');
    expect(out.title).toBe('Старое имя');
  });

  it('неизвестная версия — понятная ошибка', () => {
    expect(() => migrate({ schema: 'scene@99' })).toThrow(/scene@99/);
  });
});

describe('раскладка фильма', () => {
  const film: any = readJson('scenes/film-01.json');
  const mk = (kinds: [string, number][]) => ({
    ...film,
    scenes: kinds.map(([kind, d], i) => ({ id: `s${i + 1}`, sceneDocId: `d${i + 1}`, title: '', summary: '', link: 'cut', transition: { kind, duration: d } })),
  });
  it('начало считается само: удлинил сцену — следующие сдвинулись', () => {
    const f = mk([['cut', 0], ['fade', 2], ['cut', 0]]);
    expect(layout(f, { d1: 10, d2: 20, d3: 5 })).toEqual([
      { sceneId: 's1', start: 0, end: 10 }, { sceneId: 's2', start: 8, end: 28 }, { sceneId: 's3', start: 28, end: 33 },
    ]);
    expect(layout(f, { d1: 14, d2: 20, d3: 5 })[2]!.start).toBe(32);
  });
  it('время фильма ↔ время сцены', () => {
    const slots = layout(mk([['cut', 0], ['cut', 0]]), { d1: 10, d2: 20 });
    expect(toSceneTime(slots, 4)).toEqual({ sceneId: 's1', t: 4 });
    expect(toSceneTime(slots, 12)).toEqual({ sceneId: 's2', t: 2 });
    expect(toFilmTime(slots, 's2', 2)).toBe(12);
  });
});
