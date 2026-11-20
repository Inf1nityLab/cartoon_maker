// Ручной запуск (не в рантайме):  node scripts/biped/build-clips.ts
// Читает сырые базы из sources/_eval/ (в git не попадают) и пишет packages/components/src/biped/clips/library.json:
// только отобранные клипы, уже перенесённые на наш скелет. Базы: 100STYLE (CC BY 4.0) и Quaternius UAL (CC0). Больше ничего.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { NB } from '../../packages/components/src/biped/skeleton.ts';
import { readBvh } from './bvh.ts';
import { glbMotion, readGlb } from './glb.ts';
import { retarget, type Mapping } from './retarget.ts';
import { findLoop, typicalSpeed, leftFootForward, loopClip, pack, series, shotClip, stanceSpeed, type Built, type Series } from './clipbuild.ts';
import { angleBetween } from '../../packages/components/src/biped/quat.ts';

const ROOT = new URL('../../', import.meta.url).pathname;
const STYLE_DIR = `${ROOT}sources/_eval/100style/raw/100STYLE`;
const UAL = `${ROOT}sources/_eval/quaternius-ual/raw/Universal Animation Library[Standard]/Unreal-Godot`;

const MAP_100: Mapping = {
  hips: { j: 'Hips', child: 'Chest' }, spine: { j: 'Chest', child: 'Chest2' }, chest: { j: 'Chest2', child: 'Chest4' }, upperChest: { j: 'Chest4', child: 'Neck' },
  neck: { j: 'Neck', child: 'Head' }, head: { j: 'Head' },
  leftShoulder: { j: 'LeftCollar', child: 'LeftShoulder' }, leftUpperArm: { j: 'LeftShoulder', child: 'LeftElbow' }, leftLowerArm: { j: 'LeftElbow', child: 'LeftWrist' }, leftHand: { j: 'LeftWrist' },
  rightShoulder: { j: 'RightCollar', child: 'RightShoulder' }, rightUpperArm: { j: 'RightShoulder', child: 'RightElbow' }, rightLowerArm: { j: 'RightElbow', child: 'RightWrist' }, rightHand: { j: 'RightWrist' },
  leftUpperLeg: { j: 'LeftHip', child: 'LeftKnee' }, leftLowerLeg: { j: 'LeftKnee', child: 'LeftAnkle' }, leftFoot: { j: 'LeftAnkle', child: 'LeftToe' }, leftToes: { j: 'LeftToe' },
  rightUpperLeg: { j: 'RightHip', child: 'RightKnee' }, rightLowerLeg: { j: 'RightKnee', child: 'RightAnkle' }, rightFoot: { j: 'RightAnkle', child: 'RightToe' }, rightToes: { j: 'RightToe' },
};
const MAP_UAL: Mapping = {
  hips: { j: 'pelvis', child: 'spine_01' }, spine: { j: 'spine_01', child: 'spine_02' }, chest: { j: 'spine_02', child: 'spine_03' }, upperChest: { j: 'spine_03', child: 'neck_01' },
  neck: { j: 'neck_01', child: 'Head' }, head: { j: 'Head' },
  leftShoulder: { j: 'clavicle_l', child: 'upperarm_l' }, leftUpperArm: { j: 'upperarm_l', child: 'lowerarm_l' }, leftLowerArm: { j: 'lowerarm_l', child: 'hand_l' }, leftHand: { j: 'hand_l' },
  rightShoulder: { j: 'clavicle_r', child: 'upperarm_r' }, rightUpperArm: { j: 'upperarm_r', child: 'lowerarm_r' }, rightLowerArm: { j: 'lowerarm_r', child: 'hand_r' }, rightHand: { j: 'hand_r' },
  leftUpperLeg: { j: 'thigh_l', child: 'calf_l' }, leftLowerLeg: { j: 'calf_l', child: 'foot_l' }, leftFoot: { j: 'foot_l', child: 'ball_l' }, leftToes: { j: 'ball_l' },
  rightUpperLeg: { j: 'thigh_r', child: 'calf_r' }, rightLowerLeg: { j: 'calf_r', child: 'foot_r' }, rightFoot: { j: 'foot_r', child: 'ball_r' }, rightToes: { j: 'ball_r' },
};

