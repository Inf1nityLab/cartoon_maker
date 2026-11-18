import { z } from 'zod';
import { Hex } from '@cartoon/schema';
import { SPECIES, type Species } from './recipes.ts';

/**
 * Дерево (ARCHITECTURE 6.5): одно семейство, порода — пресет. Облик (структура) меняется только пересборкой дерева;
 * ручки (age, season, snow, shed, windSensitivity) — во времени, без пересборки.
 */
export const TreeParams = z.object({
  species: z.enum(SPECIES).default('oak').describe('рецепт породы: oak дуб, ash ясень, aspen осина, birch берёза, pine сосна, spruce ель, bush1–3 кусты, willow ива'),
  seed: z.number().int().min(0).max(999999).default(35729).describe('зерно: у каждого дерева свой рисунок ветвей при той же породе'),
  height: z.number().min(0.3).max(60).default(12).describe('рост взрослого дерева, м (в возрасте 0.5)'),
  trunk: z.number().min(0.4).max(2.5).default(1).describe('толщина ствола, множитель'),
  branching: z.number().min(0.3).max(2).default(1).describe('сколько ветвей, множитель'),
  spread: z.number().min(-30).max(40).default(0).describe('раскрытие ветвей: добавка к углу ветвей, °'),
  crooked: z.number().min(0).max(3).default(1).describe('кривизна ствола и ветвей, множитель'),
  leafSize: z.number().min(0.4).max(2.5).default(1).describe('размер листьев, множитель'),
  leafCount: z.number().min(0.2).max(1.5).default(1).describe('густота кроны (листьев на веточку), множитель'),
  barkTint: Hex.default('#ffffff').describe('оттенок коры (белый — как у породы)'),
  leafColor: Hex.default('#5a9433').describe('цвет листвы летом'),
  autumnColor: Hex.default('#d98a1c').describe('цвет листвы осенью (часть листьев краснее)'),
  age: z.number().min(0).max(1).default(0.5).describe('возраст: 0 саженец, 0.5 взрослое дерево, 1 старое (шире, реже крона)'),
  season: z.number().min(0).max(1).default(0.3).describe('сезон: 0 весна, 0.3 лето, 0.5 осень (жёлтая, красная), 0.8 листья опали, 1 зима'),
  snow: z.number().min(0).max(1).default(0).describe('снег на ветвях и листьях (тает при температуре выше нуля)'),
  shed: z.number().min(0).max(1).default(0).describe('листопад: доля листьев, что уже опала'),
  windSensitivity: z.number().min(0).max(3).default(1).describe('чувствительность к ветру: 0 стоит, 1 как у породы (берёза качается сильнее дуба), 3 флюгер'),
});
export type TreeParams = z.infer<typeof TreeParams>;

const P = (species: Species, o: Partial<TreeParams>): TreeParams => TreeParams.parse({ species, ...o });

/** Пресеты: порода + рост + цвета. Остальное — по умолчанию. */
export const TREE_PRESETS: Record<string, TreeParams> = {
  oak: P('oak', { seed: 35729, height: 12, leafColor: '#5a9433', autumnColor: '#c9791c' }),
  ash: P('ash', { seed: 36330, height: 16, leafColor: '#6aa03e', autumnColor: '#e0b53a' }),
  aspen: P('aspen', { seed: 18020, height: 15, leafColor: '#80ae44', autumnColor: '#f2c230' }),
  birch: P('birch', { seed: 4411, height: 12, leafColor: '#8ab84c', autumnColor: '#f0c63a' }),
  pine: P('pine', { seed: 13977, height: 18, leafColor: '#2f6038', autumnColor: '#2f6038' }),
  spruce: P('spruce', { seed: 2024, height: 20, leafColor: '#2a5a42', autumnColor: '#2a5a42' }),
  bush1: P('bush1', { seed: 45590, height: 1.6, leafColor: '#58863a', autumnColor: '#d08a30' }),
  bush2: P('bush2', { seed: 45591, height: 1.3, leafColor: '#6a9a3a', autumnColor: '#e4a040' }),
  bush3: P('bush3', { seed: 31343, height: 1.8, leafColor: '#3b6b3a', autumnColor: '#3b6b3a' }),
  willow: P('willow', { seed: 777, height: 10, leafColor: '#86a84a', autumnColor: '#d6c050' }),
};
