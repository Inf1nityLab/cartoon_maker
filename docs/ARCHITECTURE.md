# Архитектура движка «ИИ-режиссёр мультфильмов» (Three.js + TypeScript)

> Документ для ИИ-агента и разработчиков. Прочитай целиком перед первой строкой кода.
> Раздел 1 — жёсткие правила. Раздел 9 — сюжет и таймлайн. Раздел 13 — с чего начать (этап 0).
> Образец рабочей сцены: `reference/scene-01-reference.js` (один файл, всё в нём). Его надо перенести в эту архитектуру.

---

## 0. Что строим

Браузерный движок, в котором мультфильм — это **данные и код**:

- ИИ пишет сценарий сцены кодом (Code Mode) против типизированного API режиссёра.
- Код исполняется в песочнице и выдаёт **документ сцены** (`SceneDoc`, JSON).
- Движок на Three.js проигрывает документ **одинаково** в браузере и на сервере и рендерит видео кадр за кадром.
- ИИ получает обратно **состояние мира** (`WorldState`, JSON) и **кадры**, чтобы проверить и исправить сцену.
- Хранение, файлы, функции, ИИ-задачи и оплаты — на нашей платформе (Postgres, R2, функции, realtime).

Первый ориентир — «Сцена 01»: механический паук на холмах на закате, лес, озеро, 6 типов кадров камеры, 60-секундный сценарий.

---

## 1. Жёсткие правила

1. **Мир — это данные.** Источник правды — `SceneDoc` (JSON). Three.js только рисует.
2. **Детерминизм.** Один `SceneDoc` + один `seed` = одинаковые `WorldState` и кадры. Время только из таймлайна.
   В `packages/schema`, `packages/engine`, `packages/components`, `packages/director` **запрещены** `Math.random`, `Date.now`, `performance.now`, `new Date()` (правило ESLint `no-restricted-properties` / `no-restricted-globals`).
3. **Three.js только в `packages/render-three`.** Ни один другой пакет не импортирует `three`. В данных, в API и в базе нет ни одного типа Three.js.
4. **Всё — компоненты** с zod-схемой параметров и номером версии.
5. **ИИ работает только через API режиссёра.** Прямого доступа к движку и Three.js у кода ИИ нет.
6. **Один язык — TypeScript (strict).** Движок, редактор, код ИИ, серверный рендер.
7. **Версии и миграции с первого дня:** `SceneDoc.schema`, `ComponentInstance.version`, версия API режиссёра.
8. **Единицы:** метры, секунды, градусы, цвет — hex-строка `'#rrggbb'`. Вектор — кортеж `[x, y, z]`.
9. **Логика и вид разделены.** Логика компонента (симуляция) в `packages/components`, вид (меши, материалы) в `packages/render-three/views`.
10. **Зависимости только сверху вниз** (раздел 3). Циклы запрещены.
11. **Сначала готовое, потом своё.** Прежде чем писать модуль, проверь таблицу раздела 3.1. Сторонний код подключаем как npm-зависимость за нашим интерфейсом; копируем исходники только если без этого никак, и тогда сохраняем их LICENSE и заголовки.
12. **Только разрешённые лицензии** (раздел 3.1). GPL, AGPL, «только некоммерческое» и «бесплатно до N сотрудников» — запрещены.

---

## 2. Схема слоёв

```
   ┌──────────────────────────┐        ┌──────────────────────────┐
   │       ИИ-режиссёр        │        │         Редактор         │
   │  Code Mode: пишет код    │        │  люди правят сцену       │
   │  сцены (этап 2)          │        │  руками (этап 4)         │
   └─────────────┬────────────┘        └─────────────┬────────────┘
        ▲        │                                   │
        │        ▼                                   ▼
        │  ┌──────────────────────────────────────────────────┐
        │  │ API режиссёра               packages/director    │
        │  │ команды · zod-проверка · director.d.ts ·         │
        │  │ песочница → выдаёт SceneDoc                      │
        │  └────────────────────────┬─────────────────────────┘
        │                           ▼
        │  ┌──────────────────────────────────────────────────┐     ┌────────────────────┐
        │  │ SceneDoc (JSON, schema 'scene@1') packages/schema│────▶│ Платформа (хранит) │
        │  │ ИСТОЧНИК ПРАВДЫ: мир, сущности, места, пути,     │     │ Postgres: сцены,   │
        │  │ таймлайн, ассеты                                 │     │   версии, рендеры  │
        │  └────────────────────────┬─────────────────────────┘     │ R2: ассеты, видео  │
        │                           ▼                               │ функции, очередь   │
  WorldState  ┌──────────────────────────────────────────────┐      │ ИИ-задачи          │
  + кадры ◀───│ Ядро                       packages/engine   │      │ realtime, оплаты   │
        │     │ шаг 1/60 · seek с чекпоинтами · таймлайн ·   │      └────────────────────┘
        │     │ реестр компонентов · ctx · rng(seed)         │                ▲
        │     │ → WorldState                                 │                │
        │     └────────────────────────┬─────────────────────┘                │
        │                              ▼                                      │
        │     ┌──────────────────────────────────────────────┐                │
        │     │ Адаптер рендера         packages/render-three│                │
        │     │ ЕДИНСТВЕННОЕ место с Three.js (WebGPU,       │                │
        │     │ откат на WebGL2) + views компонентов         │                │
        │     └───────────┬──────────────────────┬───────────┘                │
        │                 ▼                      ▼                            │
        │     ┌──────────────────────┐ ┌──────────────────────────┐  видео    │
        └─────│ apps/player          │ │ packages/export          │───────────┘
              │ предпросмотр, UI     │ │ apps/render-worker       │
              │                      │ │ кадр за кадром → ffmpeg  │
              └──────────────────────┘ │ → R2 → HLS               │
                                       └──────────────────────────┘
```

