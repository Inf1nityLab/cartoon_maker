import { describe, expect, it } from 'vitest';
import { hashWorldState } from '@cartoon/schema';
import { validateAgainstRegistry } from '@cartoon/engine';
import { registry, Robot, RobotParams, ROBOT_PRESETS, robotDims } from '@cartoon/components';
import { buildScene } from '@cartoon/director';
import { loadScene, makeEngine } from './helpers.ts';

const robotScene = () => loadScene('test-robot.json');
const text = (r: { ok: boolean; errors?: string[] }) => (r.ok ? '' : r.errors!.join('\n'));
const robotOf = (w: { entities: Record<string, any> }) => w.entities.robot!;

describe('Robot: манифест компонента (правило 7)', () => {
  it('зарегистрирован, с типом, версией, описанием и примерами', () => {
    expect(registry.components.Robot).toBe(Robot);
    expect(Robot.type).toBe('Robot');
    expect(Robot.version).toBeGreaterThanOrEqual(1);
    expect(Robot.describe.length).toBeGreaterThan(20);
    expect(Robot.examples.length).toBeGreaterThan(0);
    expect(Robot.migrate ?? {}).toBeTypeOf('object');
  });

  it('действия: полный набор, у каждого есть схема и пример в examples', () => {
    const names = ['roll', 'turn', 'stop', 'look', 'tilt', 'blink', 'squint', 'wide', 'scan', 'reach', 'startle'];
    expect(Object.keys(Robot.actions).sort()).toEqual([...names].sort());
    for (const n of ['roll', 'look', 'blink', 'reach', 'scan', 'startle']) expect(Robot.examples.join('\n'), n).toContain(`robot.${n}(`);
  });

  it('пресет «explorer» проходит схему и равен значениям по умолчанию (утверждённый облик)', () => {
    expect(Object.keys(ROBOT_PRESETS)).toContain('explorer');
    for (const [name, p] of Object.entries(ROBOT_PRESETS)) expect(RobotParams.safeParse(p).success, name).toBe(true);
    expect(Robot.presets).toBe(ROBOT_PRESETS);
    expect(ROBOT_PRESETS.explorer).toEqual(RobotParams.parse({}));
    const d = robotDims(ROBOT_PRESETS.explorer!);
    expect(d.scale).toBeCloseTo(1, 12); // рост 0.335 м = размеры песочницы 1:1
    expect(d.wheelR).toBeCloseTo(0.07, 12);
  });

  it('состояние сериализуемо: structuredClone и JSON без потерь, WorldState — только числа, строки, массивы', () => {
    const e = makeEngine(robotScene());
    const w = e.seek(9);
    const self = e.sim().components.robot!.self;
    expect(JSON.parse(JSON.stringify(self))).toEqual(structuredClone(self));
    const walk = (v: unknown, path: string): void => {
      if (typeof v === 'object' && v !== null) {
        expect(Object.getPrototypeOf(v) === Object.prototype || Array.isArray(v), path).toBe(true);
        for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
      } else expect(['number', 'string', 'boolean', 'object'], path).toContain(typeof v); // object здесь — null
    };
    walk(self, 'self');
    walk(w, 'state');
  });

  it('параметры по умолчанию и пропорции: рост задаёт масштаб, колёса — диаметр', () => {
    const big = robotDims(RobotParams.parse({ height: 0.67 }));
    expect(big.scale).toBeCloseTo(2, 12);
    const wide = robotDims(RobotParams.parse({ wheelDiameter: 1.5 }));
    expect(wide.wheelR).toBeCloseTo(0.105, 12);
  });
});

