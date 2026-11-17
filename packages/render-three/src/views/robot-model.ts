// Сборка робота из примитивов (метры, +y вверх, +z вперёд, +x влево от робота): яйцевидный корпус из двух оболочек на оси
// с двумя большими колёсами, короткая ребристая шея, круглая голова с ОДНИМ большим глазом (ободок, утопленная линза с
// радужкой и зрачком, стекло, блики), ушные датчики, пружинная антенна, рука из двух звеньев с захватом и конус луча.
// Модель в «единичных» размерах (рост 1:1 с пресетом «Исследователь»); пропорции — из robotDims(params), до реального
// роста её доводит масштаб корня. Статичные части склеены по родителю и материалу: сустав двигает группу, а не меши.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { RobotDims } from '@cartoon/components';
import type { Look } from './robot-materials.ts';

export const ANT_SEGS = 6;
const ANT_LEN = 0.0155;
const EYE = { hole: 0.04, rimZ: 0.0518, lensZ: 0.034, apex: 0.059, domeA: 0.0385, domeEdgeZ: 0.0455 };
/** Звенья руки, плечо и кисть (единичные м; плечо и высота корпуса зависят от пропорций). */
export const LINK = 0.13;
export const HAND = 0.045;
/** Колесо в утверждённом облике: радиус и полуширина покрышки до масштаба диаметром. */
const W_R = 0.07, W_HW = 0.0275;

export type Parts = {
  root: THREE.Group; chassis: THREE.Group; wheelL: THREE.Group; wheelR: THREE.Group;
  neckYaw: THREE.Group; neckPitch: THREE.Group; head: THREE.Group; beam: THREE.Mesh; antenna: THREE.Group[];
  shoulder: THREE.Group; elbow: THREE.Group; wrist: THREE.Group; fingerA: THREE.Group; fingerB: THREE.Group;
  blob: THREE.Mesh; halo: THREE.Mesh; meshes: THREE.Mesh[]; shoulderPos: { x: number; y: number; z: number };
};

function lathe(pts: [number, number][], seg = 56): THREE.LatheGeometry {
  return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0004), y)), seg);
}

type AddOpts = { p?: [number, number, number]; r?: [number, number, number]; s?: number | [number, number, number]; solid?: boolean; order?: number; name?: string };

