import './style.css';
import { createEngine, validateAgainstRegistry } from '@cartoon/engine';
import { registry, FILM_LOOK_PRESETS, type FilmLookPreset } from '@cartoon/components';
import { createThreeAdapter } from '@cartoon/render-three';
import { hashWorldState, migrate, type SceneDoc } from '@cartoon/schema';
// ?scene=<имя файла из scenes/ без .json> — какую сцену играть (по умолчанию scene-01)
const scenes = import.meta.glob('../../../scenes/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const sceneName = new URLSearchParams(location.search).get('scene') ?? 'scene-01';
const sceneJson = scenes[`../../../scenes/${sceneName}.json`];
if (!sceneJson) throw new Error(`Нет сцены «${sceneName}» в scenes/`);

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ?scene=test-robot — тестовая сцена робота (3.1); по умолчанию «Сцена 01»
const checked = validateAgainstRegistry(migrate(sceneJson), registry);
if (!checked.ok) {
  document.body.innerHTML = `<div class="err">Сцена не прошла проверку:\n${checked.errors.join('\n')}</div>`;
  throw new Error(checked.errors.join('\n'));
}
const doc: SceneDoc = structuredClone(checked.doc);
// Только для проверки света (e2e и глаза), в файл сцены не пишется: ?sun=<высота°>[,<азимут°>] — солнце;
// ?flat=1 — плоская земля. Меняем копию документа до загрузки в движок, поэтому хэш WorldState честный.
const q = new URLSearchParams(location.search);
const sunQ = q.get('sun');
if (sunQ !== null) {
  const [el, az] = sunQ.split(',').map(Number);
  const sky = doc.world.find((c) => c.type === 'Sky');
  if (sky && el !== undefined && Number.isFinite(el)) sky.params = { ...sky.params, elevation: el, ...(az !== undefined && Number.isFinite(az) ? { azimuth: az } : {}) };
}
if (q.get('flat') === '1') {
  const ter = doc.world.find((c) => c.type === 'Terrain');
  if (ter) ter.params = { ...ter.params, style: 'flat' };
}

// ?look=<пресет FilmLook> (neutral | cinema | warm-evening | vertical) — добавляет вид плёнки в копию документа;
// ?lookset=ключ:значение,… — поверх пресета (warmth, contrast, saturation, vignette, crop, rays).
// ?dof=фокус,диапазон,сила — глубина резкости с 0-й секунды (событие camera.focus; фокус число в метрах или target).
// ?fx=0 — все пост-эффекты кино выключены (в адаптере). Файл сцены не меняется, хэш WorldState честный.
const lookQ = q.get('look');
if (lookQ !== null && lookQ in FILM_LOOK_PRESETS) {
  const over = Object.fromEntries((q.get('lookset') ?? '').split(',').filter(Boolean).map((kv) => { const [k, v] = kv.split(':'); return [k!, Number.isFinite(Number(v)) ? Number(v) : v]; }));
  doc.world.push({ id: 'filmlook', type: 'FilmLook', version: 1, params: { ...FILM_LOOK_PRESETS[lookQ as FilmLookPreset], ...over } });
}
const dofQ = q.get('dof');
if (dofQ !== null) {
  const [f, r, st] = dofQ.split(',');
  doc.timeline.unshift({ id: 'dof0', t: 0, target: 'camera', action: 'focus', args: { focus: f === 'target' ? 'target' : Number(f), range: Number(r), strength: Number(st) } });
}
const revalidated = validateAgainstRegistry(doc, registry);
if (!revalidated.ok) {
  document.body.innerHTML = `<div class="err">Параметры URL не прошли проверку:\n${revalidated.errors.join('\n')}</div>`;
  throw new Error(revalidated.errors.join('\n'));
}
const engine = createEngine({ registry });
engine.load(doc);
// ?backend=webgl2 — принудительно WebGL2 (скриншот-тесты); иначе WebGPU с откатом
const params = new URLSearchParams(location.search);
const backend = params.get('backend') === 'webgl2' ? 'webgl2' : 'auto';
// ?film=1 — режим «фильм»: размер и pixelRatio фиксированы (?w=&h=, по умолчанию 1280x720, pixelRatio 1), время идёт
// только по кадрам (1/fps за кадр, ?fps=30), настенные часы не читаются. Без него — предпросмотр.
const film = params.get('film') === '1';
const filmSize = { w: Number(params.get('w') ?? 1280), h: Number(params.get('h') ?? 720) };
const FPS = Number(params.get('fps') ?? 30);
const trackGpu = params.get('gpu') === '1';
// ?taa=0 — без временного сглаживания; ?accum=N — режим накопления (кадр = среднее N сэмплов в один t, без истории;
// будущий режим экспорта видео, обычно вместе с ?film=1); ?warmup=K — кадров прогрева после перемотки (по умолчанию 3)
const taa = { enabled: params.get('taa') !== '0', accumulate: Number(params.get('accum') ?? 0), warmup: Number(params.get('warmup') ?? 3) };
const fx = params.get('fx') !== '0';
const adapter = createThreeAdapter(film ? { backend, taa, fx, mode: 'film', filmSize, pixelRatio: 1, trackGpu } : { backend, taa, fx, trackGpu });
// ?debug=motion — векторы движения цветом вместо кадра
const debug = params.get('debug');
adapter.setDebugView(debug === 'motion' ? 'motion' : null);
// ?probe=hero — серый бокс 0.4 м у камеры для проверки теней (не часть сцены); &view=top — камера строго сверху
if (params.get('probe') === 'hero') adapter.setProbe({ kind: 'hero', view: params.get('view') === 'top' ? 'top' : 'camera' });
const canvas = $<HTMLCanvasElement>('view');
await adapter.mount(canvas, doc, () => engine.sim());

const ASPECT = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1 } as const;
let aspect: keyof typeof ASPECT = doc.settings.aspect;
// В режиме film плеер стоит на паузе: кадры рисуются только по команде (кнопка ▶, ползунок, __player.show).
let t = 0, playing = !film;
if (film) $('play').textContent = '▶';
// Часы живут только здесь, в приложении: логика движка времени не знает.
let last = performance.now();

