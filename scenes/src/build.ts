import { writeFileSync } from 'node:fs';
import { scene01 } from './scene-01.ts';

// Собирает эталонные JSON из кода режиссёра: pnpm --filter @cartoon/scenes build
writeFileSync(new URL('../scene-01.json', import.meta.url), JSON.stringify(scene01, null, 2) + '\n');
const film = {
  schema: 'film@1', id: 'film-01', title: 'Фильм 01',
  bible: { logline: 'Механический паук идёт через долину на закате.', characters: [{ id: 'spider', name: 'Паук', family: 'Multiped', params: { color: '#ff5a1f' }, description: 'Оранжевый механический паук' }], world: 'Холмы, лес, озеро на закате.', style: 'lowpoly' },
  acts: [{ id: 'a1', title: 'Долина', summary: 'Один проход паука по долине.', sceneIds: ['s1'] }],
  scenes: [{ id: 's1', sceneDocId: 'scene-01', title: 'Паук на закате', summary: 'Паук идёт по петле, останавливается и смотрит в камеру.', link: 'cut', transition: { kind: 'cut', duration: 0 } }],
  tracks: [],
};
writeFileSync(new URL('../film-01.json', import.meta.url), JSON.stringify(film, null, 2) + '\n');
