/**
 * Рецепты пород дерева (данные, без three). Каждый рецепт — набор параметров генератора ez-tree
 * (`@dgreenheck/ez-tree` 1.1.0, MIT): дуб, ясень, осина, сосна и кусты взяты из его готовых наборов (Oak/Ash/Aspen/Pine Medium,
 * Bush 1–3), берёза, ель и ива — наши. Единицы ez-tree условные: вид нормирует дерево по высоте и масштабирует до `height` метров.
 */
export const SPECIES = ['oak', 'ash', 'aspen', 'birch', 'pine', 'spruce', 'bush1', 'bush2', 'bush3', 'willow'] as const;
export type Species = (typeof SPECIES)[number];
export type BarkKind = 'oak' | 'birch' | 'pine' | 'willow';
export type LeafKind = 'oak' | 'ash' | 'aspen' | 'pine';
type L4 = [number, number, number, number];
type L3 = [number, number, number];

export type TreeRecipe = {
  evergreen: boolean;
  bark: BarkKind;
  barkTint: number;
  barkScale: [number, number];
  levels: number;
  /** угол ветвей уровней 1…3, ° */
  angle: L3;
  /** число детей у ветвей уровней 0…2 */
  children: L3;
  /** сила, тянущая ветви вверх (минус — вниз), на секцию */
  force: number;
  gnarliness: L4; length: L4; radius: L4; sections: L4; segments: L4; start: L3; taper: L4; twist: L4;
  leaf: LeafKind; leafAngle: number; leafCount: number; leafStart: number; leafSize: number; leafVariance: number;
  /** как раскачивает ветер: усиление и собственная частота (Гц) для дерева высотой 9 м */
  sway: { gain: number; freq: number };
};

