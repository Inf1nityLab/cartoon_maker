import { createRegistry } from '@cartoon/engine';
import { Terrain, Water, Sky } from './world.ts';
import { Multiped } from './multiped.ts';
import { FilmLook } from './filmlook.ts';
import { Establishing, Follow, LowAngle, Orbit, Closeup, Crane } from './shots.ts';

export const registry = createRegistry([Terrain, Water, Sky, Multiped, FilmLook], [Establishing, Follow, LowAngle, Orbit, Closeup, Crane]);
export { Terrain, Water, Sky, terrainHeight } from './world.ts';
export { Multiped } from './multiped.ts';
export { FilmLook, FilmLookParams, FILM_LOOK_PRESETS, type FilmLookPreset } from './filmlook.ts';
