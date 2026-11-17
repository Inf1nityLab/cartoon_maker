import './style.css';
import { createEngine, validateAgainstRegistry } from '@cartoon/engine';
import { registry } from '@cartoon/components';
import { createThreeAdapter } from '@cartoon/render-three';
import { hashWorldState, migrate, type SceneDoc } from '@cartoon/schema';
import sceneJson from '../../../scenes/scene-01.json';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

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
const adapter = createThreeAdapter(film ? { backend, mode: 'film', filmSize, pixelRatio: 1, trackGpu } : { backend, trackGpu });
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
  li.onclick = () => { t = e.t; draw(); };
  list.append(li);
  return li;
});

const slider = $<HTMLInputElement>('t');
slider.max = String(doc.settings.duration);
$<HTMLButtonElement>('play').onclick = () => { playing = !playing; $('play').textContent = playing ? '⏸' : '▶'; };
$<HTMLButtonElement>('restart').onclick = () => { t = 0; draw(); };
slider.oninput = () => { t = Number(slider.value); draw(); };
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

function draw() {
  const w = engine.seek(t);
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
    if (t > doc.settings.duration) t = 0;
    draw();
  }
  last = n;
  requestAnimationFrame(frame);
}

// для e2e-тестов: детерминированный кадр на заданной секунде
(window as unknown as { __player: unknown }).__player = {
  // prev — секунда, которую рисуем перед sec: от неё считаются векторы движения (кадр до sec)
  show(sec: number, prev?: number) {
    playing = false;
    if (prev !== undefined) { t = prev; draw(); }
    t = sec; draw();
    return hashWorldState(engine.state());
  },
  // ?gpu=1: GPU-время последнего кадра, мс (замеры; в обычной работе не нужен)
  gpuMs: () => adapter.gpuMs(),
  shadowInfo: () => adapter.shadowInfo(),
};
if (film) draw(); // пауза: первый кадр рисуем сразу
frame();