describe('Robot: ошибки параметров — понятные, с путём', () => {
  const scene = (params: Record<string, unknown>, act?: (s: any, r: any) => void) =>
    buildScene((s) => {
      s.world.use('Terrain', { style: 'flat' });
      s.places({ a: [0, 0, 0], b: [1, 0, 0] });
      const r = s.add('Robot', params, { at: 'a' });
      act?.(s, r);
    }, { id: 'bad', duration: 10 });

  it('roll.speed вне диапазона', () => {
    const t = text(validateAgainstRegistry(scene({}, (s, r) => s.at(2).do(r.roll({ to: 'b', speed: 12 }))), registry));
    expect(t).toMatch(/timeline\[0\]\.args\.speed: должен быть не больше 3, получено 12/);
  });

  it('несколько ошибок разом: колёса, цвет, рост, неизвестное действие, неизвестная цель', () => {
    const t = text(validateAgainstRegistry(scene({ bodyColor: 'white', height: 9, wheelDiameter: 0.1 }, (s, r) => {
      s.at(1).do(r.roll({ to: 'nowhere', accel: 0 }), r.fly({}), r.blink({ duration: 5 }));
    }), registry));
    expect(t).toMatch(/entities\.robot1\.params\.bodyColor: цвет — hex-строка/);
    expect(t).toMatch(/entities\.robot1\.params\.height: должен быть не больше 3, получено 9/);
    expect(t).toMatch(/entities\.robot1\.params\.wheelDiameter: должен быть не меньше 0.5, получено 0.1/);
    expect(t).toMatch(/timeline\[0\]\.args\.to: нет места или сущности «nowhere»/);
    expect(t).toMatch(/timeline\[0\]\.args\.accel: должен быть не меньше 0.1, получено 0/);
    expect(t).toMatch(/«fly» не существует у «robot1»/);
    expect(t).toMatch(/timeline\[2\]\.args\.duration: должен быть не больше 1, получено 5/);
  });

  it('turn без цели и поворот головы за пределом', () => {
    const t = text(validateAgainstRegistry(scene({}, (s, r) => { s.at(1).do(r.turn({}), r.look({ yaw: 200 })); }), registry));
    expect(t).toMatch(/timeline\[0\]\.args\.to: нужно задать одно из двух: to \(точка\) или heading \(градусы\)/);
    expect(t).toMatch(/timeline\[1\]\.args\.yaw: должен быть не больше 110, получено 200/);
  });

  it('валидная сцена — без ошибок', () => {
    const ok = scene({}, (s, r) => s.at(1).do(r.roll({ to: 'b' }), r.look({ target: 'camera' }), r.scan({}), r.reach({ to: null }), r.startle({})));
    expect(text(validateAgainstRegistry(ok, registry))).toBe('');
  });
});

describe('Robot: детерминизм и seek (тесты 1–2 для test-robot)', () => {
  it('два запуска — одинаковый хэш WorldState на каждой секунде', () => {
    const a = makeEngine(robotScene()), b = makeEngine(robotScene());
    for (let t = 0; t <= 16; t++) expect(hashWorldState(a.seek(t)), `t=${t}`).toBe(hashWorldState(b.seek(t)));
  });

  it('seek(t) для разных t (разгон, торможение, взгляд, рука, луч, разворот) = проигрывание с нуля', () => {
    const times = [0.5, 2.0, 4.9, 5.3, 6.4, 8.7, 10.8, 12.9, 15.0];
    const stepper = makeEngine(robotScene());
    const wanted = new Map(times.map((t) => [Math.round(t * 60), t]));
    const byStep = new Map<number, string>();
    for (let k = 1; k <= 15 * 60; k++) {
      const s = stepper.step();
      if (wanted.has(k)) byStep.set(k, hashWorldState(s));
    }
    const jumper = makeEngine(robotScene());
    for (const t of [15, 5.3, 12.9, 0.5, 8.7, 2.0, 10.8, 15, 6.4, 4.9]) {
      expect(hashWorldState(jumper.seek(t)), `seek(${t})`).toBe(byStep.get(Math.round(t * 60)));
    }
  });
});

