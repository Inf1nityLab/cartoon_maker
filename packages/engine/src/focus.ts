import { z } from 'zod';

/**
 * Действие камеры `focus`: глубина резкости. Живёт в состоянии камеры (а не в компоненте), потому что фокус — свойство
 * объектива; план камеры (`shot`) его не сбрасывает, пока не придёт следующий `focus`.
 * focus — метры вдоль взгляда или 'target' (до точки, на которую смотрит камера: следует за ней сам);
 * range — полуширина зоны резкости, м; strength — макс. радиус нерезкости в пикселях кадра 720p (0 — выключено).
 */
export const CameraFocusArgs = z.object({
  focus: z.union([z.number().min(0.05).max(2000), z.literal('target')]).default('target'),
  range: z.number().min(0).max(1000).default(1),
  strength: z.number().min(0).max(40).default(12),
});
export type CameraFocusArgs = z.infer<typeof CameraFocusArgs>;
