import * as THREE from 'three/webgpu';
import { mrt, output, velocity, vec2, vec3, vec4, texture, uniform } from 'three/tsl';

/**
 * Счётчик «кадра» узлов three (frameId) растёт сам по requestAnimationFrame, а не от наших render(). От него зависят
 * обновления «раз за кадр», в том числе карта теней: несколько render() в одном браузерном кадре (seek, show(t, prev))
 * тень не обновляли бы, а кадр зависел бы от настенных часов. Публичного способа сдвинуть счётчик нет, поэтому
 * единственное место с доступом к приватному полю — здесь. Побочно сдвигает time/deltaTime узлов three (TSL `time`
 * нам не нужен: ветер и всё остальное берут t из таймлайна).
 */
function advanceNodeFrame(renderer: THREE.WebGPURenderer) {
  (renderer as unknown as { _nodes: { nodeFrame: { update(): void } } })._nodes.nodeFrame.update();
}

export type DebugView = 'motion' | null;

/**
 * Конвейер кадра: сцена → цель рендера (HalfFloat, глубина, второй выход «motion») → выходной проход
 * (тонмаппинг + sRGB делает RenderPipeline по настройкам рендерера) → холст.
 *
 * Выход `motion` — экранный вектор движения пикселя за кадр в NDC (x вправо, y вверх), считает velocity из three:
 * разность положения вершины в этом и предыдущем рендере (матрицы объекта, камеры и проекции). Предыдущий рендер =
 * предыдущий вызов render(); на первом кадре и после перемотки вектор нулевой/непоказательный — прогрев на склейках
 * делает TAA (задача 1.2). Фон (небо) вектора не пишет: 0.
 */
export function createFramePipeline(renderer: THREE.WebGPURenderer, opts: { samples: 1 | 4 }) {
  const rt = new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType, samples: opts.samples, depthBuffer: true, count: 2 });
  rt.textures[0]!.name = 'output';
  rt.textures[1]!.name = 'motion';
  rt.depthTexture = new THREE.DepthTexture(1, 1, THREE.FloatType);
  const sceneMRT = mrt({ output, motion: velocity });
  sceneMRT.setClearColor('motion', 0x000000, 0);

  const screen = uniform(new THREE.Vector2(1, 1));
  const colorNode = texture(rt.textures[0]!);
  const motionNode = texture(rt.textures[1]!);
  // выходной проход: тонмаппинг и sRGB добавляет сам RenderPipeline (renderer.toneMapping, toneMappingExposure)
  const main = new THREE.RenderPipeline(renderer, vec4(colorNode.rgb, 1));
  // отладка: серый — нет движения; цвет — куда и насколько сдвинулся пиксель (6 px ≈ полный цвет); без тонмаппинга
  const px = vec2(motionNode.x, motionNode.y.negate()).mul(0.5).mul(screen); // пиксели, y вниз
  const debugMotion = new THREE.RenderPipeline(renderer, vec4(vec3(px.x.div(6).add(0.5), px.y.div(6).add(0.5), 0.5), 1));
  debugMotion.outputColorTransform = false;

  let debug: DebugView = null;
  return {
    target: rt,
    setDebug(v: DebugView) { debug = v; },
    /** Рисует кадр. size — размер цели в пикселях (совпадает с буфером холста). */
    render(scene: THREE.Scene, camera: THREE.Camera, size: { w: number; h: number }) {
      advanceNodeFrame(renderer);
      if (rt.width !== size.w || rt.height !== size.h) rt.setSize(size.w, size.h);
      screen.value.set(size.w, size.h);
      renderer.setRenderTarget(rt);
      renderer.setMRT(sceneMRT);
      renderer.render(scene, camera);
      renderer.setMRT(null);
      renderer.setRenderTarget(null);
      (debug === 'motion' ? debugMotion : main).render();
    },
    dispose() { rt.dispose(); main.dispose(); debugMotion.dispose(); },
  };
}
