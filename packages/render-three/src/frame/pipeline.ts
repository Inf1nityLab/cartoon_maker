import * as THREE from 'three/webgpu';
import { Fn, mrt, output, velocity, vec2, vec3, vec4, float, texture, uniform, uv, max, min, select, clamp, dot, sqrt, exp, abs, length } from 'three/tsl';
import type { AaMode } from '../film.ts';
import { accumulationOffsets, taaJitter } from './jitter.ts';

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

export type PipelineOptions = {
  /** MSAA цели сцены. В режиме 'taa' вызывающий передаёт 1 (см. resolveFrame). */
  samples: 1 | 4;
  aa: { mode: AaMode; accumulate: number; warmup: number };
};

// --- настройки TAA (разбор каждой части — в комментариях ниже) ---
/** Сколько кадров истории максимум: новый кадр получает вес 1/(HISTORY_MAX + 1). */
const HISTORY_MAX = 9;
/** Резкость нового кадра против истории: вес сэмпла exp(−KERNEL·d²), d — расстояние до центра пикселя в пикселях. */
const KERNEL = 5;
/** Ширина коробки клиппинга истории в сигмах окрестности: на движущихся пикселях уже, на неподвижных шире. */
const BOX_MOVING = 1.25, BOX_STILL = 3;
/** Лёгкий unsharp на выходе: TAA слегка мылит. */
const SHARPEN = 0.25;
/** Глубина не меньше — пиксель без геометрии (небо, фон). */
const SKY_DEPTH = 0.99999;

// цвет ↔ YCoCg: коробка клиппинга в нём плотнее, чем в RGB
const toYCoCg = (c: any) => vec3(dot(c, vec3(0.25, 0.5, 0.25)), dot(c, vec3(0.5, 0, -0.5)), dot(c, vec3(-0.25, 0.5, -0.25)));
const toRGB = (y: any) => vec3(y.x.add(y.y).sub(y.z), y.x.add(y.z), y.x.sub(y.y).sub(y.z));
// История смешивается в «перцептивном» пространстве (корень из линейного света): половина тёмной иглы на ярком небе,
// усреднённая в линейном свете, на экране выглядит заметно ярче, чем при усреднении по гамме, и даёт бледный шлейф.
const enc = (c: any) => sqrt(max(c, vec3(0)));
const dec = (c: any) => c.mul(c);
const luma = (c: any) => c.x.add(c.y).add(c.z).div(3);

/**
 * Конвейер кадра: сцена → цель рендера (HalfFloat, глубина, второй выход «motion») → [сглаживание] → выходной проход
 * (тонмаппинг + sRGB делает RenderPipeline по настройкам рендерера) → холст.
 *
 * Выход `motion` — экранный вектор движения пикселя за кадр в NDC (x вправо, y вверх), считает velocity из three:
 * разность положения вершины в этом и предыдущем рендере. Для TAA проекция в velocity подменяется на НЕдрожащую
 * (иначе вектор содержал бы и джиттер). Фон (небо) вектора не пишет: 0, для него TAA считает вектор по повороту камеры.
 *
 * Режимы сглаживания (aa.mode):
 *  - off: сцена как есть;
 *  - taa: каждый кадр сцена рисуется с субпиксельным сдвигом проекции (Хэлтон от номера кадра после сброса истории) и
 *    сливается с историей, перенесённой по векторам движения; историю обрезает коробка окрестности 3×3;
 *  - accumulate: кадр = среднее N сэмплов с разными сдвигами в один и тот же t; история не переносится, кадр зависит
 *    только от t (режим экспорта).
 * После склейки/перемотки (discontinuity()) история сбрасывается, а следующий render() делает warmup кадров в тот же t без показа.
 */
