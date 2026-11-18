// director.d.ts — сгенерировано из реестра компонентов (pnpm test проверяет, что файл не устарел).
// Время задаётся снаружи: s.at(t).do(команда). Команда — значение: её можно сохранить в настроение (s.mood).
export type Ease = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'step';
export type Force = 'wind' | 'light' | 'temperature';
export type Command = { target: string; action: string; args: Record<string, unknown> };
/** Общее для любого компонента (механизм ручек, 6.7, и перебивка связей, 6.6). */
export interface HandleBase {
  readonly id: string;
  /** Перебивка: объект перестаёт слышать силу мира (ветер, свет, температура) до link. */
  unlink(force: Force): Command;
  link(force: Force): Command;
}

/** Рельеф и поверхности: холмы, дюны (гребни поперёк ветра, рябь песка), пляж и чаша под воду (пологий или крутой берег). С ground: surfaces земля знает место: песок сухой и мокрый у воды, подстилка из листьев под деревьями, снег (ложится в мороз, на крутых склонах меньше, тает в тепле), влажность. Предоставляет ctx.heightAt(x, z): поверхность сетки, по которой нарисована земля; под Road рельеф выровнен. Ручки: snow, wetness, sandRipple. Поведения: snowfall, thaw. Слушает силы мира: температуру. */
export interface TerrainParams {
  /** форма: hills — холмы, flat — плоско, dunes — дюны (гребни поперёк ветра), beach — пляж (море с одной стороны, суша с другой); по умолчанию "hills" */
  style?: "hills" | "flat" | "dunes" | "beach";
  /** по умолчанию 7 */
  seed?: number;
  /** от 0; до 40; по умолчанию 7 */
  amplitude?: number;
  /** от 0.005; до 0.2; по умолчанию 0.025 */
  scale?: number;
  /** от 50; до 1000; по умолчанию 240 */
  size?: number;
  /** от 32; до 640; по умолчанию 384 */
  segments?: number;
  /** по умолчанию "soil" */
  ground?: "lowpoly" | "soil" | "surfaces";
  /** по умолчанию {"at":[58,-4],"radius":28,"depth":12} */
  lake?: {
    at: [number, number];
    /** от 1; до 200 */
    radius: number;
    /** от 0; до 30 */
    depth: number;
  };
  /** берег чаши: smooth — как прежде, gentle — пологий с ровным дном, steep — обрыв; по умолчанию "smooth" */
  bank?: "smooth" | "gentle" | "steep";
  /** высота дюн, м (style: dunes); от 0.5; до 40; по умолчанию 6 */
  duneHeight?: number;
  /** шаг между гребнями дюн, м (style: dunes); от 10; до 300; по умолчанию 60 */
  duneSpacing?: number;
  /** куда дует ветер, который сложил дюны и рябь песка, ° (0 — на север, +z; 90 — на восток, +x); гребни поперёк; от 0; до 360; по умолчанию 90 */
  windDirection?: number;
  /** где море (style: beach): направление от суши к воде, ° (0 — на +z, 90 — на +x); от 0; до 360; по умолчанию 0 */
  shoreAngle?: number;
  /** ширина пляжа от воды до травы или дюн, м (style: beach); от 2; до 80; по умолчанию 14 */
  beachWidth?: number;
  /** уклон пляжа и дна, м/м (style: beach); от 0.01; до 0.4; по умолчанию 0.055 */
  beachSlope?: number;
  /** основа поверхности (ground: surfaces): auto — по форме (дюны и пляж — песок, холмы — луг), meadow — луг, sand — песок; по умолчанию "auto" */
  base?: "auto" | "meadow" | "sand";
  /** полоса песка у воды на любой форме (берег пруда), 0 — нет (ground: surfaces); от 0; до 1; по умолчанию 0 */
  shoreSand?: number;
  /** лесная подстилка из листьев: 0 нет, 1 сплошная (ground: surfaces); от 0; до 1; по умолчанию 0 */
  litter?: number;
  /** где подстилка: trees — под и вокруг деревьев сцены, all — на всей земле (лесная земля); по умолчанию "trees" */
  litterArea?: "trees" | "all";
  /** снег 0…1: ложится только в мороз (температура из сил мира), на крутых склонах меньше; тает в тепле (ground: surfaces); от 0; до 1; по умолчанию 0 */
  snow?: number;
  /** влажность земли 0…1: темнеет и блестит (ground: surfaces); у воды мокрый песок виден и без неё; от 0; до 1; по умолчанию 0 */
  wetness?: number;
  /** рябь песка, поперёк ветра: 0 гладкий, 1 заметные волны (ground: surfaces); от 0; до 1; по умолчанию 0.6 */
  sandRipple?: number;
}
/** Пресеты Terrain: hills, plain, bowl, soft, meadow-hills, desert-dunes, pond-shore, sea-beach, forest-glade, winter-meadow */
export type TerrainPreset = "hills" | "plain" | "bowl" | "soft" | "meadow-hills" | "desert-dunes" | "pond-shore" | "sea-beach" | "forest-glade" | "winter-meadow";
export interface Terrain extends HandleBase {
  /** действие snowfall */
  snowfall(args?: {
    /** за сколько секунд снег доходит до нужной глубины, с; от 0.5; до 3600; по умолчанию 8 */
    over?: number;
    /** сколько снега выпадет, 0…1 (ляжет только в мороз); от 0; до 1; по умолчанию 1 */
    to?: number;
  }): Command;
  /** действие thaw */
  thaw(args?: {
    /** за сколько секунд снег сходит, с; от 0.5; до 3600; по умолчанию 8 */
    over?: number;
  }): Command;
  /** Ручка «snow»: снег 0…1: ложится только в мороз (температура из сил мира), на крутых склонах меньше; тает в тепле (ground: surfaces). Диапазон 0…1. */
  set(handle: "snow", value: number): Command;
  to(handle: "snow", value: number, opts?: { over?: number; ease?: Ease }): Command;
  /** Ручка «wetness»: влажность земли 0…1: темнеет и блестит (ground: surfaces); у воды мокрый песок виден и без неё. Диапазон 0…1. */
  set(handle: "wetness", value: number): Command;
  to(handle: "wetness", value: number, opts?: { over?: number; ease?: Ease }): Command;
  /** Ручка «sandRipple»: рябь песка, поперёк ветра: 0 гладкий, 1 заметные волны (ground: surfaces). Диапазон 0…1. */
  set(handle: "sandRipple", value: number): Command;
  to(handle: "sandRipple", value: number, opts?: { over?: number; ease?: Ease }): Command;
}
/* Примеры:
 *   s.world.use('Terrain', { style: 'hills', seed: 7 })
 *   s.world.use('Terrain', { style: 'dunes', ground: 'surfaces', duneHeight: 7, windDirection: 90 })
 *   const ground = s.world.use('Terrain', { ground: 'surfaces' }); s.at(10).do(ground.snowfall({ over: 8 }))   // ляжет, если в Forces мороз
 *   s.at(30).do(ground.thaw({ over: 10 }))
 */

