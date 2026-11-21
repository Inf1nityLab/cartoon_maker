# Сторонний код

Обновляется вместе с `package.json`. Проверка лицензий: `pnpm licenses:check` (разрешены MIT, ISC, BSD-2/3, Apache-2.0, Zlib, MPL-2.0, CC0-1.0, CC-BY-4.0; GPL, AGPL, «только некоммерческое» и «бесплатно до N сотрудников» запрещены).

## Входит в продукт

| Пакет | Версия | Лицензия | Где используется | Ссылка |
|---|---|---|---|---|
| three | 0.187.0 | MIT | только `packages/render-three` (рендер, WebGPU/WebGL2, OrbitControls) | https://github.com/mrdoob/three.js |
| zod | 4.x | MIT | схемы документов и параметров компонентов | https://github.com/colinhacks/zod |
| meshoptimizer | 1.3.0 | MIT (© 2016–2026 Arseny Kapoulkine; LICENSE.md пакета этой версии проверен) | только `packages/render-three`: упрощение и кодирование кластеров в nanite-lib | https://github.com/zeux/meshoptimizer |
| @dgreenheck/ez-tree | 1.1.0 | MIT (© 2024 Daniel Greenheck; LICENSE пакета этой версии проверен) | только `packages/render-three`: генерация деревьев; его картинки коры и листьев (`src/lib/assets`) берём из самого пакета; числа его готовых наборов (Oak/Ash/Aspen/Pine Medium, Bush 1–3) перенесены данными в `packages/components/src/tree/recipes.ts` | https://github.com/dgreenheck/ez-tree |

## Данные движений (Biped)

Записи движений, перенесённые на наш скелет (`packages/components/src/biped/clips/library.json`). Сырые базы в репозиторий не входят (`sources/_eval/`). Скелеты и модели людей из баз не берём.

| База | Лицензия | Авторы и ссылка | Что взято |
|---|---|---|---|
| **100STYLE** — «The 100STYLE Dataset» | CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/) — **авторов указывать в титрах** | Ian Mason, Sebastian Starke, Taku Komura — https://www.ianxmason.com/100style/ | ходьба, бег и стойка восьми стилей (Neutral, Old, Proud, Depressed, Angry, Zombie, Strutting, Rushed): повороты суставов, сжатые и перенесённые на наш скелет. Сжатие, зацикливание и перенос — наши |
| **Universal Animation Library [Standard]** | CC0 1.0 (автор в титрах не обязателен) | Quaternius — https://quaternius.com/packs/universalanimationlibrary.html | стойка, ходьба, быстрый бег, «удар в грудь», прыжок: только движения, перенесённые на наш скелет |

Титры для фильма: «Motion data: The 100STYLE Dataset — Ian Mason, Sebastian Starke, Taku Komura (CC BY 4.0); Universal Animation Library — Quaternius (CC0)».

Запрещены для Biped ни в каком виде: CMU, AMASS, LAFAN1 (Ubisoft), база Bandai Namco, Mixamo.

## Только инструменты разработки

| Пакет | Лицензия | Зачем |
|---|---|---|
| typescript | Apache-2.0 | типы |
| vite | MIT | сборка |
| vitest | MIT | тесты |
| @playwright/test | Apache-2.0 | скриншот-тесты |
| eslint, typescript-eslint | MIT | запреты слоёв и детерминизма |

## Скопированный код

| Источник | Коммит | Лицензия | Где лежит | Что взято |
|---|---|---|---|---|
| threejs-nanites, © 2026 Victor Zakharov, https://github.com/VictorZakharov/threejs-nanites | `cde2f4d4bb3414553b9e39fd317186c97b3154ad` | MIT | `packages/render-three/vendor/threejs-nanites/` (с их LICENSE) | только `src/nanite-lib/` (рендерер кластерного LOD) |
| threejs-nanites (там же) | `cde2f4d4bb3414553b9e39fd317186c97b3154ad` | MIT | `packages/render-three/vendor/threejs-nanites-demo/` (с их LICENSE) | только функция `noiseTexture` из `src/clouds.ts` (бесшовный шум-fbm для облаков неба, Б5); правка `// OURS:` — экспорт и размер параметром |

Не взято: `public/models/lucy.nm` и `lucy4m.nm` (модель Stanford, только некоммерческое использование: запрещена по лицензии), `public/audio/ambience.mp3`, всё из `public/` (текстуры, thumbs, rock.glb), демо-код (`src/forest`, `src/webgl`, `src/taa.ts`, `src/warmup.ts`, UI). Подробнее: `sources/catalog.json`.

Правила для vendor: чужой код не переписываем; каждая наша правка помечена `// OURS: <зачем>` (сейчас правок нет). Тесты `tests/boundaries.test.ts` сторожат границы.

Заметка по ARCHITECTURE.md: раздел 3.2 велит класть скопированный код в `packages/components/vendor/`, но components не вправе импортировать three, а nanite-lib его импортирует, поэтому vendor лежит в `packages/render-three/vendor/` (так указано в задании части B). Документ не правил.

## Не используем

- Remotion — бесплатен только для компаний до 3 человек.
- @theatre/studio — AGPL-3.0. (@theatre/core, Apache-2.0, можно.)
- Blender, Kdenlive, Shotcut (GPL) — только как инструменты на своём компьютере.
