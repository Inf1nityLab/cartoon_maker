import * as THREE from 'three';

export type ProbeOptions = { kind: 'hero'; view?: 'camera' | 'top' };

/** Размер пробного «героя», м. */
const HERO = 0.4;
/** Расстояние от камеры до бокса, м. */
const DIST = 1.5;

/**
 * Пробный объект для проверки теней: серый бокс 0.4×0.4×0.4 м на земле перед камерой. Только для теста
 * (`?probe=hero` в плеере), в данные сцены не попадает. view 'top' — камера строго сверху (для замера длины тени).
 */
export function createProbe(scene: THREE.Scene) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(HERO, HERO, HERO), new THREE.MeshStandardMaterial({ color: '#8c8c8c', roughness: 0.9 }));
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.visible = false;
  scene.add(mesh);
  let opts: ProbeOptions | null = null;
  return {
    set(o: ProbeOptions | null) { opts = o; mesh.visible = o !== null; },
    active: () => opts !== null,
    /** Ставит бокс у камеры (по её кадру из WorldState) и, в виде 'top', переставляет саму камеру. */
    place(camera: THREE.PerspectiveCamera, pos: readonly number[], target: readonly number[], heightAt: (x: number, z: number) => number) {
      if (!opts) return;
      const dx = target[0]! - pos[0]!, dz = target[2]! - pos[2]!, n = Math.hypot(dx, dz) || 1;
      const x = pos[0]! + (dx / n) * DIST, z = pos[2]! + (dz / n) * DIST, y = heightAt(x, z);
      mesh.position.set(x, y + HERO / 2, z);
      camera.up.set(0, 1, 0);
      if (opts.view === 'top') {
        camera.position.set(x, y + 30, z);
        camera.up.set(0, 0, -1); // кадр: x вправо, z вниз
        camera.fov = 20;
        camera.lookAt(x, y, z);
      }
    },
    dispose() { scene.remove(mesh); mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); },
  };
}