type Out = { name: string; base: string; file: string; license: string; credit: string; kind: string; built: Built };
const out: Out[] = [];
const L100 = 'CC-BY-4.0', C100 = 'The 100STYLE Dataset — Ian Mason, Sebastian Starke, Taku Komura (CC BY 4.0, https://www.ianxmason.com/100style/)';
const LUAL = 'CC0-1.0', CUAL = 'Universal Animation Library — Quaternius (CC0 1.0)';

// ---------- 100STYLE ----------
const cuts = new Map<string, Record<string, [number, number]>>();
{
  const rows = readFileSync(`${STYLE_DIR}/Frame_Cuts.csv`, 'utf8').trim().split('\n');
  const head = rows[0]!.split(',');
  for (const r of rows.slice(1)) {
    const c = r.split(','), rec: Record<string, [number, number]> = {};
    for (let k = 1; k < head.length; k += 2) { const nm = head[k]!.replace('_START', ''); if (c[k] !== 'N/A') rec[nm] = [Number(c[k]), Number(c[k + 1])]; }
    cuts.set(c[0]!, rec);
  }
}
const STYLES = (process.env.STYLES ?? 'Neutral,Old,Proud,Depressed,Angry,Zombie,Strutting,Rushed').split(',');
const MOTIONS: { code: string; tag: string; min: number; max: number; moving: boolean; maxFrames: number; minSpeed: number }[] = [
  { code: 'FW', tag: 'walk', min: 0.7, max: 1.9, moving: true, maxFrames: 2400, minSpeed: Number(process.env.WALKMIN ?? 0.5) },
  { code: 'FR', tag: 'run', min: 0.45, max: 1.2, moving: true, maxFrames: 1500, minSpeed: 1.8 },
  { code: 'ID', tag: 'idle', min: 2.5, max: 6, moving: false, maxFrames: 1200, minSpeed: 0 },
];
for (const style of STYLES) for (const m of MOTIONS) {
  const [a, b] = cuts.get(style)![m.code]!;
  const file = `${style}/${style}_${m.code}.bvh`;
  const src = readBvh(`${STYLE_DIR}/${file}`, a, Math.min(b, a + m.maxFrames * (m.moving ? 3 : 1)));
  const rt = retarget(src, MAP_100, 'Hips', 'LeftToe');
  const s = series(rt, src.fps);
  const typ = m.moving ? typicalSpeed(s) : 0;
  const lp = findLoop(s, { minSec: m.min, maxSec: m.max, moving: m.moving, minSpeed: typ * 0.9, maxSpeed: typ * 1.25, to: Math.min(s.frames, m.maxFrames * 3) });
  if (!Number.isFinite(lp.cost)) throw new Error(`${file}: цикл не найден`);
  let start = lp.i;
  if (m.moving) start = alignLeftFoot(s, lp.i, lp.P);
  const built = loopClip(s, start, lp.P, m.moving);
  out.push({ name: `s100.${style.toLowerCase()}.${m.tag}`, base: '100STYLE', file: `${style}_${m.code}.bvh (кадры ${a + start}…${a + start + lp.P}, ${src.fps} к/с)`, license: L100, credit: C100, kind: m.tag, built });
  console.log(`100STYLE ${style} ${m.code}: P=${(lp.P / src.fps).toFixed(2)}s cost=${lp.cost.toFixed(4)} vel=${built.vel[1].toFixed(2)} м/с`);
}

function alignLeftFoot(s: Series, i: number, P: number): number {
  const dx = s.hips[(i + P) * 3]! - s.hips[i * 3]!, dz = s.hips[(i + P) * 3 + 2]! - s.hips[i * 3 + 2]!, yaw = Math.atan2(dx, dz);
  let best = i, bv = -Infinity;
  for (let f = i; f < i + P; f++) { const v = leftFootForward(s, f, yaw); if (v > bv) { bv = v; best = f; } }
  const W = Math.round(P * 0.22) + 1;
  if (best + P + 1 >= s.frames) best -= P;
  return Math.max(best, W);
}