/** Вода: пруд, озеро, ручей, река, океан, оазис. Знает место: заполняет ложбину до уровня (береговая линия по ctx.heightAt, глубина и цвет по глубине) или идёт по пути с руслом (река). Волны слоями (зыбь, ветровые, рябь), пена, каустики на дне, лёд, подводный вид. Слушает ветер и температуру сил мира. Ручки: waveHeight, swell, ripple, windSensitivity, flowSpeed, clarity, foam, reflection, ice, цвета. Поведения: ripple, storm, calm, freeze, thaw, splash. Для реки объявлять после Terrain и Road. */
export interface WaterParams {
  /** realistic — вода с волнами, глубиной и берегом; classic — прежний простой полупрозрачный лист (старые сцены); по умолчанию "realistic" */
  style?: "realistic" | "classic";
  /** basin — вода в ложбине на уровне level; river — по пути path с руслом; по умолчанию "basin" */
  shape?: "basin" | "river";
  /** вода продолжается за область до горизонта (океан); по умолчанию false */
  open?: boolean;
  /** уровень воды, м; от -50; до 50; по умолчанию -0.4 */
  level?: number;
  /** точка [x, z] внутри ложбины: вода заполняет связную область ниже уровня вокруг неё. Без неё — всё, что ниже уровня */
  at?: [number, number];
  /** как далеко от at искать берег, м; от 5; до 600; по умолчанию 120 */
  reach?: number;
  /** id пути в scene.paths (shape: river): ось русла */
  path?: string;
  /** ширина русла, м (shape: river); от 0.4; до 80; по умолчанию 6 */
  width?: number;
  /** ширина берега, на которой земля сходит к руслу, м (river); от 0.3; до 30; по умолчанию 3 */
  bank?: number;
  /** глубина русла посередине, м (river); от 0.05; до 12; по умолчанию 1.2 */
  depth?: number;
  /** на какой длине вдоль русла выравнивается уровень, м (river); от 2; до 300; по умолчанию 20 */
  smooth?: number;
  /** глубина за областью, м (open); от 1; до 300; по умолчанию 40 */
  deepDepth?: number;
  /** цвет листа воды (style: classic); по умолчанию "#2a6f97" */
  color?: string;
  /** цвет мелководья; по умолчанию "#5fc4c0" */
  shallowColor?: string /* '#rrggbb' */;
  /** цвет глубины; по умолчанию "#0c3f5c" */
  deepColor?: string /* '#rrggbb' */;
  /** цвет дна (песок), когда bedBlend > 0; по умолчанию "#d9c79a" */
  bedColor?: string /* '#rrggbb' */;
  /** 0 — сквозь воду видно настоящую землю, 1 — песчаное дно цвета bedColor; от 0; до 1; по умолчанию 0 */
  bedBlend?: number;
  /** прозрачность воды: 0 мутная (видно на сантиметры), 1 чистая (видно на десятки метров); от 0; до 1; по умолчанию 0.6 */
  clarity?: number;
  /** высота ветровых волн без ветра, м (значимая высота); от 0; до 8; по умолчанию 0 */
  waveHeight?: number;
  /** высота океанской зыби, м: идёт независимо от местного ветра; от 0; до 8; по умолчанию 0 */
  swell?: number;
  /** куда идёт зыбь, ° (0 — на север +z, 90 — на восток +x); от 0; до 360; по умолчанию 270 */
  swellDirection?: number;
  /** длина волны зыби, м; от 8; до 250; по умолчанию 40 */
  swellLength?: number;
  /** рябь: 0 зеркальная гладь, 1 сильная рябь; от 0; до 1; по умолчанию 0.3 */
  ripple?: number;
  /** добавка к ряби от порыва, 0…1 (обычно 0; меняется поведением ripple); от 0; до 1; по умолчанию 0 */
  rippleBoost?: number;
  /** как сильно вода слушает ветер сил мира: 0 — никак, 1 — как открытое море; от 0; до 1; по умолчанию 0.4 */
  windSensitivity?: number;
  /** скорость течения, м/с (у реки — вдоль пути); от 0; до 8; по умолчанию 0 */
  flowSpeed?: number;
  /** куда течёт вода, ° (у basin; у реки течение идёт вдоль пути); от 0; до 360; по умолчанию 90 */
  flowDirection?: number;
  /** пена: у берега и на гребнях волн; от 0; до 1; по умолчанию 0.5 */
  foam?: number;
  /** сила отражений неба и солнца; от 0; до 1; по умолчанию 0.8 */
  reflection?: number;
  /** лёд: 0 чистая вода, 1 сплошной лёд; от 0; до 1; по умолчанию 0 */
  ice?: number;
  /** слушает температуру: 1 — вода замерзает при морозе (ниже freezeAt) сама, 0 — только по ручке ice; от 0; до 1; по умолчанию 0 */
  temperatureSensitivity?: number;
  /** температура начала льда, °C (полностью покрыта на 6 °C ниже); от -30; до 10; по умолчанию 0 */
  freezeAt?: number;
  /** id сущностей, от которых по воде идут круги (когда они в воде); по умолчанию [] */
  touchers?: string[];
  /** места на воде под то, что будут добавлять другие объекты (кувшинки, камыш, водоросли, рыбы): id, [x, z], радиус, вид; по умолчанию [] */
  spots?: {
    id: string;
    at: [number, number];
    /** от 0.1; до 50; по умолчанию 1 */
    radius?: number;
    /** по умолчанию "lily" */
    kind?: string;
  }[];
  /** seed волн; по умолчанию 3 */
  seed?: number;
  /** попадает ли вода в отчёт о мире (WorldState); по умолчанию true */
  report?: boolean;
}
/** Пресеты Water: ocean-tropical, ocean-storm, lake-mountain, pond-forest, pond-lilies, creek, river, oasis */
export type WaterPreset = "ocean-tropical" | "ocean-storm" | "lake-mountain" | "pond-forest" | "pond-lilies" | "creek" | "river" | "oasis";
export interface Water extends HandleBase {
  /** действие ripple */
  ripple(args?: {
    /** на сколько усиливается рябь на пике, 0…1; от 0.05; до 1; по умолчанию 0.6 */
    strength?: number;
    /** сколько длится порыв ряби, с; от 0.4; до 60; по умолчанию 3 */
    duration?: number;
  }): Command;
  /** действие storm */
  storm(args?: {
    /** за сколько секунд волнение нарастает, с; от 0; до 600; по умолчанию 8 */
    over?: number;
    /** сила шторма 0…1: ветровые волны до 2.5 м и зыбь до 4 м, больше пены, мутнее вода; от 0; до 1; по умолчанию 1 */
    severity?: number;
  }): Command;
  /** действие calm */
  calm(args?: {
    /** за сколько секунд вода успокаивается до глади, с; от 0; до 600; по умолчанию 5 */
    over?: number;
  }): Command;
  /** действие freeze */
  freeze(args?: {
    /** за сколько секунд вода замерзает, с; от 0; до 3600; по умолчанию 8 */
    over?: number;
  }): Command;
  /** действие thaw */
  thaw(args?: {
    /** за сколько секунд лёд тает, с; от 0; до 3600; по умолчанию 8 */
    over?: number;
  }): Command;
  /** действие splash */
  splash(args: {
    /** куда упало: [x, y, z] или id места/сущности */
    at: string | [number, number, number];
    /** сила круга; от 0.1; до 2; по умолчанию 1 */
    strength?: number;
  }): Command;
  /** Ручка «waveHeight»: высота ветровых волн без ветра, м (значимая высота). Единицы: м. Диапазон 0…8. */
  set(handle: "waveHeight", value: number): Command;
  to(handle: "waveHeight", value: number, opts?: { over?: number; ease?: Ease }): Command;
  /** Ручка «swell»: высота океанской зыби, м: идёт независимо от местного ветра. Единицы: м. Диапазон 0…8. */
  set(handle: "swell", value: number): Command;
  to(handle: "swell", value: number, opts?: { over?: number; ease?: Ease }): Command;
  /** Ручка «swellDirection»: куда идёт зыбь, ° (0 — на север +z, 90 — на восток +x). Единицы: °. Диапазон 0…360. */
  set(handle: "swellDirection", value: number): Command;
  to(handle: "swellDirection", value: number, opts?: { over?: number; ease?: Ease }): Command;
  /** Ручка «ripple»: рябь: 0 зеркальная гладь, 1 сильная рябь. Диапазон 0…1. */
  set(handle: "ripple", value: number): Command;
  to(handle: "ripple", value: number, opts?: { over?: number; ease?: Ease }): Command;
  /** Ручка «rippleBoost»: добавка к ряби от порыва, 0…1 (обычно 0; меняется поведением ripple). Диапазон 0…1. */
  set(handle: "rippleBoost", value: number): Command;
  to(handle: "rippleBoost", value: number, opts?: { over?: number; ease?: Ease }): Command;
  /** Ручка «windSensitivity»: как сильно вода слушает ветер сил мира: 0 — никак, 1 — как открытое море. Диапазон 0…1. */
  set(handle: "windSensitivity", value: number): Command;
  to(handle: "windSensitivity", value: number, opts?: { over?: number; ease?: Ease }): Command;
  /** Ручка «flowSpeed»: скорость течения, м/с (у реки — вдоль пути). Единицы: м/с. Диапазон 0…8. */
  set(handle: "flowSpeed", value: number): Command;
  to(handle: "flowSpeed", value: number, opts?: { over?: number; ease?: Ease }): Command;
  /** Ручка «flowDirection»: куда течёт вода, ° (у basin; у реки течение идёт вдоль пути). Единицы: °. Диапазон 0…360. */
  set(handle: "flowDirection", value: number): Command;
  to(handle: "flowDirection", value: number, opts?: { over?: number; ease?: Ease }): Command;
  /** Ручка «clarity»: прозрачность воды: 0 мутная (видно на сантиметры), 1 чистая (видно на десятки метров). Диапазон 0…1. */
  set(handle: "clarity", value: number): Command;
  to(handle: "clarity", value: number, opts?: { over?: number; ease?: Ease }): Command;
  /** Ручка «foam»: пена: у берега и на гребнях волн. Диапазон 0…1. */
  set(handle: "foam", value: number): Command;
  to(handle: "foam", value: number, opts?: { over?: number; ease?: Ease }): Command;
  /** Ручка «reflection»: сила отражений неба и солнца. Диапазон 0…1. */
  set(handle: "reflection", value: number): Command;
  to(handle: "reflection", value: number, opts?: { over?: number; ease?: Ease }): Command;
  /** Ручка «ice»: лёд: 0 чистая вода, 1 сплошной лёд. Диапазон 0…1. */
  set(handle: "ice", value: number): Command;
  to(handle: "ice", value: number, opts?: { over?: number; ease?: Ease }): Command;
  /** Ручка «shallowColor»: цвет мелководья. */
  set(handle: "shallowColor", value: string /* '#rrggbb' */): Command;
  to(handle: "shallowColor", value: string /* '#rrggbb' */, opts?: { over?: number; ease?: Ease }): Command;
  /** Ручка «deepColor»: цвет глубины. */
  set(handle: "deepColor", value: string /* '#rrggbb' */): Command;
  to(handle: "deepColor", value: string /* '#rrggbb' */, opts?: { over?: number; ease?: Ease }): Command;
}
/* Примеры:
 *   s.world.use('Water', { shape: 'basin', at: [0, 0], level: -0.4, clarity: 0.5 })
 *   s.path('water', { points: [[-40,0,-20],[0,0,0],[40,0,20]] }); s.world.use('Water', { shape: 'river', path: 'water', width: 6 })
 *   water.to('ice', 1, { over: 8 })
 *   s.at(5).do(water.storm({ over: 6 }))
 */