Поток данных:

```
код ИИ ──(песочница)──▶ SceneDoc ──▶ engine.seek(t) ──▶ WorldState ──▶ adapter.sync ──▶ render ──▶ кадр
                            ▲                              │                                    │
                            └──── ИИ правит код ◀──────────┴──── ИИ смотрит данные и кадры ◀─────┘
```

---

## 3. Репозиторий и зависимости

Монорепозиторий: **pnpm workspaces**, сборка **Vite**, тесты **Vitest** + **Playwright**, схемы **zod**, TypeScript `strict: true`.

```
packages/
  schema/        FilmDoc, SceneDoc, WorldState, zod-схемы, миграции. Зависимости: zod.
  engine/        симуляция, таймлайн, seek, реестр, ctx, rng.       → schema
  components/    логика компонентов (без three).                     → schema, engine
  director/      API режиссёра, генерация director.d.ts, песочница.  → schema, engine, components
  render-three/  RenderAdapter + views компонентов. ТОЛЬКО ЗДЕСЬ three. → schema, engine, components(types), three
  export/        покадровый рендер, WebCodecs.                       → engine, render-three
apps/
  player/        проигрыватель сцены + UI (как «Сцена 01»).         → всё
  render-worker/ серверный рендер: headless Chrome + ffmpeg (этап 4).
  editor/        редактор (этап 4).
scenes/          эталонные сцены для тестов: scene-01.json …
reference/       scene-01-reference.js — исходник прототипа (только для чтения)
```

Граф зависимостей (стрелка = «зависит от»):

```
director ──▶ components ──▶ engine ──▶ schema
render-three ──▶ engine, components (только типы), schema, three
export ──▶ engine, render-three
apps/* ──▶ любые пакеты
```

Версия `three` зафиксирована точно (без `^`). Обновление — отдельное изменение, проходит только с зелёными скриншот-тестами.

---

### 3.1 Готовые библиотеки и ассеты (берём, а не пишем)

Своё пишем только то, чего ни у кого нет: SceneDoc/FilmDoc, детерминированное ядро, API режиссёра, цикл ИИ (код → проверка → кадр → правка), процедурная походка семейств, стыки сцен. Всё остальное берём готовым.

| Задача | Что берём | Лицензия | Как подключаем | Этап |
|---|---|---|---|---|
| Рендер, свет, тени, загрузка glTF | three | MIT | зависимость, только в render-three | 0 |
| Небо, вода, шум, управление камерой | three addons: Sky, SkyMesh, Water/Water2/WaterMesh, ImprovedNoise, OrbitControls | MIT | зависимость (`three/addons/...`) | 0 |
| Горы, деревья, лес, город | three addons `generators/`: TerrainGenerator, TreeGenerator, ForestGenerator, CityGenerator | MIT | зависимость; требуют WebGPURenderer (раздел 7) | 0 |
| IK и перенос анимаций между скелетами | three addons: CCDIKSolver, SkeletonUtils.retarget | MIT | зависимость | 3 |
| Человекоподобные персонажи, мимика, стандарт костей | @pixiv/three-vrm | MIT | зависимость | 3 |
| Запись mp4/webm в браузере | mediabunny | MPL-2.0 | зависимость; его файлы не правим (иначе изменения надо открыть) | 1 |
| Песочница для кода ИИ | quickjs-emscripten | MIT | зависимость в director | 2 |
| Проверка схем | zod | MIT | зависимость | 0 |
| Ключевые кадры и кривые (если понадобятся для tracks) | @theatre/core | Apache-2.0 | зависимость | 2+ |
| Идеи и части UI таймлайна «код = таймлайн» | Motion Canvas (или форк Revideo) | MIT | изучаем, переносим части UI таймлайна с сохранением LICENSE; сам движок 2D и нам не подходит | 4 |
| Основа редактора сцены | three.js editor (`three/editor`) | MIT | форк в apps/editor при необходимости | 4 |
| Модели животных, монстров, окружения с анимациями | Quaternius, Kenney, Poly Haven | CC0 | ассеты в R2, `AssetRef.license = 'CC0'`, `sourceUrl` | 3 |

Не используем:

