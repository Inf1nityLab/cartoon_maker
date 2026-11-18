import { describe, expect, it } from 'vitest';
import { hashWorldState } from '@cartoon/schema';
import { buildScene } from '@cartoon/director';
import { makeEngine } from './helpers.ts';

describe('seek: перемотка назад = проигрывание с нуля (ручки в снимке)', () => {
  it('to по ручке после перемотки назад не залипает', () => {
    const doc = buildScene((s) => {
      const f = s.world.use('Forces', { temperature: 6 });
      s.at(12).do(f.to('temperature', -6, { over: 2 }));
    }, { id: 't', duration: 30, seed: 5 });
    for (const T of [0, 5, 13, 22]) {
      const fresh = makeEngine(doc).seek(T);
      const used = makeEngine(doc);
      used.seek(22);
      const back = used.seek(T);
      expect(hashWorldState(back), `T=${T}`).toBe(hashWorldState(fresh));
    }
  });

  it('случайный порядок seek по сцене с несколькими ручками даёт те же хэши, что свежий движок', () => {
    const doc = buildScene((s) => {
      const f = s.world.use('Forces', { temperature: 6, windStrength: 4 });
      const sky = s.world.use('Sky', { elevation: 10, azimuth: 180 });
      const look = s.world.use('FilmLook', {});
      s.places({ a: [0, 0, 0] });
      const r = s.add('Robot', {}, { at: 'a' });
      s.at(2).do(f.to('temperature', -6, { over: 4 }), sky.to('elevation', 50, { over: 10 }));
      s.at(4).do(look.set('crop', '9:16'), r.unlink('wind'));
      s.at(6).do(f.gust({ strength: 9, duration: 4 }));
      s.at(9).do(look.to('warmth', -0.5, { over: 3 }), r.link('wind'));
      s.at(14).do(f.calm({ over: 3 }), sky.set('elevation', 20));
      s.at(20).do(r.unlink('light'));
    }, { id: 't', duration: 30, seed: 5 });
    const Ts = [22, 3, 15, 0, 29, 12.5, 1, 7, 21, 5, 0.5, 29.5, 10];
    const want = new Map(Ts.map((T) => [T, hashWorldState(makeEngine(doc).seek(T))]));
    const used = makeEngine(doc);
    for (const T of Ts) expect(hashWorldState(used.seek(T)), `T=${T}`).toBe(want.get(T));
    for (const T of [...Ts].reverse()) expect(hashWorldState(used.seek(T)), `rev T=${T}`).toBe(want.get(T));
  });
});
