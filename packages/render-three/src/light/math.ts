/** Чистая математика света без Three.js (тестируется в node): направление солнца, цвет и сила от высоты, каскады теней. */

const RAD = Math.PI / 180;

/** Единичный вектор «на солнце»: высота над горизонтом и азимут в градусах (0 — север, +z; 90 — восток, +x). */
export function sunVector(elevation: number, azimuth: number): [number, number, number] {
  const el = Math.max(elevation, 0.5) * RAD, az = azimuth * RAD; // ниже горизонта солнце не светит снизу: зажим 0.5°
  return [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
}

/** Доля «дня» 0…1: 0 — на горизонте и ниже, 1 — от 30° и выше. Всё остальное освещение берётся от неё. */
export const dayK = (elevation: number): number => Math.max(0, Math.min(1, elevation / 30));

/** Сила прямого света, неба (hemi) и экспозиция по высоте солнца. */
export function sunLevels(elevation: number): { sun: number; hemi: number; exposure: number } {
  const k = dayK(elevation);
  return { sun: (elevation < 0 ? 0.15 : 0.5) + 2.6 * k, hemi: 0.6 + 0.7 * k, exposure: 1.15 + 0.2 * k };
}

/** Границы каскадов теней, м от камеры: [0.1…a], [a…b], [b…c], [c…d]. Последняя — дальше тень не считаем (туман кончается раньше). */
export const SPLITS = [12, 40, 130, 420] as const;

/**
 * Сторона квадрата карты каскада, м: как считает CSMShadowNode — диагональ дальней грани среза камеры или диагональ
 * «ближний-дальний угол» среза, что больше. fov — вертикальный, градусы.
 */
export function cascadeExtent(near: number, far: number, fov: number, aspect: number): number {
  const hh = (d: number) => d * Math.tan((fov * RAD) / 2), hw = (d: number) => hh(d) * aspect;
  const farDiag = 2 * Math.hypot(hw(far), hh(far));
  const cross = Math.hypot(hw(far) + hw(near), hh(far) + hh(near), far - near);
  return Math.max(farDiag, cross);
}

/** Размер текселя каждого каскада, м, для камеры с данными fov, aspect и карты mapSize×mapSize. */
export function cascadeTexels(fov: number, aspect: number, mapSize: number, camNear = 0.1, splits: readonly number[] = SPLITS): number[] {
  return splits.map((to, i) => cascadeExtent(i === 0 ? camNear : splits[i - 1]!, to, fov, aspect) / mapSize);
}

/** Радиус мягкости PCF в текселях каскада: хотим ~4 см полутени, но не меньше 1.5 тексела (иначе лесенка) и не больше 4 (шум). */
export const pcfRadius = (texel: number): number => Math.max(1.5, Math.min(4, 0.04 / texel));