// панель сценария: события таймлайна, текущая подсвечивается
const list = $<HTMLOListElement>('script');
const items = doc.timeline.map((e) => {
  const li = document.createElement('li');
  li.innerHTML = `<b>${e.t.toFixed(0)}с</b><span>${e.target}.${e.action}${Object.keys(e.args).length ? ' ' + JSON.stringify(e.args) : ''}</span>`;
  li.onclick = () => { t = e.t; draw(true); };
  list.append(li);
  return li;
});

const slider = $<HTMLInputElement>('t');
slider.max = String(doc.settings.duration);
$<HTMLButtonElement>('play').onclick = () => { playing = !playing; $('play').textContent = playing ? '⏸' : '▶'; };
$<HTMLButtonElement>('restart').onclick = () => { t = 0; draw(true); };
slider.oninput = () => { t = Number(slider.value); draw(true); };
$<HTMLInputElement>('free').onchange = (e) => adapter.setFreeCamera((e.target as HTMLInputElement).checked);
canvas.addEventListener('pointermove', () => { if (!playing) draw(); });
canvas.addEventListener('wheel', () => { if (!playing) draw(); });
$<HTMLInputElement>('vertical').onchange = (e) => { aspect = (e.target as HTMLInputElement).checked ? '9:16' : doc.settings.aspect; draw(); };

function frameSize() {
  const stage = $('stage').getBoundingClientRect();
  const a = ASPECT[aspect];
  const w = Math.min(stage.width, stage.height * a);
  return { w: Math.max(2, Math.floor(w)), h: Math.max(2, Math.floor(w / a)) };
}

/** jump — момент не следует за прошлым показанным (перемотка, склейка): история TAA сбрасывается и прогревается. */
function draw(jump = false) {
  const w = engine.seek(t);
  if (jump) adapter.discontinuity();
  adapter.sync(w, engine.sim());
  const { w: cw, h: ch } = frameSize();
  adapter.render({ w: cw, h: ch });
  canvas.style.width = `${cw}px`;
  canvas.style.height = `${ch}px`;
  slider.value = String(t);
  $('time').textContent = `${t.toFixed(1)} / ${doc.settings.duration} с`;
  $('state').textContent = JSON.stringify(w, (_k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v), 1) + `\n\nhash: ${hashWorldState(w)}`;
  let now = -1;
  doc.timeline.forEach((e, i) => { if (e.t <= t + 1e-9) now = i; });
  items.forEach((li, i) => { li.className = i === now ? 'now' : i < now ? 'past' : ''; });
}

function frame() {
  const n = performance.now();
  if (playing) {
    t += film ? 1 / FPS : (n - last) / 1000;
    const wrapped = t > doc.settings.duration;
    if (wrapped) t = 0;
    draw(wrapped);
  }
  last = n;
  requestAnimationFrame(frame);
}

// для e2e-тестов: детерминированный кадр на заданной секунде
(window as unknown as { __player: unknown }).__player = {
  // prev — секунда, которую рисуем перед sec: от неё считаются векторы движения (кадр до sec)
  show(sec: number, prev?: number) {
    playing = false;
    // показ секунды — перемотка (история сбрасывается и прогревается); prev, если задан, — один шаг «играть» до sec
    if (prev !== undefined) { t = prev; draw(true); t = sec; draw(); } else { t = sec; draw(true); }
    return hashWorldState(engine.state());
  },
  // один кадр на секунде sec, следующий за прошлым показанным (без перемотки): векторы движения от прошлого кадра
  step(sec: number) {
    playing = false;
    t = sec; draw();
    return hashWorldState(engine.state());
  },
  // ?gpu=1: GPU-время последнего кадра, мс (замеры; в обычной работе не нужен)
  gpuMs: () => adapter.gpuMs(),
  shadowInfo: () => adapter.shadowInfo(),
  // играет кадры from, from+1/fps, … до to по одному (первый — перемотка, остальные следуют друг за другом)
  play(from: number, to: number) {
    playing = false;
    const n = Math.round((to - from) * FPS);
    for (let i = 0; i <= n; i++) { t = from + i / FPS; draw(i === 0); }
    return hashWorldState(engine.state());
  },
};
if (film) draw(true); // пауза: первый кадр рисуем сразу
frame();
