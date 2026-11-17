import { buildScene } from '@cartoon/director';

/**
 * Тестовая сцена робота (задача 3.1): ровная площадка, солнце 30°, сценарий ~15 с.
 * Робот катится вдоль +x, смотрит, моргает, тянет руку, включает луч и разворачивается.
 * Камеры — существующие планы; `aim` и `clearance` настраивают их под рост 0.33 м.
 */
export const testRobot = buildScene(
  (s) => {
    s.world.use('Terrain', { style: 'flat' });
    s.world.use('Water', {});
    s.world.use('Sky', { elevation: 30, azimuth: 60 });
    s.places({ start: [-1.5, 0, 0], stop: [1.8, 0, 0] });

    const robot = s.add('Robot', {}, { at: 'start', heading: 90, id: 'robot' });
    const small = { aim: 0.2, clearance: 0.05, height: 0.22 };

    // покой: три четверти спереди
    s.at(0).camera.shot('closeup', { target: robot, distance: 1.1, side: 'right', fov: 38, ...small });
    s.at(0.7).do(robot.blink({}));
    // тот же покой сбоку
    s.at(0.9).camera.shot('orbit', { target: robot, side: 'right', speed: 0, distance: 1.1, ...small, fov: 28 });
    // выезд, разгон, крейсер, торможение
    s.at(1.5).do(robot.roll({ to: 'stop', speed: 1, accel: 1.2, decel: 1.5 }));
    s.at(1.5).camera.shot('follow', { target: robot, side: 'right', distance: 1.3, ...small, fov: 34 });
    // боковой проезд: орбита с нулевой скоростью держит одну сторону и едет вместе с роботом
    s.at(3.2).camera.shot('orbit', { target: robot, side: 'right', speed: 0, distance: 1.1, ...small, fov: 28 });
    // взгляд влево-вправо
    s.at(5.8).camera.shot('closeup', { target: robot, on: 'eyes', distance: 0.6, side: 'right', fov: 32, aim: 0.27, clearance: 0.05 });
    s.at(5.9).do(robot.look({ target: [1.8, 0.25, -1] }));
    s.at(6.8).do(robot.look({ target: [1.8, 0.25, 1] }));
    s.at(7.6).do(robot.look({ target: null }));
    // моргание, прищур, широкие глаза
    s.at(7.95).do(robot.blink({}));
    s.at(8.5).do(robot.squint({ amount: 0.35, hold: 0.6 }));
    s.at(9.3).do(robot.wide({ amount: 1, hold: 0.7 }));
    // рука к земле
    s.at(9.9).camera.shot('orbit', { target: robot, side: 'left', speed: 0, distance: 1.0, ...small, fov: 28 });
    s.at(10.0).do(robot.reach({}));
    s.at(11.7).do(robot.reach({ to: null }));
    // луч
    s.at(12.1).camera.shot('orbit', { target: robot, side: 'right', speed: 0, distance: 1.1, ...small, fov: 28 });
    s.at(12.2).do(robot.scan({ on: true }));
    s.at(13.7).do(robot.scan({ on: false }));
    // разворот
    s.at(13.9).camera.shot('orbit', { target: robot, side: 'right', speed: 22, distance: 1.2, ...small, fov: 30 });
    s.at(14.0).do(robot.turn({ heading: 270, rate: 140 }));
  },
  { id: 'test-robot', title: 'Тест: робот-исследователь', duration: 17, seed: 31 },
);