- **Remotion** — исходники открыты, но бесплатен только для компаний до 3 человек.
- **@theatre/studio** — AGPL-3.0: встроить в продукт нельзя без открытия нашего кода. `@theatre/core` (Apache-2.0) — можно.
- **GPL-редакторы и движки** (Blender, Kdenlive, Shotcut) — только как инструменты у себя на компьютере, не код в продукте.

Правила для стороннего кода:

- Перед добавлением зависимости открыть её LICENSE в репозитории той версии, которую ставим (лицензии иногда меняются).
- Каждая библиотека — за нашим интерфейсом (как Three.js за RenderAdapter), чтобы её можно было заменить.
- Файл `THIRD_PARTY_NOTICES.md` в корне: название, версия, лицензия, ссылка. Обновляется вместе с `package.json`.
- CI-проверка лицензий (`pnpm licenses:check`): список разрешённых — MIT, ISC, BSD-2/3, Apache-2.0, Zlib, MPL-2.0, CC0-1.0, CC-BY-4.0 (для ассетов, с указанием автора). Всё остальное роняет сборку.
- Ассеты: лицензия и источник обязательны в `AssetRef`; CC-BY-ассеты попадают в титры автоматически.

### 3.2 Окружение: откуда берём воду, лес, горы, небо

Порядок поиска: 1) сам Three.js → 2) MIT-библиотеки из таблицы → 3) MIT-демо, из которых берём только нужный файл → 4) пишем сами. Каждый источник оборачиваем в наш компонент со схемой параметров (раздел 6): снаружи никто не знает, чей код внутри.

| Наш компонент | Основа | Лицензия | Что делаем |
|---|---|---|---|
| Terrain | `three/addons/generators/TerrainGenerator.js` (горный хребет из шума с эрозией, материал трава/камень/снег по высоте и склону) | MIT | обёртка: параметры → генератор; `ctx.heightAt` считаем той же функцией на CPU |
| Terrain (вариант по карте высот) | THREE.Terrain — много алгоритмов рельефа, сглаживание, раскраска | MIT | берём алгоритмы heightmap, рендер — наш |
| Forest | `three/addons/generators/ForestGenerator.js` (лес одним инстанс-вызовом поверх TerrainGenerator) | MIT | обёртка + исключение зон у путей и воды (как в «Сцене 01») |
| Tree (крупные деревья в кадре) | `three/addons/generators/TreeGenerator.js` или EZ-Tree (`@dgreenheck/ez-tree`, 50+ параметров, LOD, пресеты) | MIT | пресеты пород как параметры компонента |
| Water (озеро, река) | Water/Water2/WaterMesh из three addons | MIT | обёртка; нормали воды — наша периодическая карта или из примеров three |
| Ocean (волны, берег) | fft-ocean и MIT-примеры океана | MIT | берём спектр/FFT/пену, шейдеры переписываем под TSL |
| Sky | Sky/SkyMesh из three addons (как в «Сцене 01») | MIT | готово |
| Atmosphere, Clouds (позже, для красивого неба) | three-geospatial: `@takram/three-atmosphere`, `@takram/three-clouds` | MIT («кроме указанного отдельно» — проверить файлы) | тяжёлые эффекты, для финального рендера |
| Grass | готовой проверенной MIT-библиотеки не нашли (Grassworks — платный) | — | пишем сами: инстансы травинок + ветер в вершинном шейдере |
| Rocks, Dust | «Сцена 01» (наш код) | наш | переносим |

Перед копированием файла из демо-репозитория: проверить LICENSE именно этого репозитория, скопировать файл в `packages/components/vendor/<проект>/` вместе с LICENSE, указать источник и коммит в `THIRD_PARTY_NOTICES.md`.

---

## 4. Модель данных (`packages/schema`)

```ts
export type Vec3 = [number, number, number]
export type Target = string | Vec3            // string = id места (places) или сущности

// ===== Сохраняется в базу. Никаких типов Three.js. =====
export type SceneDoc = {
  schema: 'scene@1'
  id: string
  title: string
  settings: {
    fps: 30 | 60
    duration: number                          // секунды
    seed: number
    aspect: '16:9' | '9:16' | '1:1'
  }
  world: ComponentInstance[]                  // Terrain, Water, Sky, Fog, Forest, Rocks, Dust
  entities: Record<string, Entity>            // персонажи и предметы
  places: Record<string, Vec3>                // 'meadow', 'lakeShore'  (y можно 0: берётся из рельефа)
  paths: Record<string, { points: Vec3[]; closed: boolean }>
  camera: { shots: Record<string, ComponentInstance> }  // определения кадров (опционально; иначе по имени)
  timeline: TimelineEvent[]                   // отсортирован по t
  tracks?: KeyframeTrack[]                    // резерв под ключевые кадры (не реализуем в этапе 0)
  assets: AssetRef[]
}

export type ComponentInstance = {
  id: string
  type: string                                // 'Terrain', 'Multiped', 'Quadruped'
  version: number
  params: Record<string, unknown>             // проверяется схемой компонента
}

export type Entity = ComponentInstance & {
  spawn: { at: Target; heading: number }      // heading в градусах, 0 = +Z
}

export type TimelineEvent = {
  id: string
  t: number                                   // секунды
  target: 'world' | 'camera' | string         // string = id сущности
  action: string                              // 'sun' | 'shot' | 'walkTo' | 'followPath' | 'stop' | 'lookAt' …
  args: Record<string, unknown>               // проверяется схемой действия
}

export type AssetRef = {
  id: string
  kind: 'gltf' | 'vrm' | 'texture' | 'audio'
  hash: string                                // адрес по содержимому (R2: assets/<hash>)
  license: string
  sourceUrl?: string
}

export type KeyframeTrack = { target: string; property: string; keys: { t: number; v: unknown; ease?: string }[] }

// ===== Вычисляется движком для любого t. То, что «видит» ИИ. Не хранится как источник правды. =====
export type WorldState = {
  t: number
  sun: { elevation: number; azimuth: number }
  camera: { shot: string; pos: Vec3; target: Vec3; fov: number }
  inFrame: string[]                           // id сущностей и мест в кадре
  entities: Record<string, {
    type: string
    pos: Vec3
    heading: number
    action: string                            // 'walking' | 'standing' | 'running' …
    speed: number
    [k: string]: unknown                      // доп. поля из component.state()
  }>
}
```

