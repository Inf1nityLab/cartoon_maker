/** Режим кадра. Чистые данные, без Three.js: тестируется в node. */
export type FrameMode = 'preview' | 'film';

export type FrameOptions = {
  /** 'film' — фиксированное качество и разрешение, без подстройки под скорость; кадр зависит только от t таймлайна. */
  mode?: FrameMode;
  /** Размер кадра в «CSS-пикселях». В режиме film обязателен и не меняется за всё время жизни адаптера. */
  filmSize?: { w: number; h: number };
  /** Пикселей на «CSS-пиксель». Для film по умолчанию 1 (не зависит от экрана), для preview — что передали (по умолчанию 1). */
  pixelRatio?: number;
  /** MSAA цели сцены (1 или 4). По умолчанию 4; TAA (задача 1.2) выставит 1. */
  samples?: 1 | 4;
};

export type ResolvedFrame = {
  mode: FrameMode;
  pixelRatio: number;
  samples: 1 | 4;
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
  const fixed = mode === 'film' ? { w: Math.round(opts.filmSize!.w), h: Math.round(opts.filmSize!.h) } : null;
  return {
    mode,
    pixelRatio,
    samples: opts.samples ?? 4,
    size: (r) => fixed ?? r,
    pixels: (s) => ({ w: Math.max(1, Math.round(s.w * pixelRatio)), h: Math.max(1, Math.round(s.h * pixelRatio)) }),
  };
}