// ---------- Quaternius UAL ----------
const glbRM = readGlb(`${UAL}/UAL1_Standard_RM.glb`), glb = readGlb(`${UAL}/UAL1_Standard.glb`);
const UAL_LOOPS: [string, string, boolean][] = [['Idle_Loop', 'idle', false], ['Walk_Loop', 'walk', true], ['Walk_Formal_Loop', 'walk-formal', true], ['Jog_Fwd_Loop', 'fast-run', true]];
const UAL_SHOTS: [string, string][] = [['Hit_Chest', 'hit-chest'], ['Jump_Start', 'jump-start'], ['Jump_Land', 'jump-land']];
for (const [an, tag, moving] of UAL_LOOPS) {
  const m = glbMotion(glbRM, an);
  const rt = retarget(m, MAP_UAL, 'pelvis', 'ball_l');
  const s0 = series(rt, m.fps);
  const closure = Math.max(...Array.from({ length: NB }, (_, b) => angleBetween(s0.q.subarray(b * 4, b * 4 + 4), s0.q.subarray(((s0.frames - 1) * NB + b) * 4, ((s0.frames - 1) * NB + b) * 4 + 4))));
  const P = closure < 0.05 ? s0.frames - 1 : s0.frames;
  // периодическое продолжение (3 цикла), чтобы стык и фаза шли по кругу
  const ext: Series = { fps: s0.fps, frames: P * 3, q: new Float64Array(P * 3 * NB * 4), hips: new Float64Array(P * 3 * 3) };
  const adv = [s0.hips[P * 3]! - s0.hips[0]!, 0, s0.hips[P * 3 + 2]! - s0.hips[2]!];
  for (let r = 0; r < 3; r++) for (let f = 0; f < P; f++) {
    ext.q.set(s0.q.subarray(f * NB * 4, (f + 1) * NB * 4), ((r * P + f) * NB) * 4);
    for (let c = 0; c < 3; c++) ext.hips[(r * P + f) * 3 + c] = s0.hips[f * 3 + c]! + adv[c]! * r;
  }
  const start = moving ? alignLeftFoot(ext, P, P) : P;
  const built = loopClip(ext, start, P, moving);
  out.push({ name: `ual.${tag}`, base: 'Quaternius UAL', file: `UAL1_Standard_RM.glb :: ${an}`, license: LUAL, credit: CUAL, kind: tag, built });
  console.log(`UAL ${an}: ${built.duration.toFixed(2)}s vel=${built.vel[1].toFixed(2)} м/с замыкание исх. ${(closure * 57.3).toFixed(1)}°`);
}
for (const [an, tag] of UAL_SHOTS) {
  const m = glbMotion(glb, an);
  const s = series(retarget(m, MAP_UAL, 'pelvis', 'ball_l'), m.fps);
  const built = shotClip(s, 0, s.frames);
  out.push({ name: `ual.${tag}`, base: 'Quaternius UAL', file: `UAL1_Standard.glb :: ${an}`, license: LUAL, credit: CUAL, kind: tag, built });
  console.log(`UAL ${an}: ${built.duration.toFixed(2)}s`);
}

// ---------- скорость по стопам ----------
for (const o of out) if (o.built.loop && o.built.vel[1] > 0) {
  const sv = stanceSpeed(o.built);
  console.log(`  ${o.name}: корень ${o.built.vel[1].toFixed(2)} м/с, по опорным стопам ${sv.toFixed(2)} м/с`);
  const ok = sv > 0.5 * o.built.vel[1] && sv < 1.15 * o.built.vel[1];
  if (!ok) console.log(`    оценка по стопам не годится (${sv.toFixed(2)}), берём скорость корня`);
  o.built.vel = [0, ok ? sv : o.built.vel[1]];
}

// ---------- запись ----------
const clips = out.map((o) => {
  const p = pack(o.built), b = o.built;
  return { name: o.name, base: o.base, source: o.file, license: o.license, credit: o.credit, kind: o.kind, fps: 30, frames: b.frames, duration: Math.round(b.duration * 1000) / 1000, loop: b.loop, vel: [Math.round(b.vel[0] * 1000) / 1000, Math.round(b.vel[1] * 1000) / 1000], hips: p.hips, q: p.q };
});
const dir = `${ROOT}packages/components/src/biped/clips`;
mkdirSync(dir, { recursive: true });
const json = JSON.stringify({ version: 1, skeleton: 'biped-vrm22', clips });
writeFileSync(`${dir}/library.json`, json);
console.log(`записано ${clips.length} клипов, ${(json.length / 1024).toFixed(0)} КБ`);