Также в `schema`:

- `SceneDocSchema` (zod) и `validateSceneDoc(doc): { ok: true, doc } | { ok: false, errors: string[] }` — ошибки человекочитаемые, с путём: `timeline[3].args.speed: должен быть от 0 до 5, получено 12`.
- `migrate(doc: unknown): SceneDoc` — цепочка чистых функций `scene@N → scene@N+1`. В этапе 0 цепочка пустая, но механизм и тест есть.
- `hashWorldState(state): string` — стабильный хэш (сортировка ключей, округление чисел до 1e-4) для тестов детерминизма.

---

## 5. Ядро (`packages/engine`)

```ts
export function createEngine(opts: {
  registry: Registry
  fixedStep?: number          // по умолчанию 1/60
  checkpointEvery?: number    // секунды, по умолчанию 1
}): Engine

export interface Engine {
  load(doc: SceneDoc): void
  seek(t: number): WorldState        // детерминированно; через ближайший чекпоинт
  step(): WorldState                 // +fixedStep
  readonly time: number
  state(): WorldState
  sim(): SimSnapshot                 // внутреннее состояние для адаптера рендера (без three)
}
```

**Порядок одного шага:**

1. Применить события таймлайна с `t ≤ time` (каждое ровно один раз).
2. `step(self, dt, ctx)` всех компонентов мира, потом сущностей (порядок — по id, стабильный).
3. Обновить камеру по текущему кадру (shot).
4. Собрать `WorldState`.

**seek(t):** восстановить ближайший чекпоинт ≤ t и досчитать шагами. Результат обязан совпадать с проигрыванием с нуля (тест).
Чекпоинт = глубокая копия состояний всех компонентов (`structuredClone`), поэтому состояние компонентов — только сериализуемые данные.

**Случайность:** `ctx.rng` — генератор, детерминированно выведенный из `seed` и `componentId` (например, mulberry32 от хэша `seed + ':' + id`). У каждого компонента свой поток.

**Мировые сервисы (ctx):**

```ts
export interface Ctx {
  time: number
  dt: number
  rng: () => number
  heightAt(x: number, z: number): number      // предоставляет Terrain
  waterLevel: number                          // предоставляет Water
  place(id: string): Vec3                     // y проецируется на рельеф
  path(id: string): PathSampler               // getPointAt(u), getTangentAt(u), length
  entity(id: string): EntityHandle            // pos, heading, state
  camera: CameraState
  provide<K extends keyof Services>(name: K, impl: Services[K]): void   // компонент регистрирует сервис
}
```

Компоненты не ссылаются друг на друга напрямую — только через `ctx`.

---

## 6. Компоненты (`packages/components`)

### 6.1 Контракт логики

```ts
export const Multiped = defineComponent({
  type: 'Multiped',
  version: 1,
  describe: 'Механическое многоногое существо (паук, краб). Ходит по любому рельефу, ноги на IK.',
  params: z.object({
    legs: z.number().int().min(4).max(12).default(8),
    bodyHeight: z.number().min(0.3).max(5).default(1.35),
    upperLeg: z.number().default(1.75),
    lowerLeg: z.number().default(2.15),
    color: z.string().default('#ff5a1f'),
  }),
  actions: {
    walkTo:     z.object({ to: Target, speed: z.number().min(0).max(5).default(2) }),
    followPath: z.object({ path: z.string(), speed: z.number().min(0).max(5).default(2), loop: z.boolean().default(true) }),
    stop:       z.object({}),
    lookAt:     z.object({ target: z.union([Target, z.literal('camera')]).nullable() }),
  },
  create(ctx, params, spawn) { return { /* сериализуемое состояние: ноги, фазы, позиция */ } },
  step(self, dt, ctx) { /* походка, IK, наклон корпуса, голова */ },
  onAction(self, name, args, ctx) { /* смена цели/скорости */ },
  state(self) { return { action: 'walking', speed: 1.9, legsInAir: 4 } },
  migrate: {},                 // { 1: (p) => p2 } при переходе на version 2
  examples: ['spider.followPath({ path: "valleyLoop", speed: 2 })'],
})
```

