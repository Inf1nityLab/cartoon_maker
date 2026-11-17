import { createRegistry } from '@cartoon/engine';
import { Terrain, Water, Sky } from './world.ts';
import { Forces } from './forces.ts';
import { Multiped } from './multiped.ts';
import { FilmLook } from './filmlook.ts';
import { Robot } from './robot/index.ts';
import { Road } from './road.ts';
import { Establishing, Follow, LowAngle, Orbit, Closeup, Crane, Fixed } from './shots.ts';

export const registry = createRegistry([Terrain, Water, Sky, Forces, Road, Multiped, FilmLook, Robot], [Establishing, Follow, LowAngle, Orbit, Closeup, Crane, Fixed]);
export { Terrain, Water, Sky, terrainHeight, TerrainParams } from './world.ts';
export { Multiped } from './multiped.ts';
export { FilmLook, FilmLookParams, FILM_LOOK_PRESETS, type FilmLookPreset } from './filmlook.ts';
export { Robot, RobotParams, ROBOT_PRESETS, robotDims, type RobotSelf, type RobotDims } from './robot/index.ts';
export { Road, buildRoad, RoadParams } from './road.ts';
export { gridHeight, gridIndices, gridNormals, gridStep, sampleGrid, type GridSpec } from './terrain-grid.ts';
export { Forces, ForcesParams, sunAt, sunStrength, moonStrength } from './forces.ts';
