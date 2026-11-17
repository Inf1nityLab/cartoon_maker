import { buildScene } from '@cartoon/director';

/**
 * Тестовая сцена задачи 1.4 «земля и дорога»: брусчатая дорога 40 м по холмам, солнце 30°, три камеры.
 * Камера и время: t=0…9 — у земли вдоль дороги (0.5 м, едет 2 м/с), t=10 — сбоку 3 м, t=20 — сверху 20 м.
 */
export const testRoad = buildScene(
  (s) => {
    s.world.use('Terrain', { style: 'hills', seed: 11, amplitude: 9, scale: 0.04, size: 160, segments: 480, ground: 'soil' });
    s.world.use('Water', {});
    s.world.use('Sky', { elevation: 30, azimuth: 130 });
    s.path('road', { points: [[0, 0, -20], [0.8, 0, -8], [-0.8, 0, 6], [0, 0, 20]] });
    s.world.use('Road', { path: 'road', width: 3.6, shoulder: 3 });
    s.at(0).camera.shot('fixed', { at: [0, 0.5, -19], look: [0, 0.5, 4], velocity: [0, 2], fov: 50 });
    s.at(10).camera.shot('fixed', { at: [3, 1, -3], look: [0, 0.3, 2], fov: 50 });
    s.at(20).camera.shot('fixed', { at: [0, 20, -9], look: [0, 0, 3], aboveGround: false, fov: 50 });
  },
  { id: 'test-road', title: 'Тест 1.4: дорога', duration: 30, seed: 11 },
);
