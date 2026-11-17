/** Режим кадра. Чистые данные, без Three.js: тестируется в node. */
export type FrameMode = 'preview' | 'film';

export type FrameOptions = {
  /** 'film' — фиксированное качество и разрешение, без подстройки под скорость; кадр зависит только от t таймлайна. */
  mode?: FrameMode;
  /** Размер кадра в «CSS-пикселях». В режиме film обязателен и не меняется за всё время жизни адаптера. */
  filmSize?: { w: number; h: number };
  /** Пикселей на «CSS-пиксель». Для film по умолчанию 1 (не зависит от экрана), для preview — что передали (по умолчанию 1). */
  pixelRatio?: number;
  /** MSAA цели сцены (1 или 4). По умолчанию 4; при включённом TAA цель всегда без MSAA (джиттер сам сглаживает). */
  samples?: 1 | 4;
  /** Временное сглаживание. По умолчанию включено. */
  taa?: TaaOptions;
};

export type TaaOptions = {
  /** false — без TAA (если не задан accumulate). По умолчанию true. */
  enabled?: boolean;
  /**
   * N ≥ 1 — режим накопления (для экспорта): каждый кадр — среднее N джиттер-сэмплов в один и тот же момент, история
   * между кадрами не переносится, кадр зависит только от t. Перекрывает enabled. По умолчанию 0 (обычный TAA).
   */
  accumulate?: number;
  /** Сколько кадров в тот же t рисуется без показа после склейки/перемотки, чтобы история не была пустой. По умолчанию 3. */
  warmup?: number;
};

/** off — без временного сглаживания; taa — история между кадрами; accumulate — N сэмплов на кадр, без истории. */
export type AaMode = 'off' | 'taa' | 'accumulate';

export type ResolvedFrame = {
  mode: FrameMode;
  pixelRatio: number;
  /** MSAA цели сцены с учётом TAA: при aa.mode === 'taa' всегда 1. */
  samples: 1 | 4;
  aa: { mode: AaMode; accumulate: number; warmup: number };
  /** Размер кадра для запрошенного размера окна: в film всегда filmSize, в preview — как просили. */
  size(requested: { w: number; h: number }): { w: number; h: number };
  /** Размер цели рендера в пикселях для кадра размера `s`. */
  pixels(s: { w: number; h: number }): { w: number; h: number };
};

export function resolveFrame(opts: FrameOptions = {}): ResolvedFrame {
  const mode = opts.mode ?? 'preview';
  if (mode === 'film') {
    const f = opts.filmSize;
    if (!f || !(f.w > 0) || !(f.h > 0)) throw new Error("render-three: режиму 'film' нужен filmSize {w,h}");
  }
  const pixelRatio = opts.pixelRatio ?? 1;
  if (!(pixelRatio > 0)) throw new Error('render-three: pixelRatio должен быть > 0');
  const accumulate = opts.taa?.accumulate ?? 0;
  if (!Number.isInteger(accumulate) || accumulate < 0 || accumulate > 256) throw new Error('render-three: taa.accumulate — целое от 0 до 256');
  const warmup = opts.taa?.warmup ?? 3;
  if (!Number.isInteger(warmup) || warmup < 0 || warmup > 32) throw new Error('render-three: taa.warmup — целое от 0 до 32');
  const aaMode: AaMode = accumulate > 0 ? 'accumulate' : (opts.taa?.enabled ?? true) ? 'taa' : 'off';
  const fixed = mode === 'film' ? { w: Math.round(opts.filmSize!.w), h: Math.round(opts.filmSize!.h) } : null;
  return {
    mode,
    pixelRatio,
    samples: aaMode === 'taa' ? 1 : (opts.samples ?? 4),
    aa: { mode: aaMode, accumulate, warmup },
    size: (r) => fixed ?? r,
    pixels: (s) => ({ w: Math.max(1, Math.round(s.w * pixelRatio)), h: Math.max(1, Math.round(s.h * pixelRatio)) }),
  };
}
