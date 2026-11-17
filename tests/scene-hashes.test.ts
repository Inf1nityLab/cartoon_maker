import { describe, expect, it } from 'vitest';
import { hashWorldState } from '@cartoon/schema';
import { loadScene, makeEngine, sceneFiles } from './helpers.ts';

/**
 * Хэши WorldState готовых сцен каждые 1.5 с, снятые ДО механизма ручек и сил мира (задача Б0).
 * Старые сцены обязаны давать те же хэши: Sky и FilmLook работают через ручки, но поведения в WorldState не идут,
 * а новые ключи (handles, world, unlinked) появляются только у сцен, которые ими пользуются.
 */
const GOLDEN: Record<string, string[]> = {
  "scene-01.json": [
    "51411bb86e86f794",
    "6d22840c343cffd8",
    "9d461118d10de444",
    "1b72103f8b3a769b",
    "46c013b264b23366",
    "09424002d40b5ba6",
    "66f0f9555f227351",
    "6e0086a0c92bbdac",
    "dae46c27851f20eb",
    "ccdd2abc3a27a240",
    "e816eea604c8a3d2",
    "eba1f0a6eec568d2",
    "68eecd45e92ca381",
    "f577256a73b25dde",
    "50e8a7c2270ebd66",
    "bb2a87e031b88e9c",
    "f9779945cef31059",
    "39d402b67ee8eb32",
    "c85ea51fdceca103",
    "0d33a19d010c2719",
    "c3faa26ffc15bd13",
    "6ed7513a8ddd8156",
    "b81022142fa645d8",
    "f4c18ab4fc33cc20",
    "6a944dfd769c3da1",
    "fc53e8a55da11821",
    "71e78d92110729ee",
    "e50481828ba9f1ae",
    "dbdc596e9684414a",
    "993dc0284aeb884c",
    "4c6b7fa966191e1d",
    "2c8733089cca564c",
    "a18b1e0e040662f2",
    "7628f387043b555b",
    "014562d68732ab0a",
    "f043f3e031f8c5ac",
    "45cb3e88134f8d1c",
    "7900c35096fc9a5c",
    "d4d9c5889b55eb74",
    "1d347b9c3a7353e8",
    "83eb080d2cc8a841"
  ],
  "test-road.json": [
    "5100371364fdf127",
    "e93064d5b5b64c61",
    "1ac17bcfdbab9d9b",
    "d5f8859474e2ac90",
    "85917f7c98bd9c60",
    "9941939efd6724ea",
    "97accdbc20050d40",
    "c4508e1ea61dfcc2",
    "12e3bbc7d3dec0eb",
    "ab3da91153848ae5",
    "12f504e8d3dc8254",
    "53c1e09cbe77c268",
    "16fbc6f9d7cfbcad",
    "9ff4dd2fa576d213",
    "e820622823582b64",
    "9ad47bdca9607ed8",
    "ec139c8127608075",
    "0d3e4487595b478b",
    "ec115dea275e41de",
    "978bbc923d4e8dbe",
    "59f2a83293ed3cee"
  ],
  "test-robot.json": [
    "9ba23ddba4c70fa7",
    "927890857df2b8a9",
    "0d32575083c55a1c",
    "4ba4dc654eeaefa1",
    "cb0ed44eccf1844a",
    "9861d88327c1ac9f",
    "c5e106f6929c271a",
    "a32846d50c7eafd1",
    "f8538e30b7af578c",
    "e83545743f92c128",
    "80eafdc5df0126d1",
    "fe4e3f82de831416"
  ]
};

describe('хэши готовых сцен не изменились (Б0)', () => {
  for (const f of sceneFiles()) {
    it(f, () => {
      const e = makeEngine(loadScene(f));
      const dur = loadScene(f).settings.duration;
      const got: string[] = [];
      for (let t = 0; t <= dur; t += 1.5) got.push(hashWorldState(e.seek(t)));
      expect(got).toEqual(GOLDEN[f]);
    });
  }
});