/** Небо и солнце. Действие sun меняет высоту и азимут (градусы), можно плавно за duration секунд. Если в мире есть Forces, солнце идёт по часам суток, а эти значения не используются. */
export interface SkyParams {
  /** высота солнца над горизонтом, ° (если нет Forces); от -10; до 90; по умолчанию 30 */
  elevation?: number;
  /** азимут солнца, ° (0 — север, +z; 90 — восток, +x) (если нет Forces); от 0; до 360; по умолчанию 180 */
  azimuth?: number;
}
export interface Sky extends HandleBase {
  /** действие sun */
  sun(args?: {
    /** от -10; до 90 */
    elevation?: number;
    /** от 0; до 360 */
    azimuth?: number;
    /** от 0; до 600; по умолчанию 0 */
    duration?: number;
  }): Command;
  /** Ручка «elevation»: высота солнца над горизонтом, ° (если нет Forces). Единицы: °. Диапазон -10…90. */
  set(handle: "elevation", value: number): Command;
  to(handle: "elevation", value: number, opts?: { over?: number; ease?: Ease }): Command;
  /** Ручка «azimuth»: азимут солнца, ° (0 — север, +z; 90 — восток, +x) (если нет Forces). Единицы: °. Диапазон 0…360. */
  set(handle: "azimuth", value: number): Command;
  to(handle: "azimuth", value: number, opts?: { over?: number; ease?: Ease }): Command;
}
/* Примеры:
 *   s.world.sun({ elevation: 0.6, duration: 14 })
 *   sky.to('elevation', 20, { over: 8 })
 */

