import { describe, expect, it } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { hashWorldState } from '@cartoon/schema';
import { validateAgainstRegistry } from '@cartoon/engine';
import { buildScene } from '@cartoon/director';
import { registry, Biped, BipedParams, BIPED_PRESETS, CLIPS, CLIP_NAMES } from '@cartoon/components';
import { B, BONES, NB, PARENT, BipedProportions, fk, hipsHeight, restOffsets } from '../packages/components/src/biped/skeleton.ts';
import { cmdStartle, cmdWalkTo, newSim, runPlan, stepSim, tiers, type BipedSim, type Env, type PlanEvent } from '../packages/components/src/biped/sim.ts';
import { makeEngine } from './helpers.ts';

const flat: Env = { heightAt: () => 0, resolve: () => null };
const prop = BipedProportions.parse({});
const fresh = (over: Partial<BipedSim> = {}): BipedSim => Object.assign(newSim(prop, 0, 0, 0), over);

describe('Biped: манифест (правило 7)', () => {
  it('зарегистрирован, версия, описание, примеры, пресеты проходят схему', () => {
    expect(registry.components.Biped).toBe(Biped);
    expect(Biped.version).toBeGreaterThanOrEqual(1);
    expect(Biped.describe.length).toBeGreaterThan(40);
    expect(Biped.examples.length).toBeGreaterThan(2);
    expect(Object.keys(Biped.actions).sort()).toEqual(['lookAround', 'startle', 'stop', 'walkTo']);
    expect(Object.keys(Biped.handles ?? {}).sort()).toEqual(['clip', 'lookAt', 'speed', 'style']);
    for (const [n, p] of Object.entries(BIPED_PRESETS)) expect(BipedParams.safeParse(p).success, n).toBe(true);
    expect(Biped.migrate ?? {}).toBeTypeOf('object');
  });
});

describe('Biped: скелет', () => {
  it('22 кости по VRM, родитель всегда раньше потомка, корень один', () => {
    expect(NB).toBe(22);
    for (const n of ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'leftUpperLeg', 'rightToes', 'leftHand', 'rightShoulder']) expect(BONES).toContain(n);
    for (let i = 1; i < NB; i++) expect(PARENT[i]!).toBeLessThan(i);
    expect(PARENT[0]).toBe(-1);
  });
  it('поза покоя: рост 1,7 м, ступни на земле, левая сторона +X, носки вперёд', () => {
    const rest = restOffsets(prop), wp = new Float64Array(NB * 3), wq = new Float64Array(NB * 4), q = new Float64Array(NB * 4);
    for (let i = 0; i < NB; i++) q[i * 4 + 3] = 1;
    fk(rest, [0, rest[1]!, 0], q, wp, wq);
    expect(wp[B.head * 3 + 1]! + 0.19).toBeCloseTo(1.7, 2);
    expect(wp[B.leftToes * 3 + 1]!).toBeCloseTo(0.02, 2);
    expect(wp[B.leftUpperLeg * 3]!).toBeGreaterThan(0);
    expect(wp[B.rightUpperLeg * 3]!).toBeLessThan(0);
    expect(wp[B.leftToes * 3 + 2]!).toBeGreaterThan(wp[B.leftFoot * 3 + 2]!);
    expect(wp[B.leftHand * 3]!).toBeGreaterThan(0.6);
  });
  it('пропорции — параметры: рост, ноги, руки, плечи меняют кости как должны', () => {
    const base = restOffsets(prop);
    const tall = restOffsets(BipedProportions.parse({ height: 2.0 }));
    expect(hipsHeight(BipedProportions.parse({ height: 2.0 }))).toBeCloseTo((hipsHeight(prop) * 2.0) / 1.7, 6);
    expect(tall[B.chest * 3 + 1]!).toBeGreaterThan(base[B.chest * 3 + 1]!);
    const legs = restOffsets(BipedProportions.parse({ legLength: 1.2 }));
    expect(Math.abs(legs[B.leftLowerLeg * 3 + 1]!)).toBeCloseTo(Math.abs(base[B.leftLowerLeg * 3 + 1]!) * 1.2, 6);
    expect(legs[B.chest * 3 + 1]!).toBeCloseTo(base[B.chest * 3 + 1]!, 9);
    const arms = restOffsets(BipedProportions.parse({ armLength: 1.2 }));
    expect(arms[B.leftLowerArm * 3]!).toBeGreaterThan(base[B.leftLowerArm * 3]!);
    const sh = restOffsets(BipedProportions.parse({ shoulderWidth: 1.4 }));
    expect(sh[B.leftShoulder * 3]!).toBeGreaterThan(base[B.leftShoulder * 3]!);
  });
});

