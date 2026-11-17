import { readdirSync, readFileSync } from 'node:fs';
import { createEngine, validateAgainstRegistry } from '@cartoon/engine';
import { registry } from '@cartoon/components';
import { migrate, validateSceneDoc, type SceneDoc } from '@cartoon/schema';

export const readJson = (path: string): unknown => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
export const sceneFiles = () => readdirSync(new URL('../scenes/', import.meta.url)).filter((f) => /^(scene|test)-.*\.json$/.test(f));
export const loadScene = (name = 'scene-01.json'): SceneDoc => {
  const r = validateAgainstRegistry(migrate(readJson(`scenes/${name}`)), registry);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.doc;
};
export const makeEngine = (doc = loadScene()) => {
  const e = createEngine({ registry });
  e.load(doc);
  return e;
};
export { validateSceneDoc };