/** Силы мира: время суток (солнце, луна, звёзды), ветер (направление, сила, порывы), облачность, туман, температура. Объекты слушают их через ctx.wind(p), ctx.light(p), ctx.temperature(p), ctx.timeOfDay с собственной чувствительностью. Ручка time идёт по кругу: to(time, 26) приходит к 02:00 вперёд через полночь. Небо (облака, луна с фазой, звёзды, дымка) и свет на земле считает вид Sky по этим силам; облака плывут по ветру. Пресеты: dawn, noon, golden-hour, sunset, moonlit-night, overcast, foggy-morning. Ручки: time, windStrength, windDirection, gustiness, cloudiness, fog, temperature, moonPhase. Поведения: gust, calm, sunset, sunrise. */
export interface ForcesParams {
  /** время суток, часы (0–24; 5 — восход, 12 — полдень, 19 — закат, 0 — полночь). Ручкой можно дойти до 96: больше 24 — следующие сутки (26 = 02:00); от 0; до 24; по умолчанию 12 */
  time?: number;
  /** наибольшая высота солнца в полдень, ° (меньше — севернее или зимой); от 10; до 90; по умолчанию 62 */
  sunArc?: number;
  /** куда дует ветер, ° (0 — на север, +z; 90 — на восток, +x); от 0; до 360; по умолчанию 90 */
  windDirection?: number;
  /** сила ветра, м/с (2 — лёгкий, 8 — свежий, 15 — шторм); от 0; до 30; по умолчанию 2 */
  windStrength?: number;
  /** порывистость: доля, на которую сила ветра гуляет вверх-вниз сама; от 0; до 1; по умолчанию 0.3 */
  gustiness?: number;
  /** добавка к силе ветра от порыва, м/с (обычно 0; меняется поведением gust); от 0; до 30; по умолчанию 0 */
  gustBoost?: number;
  /** облачность: 0 ясно, 1 сплошные тучи (тускнеет свет солнца и луны); от 0; до 1; по умолчанию 0.15 */
  cloudiness?: number;
  /** туман: 0 нет, 1 густой; от 0; до 1; по умолчанию 0 */
  fog?: number;
  /** температура воздуха у земли, °C; от -50; до 60; по умолчанию 15 */
  temperature?: number;
  /** освещённость луны: 0 новолуние, 1 полнолуние; от 0; до 1; по умолчанию 1 */
  moonPhase?: number;
}
/** Пресеты Forces: dawn, noon, golden-hour, sunset, moonlit-night, overcast, foggy-morning */
export type ForcesPreset = "dawn" | "noon" | "golden-hour" | "sunset" | "moonlit-night" | "overcast" | "foggy-morning";
export interface Forces extends HandleBase {
  /** действие gust */
  gust(args?: {
    /** на сколько м/с сильнее на пике; от 0.5; до 30; по умолчанию 8 */
    strength?: number;
    /** сколько длится порыв, с; от 0.4; до 60; по умолчанию 3 */
    duration?: number;
  }): Command;
  /** действие calm */
  calm(args?: {
    /** за сколько секунд ветер стихает, с; от 0; до 600; по умолчанию 5 */
    over?: number;
  }): Command;
  /** действие sunset */
  sunset(args?: {
    /** за сколько секунд, с; от 0; до 3600; по умолчанию 40 */
    over?: number;
  }): Command;
  /** действие sunrise */
  sunrise(args?: {
    /** за сколько секунд, с; от 0; до 3600; по умолчанию 40 */
    over?: number;
  }): Command;
  /** Ручка «time»: время суток, часы; больше 24 — следующие сутки (26 = 02:00), мир показывает остаток от деления на 24. Единицы: ч. Диапазон 0…96. */
  set(handle: "time", value: number): Command;
  to(handle: "time", value: number, opts?: { over?: number; ease?: Ease }): Command;
  /** Ручка «windDirection»: куда дует ветер, ° (0 — на север, +z; 90 — на восток, +x). Единицы: °. Диапазон 0…360. */
  set(handle: "windDirection", value: number): Command;
  to(handle: "windDirection", value: number, opts?: { over?: number; ease?: Ease }): Command;
  /** Ручка «windStrength»: сила ветра, м/с (2 — лёгкий, 8 — свежий, 15 — шторм). Единицы: м/с. Диапазон 0…30. */
  set(handle: "windStrength", value: number): Command;
  to(handle: "windStrength", value: number, opts?: { over?: number; ease?: Ease }): Command;
  /** Ручка «gustiness»: порывистость: доля, на которую сила ветра гуляет вверх-вниз сама. Диапазон 0…1. */
  set(handle: "gustiness", value: number): Command;
  to(handle: "gustiness", value: number, opts?: { over?: number; ease?: Ease }): Command;
  /** Ручка «gustBoost»: добавка к силе ветра от порыва, м/с (обычно 0; меняется поведением gust). Единицы: м/с. Диапазон 0…30. */
  set(handle: "gustBoost", value: number): Command;
  to(handle: "gustBoost", value: number, opts?: { over?: number; ease?: Ease }): Command;
  /** Ручка «cloudiness»: облачность: 0 ясно, 1 сплошные тучи (тускнеет свет солнца и луны). Диапазон 0…1. */
  set(handle: "cloudiness", value: number): Command;
  to(handle: "cloudiness", value: number, opts?: { over?: number; ease?: Ease }): Command;
  /** Ручка «fog»: туман: 0 нет, 1 густой. Диапазон 0…1. */
  set(handle: "fog", value: number): Command;
  to(handle: "fog", value: number, opts?: { over?: number; ease?: Ease }): Command;
  /** Ручка «temperature»: температура воздуха у земли, °C. Единицы: °C. Диапазон -50…60. */
  set(handle: "temperature", value: number): Command;
  to(handle: "temperature", value: number, opts?: { over?: number; ease?: Ease }): Command;
  /** Ручка «moonPhase»: освещённость луны: 0 новолуние, 1 полнолуние. Диапазон 0…1. */
  set(handle: "moonPhase", value: number): Command;
  to(handle: "moonPhase", value: number, opts?: { over?: number; ease?: Ease }): Command;
}
/* Примеры:
 *   const forces = s.world.use('Forces', { time: 12, windStrength: 4 })
 *   s.at(10).do(forces.to('time', 19.5, { over: 40 }))   // закат за 40 с
 *   s.at(20).do(forces.gust({ strength: 10, duration: 3 }))
 *   s.at(30).do(robot.unlink('wind'))   // робот не слышит ветер
 */

