import { z } from 'zod';
import { defineComponent } from '@cartoon/engine';

/**
 * «Вид плёнки»: цвет, виньетка, рамка кадра, солнечные лучи. Чистые данные для render-three (пост-проход после
 * сглаживания). Глубина резкости сюда НЕ входит — это свойство объектива и живёт в состоянии камеры (`camera.focus`).
 * Версия 1. Правило 7: смена поведения — новая версия + миграция (migrate) + тест.
 */
const shape = {
  /** Тёплый (+) или холодный (−) оттенок, −1…1. */
  warmth: z.number().min(-1).max(1).default(0.35),
  /** Контраст вокруг серого 0.18 (1 — без изменений). */
  contrast: z.number().min(0.5).max(1.5).default(1.06),
  /** Насыщенность (1 — без изменений). */
  saturation: z.number().min(0).max(2).default(1.08),
  /** Тёмные углы, 0…1. */
  vignette: z.number().min(0).max(1).default(0.35),
  /** Рамка: none — весь кадр; 2.39:1 — кинополосы; 9:16 — вертикальный кадр в центре, остальное чёрное. */
  crop: z.enum(['none', '2.39:1', '9:16']).default('none'),
  /** Сила солнечных лучей (god rays), 0 — не считаются совсем. */
  rays: z.number().min(0).max(2).default(0.6),
};
export const FilmLookParams = z.object(shape);
/** Действие look: меняет только названные поля (схема без значений по умолчанию, иначе неназванные сбросились бы). */
const LookPatch = z.object({
  warmth: shape.warmth.unwrap().optional(), contrast: shape.contrast.unwrap().optional(), saturation: shape.saturation.unwrap().optional(),
  vignette: shape.vignette.unwrap().optional(), crop: shape.crop.unwrap().optional(), rays: shape.rays.unwrap().optional(),
});
export type FilmLookParams = z.infer<typeof FilmLookParams>;

/** Пресеты: полный набор значений. Действие `preset` и пример в describe берут отсюда. */
export const FILM_LOOK_PRESETS = {
  neutral: { warmth: 0, contrast: 1, saturation: 1, vignette: 0, crop: 'none', rays: 0 },
  cinema: { warmth: 0.35, contrast: 1.06, saturation: 1.08, vignette: 0.35, crop: '2.39:1', rays: 0.6 },
  'warm-evening': { warmth: 0.7, contrast: 1.1, saturation: 1.15, vignette: 0.45, crop: 'none', rays: 1 },
  vertical: { warmth: 0.3, contrast: 1.06, saturation: 1.08, vignette: 0.3, crop: '9:16', rays: 0.6 },
} as const satisfies Record<string, FilmLookParams>;
export type FilmLookPreset = keyof typeof FILM_LOOK_PRESETS;
const PRESET_NAMES = Object.keys(FILM_LOOK_PRESETS) as [FilmLookPreset, ...FilmLookPreset[]];

export const FilmLook = defineComponent<FilmLookParams, FilmLookParams>({
  type: 'FilmLook',
  version: 1,
  describe: 'Вид плёнки: теплота, контраст, насыщенность, виньетка, рамка кадра (2.39:1 или 9:16), сила солнечных лучей. Пресеты: neutral, cinema, warm-evening, vertical. Без компонента в сцене пост-проходов нет.',
  params: FilmLookParams,
  presets: FILM_LOOK_PRESETS,
  // все шесть полей — ручки (6.7): сразу, по кривой («виньетка нарастает за 5 с») или действием look
  handles: { warmth: {}, contrast: {}, saturation: {}, vignette: {}, crop: {}, rays: {} },
  actions: {
    look: LookPatch,
    lookPreset: z.object({ name: z.enum(PRESET_NAMES) }),
  },
  create: (_ctx, p) => ({ ...p }),
  step() {},
  // действия — поведения: меняют ручки сразу в момент события, как и раньше меняли поля
  onAction(_self, name, args, ctx) {
    const patch = name === 'lookPreset' ? FILM_LOOK_PRESETS[(args as { name: FilmLookPreset }).name] : (args as Partial<FilmLookParams>);
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) ctx.handles.set(k, v);
  },
  showcase: {
    kind: 'world', size: 12, eye: 1.5,
    demos: [{
      title: 'Плёнка: от нейтральной к тёплому вечеру и полосам',
      duration: 10,
      steps: [
        { t: 0, action: 'lookPreset', args: { name: 'neutral' } },
        { t: 1, action: 'handle.to', args: { handle: 'warmth', value: 0.8, over: 4, ease: 'ease-in-out' } },
        { t: 1, action: 'handle.to', args: { handle: 'vignette', value: 0.6, over: 4, ease: 'ease-out' } },
        { t: 5.5, action: 'handle.set', args: { handle: 'crop', value: '2.39:1' } },
        { t: 6, action: 'handle.to', args: { handle: 'saturation', value: 1.5, over: 3, ease: 'linear' } },
      ],
    }],
  },
  // вид — не часть «что видит ИИ»: хэш WorldState от него не зависит
  state: () => ({}),
  migrate: {},
  examples: ["s.world.use('FilmLook', { ...FILM_LOOK_PRESETS.cinema })", "s.at(40).world.look({ vignette: 0.6 })"],
});