export const RECIPES: Record<Species, TreeRecipe> = {
  oak: {
    evergreen: false, bark: 'oak', barkTint: 0xd9b48a, barkScale: [1, 10], levels: 3, angle: [54, 58, 32], children: [6, 4, 3], force: -0.01,
    gnarliness: [0, -0.1, -0.15, 0.09], length: [37.24, 11.08, 12.39, 7.16], radius: [1.41, 0.9, 0.69, 1.19], sections: [8, 6, 3, 1], segments: [7, 5, 3, 3],
    start: [0.49, 0.06, 0.12], taper: [0.73, 0.42, 0.69, 0.75], twist: [-0.23, 0.42, 0, 0],
    leaf: 'oak', leafAngle: 42, leafCount: 18, leafStart: 0.16, leafSize: 2.5, leafVariance: 0.7, sway: { gain: 0.6, freq: 0.45 },
  },
  ash: {
    evergreen: false, bark: 'oak', barkTint: 0xcdb99f, barkScale: [0.5, 5], levels: 3, angle: [48, 75, 60], children: [7, 4, 3], force: -0.06,
    gnarliness: [0.03, 0.25, 0.2, 0.09], length: [43.47, 27.14, 9.51, 4.6], radius: [2, 0.63, 0.76, 0.7], sections: [12, 8, 6, 4], segments: [12, 6, 4, 3],
    start: [0.23, 0.33, 0], taper: [0.7, 0.7, 0.7, 0.7], twist: [0.09, -0.07, 0, 0],
    leaf: 'ash', leafAngle: 55, leafCount: 16, leafStart: 0, leafSize: 2.67, leafVariance: 0.72, sway: { gain: 0.85, freq: 0.5 },
  },
  aspen: {
    evergreen: false, bark: 'birch', barkTint: 0xffffff, barkScale: [1, 1], levels: 2, angle: [75, 32, 7], children: [10, 3, 3], force: 0.0148,
    gnarliness: [0.05, 0.12, 0.12, 0.02], length: [50, 6.07, 11.19, 1], radius: [0.72, 0.41, 0.7, 0.7], sections: [12, 10, 8, 6], segments: [8, 6, 4, 3],
    start: [0.59, 0.35, 0], taper: [0.37, 0.13, 0.7, 0.7], twist: [0, 0, 0, 0],
    leaf: 'aspen', leafAngle: 30, leafCount: 11, leafStart: 0.124, leafSize: 2.5, leafVariance: 0.7, sway: { gain: 1.45, freq: 0.6 },
  },
  // берёза (наша): тоньше и ниже осины, ветви уходят вверх и книзу свисают тонкие концы
  birch: {
    evergreen: false, bark: 'birch', barkTint: 0xffffff, barkScale: [1, 2], levels: 3, angle: [48, 55, 40], children: [8, 4, 3], force: -0.035,
    gnarliness: [0.06, 0.14, 0.12, 0.05], length: [34, 15, 8, 4], radius: [0.62, 0.34, 0.3, 0.3], sections: [12, 8, 6, 4], segments: [8, 5, 4, 3],
    start: [0.38, 0.3, 0], taper: [0.55, 0.5, 0.6, 0.7], twist: [0.05, 0, 0, 0],
    leaf: 'aspen', leafAngle: 40, leafCount: 14, leafStart: 0.05, leafSize: 1.9, leafVariance: 0.5, sway: { gain: 1.6, freq: 0.62 },
  },
  pine: {
    evergreen: true, bark: 'pine', barkTint: 0xffffff, barkScale: [1, 1], levels: 1, angle: [110, 16, 60], children: [82, 3, 5], force: -0.003,
    gnarliness: [0.05, 0.08, 0, 0], length: [50, 23.87, 14.08, 1], radius: [1.05, 0.36, 0.7, 0.7], sections: [12, 10, 8, 6], segments: [8, 6, 4, 3],
    start: [0.27, 0.14, 0.3], taper: [0.7, 0.7, 0.7, 0.7], twist: [0, 0, 0, 0],
    leaf: 'pine', leafAngle: 39, leafCount: 30, leafStart: 0.09, leafSize: 1.435, leafVariance: 0.2, sway: { gain: 0.5, freq: 0.5 },
  },
  // ель (наша): узкий конус, короткие ветви почти горизонтально
  spruce: {
    evergreen: true, bark: 'pine', barkTint: 0xb9a99a, barkScale: [1, 1], levels: 1, angle: [88, 16, 60], children: [120, 3, 5], force: -0.012,
    gnarliness: [0.03, 0.06, 0, 0], length: [56, 13, 14.08, 1], radius: [0.9, 0.3, 0.7, 0.7], sections: [12, 8, 8, 6], segments: [8, 5, 4, 3],
    start: [0.12, 0.14, 0.3], taper: [0.8, 0.7, 0.7, 0.7], twist: [0, 0, 0, 0],
    leaf: 'pine', leafAngle: 55, leafCount: 36, leafStart: 0.05, leafSize: 1.3, leafVariance: 0.15, sway: { gain: 0.42, freq: 0.55 },
  },
  bush1: {
    evergreen: false, bark: 'oak', barkTint: 0xcdb99f, barkScale: [0.5, 5], levels: 3, angle: [21.5, 62.6, 60], children: [7, 3, 2], force: -0.02,
    gnarliness: [0.11, 0.09, 0.05, 0.09], length: [0.1, 15.3, 5.59, 4.6], radius: [0.58, 0.95, 0.76, 0.7], sections: [6, 6, 10, 10], segments: [4, 4, 4, 3],
    start: [0.53, 0.33, 0], taper: [0.7, 0.7, 0.7, 0.7], twist: [0.3, -0.07, 0, 0],
    leaf: 'ash', leafAngle: 55, leafCount: 12, leafStart: 0, leafSize: 2.45, leafVariance: 0.72, sway: { gain: 0.8, freq: 1.0 },
  },
  bush2: {
    evergreen: false, bark: 'oak', barkTint: 0xcdb99f, barkScale: [0.5, 5], levels: 2, angle: [19.6, 27.4, 60], children: [10, 3, 2], force: -0.02,
    gnarliness: [0.02, 0.11, 0.05, 0.09], length: [0.1, 19.6, 7.7, 4.6], radius: [0.58, 0.95, 0.76, 0.7], sections: [3, 4, 10, 10], segments: [4, 4, 4, 3],
    start: [0.64, 0.71, 0], taper: [0.7, 0.7, 0.7, 0.7], twist: [0.36, -0.04, 0, 0],
    leaf: 'aspen', leafAngle: 55, leafCount: 7, leafStart: 0, leafSize: 2.45, leafVariance: 0.72, sway: { gain: 0.9, freq: 1.0 },
  },
  bush3: {
    evergreen: true, bark: 'oak', barkTint: 0xcdb99f, barkScale: [0.5, 5], levels: 3, angle: [66.5, 52.8, 0], children: [13, 4, 4], force: -0.007,
    gnarliness: [0.05, 0.07, 0.05, 0.09], length: [10.96, 21.8, 13.1, 5.53], radius: [0.58, 0.95, 0.69, 0.74], sections: [4, 3, 3, 10], segments: [3, 3, 3, 3],
    start: [0.14, 0.29, 0], taper: [0.7, 0.7, 0.7, 0.7], twist: [0.3, -0.03, 0, 0],
    leaf: 'pine', leafAngle: 54, leafCount: 3, leafStart: 0.15, leafSize: 3.04, leafVariance: 0.46, sway: { gain: 0.7, freq: 1.0 },
  },
  // ива (наша; приём из пруда с уткой: ствол с наклоном, ветви дугой вверх и наружу, потом тонкие плети вниз). Тонкие ветви гнутся книзу сильнее толстых: сила (отрицательная — от вертикали) делится на радиус
  willow: {
    evergreen: false, bark: 'willow', barkTint: 0xcfc3a2, barkScale: [1, 6], levels: 2, angle: [42, 18, 30], children: [14, 20, 3], force: -0.05,
    gnarliness: [0.07, 0.07, 0.05, 0.02], length: [15, 12, 24, 4], radius: [3.4, 0.36, 0.14, 0.1], sections: [8, 9, 10, 5], segments: [8, 6, 3, 3],
    start: [0.55, 0.2, 0], taper: [0.45, 0.4, 0.3, 0.7], twist: [0.06, 0, 0, 0],
    leaf: 'ash', leafAngle: 20, leafCount: 30, leafStart: 0.05, leafSize: 1.8, leafVariance: 0.5, sway: { gain: 1.3, freq: 0.4 },
  },
};