/** Дорога-брусчатка вдоль пути scene.paths[path]. Рельеф под ней мягко выравнивается (ctx.heightAt), обочина плавная. Объявлять после Terrain. */
export interface RoadParams {
  /** id пути в scene.paths: ось дороги (точки в метрах, y игнорируется) */
  path: string;
  /** ширина мощения, м; от 0.5; до 20; по умолчанию 3.6 */
  width?: number;
  /** обочина: на такую ширину рельеф плавно переходит от дороги к холмам; от 0.2; до 30; по умолчанию 3 */
  shoulder?: number;
  /** на какой длине вдоль дороги выравнивается высота, м; от 0; до 80; по умолчанию 10 */
  smooth?: number;
  /** размер камня брусчатки, м; от 0.05; до 1; по умолчанию 0.22 */
  stone?: number;
}
/** Пресеты Road: lane, wide, footpath */
export type RoadPreset = "lane" | "wide" | "footpath";
export type Road = HandleBase;
/* Примеры:
 *   s.path('road', { points: [[0,0,-20],[0,0,20]] }); s.world.use('Road', { path: 'road', width: 3.6 })
 */

/** Механическое многоногое существо (паук, краб). Ходит по рельефу, ноги шагают двумя группами. */
export interface MultipedParams {
  /** от 4; до 12; по умолчанию 8 */
  legs?: number;
  /** от 0.3; до 5; по умолчанию 1.35 */
  bodyHeight?: number;
  /** от 0.2; до 6; по умолчанию 1.75 */
  upperLeg?: number;
  /** от 0.2; до 6; по умолчанию 2.15 */
  lowerLeg?: number;
  /** по умолчанию "#ff5a1f" */
  color?: string /* '#rrggbb' */;
}
export interface Multiped extends HandleBase {
  /** действие walkTo */
  walkTo(args: {
    to: string | [number, number, number];
    /** от 0; до 5; по умолчанию 2 */
    speed?: number;
  }): Command;
  /** действие followPath */
  followPath(args: {
    path: string;
    /** от 0; до 5; по умолчанию 2 */
    speed?: number;
    /** по умолчанию true */
    loop?: boolean;
  }): Command;
  /** действие stop */
  stop(args?: Record<string, unknown>): Command;
  /** действие lookAt */
  lookAt(args: {
    target: string | [number, number, number] | "camera" | null;
  }): Command;
}
/* Примеры:
 *   spider.followPath({ path: "valleyLoop", speed: 2 })
 *   spider.walkTo({ to: "lakeShore", speed: 1.5 })
 */

/** Вид плёнки: теплота, контраст, насыщенность, виньетка, рамка кадра (2.39:1 или 9:16), сила солнечных лучей. Пресеты: neutral, cinema, warm-evening, vertical. Без компонента в сцене пост-проходов нет. */
export interface FilmLookParams {
  /** от -1; до 1; по умолчанию 0.35 */
  warmth?: number;
  /** от 0.5; до 1.5; по умолчанию 1.06 */
  contrast?: number;
  /** от 0; до 2; по умолчанию 1.08 */
  saturation?: number;
  /** от 0; до 1; по умолчанию 0.35 */
  vignette?: number;
  /** по умолчанию "none" */
  crop?: "none" | "2.39:1" | "9:16";
  /** от 0; до 2; по умолчанию 0.6 */
  rays?: number;
}
/** Пресеты FilmLook: neutral, cinema, warm-evening, vertical */
export type FilmLookPreset = "neutral" | "cinema" | "warm-evening" | "vertical";
export interface FilmLook extends HandleBase {
  /** действие look */
  look(args?: {
    /** от -1; до 1 */
    warmth?: number;
    /** от 0.5; до 1.5 */
    contrast?: number;
    /** от 0; до 2 */
    saturation?: number;
    /** от 0; до 1 */
    vignette?: number;
    crop?: "none" | "2.39:1" | "9:16";
    /** от 0; до 2 */
    rays?: number;
  }): Command;
  /** действие lookPreset */
  lookPreset(args: {
    name: "neutral" | "cinema" | "warm-evening" | "vertical";
  }): Command;
  /** Ручка «warmth»: . Диапазон -1…1. */
  set(handle: "warmth", value: number): Command;
  to(handle: "warmth", value: number, opts?: { over?: number; ease?: Ease }): Command;
  /** Ручка «contrast»: . Диапазон 0.5…1.5. */
  set(handle: "contrast", value: number): Command;
  to(handle: "contrast", value: number, opts?: { over?: number; ease?: Ease }): Command;
  /** Ручка «saturation»: . Диапазон 0…2. */
  set(handle: "saturation", value: number): Command;
  to(handle: "saturation", value: number, opts?: { over?: number; ease?: Ease }): Command;
  /** Ручка «vignette»: . Диапазон 0…1. */
  set(handle: "vignette", value: number): Command;
  to(handle: "vignette", value: number, opts?: { over?: number; ease?: Ease }): Command;
  /** Ручка «crop»: . Только скачком (set); to держит старое до конца отрезка. */
  set(handle: "crop", value: "none" | "2.39:1" | "9:16"): Command;
  to(handle: "crop", value: "none" | "2.39:1" | "9:16", opts?: { over?: number; ease?: Ease }): Command;
  /** Ручка «rays»: . Диапазон 0…2. */
  set(handle: "rays", value: number): Command;
  to(handle: "rays", value: number, opts?: { over?: number; ease?: Ease }): Command;
}
/* Примеры:
 *   s.world.use('FilmLook', { ...FILM_LOOK_PRESETS.cinema })
 *   s.at(40).world.look({ vignette: 0.6 })
 */

