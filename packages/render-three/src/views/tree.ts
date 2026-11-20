import * as THREE from 'three/webgpu';
import { RECIPES, TreeParams, type TreeSelf, type TreeShape } from '@cartoon/components';
import { defineView } from '../view.ts';
import { grow, type Grown } from './tree/grow.ts';
import { barkTex, leafTex, preloadTreeAssets } from './tree/assets.ts';
import { createTreeLook, type TreeLook } from './tree/materials.ts';

type Handle = {
  root: THREE.Group; barkMesh: THREE.Mesh; leafMesh: THREE.Mesh; look: TreeLook; shape: TreeShape;
  grown: Map<number, Grown>; stage: number; lastT: number; leafColor: string;
};

const shapeOf = (p: TreeParams): TreeShape => ({ species: p.species, seed: p.seed, trunk: p.trunk, branching: p.branching, spread: p.spread, crooked: p.crooked, leafSize: p.leafSize, leafCount: p.leafCount, barkTint: p.barkTint });

function stageGeometry(h: Handle, stage: number): Grown {
  let g = h.grown.get(stage);
  if (!g) { g = grow(h.shape, stage as 0 | 1 | 2); h.grown.set(stage, g); }
  return g;
}

/**
 * Дерево: кора и листва из ez-tree (рецепт породы + seed), вид только рисует состояние логики: рост, цвет и густота листвы,
 * снег, изгиб ствола и трепет листьев. Геометрия растёт один раз на ступень возраста (0–2) и лежит в кэше; дальше
 * в кадре меняются только униформы, матрица и диапазон отрисовки листьев (префикс листьев в порядке случайного ранга).
 */
export const TreeView = defineView<Handle>('Tree', {
  preload: preloadTreeAssets,
  mount(three, inst) {
    const p = TreeParams.parse(inst.params), r = RECIPES[p.species];
    const look = createTreeLook(barkTex(r.bark), leafTex(r.leaf), { leaf: p.leafColor, autumn: p.autumnColor, barkTint: '#ffffff' });
    const shape = shapeOf(p);
    const h: Handle = { root: new THREE.Group(), barkMesh: new THREE.Mesh(undefined, look.bark), leafMesh: new THREE.Mesh(undefined, look.leaves), look, shape, grown: new Map(), stage: 2, lastT: Number.NaN, leafColor: p.leafColor };
    for (const m of [h.barkMesh, h.leafMesh]) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; }
    const g = stageGeometry(h, 2);
    h.barkMesh.geometry = g.bark; h.leafMesh.geometry = g.leaves;
    h.root.add(h.barkMesh, h.leafMesh);
    three.scene.add(h.root);
    return h;
  },
  sync(h, s: TreeSelf, three, state) {
    if (s.stage !== h.stage) {
      const g = stageGeometry(h, s.stage);
      h.barkMesh.geometry = g.bark; h.leafMesh.geometry = g.leaves; h.stage = s.stage;
    }
    const g = stageGeometry(h, h.stage), u = h.look.u;
    h.root.position.set(s.pos[0], s.pos[1], s.pos[2]);
    h.root.rotation.y = (s.heading * Math.PI) / 180;
    h.root.scale.setScalar(s.height);
    // прошлое значение униформ — для вектора движения; при повторе того же момента (прогрев кадра) оно не сдвигается
    if (state.t !== h.lastT) {
      u.bendPrev.value.copy(u.bend.value as THREE.Vector2); u.tPrev.value = u.t.value; u.flutPrev.value = u.flut.value; u.girthPrev.value = u.girth.value;
      h.lastT = state.t;
    }
    // изгиб из системы мира в систему дерева (оно повёрнуто на heading)
    const th = (s.heading * Math.PI) / 180, c = Math.cos(th), sn = Math.sin(th);
    (u.bend.value as THREE.Vector2).set(s.bend[0] * c - s.bend[1] * sn, s.bend[0] * sn + s.bend[1] * c);
    u.t.value = state.t; u.flut.value = s.flutter; u.girth.value = s.girth;
    u.snow.value = s.snowLoad; u.autumn.value = s.autumn;
    u.selfLit.value = three.skyState.active ? three.skyState.daylight : 1;
    if (s.leafColor !== h.leafColor) { u.leaf.value.set(s.leafColor); h.leafColor = s.leafColor; }
    const n = Math.round(s.leafDensity * g.leafUnits);
    h.leafMesh.visible = n > 0;
    g.leaves.setDrawRange(0, n * g.indicesPerLeaf);
  },
  dispose(h, three) {
    three.scene.remove(h.root);
    for (const g of h.grown.values()) { g.bark.dispose(); g.leaves.dispose(); }
    h.look.dispose();
  },
});
