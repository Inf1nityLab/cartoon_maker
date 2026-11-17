import { buildScene } from '@cartoon/director';

/** «Сцена 01»: код, который мог бы написать ИИ. JSON в scenes/scene-01.json собирается из него. */
export const scene01 = buildScene(
  (s) => {
    s.world.use('Terrain', { style: 'hills', seed: 7 });
    s.world.use('Water', {});
    s.world.use('Sky', { elevation: 9, azimuth: 205 });
    s.places({ meadow: [-38, 0, -8], lakeShore: [34, 0, 2] });
    s.path('valleyLoop', {
      closed: true,
      points: [[31, 0, 0], [20, 0, 25], [-5, 0, 38], [-30, 0, 22], [-38, 0, -8], [-20, 0, -30], [8, 0, -34], [30, 0, -22]],
    });

    const spider = s.add('Multiped', { color: '#ff5a1f' }, { at: 'meadow', heading: 0, id: 'spider' });

    s.at(0).camera.shot('establishing', { target: spider });
    s.at(0).do(spider.followPath({ path: 'valleyLoop', speed: 2 }));
    s.at(7).camera.shot('follow', { target: spider, side: 'left' });
    s.at(16).camera.shot('lowAngle', { target: spider });
    s.at(21).camera.shot('orbit', { target: spider, speed: 18 });
    s.at(27).do(spider.stop(), spider.lookAt({ target: 'camera' }));
    s.at(29).camera.shot('closeup', { target: spider, on: 'eyes' });
    s.at(36).do(spider.followPath({ path: 'valleyLoop', speed: 2.4 }));
    s.at(36).camera.shot('follow', { target: spider, side: 'right' });
    s.at(45).world.sun({ elevation: 0.6, duration: 14 });
    s.at(50).camera.shot('crane', { target: spider, to: 30, duration: 8 });
  },
  { id: 'scene-01', title: 'Сцена 01: паук на закате', duration: 60, seed: 7 },
);