/** Колёсный робот-исследователь (семейство Biped не нужно: два колеса на оси). Катится, сам балансирует корпус, гибкая антенна (качается от ветра), один большой глаз с веком и зрачком (щурится от яркого света в лицо), рука с захватом, луч сканера. Ручки: lightColor, windSensitivity, lightSensitivity. Слушает силы мира: ветер и свет. */
export interface RobotParams {
  /** рост до макушки головы, м (без антенны); от 0.1; до 3; по умолчанию 0.335 */
  height?: number;
  /** ширина корпуса, множитель; от 0.6; до 1.6; по умолчанию 1 */
  bodyWidth?: number;
  /** высота корпуса, множитель; от 0.6; до 1.6; по умолчанию 1 */
  bodyHeight?: number;
  /** размер головы, множитель; от 0.6; до 1.6; по умолчанию 1 */
  headSize?: number;
  /** диаметр колёс, множитель; от 0.5; до 1.8; по умолчанию 1 */
  wheelDiameter?: number;
  /** цвет корпуса (пластик); по умолчанию "#fffaf1" */
  bodyColor?: string /* '#rrggbb' */;
  /** цвет огней: глаз, кольца, антенна, луч; по умолчанию "#59fff3" */
  lightColor?: string /* '#rrggbb' */;
  /** чувствительность антенны к ветру: 0 не качается, 1 как есть, 3 флюгер; от 0; до 3; по умолчанию 1 */
  windSensitivity?: number;
  /** насколько глаз щурится от яркого света в лицо: 0 не щурится; от 0; до 1; по умолчанию 0.8 */
  lightSensitivity?: number;
}
/** Пресеты Robot: explorer, scout, hauler */
export type RobotPreset = "explorer" | "scout" | "hauler";
export interface Robot extends HandleBase {
  /** действие roll */
  roll(args: {
    /** куда ехать: точка, место или сущность */
    to: string | [number, number, number];
    /** крейсерская скорость, м/с; от 0.05; до 3; по умолчанию 0.6 */
    speed?: number;
    /** разгон, м/с²; от 0.1; до 5; по умолчанию 1 */
    accel?: number;
    /** торможение, м/с²; от 0.1; до 5; по умолчанию 1.5 */
    decel?: number;
    /** предельная скорость поворота, °/с; от 10; до 360; по умолчанию 140 */
    turnRate?: number;
  }): Command;
  /** действие turn */
  turn(args?: {
    /** развернуться лицом к точке, месту или сущности */
    to?: string | [number, number, number];
    /** развернуться на курс, градусы (0 = +Z) */
    heading?: number;
    /** скорость поворота, °/с; от 10; до 360; по умолчанию 120 */
    rate?: number;
  }): Command;
  /** действие stop */
  stop(args?: Record<string, unknown>): Command;
  /** действие look */
  look(args?: {
    /** куда смотреть; null или без — прямо */
    target?: string | [number, number, number] | "camera" | null;
    /** поворот головы влево, °, если цели нет; от -110; до 110 */
    yaw?: number;
    /** наклон взгляда вверх, °, если цели нет; от -35; до 35 */
    pitch?: number;
  }): Command;
  /** действие tilt */
  tilt(args?: {
    /** наклон головы к левому уху, °; от -45; до 45; по умолчанию 20 */
    angle?: number;
  }): Command;
  /** действие blink */
  blink(args?: {
    /** длительность моргания, с; от 0.08; до 1; по умолчанию 0.22 */
    duration?: number;
  }): Command;
  /** действие squint */
  squint(args?: {
    /** насколько открыт глаз, 0 закрыт; от 0; до 0.9; по умолчанию 0.35 */
    amount?: number;
    /** сколько держать, с; от 0; до 30; по умолчанию 0.8 */
    hold?: number;
  }): Command;
  /** действие wide */
  wide(args?: {
    /** насколько расширить зрачок; от 0; до 1; по умолчанию 1 */
    amount?: number;
    /** сколько держать, с; от 0; до 30; по умолчанию 0.8 */
    hold?: number;
  }): Command;
  /** действие scan */
  scan(args?: {
    /** луч включён; по умолчанию true */
    on?: boolean;
    /** куда светить (голова повернётся), без цели — куда смотрит */
    target?: string | [number, number, number] | "camera" | null;
  }): Command;
  /** действие reach */
  reach(args?: {
    /** куда тянуть руку; без цели — к земле у левого бока, null — сложить */
    to?: string | [number, number, number] | null;
    /** раскрытие захвата; от 0; до 1; по умолчанию 0.9 */
    grip?: number;
    /** за сколько секунд, с; от 0.2; до 5; по умолчанию 0.9 */
    duration?: number;
  }): Command;
  /** действие startle */
  startle(args?: {
    /** сила испуга; от 0.1; до 1.5; по умолчанию 1 */
    intensity?: number;
  }): Command;
  /** Ручка «lightColor»: цвет огней: глаз, кольца, антенна, луч. */
  set(handle: "lightColor", value: string /* '#rrggbb' */): Command;
  to(handle: "lightColor", value: string /* '#rrggbb' */, opts?: { over?: number; ease?: Ease }): Command;
  /** Ручка «windSensitivity»: чувствительность антенны к ветру: 0 не качается, 1 как есть, 3 флюгер. Диапазон 0…3. */
  set(handle: "windSensitivity", value: number): Command;
  to(handle: "windSensitivity", value: number, opts?: { over?: number; ease?: Ease }): Command;
  /** Ручка «lightSensitivity»: насколько глаз щурится от яркого света в лицо: 0 не щурится. Диапазон 0…1. */
  set(handle: "lightSensitivity", value: number): Command;
  to(handle: "lightSensitivity", value: number, opts?: { over?: number; ease?: Ease }): Command;
}
/* Примеры:
 *   robot.roll({ to: [3, 0, 0], speed: 1, accel: 1.2, decel: 1.5 })
 *   robot.look({ target: "camera" })
 *   robot.blink({})
 *   robot.reach({})
 *   robot.scan({ on: true })
 *   robot.startle({ intensity: 1 })
 */

