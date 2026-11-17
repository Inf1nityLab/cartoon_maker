import * as THREE from 'three/webgpu';
import { Fn, Loop, mrt, output, velocity, vec2, vec3, vec4, float, texture, uniform, uv, max, min, select, clamp, dot, sqrt, exp, abs, length, cos, sin, fract, smoothstep, mix, log2, exp2 } from 'three/tsl';
import type { AaMode } from '../film.ts';
import { accumulationOffsets, taaJitter } from './jitter.ts';
import { DOF_REF_HEIGHT, DOF_TAPS, cropRect, raysFade, sunScreen, type PostFrame, type Vec3 } from './post.ts';

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
  /** Пост-проходы кино (лучи, глубина резкости, цвет) собираются в графе. false — графа нет вовсе, кадр как до задачи 1.7. */
  post: boolean;
  /** Лучи солнца встроены в граф (нужен компонент FilmLook в сцене). Без них в графе нет ни одной выборки лучей. */
  rays: boolean;
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

  // ---------------------------------------------------------------- солнечные лучи (god rays), полразрешения
  // Проход идёт после КАЖДОГО рендера сцены (в том числе джиттер-сэмпла) по глубине этого же рендера, а результат
  // прибавляется к цвету сцены на входе TAA/накопления (scn): ступеньки вдоль лучей, которые оставляют фиксированные
  // выборки и половинное разрешение, усредняются вместе с краями. Радиальный марш — по образцу godrays.ts демо (MIT),
  // но со своим шумом начала марша (interleaved gradient noise от пикселя и номера кадра, не от случайных чисел).
  const RAY_SAMPLES = 40;
  const raysRT = opts.post && opts.rays ? new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false }) : null;
  const ru = {
    sunUv: uniform(new THREE.Vector2(0.5, 0.5)),
    aspect: uniform(1),
    strength: uniform(0),
    phase: uniform(0),
  };
  const raysMat = new THREE.NodeMaterial();
  raysMat.toneMapped = false;
  raysMat.blending = THREE.NoBlending;
  if (raysRT) {
    raysMat.fragmentNode = Fn(() => {
      const here = uv();
      const toSun = ru.sunUv.sub(here);
      const span = length(toSun.mul(vec2(ru.aspect, 1)));
      // марш не длиннее половины экрана: дальше лучи слабы, а выборки редки
      const step = toSun.mul(float(0.5).div(max(span, 0.5))).div(RAY_SAMPLES);
      const pix = here.mul(size);
      const noise = fract(fract(dot(pix, vec2(0.06711056, 0.00583715))).mul(52.9829189).add(ru.phase.mul(0.381966)));
      const sum = float(0).toVar(), w = float(1).toVar(), p = here.add(step.mul(noise)).toVar();
      Loop(RAY_SAMPLES, () => {
        p.addAssign(step);
        const d = depthTex.sample(clamp(p, vec2(0), vec2(0.9999))).x;
        // чистое небо около диска солнца светится (ореол, который несут лучи), вдали — нет
        const off = length(p.sub(ru.sunUv).mul(vec2(ru.aspect, 1)));
        sum.addAssign(select(d.greaterThanEqual(SKY_DEPTH), exp(off.mul(-6)), float(0)).mul(w));
        w.mulAssign(0.97);
      });
      // слабее с расстоянием пикселя от солнца: иначе весь экран под солнцем у края кадра выцветает
      return vec4(vec3(1, 0.86, 0.66).mul(sum.mul(ru.strength).mul(exp(span.mul(-2.5))).div(RAY_SAMPLES * 0.4)), 1);
    })();
  }
  const raysQuad = new THREE.QuadMesh(raysMat);
  const raysTex = raysRT ? texture(raysRT.texture) : null;
  /** Цвет сцены в точке q: то, что нарисовала сцена, плюс лучи (если они вообще собраны в граф). */
  const scn = (q: any) => (raysTex ? sceneTex.sample(q).rgb.add(raysTex.sample(q).rgb) : sceneTex.sample(q).rgb);

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
          const e = enc(scn(quv));
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
    const c = scn(uv());
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
    if (!taa) return raysTex ? shownTex.rgb.add(raysTex.rgb) : shownTex.rgb;
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

  // ---------------------------------------------------------------- пост кино: глубина резкости, цвет, виньетка, рамка
  // Идёт ПОСЛЕ сглаживания, в линейном HDR до тонмаппинга. Узлы собираются лениво и по вариантам: без глубины резкости
  // в графе нет ни одной её выборки, без FilmLook и камеры с фокусом работает прежний `main`.
  const pu = {
    // глубина резкости
    focus: uniform(1), range: uniform(1), strength: uniform(0), near: uniform(0.1), far: uniform(800),
    // вид плёнки
    warmth: uniform(0), contrast: uniform(1), saturation: uniform(1), vignette: uniform(0),
    rect: uniform(new THREE.Vector4(0, 0, 1, 1)), // видимый кадр, пиксели: x0 y0 x1 y1
  };
  /** Цвет итогового (сглаженного) кадра в точке q, без unsharp: для выборок сборки размытия. */
  const colorAt = (q: any) => {
    if (accum) { const a = shownTex.sample(q); return a.rgb.div(max(a.a, 1e-5)); }
    return raysTex && !taa ? shownTex.sample(q).rgb.add(raysTex.sample(q).rgb) : shownTex.sample(q).rgb;
  };
  /** Радиус нерезкости в пикселях по значению буфера глубины: формула cocRadius из post.ts. */
  const cocOf = (q: any) => {
    const d = depthTex.sample(q).x;
    const z = select(d.greaterThanEqual(SKY_DEPTH), pu.far, pu.near.mul(pu.far).div(pu.far.sub(pu.far.sub(pu.near).mul(d))));
    const dz = max(abs(z.sub(pu.focus)).sub(pu.range), 0);
    return min(dz.div(z), 1).mul(pu.strength).mul(size.y.div(DOF_REF_HEIGHT));
  };
  /**
   * Сборка размытия: выборки по спирали «подсолнух» радиуса R = нерезкость ЭТОГО пикселя. Выборка влияет, только если
   * её собственный радиус нерезкости достаёт до центра (c_s ≥ ρ): резкий герой не «растекается» на размытый фон, а
   * размытый фон не затекает под резкий силуэт. Где радиус мал — берём резкий исходный кадр (смесь по smoothstep).
   */
  const dofColor = (sharp: any) => Fn(() => {
    const here = uv();
    const c0 = cocOf(here);
    const c00 = colorAt(here);
    const w00 = float(1).div(luma(c00).add(1));
    const acc = c00.mul(w00).toVar(), wsum = w00.toVar();
    Loop(DOF_TAPS, ({ i }: any) => {
      const f = float(i);
      const ang = f.mul(2.399963);
      const rho = sqrt(f.add(0.5).div(DOF_TAPS)).mul(c0);
      const q = here.add(vec2(cos(ang), sin(ang)).mul(rho).div(size));
      const cs = cocOf(q);
      const col = colorAt(q);
      const w = clamp(cs.sub(rho).add(1), 0, 1).mul(float(1).div(luma(col).add(1)));
      acc.addAssign(col.mul(w));
      wsum.addAssign(w);
    });
    const blurred = acc.div(max(wsum, 1e-5));
    return mix(sharp, blurred, smoothstep(0.5, 1.5, c0));
  })();
  /** Теплота, контраст, насыщенность, виньетка и рамка. */
  const finishLook = (rgb0: any) => {
    const pix = uv().mul(size);
    const warm = rgb0.mul(vec3(float(1).add(pu.warmth.mul(0.10)), float(1).add(pu.warmth.mul(0.02)), float(1).sub(pu.warmth.mul(0.12))));
    const lg = log2(max(warm, vec3(1e-4)).div(0.18));
    const con = exp2(lg.mul(pu.contrast)).mul(0.18);
    const y = luma(con);
    const sat = max(mix(vec3(y), con, pu.saturation), vec3(0));
    const half = vec2(pu.rect.z.sub(pu.rect.x), pu.rect.w.sub(pu.rect.y)).mul(0.5);
    const center = vec2(pu.rect.x.add(pu.rect.z), pu.rect.y.add(pu.rect.w)).mul(0.5);
    const r = length(pix.sub(center).div(half)).div(1.41421356);
    const vig = float(1).sub(pu.vignette.mul(smoothstep(0.4, 1.0, r)).mul(0.7));
    const inside = pix.x.greaterThanEqual(pu.rect.x).and(pix.x.lessThan(pu.rect.z)).and(pix.y.greaterThanEqual(pu.rect.y)).and(pix.y.lessThan(pu.rect.w));
    return select(inside, sat.mul(vig), vec3(0));
  };
  const variants: { look?: THREE.RenderPipeline; lookDof?: THREE.RenderPipeline } = {};
  const lookPipeline = (withDof: boolean) => {
    const key = withDof ? 'lookDof' : 'look';
    return (variants[key] ??= new THREE.RenderPipeline(renderer, vec4(finishLook(withDof ? dofColor(shown as any) : (shown as any)) as any, 1)));
  };
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
  let rayPhase = 0; // номер сэмпла для шума лучей: от номера кадра после сброса (TAA) или индекса сэмпла (накопление)
  let raysActive = false, raysCleared = false;
  let sunDir: Vec3 | null = null, raysK = 0;
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
    if (raysRT) renderRays(camera, w, h);
  }

  /** Лучи по глубине только что нарисованного сэмпла; не выполняется, если они выключены (или солнце за камерой). */
  function renderRays(camera: THREE.PerspectiveCamera, w: number, h: number) {
    const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
    if (raysRT!.width !== hw || raysRT!.height !== hh) { raysRT!.setSize(hw, hh); raysCleared = false; }
    let k = 0;
    if (raysActive && sunDir) {
      const sc = sunScreen(sunDir, [camera.position.x, camera.position.y, camera.position.z], camera.matrixWorldInverse.elements, unjittered.elements);
      if (sc.facing) { ru.sunUv.value.set(sc.u, sc.v); k = raysK * raysFade(sc.off); }
    }
    ru.strength.value = k;
    ru.aspect.value = w / h;
    ru.phase.value = rayPhase;
    if (k > 0) {
      renderer.setRenderTarget(raysRT);
      raysQuad.render(renderer);
      renderer.setRenderTarget(null);
      raysCleared = false;
    } else if (!raysCleared) {
      renderer.setRenderTarget(raysRT);
      renderer.clear();
      renderer.setRenderTarget(null);
      raysCleared = true;
    }
  }

  return {
    target: rt,
    mode,
    setDebug(v: DebugView) { debug = v; },
    /** Следующий кадр не следует за предыдущим (склейка, перемотка): история сбрасывается, кадр прогревается. */
    discontinuity() { needReset = true; },
    /** Рисует кадр. size — размер цели в пикселях (совпадает с буфером холста). */
    render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, sz: { w: number; h: number }, post: PostFrame | null = null) {
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
      const look = opts.post ? post?.look ?? null : null, dof = opts.post ? post?.dof ?? null : null;
      sunDir = post?.sunDir ?? null;
      raysActive = !!look && look.rays > 0;
      raysK = look?.rays ?? 0;

      if (mode === 'off') {
        rayPhase = 0;
        renderScene(scene, camera, w, h, 0, 0);
      } else if (accum) {
        const offs = accumulationOffsets(opts.aa.accumulate);
        offs.forEach(([jx, jy], i) => {
          rayPhase = i;
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
          rayPhase = frameNo;
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
      let out = main;
      if (opts.post && (look || (dof && dof.strength > 0))) {
        const l = look ?? { warmth: 0, contrast: 1, saturation: 1, vignette: 0, crop: 'none' as const };
        pu.warmth.value = l.warmth; pu.contrast.value = l.contrast; pu.saturation.value = l.saturation; pu.vignette.value = l.vignette;
        const [x0, y0, x1, y1] = cropRect(w, h, l.crop);
        pu.rect.value.set(x0, y0, x1, y1);
        const useDof = !!dof && dof.strength > 0;
        if (useDof) {
          pu.focus.value = dof.focus; pu.range.value = dof.range; pu.strength.value = dof.strength;
          pu.near.value = camera.near; pu.far.value = camera.far;
        }
        out = lookPipeline(useDof);
      }
      (debug === 'motion' ? debugMotion : out).render();
    },
    dispose() {
      rt.dispose(); main.dispose(); debugMotion.dispose();
      variants.look?.dispose(); variants.lookDof?.dispose();
      raysRT?.dispose(); raysMat.dispose();
      for (const t of history) t.dispose();
      accumRT?.dispose();
      resolveMat.dispose(); accumFirstMat.dispose(); accumAddMat.dispose();
    },
  };
}
