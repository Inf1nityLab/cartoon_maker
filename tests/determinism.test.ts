import { describe, expect, it } from 'vitest';
import { hashWorldState } from '@cartoon/schema';
import { loadScene, makeEngine } from './helpers.ts';

describe('детерминизм (тест 1)', () => {
  it('сцена 01 дважды → одинаковый хэш WorldState на каждой целой секунде', () => {
    const a = makeEngine(), b = makeEngine();
    for (let t = 0; t <= 60; t++) expect(hashWorldState(a.seek(t)), `t=${t}`).toBe(hashWorldState(b.seek(t)));
  });

  it('seek(t) для 0.5, 7, 29.3, 59 даёт тот же хэш, что шаги с нуля (тест 2)', () => {
    const stepper = makeEngine();
    const wanted = new Map([0.5, 7, 29.3, 59].map((t) => [Math.round(t * 60), t]));
    const byStep = new Map<number, string>();
    for (let k = 1; k <= 59 * 60; k++) {
      const s = stepper.step();
      if (wanted.has(k)) byStep.set(k, hashWorldState(s));
    }
    const jumper = makeEngine();
    // прыжки вперёд-назад: чекпоинты обязаны давать тот же результат
    for (const t of [59, 7, 29.3, 0.5, 29.3, 59, 0.5]) {
      expect(hashWorldState(jumper.seek(t)), `seek(${t})`).toBe(byStep.get(Math.round(t * 60)));
    }
  });

  it('другой seed даёт другой мир, тот же — тот же', () => {
    const doc = loadScene();
    const other = structuredClone(doc);
    other.world[0]!.params = { ...other.world[0]!.params, seed: 8 };
    const h = (d: typeof doc) => hashWorldState(makeEngine(d).seek(10));
    expect(h(doc)).toBe(h(structuredClone(doc)));
    expect(h(other)).not.toBe(h(doc));
  });
});

describe('мир', () => {
  it('паук идёт по петле, шоты сменяются, в кадре виден паук', () => {
    const e = makeEngine();
    expect(e.seek(3).camera.shot).toBe('establishing');
    expect(e.seek(3).entities.spider!.action).toBe('walking');
    expect(e.seek(8).camera.shot).toBe('follow');
    expect(e.seek(28).entities.spider!.action).toBe('standing');
    const w = e.seek(31);
    expect(w.camera.shot).toBe('closeup');
    expect(w.inFrame).toContain('spider');
    expect(e.seek(60).sun.elevation).toBeCloseTo(0.6, 1);
  });

  it('камера никогда не под землёй, паук не в воде', () => {
    const e = makeEngine();
    for (let t = 0; t <= 60; t += 0.5) {
      const w = e.seek(t);
      const sim = e.sim();
      expect(w.camera.pos[1], `камера t=${t}`).toBeGreaterThan(sim.services.heightAt(w.camera.pos[0], w.camera.pos[2]));
      const p = w.entities.spider!.pos;
      expect(p[1], `паук t=${t}`).toBeGreaterThan(sim.services.waterLevel);
    }
  });

  it('все места лежат выше воды', () => {
    const doc = loadScene();
    const e = makeEngine(doc);
    for (const id of Object.keys(doc.places)) {
      const p = e.sim().components; void p;
      const [x, , z] = doc.places[id]!;
      expect(e.sim().services.heightAt(x, z), id).toBeGreaterThan(e.sim().services.waterLevel);
    }
  });
});