/** Дерево или куст одного семейства (на ez-tree): дуб, ясень, осина, берёза, сосна, ель, кусты, ива — пресеты одного рецепта; seed делает каждое дерево своим. Растёт (age), меняется по сезонам (season: весна, лето, жёлтая и красная осень, голое, зима), сбрасывает листья (shed, shedLeaves), покрывается снегом (snow, тает в тепле), качается от ветра (берёза сильнее дуба; windSensitivity). Ручки: age, season, snow, shed, windSensitivity. Слушает силы мира: ветер, температура. */
export interface TreeParams {
  /** рецепт породы: oak дуб, ash ясень, aspen осина, birch берёза, pine сосна, spruce ель, bush1–3 кусты, willow ива; по умолчанию "oak" */
  species?: "oak" | "ash" | "aspen" | "birch" | "pine" | "spruce" | "bush1" | "bush2" | "bush3" | "willow";
  /** зерно: у каждого дерева свой рисунок ветвей при той же породе; от 0; до 999999; по умолчанию 35729 */
  seed?: number;
  /** рост взрослого дерева, м (в возрасте 0.5); от 0.3; до 60; по умолчанию 12 */
  height?: number;
  /** толщина ствола, множитель; от 0.4; до 2.5; по умолчанию 1 */
  trunk?: number;
  /** сколько ветвей, множитель; от 0.3; до 2; по умолчанию 1 */
  branching?: number;
  /** раскрытие ветвей: добавка к углу ветвей, °; от -30; до 40; по умолчанию 0 */
  spread?: number;
  /** кривизна ствола и ветвей, множитель; от 0; до 3; по умолчанию 1 */
  crooked?: number;
  /** размер листьев, множитель; от 0.4; до 2.5; по умолчанию 1 */
  leafSize?: number;
  /** густота кроны (листьев на веточку), множитель; от 0.2; до 1.5; по умолчанию 1 */
  leafCount?: number;
  /** оттенок коры (белый — как у породы); по умолчанию "#ffffff" */
  barkTint?: string /* '#rrggbb' */;
  /** цвет листвы летом; по умолчанию "#5a9433" */
  leafColor?: string /* '#rrggbb' */;
  /** цвет листвы осенью (часть листьев краснее); по умолчанию "#d98a1c" */
  autumnColor?: string /* '#rrggbb' */;
  /** возраст: 0 саженец, 0.5 взрослое дерево, 1 старое (шире, реже крона); от 0; до 1; по умолчанию 0.5 */
  age?: number;
  /** сезон: 0 весна, 0.3 лето, 0.5 осень (жёлтая, красная), 0.8 листья опали, 1 зима; от 0; до 1; по умолчанию 0.3 */
  season?: number;
  /** снег на ветвях и листьях (тает при температуре выше нуля); от 0; до 1; по умолчанию 0 */
  snow?: number;
  /** листопад: доля листьев, что уже опала; от 0; до 1; по умолчанию 0 */
  shed?: number;
  /** чувствительность к ветру: 0 стоит, 1 как у породы (берёза качается сильнее дуба), 3 флюгер; от 0; до 3; по умолчанию 1 */
  windSensitivity?: number;
}
/** Пресеты Tree: oak, ash, aspen, birch, pine, spruce, bush1, bush2, bush3, willow */
export type TreePreset = "oak" | "ash" | "aspen" | "birch" | "pine" | "spruce" | "bush1" | "bush2" | "bush3" | "willow";
export interface Tree extends HandleBase {
  /** действие shedLeaves */
  shedLeaves(args?: {
    /** за сколько секунд опадает листва, с; от 0.5; до 600; по умолчанию 6 */
    over?: number;
    /** сколько листьев должно опасть к концу, доля; от 0; до 1; по умолчанию 1 */
    to?: number;
  }): Command;
  /** Ручка «age»: возраст: 0 саженец, 0.5 взрослое дерево, 1 старое (шире, реже крона). Диапазон 0…1. */
  set(handle: "age", value: number): Command;
  to(handle: "age", value: number, opts?: { over?: number; ease?: Ease }): Command;
  /** Ручка «season»: сезон: 0 весна, 0.3 лето, 0.5 осень (жёлтая, красная), 0.8 листья опали, 1 зима. Диапазон 0…1. */
  set(handle: "season", value: number): Command;
  to(handle: "season", value: number, opts?: { over?: number; ease?: Ease }): Command;
  /** Ручка «snow»: снег на ветвях и листьях (тает при температуре выше нуля). Диапазон 0…1. */
  set(handle: "snow", value: number): Command;
  to(handle: "snow", value: number, opts?: { over?: number; ease?: Ease }): Command;
  /** Ручка «shed»: листопад: доля листьев, что уже опала. Диапазон 0…1. */
  set(handle: "shed", value: number): Command;
  to(handle: "shed", value: number, opts?: { over?: number; ease?: Ease }): Command;
  /** Ручка «windSensitivity»: чувствительность к ветру: 0 стоит, 1 как у породы (берёза качается сильнее дуба), 3 флюгер. Диапазон 0…3. */
  set(handle: "windSensitivity", value: number): Command;
  to(handle: "windSensitivity", value: number, opts?: { over?: number; ease?: Ease }): Command;
}
/* Примеры:
 *   const oak = s.add('Tree', { species: 'oak', seed: 7, height: 12 }, { at: 'meadow' })
 *   s.at(5).do(oak.to("season", 0.58, { over: 20 }))   // лето → осень
 *   s.at(25).do(oak.shedLeaves({ over: 8 }))   // листопад
 *   s.at(40).do(oak.to("snow", 1, { over: 6 }))   // снег ложится, если холодно
 *   birch.set("windSensitivity", 2)   // чутче к ветру
 */