/** Параметры, меняющие рецепт (структура дерева). Возраст выбирает ступень: чем моложе, тем меньше уровней, ветвей и листьев. */
export type TreeShape = { species: Species; seed: number; trunk: number; branching: number; spread: number; crooked: number; leafSize: number; leafCount: number; barkTint: string };

/** Ступень возраста 0 (саженец), 1 (молодое), 2 (взрослое и старое). */
export function ageStage(age: number): 0 | 1 | 2 { return age < 0.1 ? 0 : age < 0.28 ? 1 : 2; }

const STAGE_CHILDREN = [0.4, 0.7, 1], STAGE_LEAVES = [0.5, 0.8, 1];

/** Настройки генератора ez-tree (в виде JSON, как у его `loadFromJson`). */
export function ezOptions(p: TreeShape, stage: 0 | 1 | 2): Record<string, unknown> {
  const r = RECIPES[p.species];
  const levels = Math.max(1, r.levels - (2 - stage) * (r.levels >= 3 ? 1 : 0));
  const rec = <T extends number[]>(a: T, f: (v: number, i: number) => number): Record<string, number> => Object.fromEntries(a.map((v, i) => [String(i), f(v, i)]));
  const tint = (hex: string) => parseInt(hex.slice(1), 16);
  const childMul = p.branching * STAGE_CHILDREN[stage]!;
  return {
    seed: p.seed,
    type: r.evergreen ? 'evergreen' : 'deciduous',
    bark: { type: r.bark, tint: tint(p.barkTint) === 0xffffff ? r.barkTint : tint(p.barkTint), flatShading: false, textured: true, textureScale: { x: r.barkScale[0], y: r.barkScale[1] } },
    branch: {
      levels,
      angle: { 1: r.angle[0] + p.spread, 2: r.angle[1] + p.spread * 0.6, 3: r.angle[2] },
      children: rec(r.children, (v) => Math.max(1, Math.round(v * childMul))),
      force: { direction: { x: 0, y: 1, z: 0 }, strength: r.force },
      gnarliness: rec(r.gnarliness, (v) => v * p.crooked),
      length: rec(r.length, (v) => v),
      radius: rec(r.radius, (v, i) => (i === 0 ? v * p.trunk : v)),
      sections: rec(r.sections, (v) => v),
      segments: rec(r.segments, (v) => v),
      start: { 1: r.start[0], 2: r.start[1], 3: r.start[2] },
      taper: rec(r.taper, (v) => v),
      twist: rec(r.twist, (v) => v),
    },
    leaves: {
      type: r.leaf, billboard: 'double', angle: r.leafAngle, count: Math.max(1, Math.round(r.leafCount * p.leafCount * STAGE_LEAVES[stage]!)),
      start: r.leafStart, size: r.leafSize * p.leafSize, sizeVariance: r.leafVariance, tint: 0xffffff, alphaTest: 0.5,
    },
    trellis: { enabled: false },
  };
}
