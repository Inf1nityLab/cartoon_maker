import { z } from 'zod';
import { Hex } from '@cartoon/schema';

/**
 * Облик робота. Все пропорции — множители относительно утверждённого «Исследователя» (1 = как в пресете),
 * поэтому схема не знает про внутренние размеры модели. Единицы: метры, hex-цвета (правило 8).
 */
export const RobotParams = z.object({
  height: z.number().min(0.1).max(3).default(0.335).describe('рост до макушки головы, м (без антенны)'),
  bodyWidth: z.number().min(0.6).max(1.6).default(1).describe('ширина корпуса, множитель'),
  bodyHeight: z.number().min(0.6).max(1.6).default(1).describe('высота корпуса, множитель'),
  headSize: z.number().min(0.6).max(1.6).default(1).describe('размер головы, множитель'),
  wheelDiameter: z.number().min(0.5).max(1.8).default(1).describe('диаметр колёс, множитель'),
  bodyColor: Hex.default('#fffaf1').describe('цвет корпуса (пластик)'),
  lightColor: Hex.default('#59fff3').describe('цвет огней: глаз, кольца, антенна, луч'),
});
export type RobotParams = z.infer<typeof RobotParams>;

/** Пресеты облика. `explorer` — утверждённый владельцем «Исследователь» (песочница, последний круг правок). */
export const ROBOT_PRESETS: Record<string, RobotParams> = {
  explorer: RobotParams.parse({}),
};

/**
 * Размеры сборки в «единичных» метрах (рост 1:1 с пресетом) и масштаб до реального роста.
 * Логика и вид считают размеры одной функцией, поэтому колёса катятся ровно на пройденный путь.
 */
export function robotDims(p: RobotParams) {
  const w = p.bodyWidth, h = p.bodyHeight, d = p.wheelDiameter;
  const bodyTop = 0.2 * h;
  const wheelR = 0.07 * d;
  const wheelHW = 0.0275 * d;
  const bodyR = 0.078 * w;
  const wheelX = 0.116 + (w - 1) * 0.078 + (d - 1) * 0.0275;
  const neckY = bodyTop - 0.005;
  const headR = 0.066 * p.headSize;
  const headY = 0.05 * p.headSize;
  // макушка головы над землёй в единичных метрах
  const top = neckY + 0.02 + headY + 0.004 * p.headSize + headR;
  const scale = p.height / top;
  return { bodyTop, wheelR, wheelHW, bodyR, wheelX, neckY, headR, headY, top, scale, headH: neckY + 0.02 + headY };
}
export type RobotDims = ReturnType<typeof robotDims>;
