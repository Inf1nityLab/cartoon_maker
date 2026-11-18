import type { ShowSetup } from '@cartoon/engine';
import { Water } from './water.ts';
import { TREE_PRESETS } from './tree/index.ts';

/**
 * Сцены витрины Terrain: под каждый пресет — своя вода рядом, деревья и камеры. Только данные (library.html?object=Terrain).
 */
const water = (name: string, extra: Record<string, unknown> = {}) => ({ type: 'Water', params: { ...Water.presets![name]!, ...extra } as Record<string, unknown> });
const oak = (at: [number, number], seed: number, heading = 0): NonNullable<ShowSetup['entities']>[number] => ({ type: 'Tree', params: { ...TREE_PRESETS.oak!, seed }, at, heading });

export const TERRAIN_SETUPS: Record<string, ShowSetup> = {
  default: {
    world: [],
    views: {
      general: { at: [-34, 11, -50], look: [14, 2, 4], fov: 48, abs: true },
      close: { at: [-8, 3.6, -14], look: [6, 1.5, 4], fov: 45, abs: true },
      ground: { at: [-6, 1.2, -9], look: [10, 1.2, 2], fov: 60, abs: true },
      top: { at: [0, 120, -30], look: [0, 0, 0], fov: 50, abs: true },
    },
  },
  'meadow-hills': {
    world: [water('pond-forest', { at: [58, -4], reach: 60 })],
    forces: { temperature: 15 },
    views: {
      general: { at: [10, 9, -62], look: [58, 0, -4], fov: 48, abs: true },
      close: { at: [36, 3.5, -30], look: [58, 0, -4], fov: 45, abs: true },
      ground: { at: [40, 1.4, -24], look: [58, 0.5, -4], fov: 60, abs: true },
      top: { at: [40, 110, -10], look: [40, 0, -4], fov: 50, abs: true },
    },
  },
  'winter-meadow': {
    world: [water('pond-forest', { at: [58, -4], reach: 60 })],
    forces: { temperature: -6 },
    views: {
      general: { at: [10, 9, -62], look: [58, 0, -4], fov: 48, abs: true },
      close: { at: [36, 3.5, -30], look: [58, 0, -4], fov: 45, abs: true },
      ground: { at: [40, 1.4, -24], look: [58, 0.5, -4], fov: 60, abs: true },
      top: { at: [40, 110, -10], look: [40, 0, -4], fov: 50, abs: true },
    },
  },
  'desert-dunes': {
    world: [],
    forces: { time: 17.5, temperature: 32, windStrength: 5 },
    views: {
      general: { at: [-70, 22, -80], look: [20, 3, 10], fov: 50, abs: true },
      close: { at: [-22, 6, -30], look: [10, 2, 0], fov: 45, abs: true },
      ground: { at: [-10, 1.4, -14], look: [14, 1.5, 4], fov: 60, abs: true },
      top: { at: [0, 130, -20], look: [0, 0, 0], fov: 50, abs: true },
    },
  },
  'pond-shore': {
    world: [water('pond-forest', { at: [0, 0], reach: 60 })],
    views: {
      general: { at: [-42, 8, -44], look: [0, -0.5, 0], fov: 46, abs: true },
      close: { at: [-22, 2.2, -22], look: [0, -0.6, 2], fov: 45, abs: true },
      ground: { at: [-17, 0.5, -15], look: [0, -0.4, 4], fov: 60, abs: true },
      top: { at: [0, 80, -2], look: [0, 0, 0], fov: 50, abs: true },
    },
  },
  'sea-beach': {
    world: [water('ocean-tropical', { at: [-100, 0], reach: 250 })],
    forces: { time: 11 },
    views: {
      general: { at: [30, 6, -48], look: [-40, 0, 6], fov: 52, abs: true },
      close: { at: [8, 2.4, -18], look: [-14, 0, 2], fov: 48, abs: true },
      ground: { at: [10, 0.5, -8], look: [-14, 0, 2], fov: 62, abs: true },
      top: { at: [-20, 100, 0], look: [-20, 0, 0], fov: 50, abs: true },
    },
  },
  'forest-glade': {
    world: [],
    entities: [
      oak([-9, 6], 3, 20), oak([8, 9], 5, 140), oak([-4, -8], 8, 250), oak([13, -5], 11, 60), oak([-15, -3], 14, 300), oak([2, 16], 17, 90),
    ],
    forces: { time: 14 },
    views: {
      general: { at: [-6, 5, -34], look: [0, 3, 2], fov: 48, abs: true },
      close: { at: [-2, 2.2, -16], look: [0, 0.4, 0], fov: 45, abs: true },
      ground: { at: [0, 0.5, -10], look: [0, 0.3, 3], fov: 60, abs: true },
      top: { at: [0, 70, -4], look: [0, 0, 0], fov: 50, abs: true },
    },
  },
};