Состояние `self` — только числа, массивы, обычные объекты (никаких классов и three). Позиции суставов (бедро, колено, стопа) лежат в состоянии, вид их только рисует.

### 6.2 Контракт вида (`packages/render-three/views`)

```ts
export const MultipedView = defineView('Multiped', {
  mount(three: ThreeCtx, inst: ComponentInstance): ViewHandle   // создать меши/материалы
  sync(handle, self, ctx): void                                  // расставить по состоянию
  dispose(handle): void
})
```

### 6.3 Первый набор (перенос из «Сцены 01»)

| Тип | Что делает | Откуда в reference |
|---|---|---|
| `Terrain` | рельеф fbm(ImprovedNoise) + впадина озера, вершинные цвета; предоставляет `ctx.heightAt` | `fbm`, `heightAt`, блок terrain |
| `Water` | уровень воды, периодическая карта нормалей; предоставляет `ctx.waterLevel` | `WATER`, `makeWaterNormals` |
| `Sky` + `Sun` | небо Preetham, солнце (elevation/azimuth, плавный переход), свет, туман, экспозиция | `Sky`, `applySun`, `sun.tween` |
| `Forest` | инстансы сосен, исключая зону у путей, воды и склонов | блок forest |
| `Rocks` | инстансы камней | блок rocks |
| `Dust` | частицы в воздухе вокруг цели камеры | блок dust |
| `Multiped` | паук: походка двумя группами ног, IK колена, наклон корпуса, голова, шестерёнки | `updateSpider`, `solveLeg`, построение паука |
| `CameraShot.*` | `establishing`, `follow`, `lowAngle`, `orbit`, `closeup`, `crane` с параметрами и fov | `SHOTS` |

Важно: в reference генерация леса и камней использует один общий `rand`. В новой версии у каждого компонента свой `ctx.rng`, поэтому расположение деревьев изменится — это нормально, эталонные скриншоты делаются уже с новой версии.

### 6.4 Персонажи: семейства

Скелет один на **семейство**, персонаж = числа (пропорции, походка, внешность). Движения пишутся один раз и подстраиваются под пропорции через IK.

| Семейство | Компонент | Кто | Движения |
|---|---|---|---|
| Многоногие | `Multiped` | паук, жук, краб | волна шагов группами ног |
| Четвероногие | `Quadruped` | лиса, собака, кошка, лошадь | шаг, рысь, галоп, прыжок |
| Двуногие | `Biped` | роботы, гуманоиды, люди (кости по стандарту VRM) | шаг, бег, прыжок, баланс |
| Позвоночник-цепочка | `Spine` | рыба, змея, медуза, дракон | волна по телу, плавание |
| Крылатые | `Winged` | птицы | взмах, планирование, посадка |
| Техника | `Vehicle` | машины, лодки | колёса, подвеска, качка |

Четыре слоя персонажа: **скелет и пропорции** → **движение** (процедурное: IK, походка) → **тело** (меш под скелет, автопривязка) → **внешность** (цвета, материалы, стиль). Каждый слой меняется независимо.
Сложные движения (танец, жесты) — клипы, перенесённые на скелет семейства (ретаргетинг), смешиваются с IK ног.
Порядок: `Multiped` → `Quadruped` → `Spine` → `Biped` (робот) → `Biped` (стилизованный человек) → остальное.

---

## 7. Адаптер рендера (`packages/render-three`)

```ts
export interface RenderAdapter {
  mount(canvas: HTMLCanvasElement | OffscreenCanvas, doc: SceneDoc): Promise<void>
  sync(state: WorldState, sim: SimSnapshot): void
  render(size: { w: number; h: number }): void
  capture(): Promise<VideoFrame | ImageBitmap>
  dispose(): void
}
export function createThreeAdapter(opts: { views: ViewRegistry; pixelRatio?: number; backend?: 'auto' | 'webgl2' }): RenderAdapter
```

Рендерер — `WebGPURenderer` из `three/webgpu` с автоматическим откатом на WebGL2 (`backend: 'auto'`). Причина: генераторы окружения Three.js (TerrainGenerator, ForestGenerator, TreeGenerator) используют материалы на узлах (TSL), которые работают только с ним. Свои материалы тоже пишем на TSL (`MeshStandardNodeMaterial`), а не на старых `ShaderMaterial`. Для скриншот-тестов и серверного рендера допустим `backend: 'webgl2'`.

Настройки из reference: `ACESFilmicToneMapping`, тени `PCFShadowMap` (не `PCFSoftShadowMap` — удалён в текущей версии three), тени солнца — каскады `CSMShadowNode` (`render-three/src/light/`): 4 карты 2048² по границам 12/40/130/420 м от камеры, у первого тексел ≈ 1–2 см (≤ 5 см при любом fov), смещения и мягкость PCF считаются от тексела каскада; направление солнца берётся из `Sky` (высота, азимут), рельеф тоже отбрасывает тени, окружение через `PMREMGenerator` из сцены неба (обновлять не чаще раза в 1,2 с или при изменении солнца).

