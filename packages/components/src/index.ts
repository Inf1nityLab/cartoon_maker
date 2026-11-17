import { createRegistry } from '@cartoon/engine';
import { Terrain, Water, Sky } from './world.ts';
import { Multiped } from './multiped.ts';
import { Establishing, Follow, LowAngle, Orbit, Closeup, Crane } from './shots.ts';

export const registry = createRegistry([Terrain, Water, Sky, Multiped], [Establishing, Follow, LowAngle, Orbit, Closeup, Crane]);
export { Terrain, Water, Sky, terrainHeight } from './world.ts';
export { Multiped } from './multiped.ts';
