import { createRegistry } from '@cartoon/engine';
import { Terrain, Water, Sky } from './world.ts';
import { Multiped } from './multiped.ts';
import { FilmLook } from './filmlook.ts';
import { Robot } from './robot/index.ts';
import { Establishing, Follow, LowAngle, Orbit, Closeup, Crane } from './shots.ts';

export const registry = createRegistry([Terrain, Water, Sky, Multiped, FilmLook, Robot], [Establishing, Follow, LowAngle, Orbit, Closeup, Crane]);
export { Terrain, Water, Sky, terrainHeight } from './world.ts';
export { Multiped } from './multiped.ts';
export { FilmLook, FilmLookParams, FILM_LOOK_PRESETS, type FilmLookPreset } from './filmlook.ts';
export { Robot, RobotParams, ROBOT_PRESETS, robotDims, type RobotSelf, type RobotDims } from './robot/index.ts';