describe('Robot: поведение', () => {
  it('выезжает, разгоняется, тормозит ровно в точке и стоит', () => {
    const e = makeEngine(robotScene());
    expect(robotOf(e.seek(1)).action).toBe('standing');
    const mid = robotOf(e.seek(3.5));
    expect(mid.action).toBe('rolling');
    expect(mid.speed).toBeCloseTo(1, 2);
    const end = robotOf(e.seek(6.5));
    expect(end.pos[0]).toBeCloseTo(1.8, 6);
    expect(end.pos[2]).toBeCloseTo(0, 6);
    expect(end.speed).toBe(0);
  });

  it('корпус наклоняется вперёд на разгоне и откидывается на торможении, потом выравнивается', () => {
    const e = makeEngine(robotScene());
    expect(robotOf(e.seek(2.0)).tilt).toBeGreaterThan(4);
    expect(robotOf(e.seek(4.0)).tilt).toBeLessThan(2); // крейсер: почти ровно
    expect(robotOf(e.seek(5.3)).tilt).toBeLessThan(-5);
    expect(Math.abs(robotOf(e.seek(7.5)).tilt)).toBeLessThan(0.5);
  });

  it('колёса катятся по пройденному пути: угол × радиус = путь', () => {
    const e = makeEngine(robotScene());
    const w = robotOf(e.seek(6.5));
    const r = robotDims(RobotParams.parse({})).wheelR, path = 1.8 + 1.5;
    for (const deg of w.wheels as number[]) expect(Math.abs((deg * Math.PI) / 180 * r - path)).toBeLessThan(0.01); // остаток — подтяжка в точку на последних миллиметрах
  });

  it('антенна гнётся при разгоне и успокаивается', () => {
    const e = makeEngine(robotScene());
    expect(Math.abs(robotOf(e.seek(1.75)).antenna[0])).toBeGreaterThan(5);
    expect(Math.abs(robotOf(e.seek(3.6)).antenna[0])).toBeLessThan(2);
  });

  it('голова: взгляд влево-вправо, глаз: моргание и прищур, рука и луч, разворот на 270°', () => {
    const e = makeEngine(robotScene());
    expect(robotOf(e.seek(6.4)).headYaw).toBeGreaterThan(60);
    expect(robotOf(e.seek(7.3)).headYaw).toBeLessThan(-60);
    expect(robotOf(e.seek(8.1)).eyeOpen).toBeLessThan(0.7); // моргание в 7.95
    expect(robotOf(e.seek(8.8)).eyeOpen).toBeLessThan(0.45); // прищур с 8.5
    expect(robotOf(e.seek(9.7)).eyeWide).toBeGreaterThan(0.9);
    const arm = robotOf(e.seek(11.4));
    expect(arm.armReach).toBe(1);
    expect(arm.armTarget[1]).toBeCloseTo(0, 6); // кисть тянется к земле
    expect(robotOf(e.seek(13.0)).scan).toBeGreaterThan(0.95);
    expect(robotOf(e.seek(14.9)).scan).toBe(0);
    const fin = robotOf(e.seek(17));
    expect(fin.heading).toBeCloseTo(270, 6);
    expect(fin.action).toBe('standing');
  });

  it('startle: откидывает корпус, расширяет зрачок, потом отпускает', () => {
    const doc = buildScene((s) => {
      s.world.use('Terrain', { style: 'flat' });
      s.places({ a: [0, 0, 0] });
      const r = s.add('Robot', {}, { at: 'a', id: 'robot' });
      s.at(1).do(r.startle({ intensity: 1 }));
    }, { id: 'st', duration: 5 });
    const e = makeEngine(validateAgainstRegistry(doc, registry).ok ? doc : doc);
    const before = robotOf(e.seek(0.9));
    const w = robotOf(e.seek(1.15));
    expect(w.action).toBe('startled');
    expect(w.tilt).toBeLessThan(before.tilt - 3);
    expect(robotOf(e.seek(1.4)).eyeWide).toBeGreaterThan(0.8);
    expect(robotOf(e.seek(4)).eyeWide).toBeLessThan(0.05);
  });

  it('на рельефе робот стоит на земле и наклоняется по склону', () => {
    const doc = buildScene((s) => {
      s.world.use('Terrain', { style: 'hills', seed: 7 });
      s.places({ a: [10, 0, 10], b: [20, 0, 18] });
      const r = s.add('Robot', {}, { at: 'a', id: 'robot' });
      s.at(0).do(r.roll({ to: 'b', speed: 1 }));
    }, { id: 'hill', duration: 15, seed: 7 });
    const e = makeEngine(doc);
    for (let t = 0; t <= 14; t += 1) {
      const w = e.seek(t), p = robotOf(w).pos;
      const h = e.sim().services.heightAt(p[0], p[2]);
      expect(Math.abs(p[1] - h), `t=${t}`).toBeLessThan(0.15); // колёса на ширине базы: высота — среднее по ним
    }
  });
});
