// Вторичное движение робота: наклон корпуса на колёсах (демпфированная пружина по ускорению), хлыст антенны
// (слабо демпфированная пружина по ускорению головы) и качение колёс (путь без проскальзывания).
// Порт утверждённой динамики песочницы. Шагает на сетке движка 1/60 с, всё состояние — числа в `self`,
// поэтому входит в чекпоинты, а seek(t) = проигрывание.

export const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
export const wrapPi = (a: number): number => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
export const smooth = (e0: number, e1: number, x: number): number => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

const TILT_GAIN = 0.12; // рад наклона на м/с² ускорения
const TILT_MAX = 0.3;
const TILT_W = 11; // рад/с: собственная частота наклона
const TILT_ZETA = 0.38; // демпфирование: ~28 % перелёта, когда ускорение кончилось
const ANT_W = 15;
const ANT_ZETA = 0.16;
const ANT_GAIN = 0.16; // рад изгиба на м/с² ускорения головы

/** Числа динамики: входят в состояние компонента (сериализуемо). Углы — радианы. */
export type Dyn = {
  tilt: number; tv: number; // наклон корпуса (+ вперёд) и его скорость
  antF: number; fv: number; // изгиб антенны вперёд и скорость
  antS: number; sv: number; // вбок (+ влево) и скорость
  wheelL: number; wheelR: number; // углы качения колёс (+ вперёд)
};
export const newDyn = (): Dyn => ({ tilt: 0, tv: 0, antF: 0, fv: 0, antS: 0, sv: 0, wheelL: 0, wheelR: 0 });

export type DynInput = {
  speed: number; accel: number; // м/с, м/с²
  yawRate: number; yawAcc: number; // рад/с, рад/с² (поворот корпуса)
  headAcc: number; // рад/с² (поворот головы относительно корпуса)
  wheelR: number; halfTrack: number; headH: number; // м, в реальных размерах
};

/** Один шаг динамики на dt. */
export function stepDyn(c: Dyn, i: DynInput, dt: number): void {
  const target = clamp(i.accel * TILT_GAIN + i.speed * 0.01, -TILT_MAX, TILT_MAX);
  const ta = TILT_W * TILT_W * (target - c.tilt) - 2 * TILT_ZETA * TILT_W * c.tv;
  c.tv += ta * dt;
  c.tilt += c.tv * dt;
  // ускорение основания антенны в системе робота: корпус, голова на наклоне, центростремительное и касательное
  const aF = i.accel + i.headH * ta;
  const aS = i.speed * i.yawRate + 0.05 * clamp(i.yawAcc + i.headAcc, -60, 60);
  const spring = (v: number, vel: number, a: number): [number, number] => {
    const acc = ANT_W * ANT_W * (-ANT_GAIN * a - v) - 2 * ANT_ZETA * ANT_W * vel;
    const nv = vel + acc * dt;
    return [clamp(v + nv * dt, -0.9, 0.9), nv];
  };
  [c.antF, c.fv] = spring(c.antF, c.fv, aF);
  [c.antS, c.sv] = spring(c.antS, c.sv, aS);
  // левый поворот: левое колесо медленнее
  c.wheelL += ((i.speed - i.yawRate * i.halfTrack) / i.wheelR) * dt;
  c.wheelR += ((i.speed + i.yawRate * i.halfTrack) / i.wheelR) * dt;
}