/** кадр «establishing»: Общий план: высоко и далеко, сзади-сбоку. Показывает, где происходит действие. */
export type EstablishingShotArgs = {
  target: string | [number, number, number];
  /** по умолчанию "right" */
  side?: "left" | "right";
  /** от 10; до 110 */
  fov?: number;
  /** от 0; до 30 */
  aim?: number;
  /** от 0.02; до 5 */
  clearance?: number;
  /** от 5; до 200; по умолчанию 38 */
  distance?: number;
  /** от 2; до 100; по умолчанию 15 */
  height?: number;
};

/** кадр «follow»: Камера следует сзади-сбоку на небольшой дистанции. */
export type FollowShotArgs = {
  target: string | [number, number, number];
  /** по умолчанию "right" */
  side?: "left" | "right";
  /** от 10; до 110 */
  fov?: number;
  /** от 0; до 30 */
  aim?: number;
  /** от 0.02; до 5 */
  clearance?: number;
  /** от 1; до 50; по умолчанию 8 */
  distance?: number;
  /** от 0.2; до 30; по умолчанию 2.6 */
  height?: number;
};

/** кадр «lowAngle»: Низкая точка спереди-сбоку, снизу вверх: существо выглядит крупным. */
export type LowAngleShotArgs = {
  target: string | [number, number, number];
  /** по умолчанию "right" */
  side?: "left" | "right";
  /** от 10; до 110 */
  fov?: number;
  /** от 0; до 30 */
  aim?: number;
  /** от 0.02; до 5 */
  clearance?: number;
  /** от 1; до 50; по умолчанию 7 */
  distance?: number;
};

/** кадр «orbit»: Камера кружит вокруг цели с постоянной скоростью (градусов в секунду). */
export type OrbitShotArgs = {
  target: string | [number, number, number];
  /** по умолчанию "right" */
  side?: "left" | "right";
  /** от 10; до 110 */
  fov?: number;
  /** от 0; до 30 */
  aim?: number;
  /** от 0.02; до 5 */
  clearance?: number;
  /** от 1; до 80; по умолчанию 10 */
  distance?: number;
  /** от 0.2; до 40; по умолчанию 4 */
  height?: number;
  /** от -90; до 90; по умолчанию 14 */
  speed?: number;
};

/** кадр «closeup»: Крупный план. on: "eyes" — на голову, иначе на корпус. */
export type CloseupShotArgs = {
  target: string | [number, number, number];
  /** по умолчанию "right" */
  side?: "left" | "right";
  /** от 10; до 110 */
  fov?: number;
  /** от 0; до 30 */
  aim?: number;
  /** от 0.02; до 5 */
  clearance?: number;
  /** от 0.5; до 30; по умолчанию 8 */
  distance?: number;
  /** по умолчанию "body" */
  on?: "eyes" | "body";
};

/** кадр «crane»: Кран: камера поднимается вверх, открывая окружение. duration — за сколько секунд. */
export type CraneShotArgs = {
  target: string | [number, number, number];
  /** по умолчанию "right" */
  side?: "left" | "right";
  /** от 10; до 110 */
  fov?: number;
  /** от 0; до 30 */
  aim?: number;
  /** от 0.02; до 5 */
  clearance?: number;
  /** от 2; до 100; по умолчанию 16 */
  distance?: number;
  /** от 0.3; до 60; по умолчанию 2 */
  from?: number;
  /** от 0.3; до 120; по умолчанию 26 */
  to?: number;
  /** от 0.5; до 120; по умолчанию 10 */
  duration?: number;
};

/** кадр «fixed»: Камера в заданной точке и смотрит в заданную точку, опционально едет по прямой. Высоты — над землёй (aboveGround) или абсолютные. */
export type FixedShotArgs = {
  /** [x, высота, z], м */
  at: [number, number, number];
  /** куда смотрит [x, высота, z], м */
  look: [number, number, number];
  /** высоты отсчитываются от земли под точкой; по умолчанию true */
  aboveGround?: boolean;
  /** скорость по земле [vx, vz], м/с: камера и точка взгляда едут вместе; по умолчанию [0,0] */
  velocity?: [number, number];
  /** от 10; до 110; по умолчанию 50 */
  fov?: number;
};

/** кадр «glide»: Камера плавно едет из точки в точку и так же смотрит из точки в точку за duration секунд (кривая ease-in-out), потом стоит. Высоты — абсолютные (можно под воду) или над землёй (aboveGround). */
export type GlideShotArgs = {
  /** откуда [x, высота, z], м */
  from: [number, number, number];
  /** куда [x, высота, z], м */
  to: [number, number, number];
  /** куда смотрит в начале [x, высота, z], м */
  lookFrom: [number, number, number];
  /** куда смотрит в конце [x, высота, z], м */
  lookTo: [number, number, number];
  /** за сколько секунд, с; от 0.1; до 120; по умолчанию 4 */
  duration?: number;
  /** высоты отсчитываются от земли под точкой; по умолчанию false */
  aboveGround?: boolean;
  /** от 10; до 110; по умолчанию 50 */
  fov?: number;
};

export interface Director {
  places(p: Record<string, [number, number, number]>): void;
  path(id: string, p: { points: [number, number, number][]; closed?: boolean }): void;
  /** Поставить компонент мира; возвращает ручку для команд (forces.to('time', 19.5, { over: 40 })). */
  world: { use<K extends keyof Components>(type: K, params?: Partial<Components[K]['params']>): Components[K]['handle'] };
  add(type: string, params?: Record<string, unknown>, spawn?: { at: string | [number, number, number]; heading?: number; id?: string }): any;
  /** Настроение: набор изменений ручек разных объектов; s.at(t).mood(name) применяет. */
  mood(name: string, changes: Command[]): void;
  at(t: number): {
    do(...cmds: Command[]): void;
    mood(name: string): void;
    camera: { shot(name: string, args?: Record<string, unknown>): void; focus(a?: { focus?: number | 'target'; range?: number; strength?: number }): void };
  };
}
export interface Components {
  Terrain: { params: TerrainParams; handle: Terrain };
  Water: { params: WaterParams; handle: Water };
  Sky: { params: SkyParams; handle: Sky };
  Forces: { params: ForcesParams; handle: Forces };
  Road: { params: RoadParams; handle: Road };
  Multiped: { params: MultipedParams; handle: Multiped };
  FilmLook: { params: FilmLookParams; handle: FilmLook };
  Robot: { params: RobotParams; handle: Robot };
  Tree: { params: TreeParams; handle: Tree };
}