---

## 8. API режиссёра и Code Mode (`packages/director`, этап 2)

Код ИИ — генератор `SceneDoc`:

```ts
export const api = 1
export default (s: Director) => {
  s.world.use('Terrain', { style: 'hills', seed: 7 })
  s.world.use('Water', {})
  s.world.sun({ elevation: 9, azimuth: 205 })
  s.path('valleyLoop', { points: [[31,0,0], [20,0,25], /* … */], closed: true })

  const spider = s.add('Multiped', { color: '#ff5a1f' }, { at: 'meadow', heading: 0 })

  s.at(0).camera.shot('establishing', { target: spider })
  s.at(0).do(spider.followPath({ path: 'valleyLoop', speed: 2 }))
  s.at(7).camera.shot('follow', { target: spider, side: 'left' })
  s.at(27).do(spider.stop(), spider.lookAt({ target: 'camera' }))
  s.at(29).camera.shot('closeup', { target: spider, on: 'eyes' })
  s.at(45).world.sun({ elevation: 0.6, duration: 14 })
}
```

- `director.d.ts` генерируется автоматически из реестра (zod → TS-типы + `describe` + `examples`) и целиком подаётся ИИ в контекст.
- Песочница: в браузере — Web Worker без DOM и сети; для чужого кода — JS-интерпретатор в WASM. На сервере — изолированное исполнение функциями платформы. Лимиты времени и памяти.
- Инструменты для ИИ: `s.inspect(t): WorldState`, `s.places()`, `s.frame(t): ImageBitmap`.
- Цикл: ИИ пишет код → песочница → `validateSceneDoc` (ошибки текстом) → симуляция + правила (цель видна, камера не под землёй, персонаж не в воде) → по одному кадру на shot → модель со зрением пишет замечания → ИИ правит код. Максимум 3 итерации, потом человеку.
- Принцип: лучше 30 хороших команд, чем 300. Команды на языке режиссёра и оператора, математика траекторий — внутри компонентов.

---

## 9. Сюжет, сцены и таймлайн (`FilmDoc`)

Фильм делится **по смыслу**, а не по ровным минутам: минутные куски режут шаг, фразу и движение камеры посередине.
ИИ всегда работает маленькой частью: **одной сценой** или **одним выделенным диапазоном**.

```
Фильм (FilmDoc: библия — персонажи, мир, стиль)
 └─ Акт 1 ─────────────┬─ Акт 2 ────────────────────────┬─ Акт 3 ──────────
    Сцена 1 │ Сцена 2  │ Сцена 3      │ Сцена 4         │ Сцена 5          ← каждая = один SceneDoc
    шоты ▯▯▯│▯▯▯▯      │▯▯▯▯▯▯        │▯▯▯▯▯            │▯▯▯▯▯▯
 ─────────────────────────────────────────────────────────────────────────  время фильма
 Музыка:   [тема утра      ]  [напряжение                ]  [финал        ]
 Свет:                                   [4:20–6:04 темнее]
 Указания ИИ:  [1:00–1:30 герой показывает на озеро]
```

Дорожки идут во **времени фильма** и не зависят от границ сцен.

### 9.1 Типы (в `packages/schema`)

```ts
export type FilmDoc = {
  schema: 'film@1'
  id: string
  title: string
  bible: { logline: string; characters: CharacterRef[]; world: string; style: string }
  acts: { id: string; title: string; summary: string; sceneIds: string[] }[]
  scenes: FilmScene[]                         // порядок массива = порядок в фильме
  tracks: Track[]
}

export type CharacterRef = { id: string; name: string; family: string; params: Record<string, unknown>; description: string }

export type FilmScene = {
  id: string
  sceneDocId: string                          // ссылка на SceneDoc
  title: string
  summary: string                             // что происходит — для ИИ и людей
  link: 'continue' | 'cut'                    // связь с предыдущей сценой
  transition: { kind: 'cut' | 'fade' | 'dissolve'; duration: number }
}

export type Track = {
  id: string
  kind: 'music' | 'light' | 'sfx' | 'voice' | 'subtitles' | 'ai-notes'
  clips: Clip[]
}

export type Clip = {
  id: string
  start: number                               // время ФИЛЬМА, секунды
  end: number
  data: Record<string, unknown>               // проверяется схемой по kind (ниже)
}
// music/sfx/voice: { asset: string; volume: number; fadeIn: number; fadeOut: number; offset?: number }
// light:           { exposure?: number; temperature?: number; saturation?: number; darken?: number; ease: number }
// subtitles:       { text: string }
// ai-notes:        { prompt: string; runId?: string; status: 'pending' | 'applied' | 'rejected' }
```

`CharacterRef` — персонаж фильма: семейство и параметры (раздел 6.4). Сцены ссылаются на него по id, поэтому персонаж выглядит одинаково во всех сценах.

### 9.2 Время

