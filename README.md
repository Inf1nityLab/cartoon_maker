# Cartoon Engine — ИИ-режиссёр мультфильмов (Three.js + TypeScript)

Архитектура: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Читать целиком перед первой строкой кода.

```
packages/schema        SceneDoc, FilmDoc, WorldState, zod, validate*, migrate, hashWorldState
packages/engine        шаг 1/60, seek с чекпоинтами, реестр, ctx, rng, проверка по реестру, раскладка фильма
packages/components    логика: Terrain, Water, Sky, Multiped + 6 кадров камеры (без three)
packages/director      API режиссёра: код → SceneDoc
packages/render-three  ЕДИНСТВЕННОЕ место с three: адаптер + views
packages/export        (этап 1) покадровый экспорт
apps/player            проигрыватель: сценарий, WorldState, свободная камера, 9:16
scenes/                эталонные сцены (scene-01.json собирается из scenes/src/scene-01.ts)
e2e/                   скриншот-тесты Playwright
```

pnpm нужен 12-й (`npm i -g pnpm`). Команды:

| | |
|---|---|
| `pnpm dev` | плеер на http://localhost:5173 |
| `pnpm test` | детерминизм, seek, схема, миграции, раскладка фильма, границы слоёв |
| `pnpm lint` | ESLint: three только в render-three, никаких Math.random/Date.now/performance.now в логике |
| `pnpm typecheck` | tsc strict |
| `pnpm e2e` | кадры t=3, 16, 32, 56 против эталонов; `--update-snapshots` обновляет эталоны |
| `pnpm licenses:check` | только разрешённые лицензии (MIT, ISC, BSD, Apache-2.0, Zlib, MPL-2.0, CC0, CC-BY-4.0) |
| `pnpm scenes` | пересобрать scenes/*.json из кода режиссёра |

Рендер: `WebGPURenderer` с откатом на WebGL2; для скриншот-тестов принудительно WebGL2 (`?backend=webgl2`). Сторонний код: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Не сделано из этапа 0: Forest, Rocks, Dust и точный перенос рельефа/воды/паука из `reference/scene-01-reference.js` (файла нет). Свет «Сцены 01» и вид приближены.
