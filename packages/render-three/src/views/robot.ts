import * as THREE from 'three/webgpu';
import { RobotParams, robotDims, type RobotDims, type RobotSelf } from '@cartoon/components';
import { defineView } from '../view.ts';
import { createLook, type Look } from './robot-materials.ts';
import { ANT_SEGS, HAND, LINK, buildRobot, type Parts } from './robot-model.ts';

// Рука сложена вдоль бока: верхнее звено назад, предплечье вперёд (правка последнего круга: у корпуса, не торчит).
const REST = { yaw: 0.0, a1: -0.95, beta: 2.55, wrist: 0 };
const LIFT = 0.012; // м (единичных): покрышки стоят чуть над картой высот
const ANT_REST = 0.07; // рад: собственный изгиб антенны на звено

type Handle = { lightColor: string; parts: Parts; look: Look; d: RobotDims; inv: THREE.Matrix4; tmp: THREE.Vector3; down: THREE.Vector3 };

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
const smooth = (x: number): number => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };

/** Рука: сложена при 0, при 1 — двухзвенный IK до точки, смешивание по углам суставов. */
function arm(h: Handle, s: RobotSelf): void {
  const p = h.parts, r = smooth(s.armReach);
  let yaw = REST.yaw, a1 = REST.a1, beta = REST.beta, wr = REST.wrist;
  if (r > 0.001) {
    // цель в системе корпуса (наклон включён); кисть смотрит вниз в мире
    h.inv.copy(p.chassis.matrixWorld).invert();
    const w = h.tmp.set(s.armTarget[0], s.armTarget[1], s.armTarget[2]).applyMatrix4(h.inv);
    const down = h.down.set(0, -1, 0).transformDirection(h.inv);
    w.addScaledVector(down, -(HAND + 0.006)); // запястье — на ладонь выше точки
    const sd = p.shoulderPos, dx = w.x - (sd.x + 0.004), dy = w.y - sd.y, dz = w.z - sd.z;
    const rho = Math.hypot(dx, dz), L = LINK;
    const D = clamp(Math.hypot(rho, dy), 0.04, 2 * L - 0.004);
    const gam = Math.atan2(rho, -dy);
    const delta = Math.acos(clamp((L * L + D * D - L * L) / (2 * L * D), -1, 1));
    const E = Math.acos(clamp((2 * L * L - D * D) / (2 * L * L), -1, 1));
    const A1 = gam - delta, B = Math.PI - E;
    a1 = REST.a1 + (A1 - REST.a1) * r; beta = REST.beta + (B - REST.beta) * r; wr = REST.wrist + (-(A1 + B) - REST.wrist) * r;
    yaw = REST.yaw + (Math.atan2(dx, dz) - REST.yaw) * r;
  }
  p.shoulder.rotation.set(-a1, yaw, 0, 'YXZ');
  p.elbow.rotation.set(-beta, 0, 0);
  p.wrist.rotation.set(-wr, 0, 0);
  const open = 0.08 + 0.55 * s.grip * (0.3 + 0.7 * r);
  p.fingerA.rotation.z = open;
  p.fingerB.rotation.z = -open;
}

export const RobotView = defineView<Handle>('Robot', {
  mount(three, inst) {
    const params = RobotParams.parse(inst.params), d = robotDims(params);
    const look = createLook(params);
    const parts = buildRobot(look, d);
    parts.root.scale.setScalar(d.scale);
    three.scene.add(parts.root);
    return { lightColor: params.lightColor, parts, look, d, inv: new THREE.Matrix4(), tmp: new THREE.Vector3(), down: new THREE.Vector3() };
  },
  sync(h, s: RobotSelf, _three, state) {
    const p = h.parts, dyn = s.dyn, k = h.d.scale;
    // на земле: высота и наклон считает логика (по высотам под колёсами), вид только ставит
    p.root.position.set(s.pos[0], s.pos[1] + LIFT * k, s.pos[2]);
    p.root.rotation.set(s.pitch, (s.heading * Math.PI) / 180, s.roll, 'YXZ');
    // наклон корпуса, колёса
    p.chassis.rotation.x = dyn.tilt;
    p.wheelL.rotation.x = dyn.wheelL;
    p.wheelR.rotation.x = dyn.wheelR;
    // голова: наклон корпуса частично гасится, глаз остаётся на цели
    p.neckYaw.rotation.y = s.headYaw;
    p.neckPitch.rotation.x = -s.headPitch - dyn.tilt * 0.6;
    p.head.rotation.z = -s.headRoll;
    const u = h.look.u;
    u.open.value = s.lid; u.wide.value = s.wide; u.glow.value = 1 + 0.5 * s.wide;
    u.scan.value = s.scan;
    if (s.lightColor !== h.lightColor) { u.light.value.set(s.lightColor); h.lightColor = s.lightColor; }
    u.ground.value = p.root.position.y - LIFT * k;
    u.t.value = state.t;
    p.beam.visible = s.scan > 0.01;
    // антенна: собственный изгиб плюс хлыст, поровну по звеньям
    p.antenna.forEach((seg, i) => {
      const f = i < ANT_SEGS ? 1 / ANT_SEGS : 0;
      seg.rotation.set(-ANT_REST * (i ? 1 : 0) + dyn.antF * f * 1.4, 0, -dyn.antS * f * 1.4);
    });
    p.root.updateMatrixWorld(true);
    arm(h, s);
    p.root.updateMatrixWorld(true);
  },
  dispose(h, three) {
    three.scene.remove(h.parts.root);
    for (const m of h.parts.meshes) m.geometry.dispose();
    h.look.dispose();
  },
});