export function createFramePipeline(renderer: THREE.WebGPURenderer, opts: PipelineOptions) {
  const mode = opts.aa.mode;
  const taa = mode === 'taa', accum = mode === 'accumulate';
  const rt = new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType, samples: opts.samples, depthBuffer: true, count: 2 });
  rt.textures[0]!.name = 'output';
  rt.textures[1]!.name = 'motion';
  rt.depthTexture = new THREE.DepthTexture(1, 1, THREE.FloatType);
  const sceneMRT = mrt({ output, motion: velocity });
  sceneMRT.setClearColor('motion', 0x000000, 0);

  const size = uniform(new THREE.Vector2(1, 1)); // пиксели цели
  const sceneTex = texture(rt.textures[0]!);
  const motionTex = texture(rt.textures[1]!);
  const depthTex = texture(rt.depthTexture);

  // ---------------------------------------------------------------- TAA: слияние с историей
  const makeRT = () => new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  const history = taa ? [makeRT(), makeRT()] : [];
  const u = {
    jitter: uniform(new THREE.Vector2()), // сдвиг сэмпла от центра пикселя, пиксели, y вниз (как uv)
    skyReproject: uniform(new THREE.Matrix4()), // клип этого кадра → клип прошлого, только поворот камеры
    resetting: uniform(1),
    still: uniform(0), // 1 — кадр прогрева в тот же t: ничего не двигалось, вектор нулевой
  };
  const historyTex = texture(history[0]?.texture ?? rt.textures[0]!);
  const resolveMat = new THREE.NodeMaterial();
  resolveMat.toneMapped = false;
  if (taa) {
    /** История в точке p (uv), фильтр Catmull-Rom по 5 билинейным выборкам: билинейная выборка мылит картинку с каждым кадром. */
    const catmullRom = (p: any) => {
      const pos = p.mul(size);
      const t1 = pos.sub(0.5).floor().add(0.5);
      const f = pos.sub(t1);
      const w0 = f.mul(f.mul(f.mul(-0.5).add(1)).sub(0.5));
      const w1 = f.mul(f).mul(f.mul(1.5).sub(2.5)).add(1);
      const w2 = f.mul(f.mul(f.mul(-1.5).add(2)).add(0.5));
      const w3 = f.mul(f).mul(f.mul(0.5).sub(0.5));
      const w12 = w1.add(w2);
      const t0 = t1.sub(1).div(size), t3 = t1.add(2).div(size), t12 = t1.add(w2.div(w12)).div(size);
      const tap = (x: any, y: any, w: any) => historyTex.sample(vec2(x, y)).rgb.mul(w);
      const mid = historyTex.sample(t12); // альфа — вес истории, для пикселя достаточно средней выборки
      const sum = tap(t12.x, t0.y, w12.x.mul(w0.y))
        .add(tap(t0.x, t12.y, w0.x.mul(w12.y)))
        .add(mid.rgb.mul(w12.x.mul(w12.y)))
        .add(tap(t3.x, t12.y, w3.x.mul(w12.y)))
        .add(tap(t12.x, t3.y, w12.x.mul(w3.y)));
      const wsum = w12.x.mul(w0.y).add(w0.x.mul(w12.y)).add(w12.x.mul(w12.y)).add(w3.x.mul(w12.y)).add(w12.x.mul(w3.y));
      return vec4(max(sum.div(wsum), vec3(0)), mid.a);
    };

    resolveMat.fragmentNode = Fn(() => {
      const R = size;
      const here = uv();
      // Сэмпл текселя q лежит в его центре плюс джиттер этого кадра. Центр этого пикселя среди сэмплов — `at`.
      const at = here.mul(R).sub(u.jitter);
      const p = clamp(at.floor(), vec2(0), R.sub(1));
      const sum = vec3(0).toVar(), w = float(0).toVar();
      const m1 = vec3(0).toVar(), m2 = vec3(0).toVar();
      const zMin = float(2).toVar(), nearUv = vec2(0).toVar();
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const q = clamp(p.add(vec2(dx, dy)), vec2(0), R.sub(1));
          const quv = q.add(0.5).div(R);
          const e = enc(sceneTex.sample(quv).rgb);
          // вес сэмпла: чем ближе он лёг к центру пикселя, тем больше
          const dq = q.add(0.5).sub(at);
          const wq = exp(dot(dq, dq).mul(-KERNEL));
          sum.addAssign(e.mul(wq));
          w.addAssign(wq);
          const c = toYCoCg(e);
          m1.addAssign(c);
          m2.addAssign(c.mul(c));
          // ближайшая к камере точка окрестности: вектор берём у неё, иначе контур движущегося объекта тянет фон
          const d = depthTex.sample(quv).x;
          const nearer = d.lessThan(zMin);
          zMin.assign(select(nearer, d, zMin));
          nearUv.assign(select(nearer, quv, nearUv));
        }
      const mean = m1.div(9);
      const sigma = sqrt(max(m2.div(9).sub(mean.mul(mean)), vec3(0)));
      // где этот пиксель был в прошлом кадре (uv идёт сверху вниз, NDC снизу вверх): геометрия — по вектору движения, небо — по повороту камеры
      const m = motionTex.sample(nearUv).xy.mul(float(1).sub(u.still));
      const geoPrev = vec2(here.x.sub(m.x.mul(0.5)), here.y.add(m.y.mul(0.5)));
      const skyClip = u.skyReproject.mul(vec4(here.x.mul(2).sub(1), here.y.mul(-2).add(1), 0.5, 1));
      const skyPrev = vec2(skyClip.x.div(skyClip.w).mul(0.5).add(0.5), skyClip.y.div(skyClip.w).mul(-0.5).add(0.5));
      const prevUv = select(zMin.greaterThanEqual(SKY_DEPTH), skyPrev, geoPrev);
      const onScreen = prevUv.x.greaterThanEqual(0).and(prevUv.x.lessThanEqual(1)).and(prevUv.y.greaterThanEqual(0)).and(prevUv.y.lessThanEqual(1));
      // история, обрезанная к среднему до коробки (клиппинг, а не clamp: без сдвига цвета в углах коробки)
      const histTap = catmullRom(prevUv);
      const hist = toYCoCg(enc(histTap.rgb));
      const dHist = hist.sub(mean);
      const moved = clamp(length(prevUv.sub(here).mul(R)).mul(4), 0, 1);
      const ext = max(sigma.mul(moved.mul(BOX_MOVING - BOX_STILL).add(BOX_STILL)), vec3(1e-4));
      const outside = max(max(abs(dHist.x).div(ext.x), abs(dHist.y).div(ext.y)), abs(dHist.z).div(ext.z)); // > 1 — вне коробки
      const clipped = toRGB(select(outside.greaterThan(1), mean.add(dHist.div(outside)), hist));
      // вес истории: ноль за экраном и после сброса, меньше, чем дальше история вне коробки
      const kept = select(onScreen.and(u.resetting.equal(0)), min(histTap.a, float(HISTORY_MAX)), float(0));
      const wHist = kept.mul(clamp(float(2).sub(outside), 0.5, 1));
      // смешиваем с весами 1/(1+яркость): яркое небо не забивает листья рядом
      const cur = sum.div(max(w, 1e-5));
      const wc = float(1).div(luma(cur).add(1));
      const wh = wHist.div(luma(clipped).add(1));
      const out = cur.mul(wc).add(clipped.mul(wh)).div(max(wc.add(wh), 1e-5));
      return vec4(clamp(dec(out), 0, 65000) as any, wHist.add(1));
    })();
  }
  const resolveQuad = new THREE.QuadMesh(resolveMat);

  // ---------------------------------------------------------------- накопление N сэмплов
  const accumRT = accum ? makeRT() : null;
  const accumNode = Fn(() => {
    const c = sceneTex.sample(uv()).rgb;
    const k = float(1).div(luma(c).add(1)); // вес Карис: яркое солнце не даёт «светлячков» на краях
    return vec4(c.mul(k), k);
  })();
  const accumFirstMat = new THREE.NodeMaterial(); // первый сэмпл пишется поверх (цель не нужно чистить)
  accumFirstMat.fragmentNode = accumNode;
  accumFirstMat.toneMapped = false;
  accumFirstMat.blending = THREE.NoBlending;
  const accumAddMat = new THREE.NodeMaterial(); // остальные добавляются
  accumAddMat.fragmentNode = accumNode;
  accumAddMat.toneMapped = false;
  accumAddMat.blending = THREE.CustomBlending;
  accumAddMat.blendEquation = THREE.AddEquation;
  accumAddMat.blendSrc = THREE.OneFactor; accumAddMat.blendDst = THREE.OneFactor;
  accumAddMat.blendSrcAlpha = THREE.OneFactor; accumAddMat.blendDstAlpha = THREE.OneFactor;
  accumAddMat.depthTest = false; accumAddMat.depthWrite = false;
  const accumQuad = new THREE.QuadMesh(accumFirstMat);

  // ---------------------------------------------------------------- выходной проход
  const shownTex = texture(taa ? history[0]!.texture : accumRT ? accumRT.texture : rt.textures[0]!);
  const shown = (() => {
    if (accum) { const a = shownTex.sample(uv()); return a.rgb.div(max(a.a, 1e-5)); }
    if (!taa) return shownTex.rgb;
    // лёгкий unsharp по 4 соседям; в сжатом пространстве x/(1+x): иначе диск солнца (≫1) обводится чёрным кольцом
    const px = vec2(1).div(size);
    const squash = (v: any) => v.div(v.add(1));
    const c = squash(shownTex.rgb);
    const ring = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([x, y]) => squash(shownTex.sample(uv().add(px.mul(vec2(x!, y!)))).rgb));
    const avg = ring.reduce((a, b) => a.add(b)).mul(0.25);
    const t = clamp(c.add(c.sub(avg).mul(SHARPEN)), 0, 0.999);
    return t.div(t.oneMinus());
  })();
  // тонмаппинг и sRGB добавляет сам RenderPipeline (renderer.toneMapping, toneMappingExposure)
  const main = new THREE.RenderPipeline(renderer, vec4(shown as any, 1));
  // отладка: серый — нет движения; цвет — куда и насколько сдвинулся пиксель (6 px ≈ полный цвет); без тонмаппинга
  const px = vec2(motionTex.x, motionTex.y.negate()).mul(0.5).mul(size); // пиксели, y вниз
  const debugMotion = new THREE.RenderPipeline(renderer, vec4(vec3(px.x.div(6).add(0.5), px.y.div(6).add(0.5), 0.5), 1));
  debugMotion.outputColorTransform = false;

  // ---------------------------------------------------------------- состояние
  let debug: DebugView = null;
  let needReset = true; // история пуста: первый кадр, склейка, перемотка, смена размера
  let frameNo = 0; // номер кадра после сброса истории: от него джиттер
  let parity = 0; // какая из двух историй читается
  const unjittered = new THREE.Matrix4();
  const prevRotVP = new THREE.Matrix4(), curRotVP = new THREE.Matrix4(), tmp = new THREE.Matrix4();
  const rotVP = (camera: THREE.Camera, out: THREE.Matrix4) => {
    tmp.copy(camera.matrixWorldInverse);
    tmp.elements[12] = 0; tmp.elements[13] = 0; tmp.elements[14] = 0; // без переноса: небо бесконечно далеко
    return out.multiplyMatrices(unjittered, tmp);
  };

  /** Один рендер сцены в цель со сдвигом проекции (jx, jy) пикселей, y вверх. */
  function renderScene(scene: THREE.Scene, camera: THREE.PerspectiveCamera, w: number, h: number, jx: number, jy: number) {
    advanceNodeFrame(renderer); // каждый рендер — «новый кадр» узлов: velocity берёт матрицы прошлого рендера
    camera.projectionMatrix.copy(unjittered);
    if (jx !== 0 || jy !== 0) {
      const e = camera.projectionMatrix.elements;
      e[8] = e[8]! + (jx * 2) / w; // сэмпл в центре текселя видит то, что лежит на (jx, jy) правее/выше
      e[9] = e[9]! + (jy * 2) / h;
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    }
    renderer.setRenderTarget(rt);
    renderer.setMRT(sceneMRT);
    renderer.render(scene, camera);
    renderer.setMRT(null);
    renderer.setRenderTarget(null);
  }

  return {
    target: rt,
    mode,
    setDebug(v: DebugView) { debug = v; },
    /** Следующий кадр не следует за предыдущим (склейка, перемотка): история сбрасывается, кадр прогревается. */
    discontinuity() { needReset = true; },
    /** Рисует кадр. size — размер цели в пикселях (совпадает с буфером холста). */
    render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, sz: { w: number; h: number }) {
      const { w, h } = sz;
      if (rt.width !== w || rt.height !== h) {
        rt.setSize(w, h);
        for (const t of history) t.setSize(w, h);
        accumRT?.setSize(w, h);
        needReset = true;
      }
      size.value.set(w, h);
      camera.updateMatrixWorld();
      unjittered.copy(camera.projectionMatrix);
      velocity.setProjectionMatrix(mode === 'off' ? null : unjittered); // vector без джиттера

      if (mode === 'off') {
        renderScene(scene, camera, w, h, 0, 0);
      } else if (accum) {
        const offs = accumulationOffsets(opts.aa.accumulate);
        offs.forEach(([jx, jy], i) => {
          renderScene(scene, camera, w, h, jx, jy);
          accumQuad.material = i === 0 ? accumFirstMat : accumAddMat;
          renderer.setRenderTarget(accumRT);
          accumQuad.render(renderer);
          renderer.setRenderTarget(null);
        });
      } else {
        const warm = needReset ? opts.aa.warmup : 0;
if (needReset) { frameNo = 0; parity = 0; }
        for (let i = 0; i <= warm; i++) {
          const [jx, jy] = taaJitter(frameNo);
          renderScene(scene, camera, w, h, jx, jy);
          // небо: поворот камеры между прошлым и этим кадром (без джиттера и переноса)
          rotVP(camera, curRotVP);
          if (needReset && i === 0) prevRotVP.copy(curRotVP);
          u.skyReproject.value.copy(prevRotVP).multiply(tmp.copy(curRotVP).invert());
          u.jitter.value.set(jx, -jy); // uv — y вниз
          u.resetting.value = needReset && i === 0 ? 1 : 0;
          // Прогрев — тот же t и та же камера, движения нет. Вектор из velocity на повторном рендере в тот же t три
          // не обнуляет (у паука остаются «прошлые» матрицы), и история после перемотки зависела бы от того, что
          // показывали до неё. Первый кадр цепочки при reset истории не читает.
          u.still.value = warm > 0 && i > 0 ? 1 : 0;
          const src = history[parity]!, dst = history[1 - parity]!;
          historyTex.value = src.texture;
          renderer.setRenderTarget(dst);
          resolveQuad.render(renderer);
          renderer.setRenderTarget(null);
          shownTex.value = dst.texture;
          prevRotVP.copy(curRotVP);
          parity = 1 - parity;
          frameNo++;
        }
        needReset = false;
      }
      camera.projectionMatrix.copy(unjittered);
      camera.projectionMatrixInverse.copy(unjittered).invert();
      (debug === 'motion' ? debugMotion : main).render();
    },
    dispose() {
      rt.dispose(); main.dispose(); debugMotion.dispose();
      for (const t of history) t.dispose();
      accumRT?.dispose();
      resolveMat.dispose(); accumFirstMat.dispose(); accumAddMat.dispose();
    },
  };
}