- У сцены своё время от 0 (`SceneDoc.settings.duration`), у дорожек — время фильма.
- Начало сцены в фильме **не хранится**, а вычисляется: сумма длительностей предыдущих сцен минус наложения переходов (`fade`/`dissolve`). Удлинил сцену 2 — сцены 3–5 сдвинулись сами.
- `packages/engine/film.ts`: `layout(film, scenes) → { sceneId, start, end }[]`, `toSceneTime(t) → { sceneId, t }`, `toFilmTime(sceneId, t)`.

### 9.3 Стыки между сценами

- `continue` — сцена начинается с конечного состояния прошлой. Движок делает `seek(end)` прошлой сцены и передаёт сериализуемое состояние сущностей с теми же id (позиция, курс, поза, действие) и солнце как начальное. Шва нет.
  Проверка: если `spawn` сущности в новой сцене противоречит концу прошлой (расстояние > 0,5 м или курс > 10°), это ошибка валидации с понятным текстом.
- `cut` — сознательный разрыв (другое место, «прошло три часа»), оформляется переходом: склейка, затемнение, растворение.
- Дорожки идут поверх стыков: музыка не обрывается на границе сцены.

### 9.4 Как применяются дорожки

- **Свет** — постобработка в адаптере рендера (экспозиция, температура, насыщенность, затемнение) с плавными краями `ease`. SceneDoc сцен не меняется.
- **Музыка, звуки, голос** — сводятся при экспорте; в проигрывателе — Web Audio.
- **Субтитры** — накладываются при экспорте (опционально).
- **Указания ИИ** — история: что, где и когда просили изменить.

### 9.5 Правка по диапазону («выделил — написал указание»)

1. Человек выделяет отрезок фильма `[start, end]` и пишет указание: «герой показывает лапой на озеро».
2. Движок находит затронутые сцены и шоты и переводит время фильма во время сцены.
3. ИИ получает: библию фильма; код и SceneDoc затронутой сцены; конец предыдущей и начало следующей сцены как контекст (только чтение); указание и диапазон.
4. ИИ меняет только события таймлайна и клипы дорожек внутри диапазона. Движок сравнивает документы до и после: **любое изменение вне диапазона отклоняется**, ИИ получает ошибку и пробует снова.
5. Перерендериваются только затронутые шоты. Остальные кадры берутся из `shot_cache` (ключ — хэш всех входных данных шота: SceneDoc, начальное состояние, версия движка, клипы дорожки «Свет» в этом отрезке).
6. Указание сохраняется клипом на дорожке `ai-notes` со статусом `applied` / `rejected`.

### 9.6 Как ИИ пишет фильм целиком

Сверху вниз, по уровням, с утверждением человеком на каждом уровне:

1. Библия: логлайн, персонажи (семейство + параметры), мир, стиль.
2. Акты: названия и краткое содержание.
3. Сцены: список с `summary`, `link` и переходами.
4. Каждая сцена отдельно: код режиссёра → SceneDoc (раздел 8).
5. Дорожки: музыка и свет по всему фильму.

В API режиссёра (этап 2):

```ts
f.bible({ logline: '…', style: 'lowpoly' })
f.character('robot', { family: 'Biped', params: { height: 1.2 }, description: 'любопытный робот' })
f.act('a1', 'Знакомство', ['s1', 's2'])
f.scene('s2', { title: 'Встреча с лисой', summary: '…', link: 'continue', transition: { kind: 'cut', duration: 0 } })
f.track('light').clip({ start: 260, end: 364, data: { darken: 0.35, ease: 2 } })
```

## 10. Рендер в видео (`packages/export`, `apps/render-worker`)

Всегда кадр за кадром: кадр N = `engine.seek(N / fps)` → `adapter.sync` → `adapter.render` → `adapter.capture`.

| Режим | Где | Качество | Этап |
|---|---|---|---|
| Предпросмотр | браузер, реальное время | может снижаться | 0 |
| Экспорт в браузере | WebCodecs (VideoEncoder) + mp4-муксер | до 1080p | 1 |
| Серверный рендер | headless Chrome с GPU → ffmpeg → R2 → HLS, очередь | до 4K | 4 |

Звук сводится по таймлайну (ffmpeg на сервере, Web Audio OfflineAudioContext в браузере).

---

## 11. Платформа (этап 3+)

| Таблица | Что хранит | Поля |
|---|---|---|
| `projects` | проект/серия | id, owner_id, title, style |
| `films` | документ фильма (FilmDoc) | id, project_id, doc jsonb, schema, updated_at |
| `scenes` | документ сцены (SceneDoc) | id, film_id, doc jsonb, code text, schema, updated_at |
| `shot_cache` | кэш отрендеренных шотов | input_hash (pk), r2_key, frames, created_at |
| `scene_versions` | история | id, scene_id, doc jsonb, author_kind ('human'\|'ai'), created_at |
| `components` | свои и общие компоненты | id, type, version, code, schema jsonb, visibility |
| `assets` | модели, текстуры, звук | hash (pk), kind, r2_key, license, source_url |
| `renders` | задачи рендера | id, scene_version_id, format, status, progress, video_url |
| `director_runs` | запуски ИИ | id, scene_id, prompt, code, errors jsonb, iterations, tokens, rating |
| `director_memory` | память режиссёра | id, kind ('shot'\|'preset'\|'scene'\|'fix'), description, snippet, preview_key, score, embedding |

