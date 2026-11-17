import type { DagResult, BarkSource, LeafSource, LeafMask } from '../../vendor/threejs-nanites/dag/types.ts';

export interface GrowJob { preset: string; seed: number; height: number; leafMask: LeafMask }
export type GrowReply =
  | { dag: DagResult; src: { bark: BarkSource; leaves: LeafSource }; radius: number; height: number }
  | { error: string };