/** Добавляет меш в родителя; безымянные склеиваются по родителю и материалу при flush(), именованные остаются отдельно. */
function adder() {
  const all: THREE.Mesh[] = [];
  const buckets = new Map<string, { parent: THREE.Object3D; mat: THREE.Material; o: AddOpts; geos: THREE.BufferGeometry[] }>();
  const make = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, o: AddOpts): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    if (o.p) m.position.set(...o.p);
    if (o.r) m.rotation.set(...o.r);
    if (o.s !== undefined) { if (typeof o.s === 'number') m.scale.setScalar(o.s); else m.scale.set(...o.s); }
    if (o.solid !== false) m.castShadow = m.receiveShadow = true;
    if (o.order !== undefined) m.renderOrder = o.order;
    if (o.name) m.name = o.name;
    m.frustumCulled = false; // части двигаются относительно корня
    parent.add(m);
    all.push(m);
    return m;
  };
  return {
    all,
    add(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, o: AddOpts = {}): THREE.Mesh {
      if (o.name) return make(parent, geo, mat, o);
      const t = new THREE.Object3D();
      if (o.p) t.position.set(...o.p);
      if (o.r) t.rotation.set(...o.r);
      if (o.s !== undefined) { if (typeof o.s === 'number') t.scale.setScalar(o.s); else t.scale.set(...o.s); }
      t.updateMatrix();
      const key = `${parent.uuid}|${mat.uuid}|${o.solid !== false}|${o.order ?? ''}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { parent, mat, o: { solid: o.solid, order: o.order }, geos: [] }));
      b.geos.push(geo.clone().applyMatrix4(t.matrix));
      return null as unknown as THREE.Mesh; // наружу отдаются только именованные
    },
    flush() {
      for (const b of buckets.values()) make(b.parent, b.geos.length === 1 ? b.geos[0]! : mergeGeometries(b.geos)!, b.mat, b.o);
      buckets.clear();
    },
  };
}

const node = (parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Group => {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
};

/** Колесо (ось x, наружу +x): покрышка, протектор, ступица, кольцо света и винты — отдельными геометриями для склейки. */
function wheelGeometry() {
  const R = W_R, hw = W_HW, dy = hw - 0.02, q = (g: THREE.BufferGeometry): THREE.BufferGeometry => (g.rotateZ(-Math.PI / 2), g);
  const arc = (cx: number, cy: number, r: number, a0: number, a1: number): [number, number][] =>
    Array.from({ length: 6 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / 5; return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as [number, number]; });
  const c = 0.0075;
  const tyre = q(lathe([[0.046, -hw], [R - c, -hw], ...arc(R - c, -hw + c, c, -Math.PI / 2, 0), ...arc(R - c, hw - c, c, 0, Math.PI / 2), [0.046, hw]], 64));
  const lug: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 22; i++) {
    for (const sx of [-1, 1]) {
      const g = new THREE.BoxGeometry(0.0165, 0.0055, 0.0105);
      g.translate(sx * 0.0128, R + 0.0003, 0);
      g.rotateX((i / 22) * Math.PI * 2 + (sx > 0 ? 0.07 : 0));
      lug.push(g);
    }
  }
  const groove = new THREE.TorusGeometry(R + 0.0003, 0.0014, 6, 72);
  groove.rotateY(Math.PI / 2);
  const hub = q(lathe([[0.0475, 0.008 + dy], [0.047, 0.016 + dy], [0.04, 0.0205 + dy], [0.028, 0.0235 + dy], [0.012, 0.0245 + dy], [0.0, 0.025 + dy]], 48));
  const ring = new THREE.TorusGeometry(0.0205, 0.0018, 8, 40);
  ring.rotateY(Math.PI / 2);
  ring.translate(0.0235 + dy, 0, 0);
  const scr: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const g = new THREE.CylinderGeometry(0.0035, 0.0035, 0.003, 10);
    g.rotateZ(-Math.PI / 2);
    g.translate(0.0222 + dy, 0.0345, 0);
    g.rotateX((i / 5) * Math.PI * 2 + 0.3);
    scr.push(g);
  }
  const cap = new THREE.CylinderGeometry(0.011, 0.011, 0.004, 24);
  cap.rotateZ(-Math.PI / 2);
  cap.translate(0.0258 + dy, 0, 0);
  return { tyre, lugs: mergeGeometries(lug)!, hub, ring, groove, screws: mergeGeometries(scr)!, cap };
}

export function buildRobot(look: Look, d: RobotDims): Parts {
  const A = adder(), { add } = A;
  const { plastic, rubber, metal, glow } = look;
  const hK = d.bodyTop / 0.2; // множитель высоты корпуса
  const root = new THREE.Group();
  const chassis = node(root, 0, 0, 0); // ось: корпус наклоняется вокруг неё

  // профиль яйца: радиус на высоте y над осью (0 вне корпуса): шире внизу, закруглён на обоих полюсах
  const BY0 = 0.085 * hK, BH = 0.115 * hK, BR = d.bodyR, BODY_MID = BY0;
  const bodyR = (y: number): number => {
    const u = (y - BY0) / BH;
    return Math.abs(u) >= 1 ? 0 : BR * (1 - 0.06 * u) * Math.pow(1 - Math.pow(Math.abs(u), 2.2), 1 / 2.2);
  };
  const bodyShell = (a0: number, a1: number, n = 24): THREE.LatheGeometry => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n, y = BY0 - BH * Math.cos(a); pts.push([bodyR(y), y]); }
    return lathe(pts, 64);
  };
  const surf = (y: number, x = 0): number => Math.sqrt(Math.max(0, bodyR(y) ** 2 - x * x)); // передняя стенка корпуса на высоте y со смещением x
  const SH = { x: 0.07 * (BR / 0.078), y: 0.15 * hK, z: 0.03 };

  // ---- корпус: нижняя и верхняя оболочки по самому широкому кольцу, резиновый пояс по шву, кольцо света внизу
  add(chassis, bodyShell(0, Math.PI / 2), plastic);
  add(chassis, bodyShell(Math.PI / 2, Math.PI), plastic);
  const belt = lathe([[bodyR(BODY_MID) - 0.001, BODY_MID - 0.008], [bodyR(BODY_MID) + 0.002, BODY_MID - 0.005], [bodyR(BODY_MID) + 0.0032, BODY_MID], [bodyR(BODY_MID) + 0.002, BODY_MID + 0.005], [bodyR(BODY_MID) - 0.001, BODY_MID + 0.008]], 64);
  add(chassis, belt, rubber);
  add(chassis, new THREE.TorusGeometry(bodyR(0.012) + 0.0004, 0.0016, 6, 64), glow, { p: [0, 0.012, 0], r: [Math.PI / 2, 0, 0] });
  // грудь: индикатор в тёмном кольце, решётка динамика ниже, вентиляция сзади
  const cy = 0.14 * hK;
  add(chassis, new THREE.CylinderGeometry(0.0105, 0.0105, 0.003, 24), rubber, { p: [0, cy, surf(cy) + 0.0005], r: [Math.PI / 2 - 0.2, 0, 0] });
  add(chassis, new THREE.CircleGeometry(0.0072, 24), glow, { p: [0, cy, surf(cy) + 0.0024], r: [-0.2, 0, 0] });
  const slot = new THREE.CapsuleGeometry(0.0021, 0.016, 3, 8);
  for (let i = -2; i <= 2; i++) {
    const x = i * 0.0105, y = 0.07 * hK, r = bodyR(y);
    add(chassis, slot, rubber, { p: [x, y, Math.sqrt(r * r - x * x) - 0.0004], r: [-0.12, Math.asin(x / r), 0], solid: false });
    const y2 = 0.1 * hK;
    add(chassis, slot, rubber, { p: [x, y2, -(Math.sqrt(bodyR(y2) ** 2 - x * x) - 0.0004)], r: [0.1, Math.PI - Math.asin(x / bodyR(y2)), 0], solid: false });
  }
  // кожухи оси и заглушки суставов на боках (левая несёт руку)
  for (const s of [1, -1]) {
    add(chassis, new THREE.CylinderGeometry(0.017, 0.017, d.wheelX - d.wheelHW - 0.05, 20), metal, { p: [s * (d.wheelX - d.wheelHW + 0.05) / 2, d.wheelR, 0], r: [0, 0, Math.PI / 2] }); // ось на высоте центров колёс (в песочнице кожух лежал на земле и торчал «ножками»)
    if (s < 0) {
      add(chassis, new THREE.CylinderGeometry(0.017, 0.017, 0.007, 24), rubber, { p: [-SH.x + 0.001, SH.y, SH.z], r: [0, 0, Math.PI / 2] });
      add(chassis, new THREE.SphereGeometry(0.005, 12, 8), glow, { p: [-SH.x - 0.003, SH.y, SH.z] });
    }
  }

  // ---- колёса: покрышка, протектор, ступица с кольцом света, винты, колпак; правое — зеркало левого; диаметр — масштабом
  const wg = wheelGeometry(), wheels: THREE.Group[] = [];
  const dk = d.wheelR / W_R;
  for (const s of [1, -1]) {
    const w = node(root, s * d.wheelX, d.wheelR, 0);
    w.scale.set(s * dk, dk, dk);
    add(w, wg.tyre, rubber); add(w, wg.lugs, rubber); add(w, wg.hub, plastic); add(w, wg.ring, glow); add(w, wg.groove, glow, { solid: false }); add(w, wg.screws, metal); add(w, wg.cap, metal);
    wheels.push(w);
  }

  // ---- шея (поворот, потом наклон) и голова
  const neckYaw = node(chassis, 0, d.neckY, 0);
  add(neckYaw, new THREE.CylinderGeometry(0.027, 0.03, 0.026, 28), rubber, { p: [0, 0.008, 0] });
  for (const y of [0.0, 0.012]) add(neckYaw, new THREE.TorusGeometry(0.0285, 0.0048, 8, 36), metal, { p: [0, y + 0.002, 0], r: [Math.PI / 2, 0, 0] });
  const neckPitch = node(neckYaw, 0, 0.02, 0);
  add(neckPitch, new THREE.SphereGeometry(0.013, 14, 10), rubber);
  // голова строится в единичных размерах и масштабируется целиком (headSize)
  const hs = d.headR / 0.066;
  const head = node(neckPitch, 0, d.headY, 0.004 * hs);
  head.scale.setScalar(hs);
  const R = 0.066, th0 = Math.asin(EYE.hole / R);
  const shellPts: [number, number][] = [];
  for (let i = 0; i <= 28; i++) { const t = Math.PI - ((Math.PI - th0) * i) / 28; shellPts.push([R * Math.sin(t), R * Math.cos(t)]); }
  shellPts.push([EYE.hole - 0.0022, EYE.rimZ - 0.0035]);
  const shell = lathe(shellPts, 72);
  shell.rotateX(Math.PI / 2);
  add(head, shell, plastic);
  add(head, new THREE.TorusGeometry(R * 0.978, 0.0017, 6, 72), rubber, { p: [0, 0, -0.016] }); // шов за глазом
  // глаз: ободок, тёмная чаша, утопленная линза (шейдер глаза), кольцо света, стеклянный купол, блики
  add(head, new THREE.TorusGeometry(EYE.hole + 0.0013, 0.0055, 10, 56), rubber, { p: [0, 0, EYE.rimZ] });
  add(head, new THREE.TorusGeometry(EYE.hole - 0.0045, 0.0013, 6, 56), glow, { p: [0, 0, EYE.rimZ - 0.0035], solid: false });
  const cup = new THREE.CylinderGeometry(EYE.domeA, EYE.domeA, EYE.rimZ - EYE.lensZ, 40, 1, true);
  cup.rotateX(Math.PI / 2);
  add(head, cup, look.cup, { p: [0, 0, (EYE.rimZ + EYE.lensZ) / 2], solid: false });
  add(head, new THREE.CircleGeometry(EYE.domeA, 48), look.eye, { p: [0, 0, EYE.lensZ + 0.0004], solid: false });
  const rs = (EYE.domeA ** 2 + (EYE.apex - EYE.domeEdgeZ) ** 2) / (2 * (EYE.apex - EYE.domeEdgeZ));
  const dome = new THREE.SphereGeometry(rs, 40, 10, 0, Math.PI * 2, 0, Math.asin(EYE.domeA / rs));
  dome.rotateX(Math.PI / 2);
  add(head, dome, look.dome, { p: [0, 0, EYE.apex - rs], solid: false, order: 5 });
  for (const [az, el, size] of [[2.3, 0.45, 0.0062], [-0.6, 0.62, 0.0028]] as const) {
    const v = new THREE.Vector3(Math.sin(el) * Math.cos(az), Math.sin(el) * Math.sin(az), Math.cos(el)).multiplyScalar(rs + 0.0003);
    add(head, new THREE.SphereGeometry(size, 12, 8), look.shine, { p: [v.x, v.y, v.z + EYE.apex - rs], s: [1, 1, 0.25], solid: false, order: 6 });
  }
  // ушные датчики по бокам, на каждом кольцо света
  for (const s of [1, -1]) {
    add(head, new THREE.CylinderGeometry(0.0185, 0.0185, 0.012, 28), metal, { p: [s * (R - 0.0005), 0, -0.004], r: [0, 0, Math.PI / 2] });
    add(head, new THREE.TorusGeometry(0.0115, 0.0016, 6, 28), glow, { p: [s * (R + 0.0058), 0, -0.004], r: [0, Math.PI / 2, 0], solid: false });
    add(head, new THREE.CylinderGeometry(0.0055, 0.0055, 0.004, 14), rubber, { p: [s * (R + 0.0058), 0, -0.004], r: [0, 0, Math.PI / 2], solid: false });
  }
  // луч сканера: конус от линзы, узкий конец у глаза
  const bg = new THREE.CylinderGeometry(0.004, 0.11, 0.6, 48, 1, true);
  bg.rotateX(-Math.PI / 2);
  bg.translate(0, 0, EYE.apex + 0.3);
  const beam = add(head, bg, look.beam, { solid: false, order: 8, name: 'robot-beam' });

  // ---- антенна: цепочка тонких звеньев с затылка, гнётся динамикой; огонёк на конце
  const base = node(head, -0.028, 0.054, -0.024);
  base.rotation.set(-0.25, 0, 0.35);
  add(base, new THREE.CylinderGeometry(0.0072, 0.0092, 0.008, 16), rubber, { p: [0, 0.002, 0] });
  const antenna: THREE.Group[] = [];
  let at: THREE.Object3D = base;
  for (let i = 0; i < ANT_SEGS; i++) {
    const seg = node(at, 0, i === 0 ? 0.005 : ANT_LEN, 0);
    add(seg, new THREE.CylinderGeometry(0.0024, 0.0032, ANT_LEN + 0.001, 8), metal, { p: [0, ANT_LEN / 2, 0], solid: false });
    antenna.push(seg);
    at = seg;
  }
  const tip = node(at, 0, ANT_LEN + 0.006, 0);
  add(tip, new THREE.SphereGeometry(0.0072, 16, 12), glow);
  const halo = add(tip, new THREE.SphereGeometry(0.019, 16, 12), look.halo, { solid: false, order: 7, name: 'robot-halo' });
  antenna.push(tip);

  // ---- рука на левом боку: плечо, верхнее звено, локоть, предплечье, запястье и двупалый захват
  const L = LINK;
  const shoulder = node(chassis, SH.x + 0.004, SH.y, SH.z);
  add(shoulder, new THREE.SphereGeometry(0.0155, 16, 12), rubber);
  add(shoulder, new THREE.CapsuleGeometry(0.0132, L - 0.027, 4, 12), plastic, { p: [0.004, -L / 2, 0] });
  const elbow = node(shoulder, 0.004, -L, 0);
  add(elbow, new THREE.SphereGeometry(0.0148, 16, 12), rubber);
  add(elbow, new THREE.TorusGeometry(0.0152, 0.0014, 6, 24), glow, { p: [0.0075, 0, 0], r: [0, Math.PI / 2, 0], solid: false });
  add(elbow, new THREE.CapsuleGeometry(0.0112, L - 0.024, 4, 12), plastic, { p: [0.0135, -L / 2, 0] });
  const wrist = node(elbow, 0.0135, -L, 0);
  add(wrist, new THREE.SphereGeometry(0.0112, 14, 10), rubber);
  add(wrist, new THREE.CylinderGeometry(0.0098, 0.0098, 0.014, 16), metal, { p: [0, -0.011, 0] });
  const fingers = [1, -1].map((s) => {
    const f = node(wrist, 0, -0.018, s * 0.0052);
    add(f, new THREE.CapsuleGeometry(0.0044, HAND - 0.016, 3, 8), metal, { p: [0, -(HAND - 0.016) / 2 - 0.004, 0] });
    add(f, new THREE.SphereGeometry(0.0046, 8, 6), rubber, { p: [0, -(HAND - 0.016) - 0.007, 0] });
    return f;
  });

  // ---- пятно-тень под колёсами
  const bgeo = new THREE.PlaneGeometry(0.36, 0.42);
  bgeo.rotateX(-Math.PI / 2);
  const blob = add(root, bgeo, look.blob, { p: [0, 0.012, 0], solid: false, order: 3, name: 'robot-blob' });
  A.flush();
  return { root, chassis, wheelL: wheels[0]!, wheelR: wheels[1]!, neckYaw, neckPitch, head, beam, antenna, halo, shoulder, elbow, wrist, fingerA: fingers[0]!, fingerB: fingers[1]!, blob, meshes: A.all, shoulderPos: SH };
}
