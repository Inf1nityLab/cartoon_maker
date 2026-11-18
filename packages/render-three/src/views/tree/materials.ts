// Материалы дерева (TSL): кора и листва. Качание, трепет, осенний цвет и снег — от униформ, которые вид меняет на месте
// каждый кадр (новых материалов и узлов на кадр нет). Вектор движения для сглаживания (TAA): положение вершины в прошлом
// кадре считается той же функцией от прошлых значений униформ и пишется в positionPrevious (иначе листва оставляла бы шлейф).
import * as THREE from 'three/webgpu';
import {
  Fn, uniform, vec2, vec3, vec4, float, uv, texture, mix, smoothstep, clamp, sin, cos, dot, attribute, normalWorld, normalMap, positionLocal, positionPrevious,
} from 'three/tsl';
import type { BarkTex, LeafTex } from './assets.ts';

type Node = any;
export type TreeUniforms = {
  bend: THREE.Uniform<THREE.Vector2> | { value: THREE.Vector2 }; bendPrev: { value: THREE.Vector2 };
  t: { value: number }; tPrev: { value: number }; flut: { value: number }; flutPrev: { value: number };
  girth: { value: number }; girthPrev: { value: number };
  snow: { value: number }; autumn: { value: number };
  leaf: { value: THREE.Color }; autumnColor: { value: THREE.Color }; barkTint: { value: THREE.Color };
};
export type TreeLook = { bark: THREE.Material; leaves: THREE.Material; u: TreeUniforms; dispose(): void };

const SNOW = vec3(0.9, 0.94, 1.0);

export function createTreeLook(bark: BarkTex, leaf: LeafTex, init: { leaf: string; autumn: string; barkTint: string }): TreeLook {
  const u = {
    bend: uniform(new THREE.Vector2()), bendPrev: uniform(new THREE.Vector2()),
    t: uniform(0), tPrev: uniform(0), flut: uniform(0), flutPrev: uniform(0), girth: uniform(1), girthPrev: uniform(1),
    snow: uniform(0), autumn: uniform(0),
    leaf: uniform(new THREE.Color(init.leaf)), autumnColor: uniform(new THREE.Color(init.autumn)), barkTint: uniform(new THREE.Color(init.barkTint)),
  };

  // положение вершины: ширина по возрасту, изгиб ствола (крона уходит дальше всего), у листьев ещё трепет
  const place = (leafy: boolean) => Fn(([p, bend, t, flut, girth]: Node[]) => {
    const h = clamp(p.y, 0, 1.3);
    const q = vec3(p.x.mul(girth), p.y, p.z.mul(girth)).add(vec3(bend.x, 0, bend.y).mul(h.mul(h)));
    if (!leafy) return q;
    const d = attribute('leafData', 'vec4');
    const ph = d.z.mul(6.2831);
    const k = flut.mul(uv().y.mul(0.7).add(0.3)).mul(0.0045);
    const f = vec3(
      sin(t.mul(7.3).add(ph).add(p.x.mul(9))).add(sin(t.mul(2.1).add(ph.mul(1.7)))),
      sin(t.mul(5.1).add(ph.mul(2.3))).mul(0.5),
      cos(t.mul(6.2).add(ph).add(p.z.mul(9))).add(cos(t.mul(1.7).add(ph.mul(0.6)))),
    );
    return q.add(f.mul(k).mul(h.mul(0.8).add(0.2)));
  });
  const move = (leafy: boolean) => { const f = place(leafy); return Fn(() => {
    const cur = f(positionLocal, u.bend, u.t, u.flut, u.girth);
    positionPrevious.assign(f(positionLocal, u.bendPrev, u.tPrev, u.flutPrev, u.girthPrev));
    return cur;
  })(); };

  // ---- кора
  const barkMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 });
  const barkTex = texture(bark.color, uv());
  const snowUp = u.snow.mul(smoothstep(0.1, 0.65, normalWorld.y));
  barkMat.colorNode = mix(barkTex.rgb.mul(u.barkTint).mul(1.8), SNOW, snowUp);
  barkMat.emissiveNode = barkTex.rgb.mul(0.08);
  barkMat.normalNode = normalMap(texture(bark.normal, uv()), vec2(0.8, 0.8));
  barkMat.positionNode = move(false);

  // ---- листва
  const leafMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.62, metalness: 0, side: THREE.DoubleSide });
  const lt = texture(leaf.map, uv());
  const d = attribute('leafData', 'vec4');
  const detail = clamp(dot(lt.rgb, vec3(0.299, 0.587, 0.114)).div(Math.max(leaf.lum, 0.05)), 0.45, 1.5);
  const summer = u.leaf.mul(d.x.mul(0.3).add(0.85));
  const red = mix(u.autumnColor, vec3(0.62, 0.17, 0.08), smoothstep(0.55, 1, d.w).mul(0.8));
  const turned = clamp(u.autumn.mul(1.7).sub(d.w.mul(0.7)), 0, 1);
  const base = mix(summer, red.mul(d.x.mul(0.4).add(0.8)), turned).mul(mix(float(1), detail, 0.65));
  const snowLeaf = u.snow.mul(smoothstep(0.25, 0.8, normalWorld.y.add(d.x.sub(0.5).mul(0.5))));
  const rgb = mix(base, SNOW, snowLeaf);
  leafMat.colorNode = vec4(rgb, lt.a);
  leafMat.emissiveNode = rgb.mul(0.22);
  leafMat.alphaTest = 0.5;
  leafMat.maskShadowNode = lt.a.greaterThan(0.5);
  leafMat.positionNode = move(true);

  return { bark: barkMat, leaves: leafMat, u: u as unknown as TreeUniforms, dispose() { barkMat.dispose(); leafMat.dispose(); } };
}