describe('Biped: клипы и права', () => {
  const real = CLIP_NAMES.filter((n) => CLIPS[n]!.base !== 'own');
  it('только разрешённые базы и лицензии; у каждого клипа записаны база, файл, лицензия и автор', () => {
    for (const n of real) {
      const c = CLIPS[n]!;
      expect(['100STYLE', 'Quaternius UAL'], n).toContain(c.base);
      expect(c.license, n).toBe(c.base === '100STYLE' ? 'CC-BY-4.0' : 'CC0-1.0');
      expect(c.source.length, n).toBeGreaterThan(5);
      expect(c.credit.length, n).toBeGreaterThan(10);
      expect(/CMU|AMASS|LAFAN|Bandai|Mixamo/i.test(`${c.name} ${c.source} ${c.credit}`), n).toBe(false);
    }
    for (const base of ['100STYLE', 'Quaternius UAL']) expect(real.filter((n) => CLIPS[n]!.base === base).length, base).toBeGreaterThanOrEqual(3);
  });
  it('кватернионы единичные, повороты конечные, длительность = кадры / частота, петля замкнута', () => {
    for (const n of real) {
      const c = CLIPS[n]!;
      expect(c.q.length).toBe(c.frames * NB * 4);
      for (let i = 0; i < c.q.length; i += 4) expect(Math.abs(Math.hypot(c.q[i]!, c.q[i + 1]!, c.q[i + 2]!, c.q[i + 3]!) - 1), n).toBeLessThan(1e-4);
      expect(c.duration, n).toBeCloseTo(c.loop ? c.frames / c.fps : (c.frames - 1) / c.fps, 2);
      if (c.loop) { // стык: угол между последним кадром и первым не больше шага соседних кадров, умноженного на 3 (+2°)
        let worst = -Infinity;
        for (let b = 0; b < NB; b++) {
          const ang = (f1: number, f2: number) => 2 * Math.acos(Math.min(1, Math.abs(c.q[(f1 * NB + b) * 4]! * c.q[(f2 * NB + b) * 4]! + c.q[(f1 * NB + b) * 4 + 1]! * c.q[(f2 * NB + b) * 4 + 1]! + c.q[(f1 * NB + b) * 4 + 2]! * c.q[(f2 * NB + b) * 4 + 2]! + c.q[(f1 * NB + b) * 4 + 3]! * c.q[(f2 * NB + b) * 4 + 3]!)));
          let step = 0; for (let f = 1; f < c.frames; f++) step = Math.max(step, ang(f - 1, f));
          worst = Math.max(worst, ang(c.frames - 1, 0) - 3 * step - 0.035);
        }
        expect(worst, `${n}: шов петли`).toBeLessThan(0);
      }
    }
  });
  it('все клипы вместе ≤ 5 МБ (в репозитории)', () => {
    expect(statSync(new URL('../packages/components/src/biped/clips/library.json', import.meta.url)).size).toBeLessThan(5 * 1024 * 1024);
  });
  it('у каждого стиля есть простой, шаг и бег; скорость шага меньше бега', () => {
    for (const style of ['ual', 'proud', 'neutral', 'zombie']) { const t = tiers(style); expect(t.walk.vel, style).toBeLessThan(t.run.vel); expect(t.idle.loop).toBe(true); }
  });
  it('THIRD_PARTY_NOTICES и catalog.json называют 100STYLE (CC BY 4.0, авторы) и Quaternius UAL (CC0)', () => {
    const notices = readFileSync(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8');
    expect(notices).toMatch(/100STYLE/); expect(notices).toMatch(/Mason/); expect(notices).toMatch(/CC BY 4\.0/); expect(notices).toMatch(/Quaternius/);
    const cat = JSON.parse(readFileSync(new URL('../sources/catalog.json', import.meta.url), 'utf8')) as { sources: { id: string; license: string }[] };
    expect(cat.sources.find((s) => s.id === '100style')?.license).toBe('CC-BY-4.0');
    expect(cat.sources.find((s) => s.id === 'quaternius-ual')?.license).toBe('CC0-1.0');
  });
});

/** Положение голеностопа в мире после IK и признак «стопа прилипла полностью». */
function footTrack(s: BipedSim, steps: number, per?: (s: BipedSim) => void) {
  const tracks: { x: number; z: number; locked: boolean }[][] = [[], []];
  for (let i = 0; i < steps; i++) {
    per?.(s); stepSim(s, 1 / 60, flat);
    [B.leftFoot, B.rightFoot].forEach((b, k) => tracks[k]!.push({ x: s.joints[b * 3]!, z: s.joints[b * 3 + 2]!, locked: s.feet[k]!.pin && s.feet[k]!.w >= 1 }));
  }
  return tracks;
}
/** Наибольшее смещение стопы от первого кадра непрерывного отрезка опоры, м. */
function worstSlip(tracks: { x: number; z: number; locked: boolean }[][]): { worst: number; runs: number } {
  let worst = 0, runs = 0;
  for (const t of tracks) {
    let start: { x: number; z: number } | null = null;
    for (const p of t) {
      if (p.locked) { if (!start) { start = p; runs++; } worst = Math.max(worst, Math.hypot(p.x - start.x, p.z - start.z)); } else start = null;
    }
  }
  return { worst, runs };
}

describe('Biped: стопа не скользит (IK, опора)', () => {
  it('ходьба 1 м/с по прямой: в фазе опоры стопа смещается ≤ 1 см, опор много', () => {
    const s = fresh({ speed: 1.0 });
    const r = worstSlip(footTrack(s, 600));
    expect(r.runs).toBeGreaterThan(6);
    expect(r.worst).toBeLessThanOrEqual(0.01);
  });
  it('разные скорости и стили (шаг, бег, смесь стилей): ≤ 1 см', () => {
    for (const [a, b, v, w] of [['ual', 'neutral', 0.7, 0.5], ['proud', 'angry', 1.4, 0.3], ['neutral', 'zombie', 0.5, 1], ['ual', 'ual', 3.5, 0]] as const) {
      const s = fresh({ speed: v, styleA: a, styleB: b, style: w });
      const r = worstSlip(footTrack(s, 480));
      expect(r.worst, `${a}/${b} v=${v}`).toBeLessThanOrEqual(0.01);
    }
  });
  it('удивление: пока опора держит стопу, она неподвижна (≤ 1 см)', () => {
    const s = fresh({ speed: 1.1 });
    const r = worstSlip(footTrack(s, 900, (x) => { if (Math.abs(x.t - 3) < 1e-6 || (x.t > 2.99 && x.t < 3.01 && x.startleT < 0)) cmdStartle(x); }));
    expect(r.worst).toBeLessThanOrEqual(0.01);
  });
  it('на склоне стопа стоит на земле: высота голеностопа над землёй в опоре в пределах 2 см от покоя', () => {
    const slope: Env = { heightAt: (x, z) => 0.18 * z + 0.05 * Math.sin(x), resolve: () => null };
    const s = fresh({ speed: 0.9 });
    const dy: number[] = [];
    for (let i = 0; i < 600; i++) {
      stepSim(s, 1 / 60, slope);
      [B.leftFoot, B.rightFoot].forEach((b, k) => { const f = s.feet[k]!; if (f.pin && f.w >= 1) dy.push(s.joints[b * 3 + 1]! - slope.heightAt(f.px, f.pz) - 0.07); });
    }
    expect(dy.length).toBeGreaterThan(100);
    expect(Math.max(...dy.map(Math.abs))).toBeLessThan(0.06); // подъём обеих стоп по тому же склону: допуск шире, чем на ровном
  });
});

const hashSim = (s: BipedSim): string => JSON.stringify([s.joints.map((v) => Math.round(v * 1e6)), s.hipsW, s.v, s.phase]);

describe('Biped: детерминизм и seek', () => {
  const init = () => fresh({ styleA: 'proud', styleB: 'angry' });
  const events: PlanEvent[] = [
    { t: 0.2, do: (s) => { s.speed = 1.2; } },
    { t: 1.0, do: (s) => { s.style = 0.6; } },
    { t: 2.5, do: (s) => cmdStartle(s) },
    { t: 6.0, do: (s) => { s.clip = 's100.proud.run'; } },
    { t: 8.0, do: (s) => cmdWalkTo(s, 3, 6, 1.4) },
  ];
  it('перемотка в случайном порядке совпадает с проигрыванием подряд', () => {
    const times = [4.1, 0.5, 9.9, 2.6, 7.0, 3.3, 1.0, 5.8, 8.4, 0.0, 6.5];
    const seq = new Map<number, string>();
    const s = init();
    const ev = [...events].sort((a, b) => a.t - b.t);
    let k = 0;
    const want = new Set(times.map((t) => Math.round(t * 60)));
    for (let i = 0; i <= 600; i++) {
      if (want.has(i)) seq.set(i, hashSim(s));
      while (k < ev.length && ev[k]!.t <= i / 60 + 1e-9) ev[k++]!.do(s);
      stepSim(s, 1 / 60, flat);
    }
    for (const t of times) expect(hashSim(runPlan(init, events, t, flat)), `t=${t}`).toBe(seq.get(Math.round(t * 60)));
    for (const t of [...times].reverse()) expect(hashSim(runPlan(init, events, t, flat)), `rev t=${t}`).toBe(seq.get(Math.round(t * 60)));
  });
  it('два запуска дают одно и то же; состояние переживает structuredClone и JSON', () => {
    const a = runPlan(init, events, 5, flat), b = runPlan(init, events, 5, flat);
    expect(hashSim(a)).toBe(hashSim(b));
    expect(JSON.parse(JSON.stringify(a))).toEqual(structuredClone(a));
    const c = structuredClone(a); for (let i = 0; i < 60; i++) { stepSim(a, 1 / 60, flat); stepSim(c, 1 / 60, flat); }
    expect(hashSim(c)).toBe(hashSim(a));
  });
  it('в движке: случайный seek сцены с Biped совпадает со свежим движком (хэши мира)', () => {
    const doc = buildScene((s) => {
      s.places({ a: [0, 0, 0], b: [3, 0, 4] });
      const p = s.add('Biped', { styleA: 'proud', styleB: 'zombie' }, { at: 'a', heading: 90 });
      s.at(0.2).do(p.set('speed', 1.1));
      s.at(1).do(p.to('style', 1, { over: 3 }));
      s.at(3).do(p.startle({}));
      s.at(7).do(p.walkTo({ to: 'b', speed: 1.3 }));
      s.at(9).do(p.lookAround({}));
    }, { id: 't', duration: 14, seed: 4 });
    const r = validateAgainstRegistry(doc, registry);
    expect(r.ok, r.ok ? '' : r.errors.join('\n')).toBe(true);
    const Ts = [6, 2, 12.5, 0.5, 9.5, 4, 13, 8, 1.5];
    const want = new Map(Ts.map((T) => [T, hashWorldState(makeEngine(doc).seek(T))]));
    const used = makeEngine(doc);
    for (const T of Ts) expect(hashWorldState(used.seek(T)), `T=${T}`).toBe(want.get(T));
    for (const T of [...Ts].reverse()) expect(hashWorldState(used.seek(T)), `rev T=${T}`).toBe(want.get(T));
  });
});

describe('Biped: сборка движений', () => {
  const speedAt = (s: BipedSim) => s.v;
  it('скорость: стоит → шагает → бежит, плавно, без скачков положения', () => {
    const s = fresh({ speed: 0 });
    let prev = [s.x, s.z], worst = 0;
    for (let i = 0; i < 720; i++) {
      if (i === 60) s.speed = 0.9; if (i === 360) s.speed = 2.5;
      stepSim(s, 1 / 60, flat);
      worst = Math.max(worst, Math.hypot(s.x - prev[0]!, s.z - prev[1]!) * 60 - speedAt(s)); prev = [s.x, s.z];
    }
    expect(s.v).toBeCloseTo(2.5, 1);
    expect(worst).toBeLessThan(0.05);
  });
  it('смешивание стилей: вес 0 даёт styleA, вес 1 — styleB, 0,5 — между', () => {
    const pose = (w: number, a = 'proud', b = 'zombie') => { const s = fresh({ speed: 1, styleA: a, styleB: b, style: w }); for (let i = 0; i < 300; i++) stepSim(s, 1 / 60, flat); return s; };
    const dist = (p: BipedSim, q: BipedSim) => Math.hypot(...p.joints.map((v, i) => v - q.joints[i]!));
    const A0 = pose(0), A1 = pose(1), M = pose(0.5), Aonly = pose(0, 'proud', 'angry');
    // фаза общая, но шаг стилей разный: стиль B при w=1 отличается от A; контроль — «B не влияет при w=0»
    expect(dist(A0, Aonly)).toBeLessThan(1e-9);
    expect(dist(A0, A1)).toBeGreaterThan(0.05);
    expect(dist(A0, M)).toBeGreaterThan(0.01);
    expect(dist(M, A1)).toBeGreaterThan(0.01);
  });
  it('склейка шаг → бег: переход 0,3 с; таз и курс не прыгают, суставы идут плавно', () => {
    const s = fresh({ clip: 's100.proud.walk' });
    let prev: number[] | null = null, worst = 0, yawJump = 0;
    for (let i = 0; i < 420; i++) {
      if (i === 150) s.clip = 's100.proud.run';
      const y = s.yaw; stepSim(s, 1 / 60, flat); yawJump = Math.max(yawJump, Math.abs(s.yaw - y));
      const rel = s.joints.map((v, k) => v - s.hipsW[k % 3]!);
      if (prev) worst = Math.max(worst, ...rel.map((v, k) => Math.abs(v - prev![k]!)));
      prev = rel;
    }
    expect(yawJump).toBe(0);
    expect(worst).toBeLessThan(0.1); // за 1/60 с любой сустав относительно таза смещается < 10 см (скачок колена/IK дал бы 30 см)
    expect(s.v).toBeCloseTo(CLIPS['s100.proud.run']!.vel * (0.94 / 0.94), 1);
  });
  it('удивление: замедлился → замер → отшатнулся → огляделся', () => {
    const s = fresh({ speed: 1.1 });
    for (let i = 0; i < 240; i++) stepSim(s, 1 / 60, flat);
    expect(s.v).toBeCloseTo(1.1, 2);
    cmdStartle(s); s.speed = 0;
    const log: { t: number; v: number; headBack: number; lean: number; headYaw: number; handsUp: number }[] = [];
    for (let i = 0; i < 480; i++) {
      stepSim(s, 1 / 60, flat);
      const f = Math.sin(s.yaw), g = Math.cos(s.yaw);
      const rel = (b: number) => (s.joints[b * 3]! - s.hipsW[0]!) * f + (s.joints[b * 3 + 2]! - s.hipsW[2]!) * g;
      const latHead = (s.ends[0]! - s.joints[B.head * 3]!) * g - (s.ends[2]! - s.joints[B.head * 3 + 2]!) * f;
      log.push({ t: (i + 1) / 60, v: s.v, headBack: rel(B.head), lean: rel(B.neck), headYaw: latHead, handsUp: s.joints[B.leftHand * 3 + 1]! });
    }
    const at = (t: number) => log[Math.round(t * 60) - 1]!;
    expect(at(0.7).v).toBe(0); // замедлился и замер (до отшатывания)
    expect(at(0.7).headBack).toBeGreaterThan(-0.05);
    const rec = at(0.9 + 0.35); // отшатнулся: голова/шея уходят назад относительно таза
    expect(rec.lean).toBeLessThan(at(0.7).lean - 0.02);
    expect(rec.handsUp).toBeGreaterThan(at(0.7).handsUp + 0.05); // руки к груди (кисть выше, чем у бедра)
    const sweepMax = Math.max(...log.filter((l) => l.t > 2.0 && l.t < 4.6).map((l) => Math.abs(l.headYaw)));
    expect(sweepMax).toBeGreaterThan(0.02); // огляделся: голова повернулась
    expect(Math.abs(log[log.length - 1]!.headYaw)).toBeLessThan(0.02); // и вернулась
  });
  it('взгляд: lookAt на точку поворачивает голову к ней, пустая строка — прямо', () => {
    const env: Env = { heightAt: () => 0, resolve: (r) => (r === 'left' ? [3, 1.5, 0.5] : null) };
    const s0 = fresh(); for (let i = 0; i < 90; i++) stepSim(s0, 1 / 60, env);
    const base = Math.abs(s0.ends[0]! - s0.joints[B.head * 3]!); // собственный наклон головы в стойке
    const s = fresh({ lookAt: 'left' });
    for (let i = 0; i < 90; i++) stepSim(s, 1 / 60, env);
    const dx = s.ends[0]! - s.joints[B.head * 3]!;
    expect(dx).toBeGreaterThan(0.02); // голова смотрит в +X (персонаж лицом в +Z, цель слева)
    s.lookAt = '';
    for (let i = 0; i < 90; i++) stepSim(s, 1 / 60, env);
    expect(Math.abs(s.ends[0]! - s.joints[B.head * 3]!)).toBeLessThan(base + 0.012);
  });
  it('walkTo: приходит в точку и останавливается; рост и ноги масштабируют шаг', () => {
    const s = fresh({ styleA: 'ual', styleB: 'ual' });
    cmdWalkTo(s, 2, 4, 1.4);
    for (let i = 0; i < 60 * 9; i++) stepSim(s, 1 / 60, flat);
    expect(Math.hypot(s.x - 2, s.z - 4)).toBeLessThan(0.1);
    expect(s.v).toBe(0);
    const tall = newSim(BipedProportions.parse({ height: 2.1, legLength: 1.15 }), 0, 0, 0); tall.speed = 1; tall.styleA = tall.styleB = 'ual';
    const small = newSim(BipedProportions.parse({ height: 1.2, legLength: 0.85 }), 0, 0, 0); small.speed = 1; small.styleA = small.styleB = 'ual';
    for (let i = 0; i < 300; i++) { stepSim(tall, 1 / 60, flat); stepSim(small, 1 / 60, flat); }
    expect(tall.phase).not.toBeCloseTo(small.phase, 3); // у длинноногого шаг длиннее: при той же скорости темп шагов ниже
  });
});