RLS: всё по `project_id` владельца; общие компоненты читают все. R2: `assets/<hash>`, `renders/<id>`, `previews/<id>`.

---

## 12. Тесты (обязательны с этапа 0)

1. **Детерминизм:** `scenes/scene-01.json` проигрывается дважды → `hashWorldState` совпадает на каждой целой секунде.
2. **seek = проигрывание:** `seek(t)` для t ∈ {0.5, 7, 29.3, 59} даёт тот же хэш, что шаги с нуля.
3. **Схема:** невалидные документы дают понятные ошибки с путём.
4. **Миграции:** все сцены из `scenes/` проходят `migrate` + `validate`.
5. **Скриншоты (Playwright):** кадры t = 3, 16, 32, 56 сравниваются с эталоном с допуском. Headless Chrome: `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`.
6. **Запреты:** ESLint падает на `three` вне `render-three` и на `Math.random`/`Date.now`/`performance.now` в логике.
7. **Лицензии:** все зависимости из `pnpm licenses list` входят в разрешённый список раздела 3.1.

---

## 13. С чего начать: этап 0 «Фундамент»

Цель: «Сцена 01» собирается из `scenes/scene-01.json` по новой архитектуре и даёт одинаковые кадры при двух запусках.

- [ ] **0.1 Монорепозиторий:** pnpm workspaces, TS strict, Vite, Vitest, Playwright, ESLint с правилами из раздела 1 и 3, `THIRD_PARTY_NOTICES.md` и CI-проверка лицензий (раздел 3.1).
- [ ] **0.2 `schema`:** типы и zod-схемы раздела 4, `validateSceneDoc`, пустая цепочка `migrate`, `hashWorldState`. Сразу заложить типы и схему `FilmDoc` (раздел 9.1) с `validateFilmDoc` — без логики, чтобы формат данных не пришлось менять позже. `scenes/film-01.json`: фильм из одной сцены `scene-01`.
- [ ] **0.3 `engine`:** rng от seed+id, реестр, таймлайн, фиксированный шаг, чекпоинты и `seek`, `Ctx` с сервисами, сборка `WorldState`.
- [ ] **0.4 `components`:** перенести логику из reference: Terrain, Water, Sky/Sun, Forest, Rocks, Dust, Multiped, CameraShot (6 кадров). Без three.
- [ ] **0.5 `render-three`:** `createThreeAdapter` на WebGPURenderer (откат на WebGL2) + view для каждого компонента. Terrain и Forest — через генераторы Three.js (раздел 3.2), остальное — перенос из reference.
- [ ] **0.6 `scenes/scene-01.json`:** сценарий из `SCRIPT` reference в формате `TimelineEvent[]`; путь паука — в `paths.valleyLoop`.
- [ ] **0.7 `apps/player`:** загрузка JSON, проигрывание, пауза, «сначала», свободная камера, режим 9:16, панель сценария с подсветкой текущей команды, панель WorldState.
- [ ] **0.8 Тесты** раздела 12 (пункты 1–7) зелёные.

**Готово, когда:** `pnpm test` зелёный, `apps/player` показывает «Сцену 01», визуально не хуже reference, и два запуска дают одинаковый хэш `WorldState` на каждой секунде.

Дальше (не начинать до прохождения этапа 0):

| Этап | Содержание | Готово, когда |
|---|---|---|
| 1 Видео | seek, экспорт WebCodecs, 9:16 | 30-секундный ролик для Shorts выходит файлом без записи экрана |
| 2 ИИ-режиссёр | director API, director.d.ts, FilmDoc (акты, сцены, дорожки), песочница, Code Mode, проверка кадром, правки по диапазону | ИИ собирает сцену по текстовому описанию без ручных правок и меняет выделенный диапазон, не трогая остальное |
| 3 Библиотека и память | семейства персонажей, 10+ компонентов, хранение в платформе, память режиссёра | опубликовано 10 роликов, собранных через движок |
| 4 Продукт | редактор с таймлайном и дорожками, серверный рендер, аккаунты, квоты, оплата | первые внешние пользователи создают свои ролики |

---

## 14. Открытые вопросы (не блокируют этап 0, кроме первого)

- Стиль: low-poly, как в «Сцене 01», или реалистичнее? (по умолчанию — low-poly)
- Звук: только музыка/атмосфера или сразу голоса? Источник музыки с чистой лицензией.
- Какая модель пишет код и какая проверяет кадры; лимит токенов на сцену.
- Пользовательские компоненты: публикация и проверка чужого кода.
- Редактор: React или стек панели платформы.
- Серверный рендер: свои GPU или облачные по запросу.
- Физика (кандидат — детерминированный движок в WASM) и переход на WebGPU — позже, архитектура это позволяет.
