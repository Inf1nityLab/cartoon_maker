import './library.css';
import { createEngine, paramFields, validateAgainstRegistry, type ComponentDef, type Showcase } from '@cartoon/engine';
import { registry } from '@cartoon/components';
import { buildScene } from '@cartoon/director';
import { createThreeAdapter } from '@cartoon/render-three';
import { hashWorldState, type SceneDoc, type TimelineEvent, type Vec3 } from '@cartoon/schema';

/**
 * Витрина объектов: library.html?object=<тип>[&preset=…][&time=<часы>]. Каркас для всех объектов мира:
 * слева пресеты и облик, справа ручки из схемы (с единицами и описанием в подсказке), сверху силы мира,
 * внизу время и демо ручек. Сам объект ничего не знает про витрину, кроме `showcase` в своём компоненте.
 * Параметры URL (для e2e): object, touch=1 (Water: робот въезжает в воду, круги), dive=<t> (нырнуть с секунды t), dy=<высота под водой, м>, preset, time, t, view, wind, winddir, clouds, fog, gust=<t>, demo=<номер>, film=1&w=&h=,
 * p.<параметр>=<значение> (параметры и ручки объекта), backend=webgl2.
 */

const q = new URLSearchParams(location.search);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const num = (v: string | null, d: number) => (v !== null && Number.isFinite(Number(v)) ? Number(v) : d);

const objectName = q.get('object') ?? 'Robot';
const def: ComponentDef | undefined = registry.components[objectName];
if (!def) {
  document.body.innerHTML = `<div style="padding:24px;color:#ff8a8a;font:13px ui-monospace,monospace">Нет объекта «${objectName}». Есть: ${Object.keys(registry.components).join(', ')}</div>`;
  throw new Error(`нет объекта ${objectName}`);
}
const show: Showcase = def.showcase ?? { kind: 'entity', size: 1 };
const objId = def.type.toLowerCase();
const TERRAIN_LIKE = ['Terrain', 'Road'];
const ALL_PRESETS = def.presets ?? {};
const fields = paramFields(def);

// ---------- состояние витрины ----------
type Params = Record<string, unknown>;
const FORCES_DEFAULT: Params = { time: 11, windStrength: 2, windDirection: 90, gustiness: 0.3, cloudiness: 0.15, fog: 0 };
const forcesParams: Params = { ...FORCES_DEFAULT };
const readOverrides = (): Params => Object.fromEntries([...q.entries()].filter(([k]) => k.startsWith('p.')).map(([k, v]) => [k.slice(2), Number.isFinite(Number(v)) && v !== '' ? Number(v) : v === 'true' ? true : v === 'false' ? false : v]));
let presetName = q.get('preset') && ALL_PRESETS[q.get('preset')!] ? q.get('preset')! : show.defaultPreset ?? Object.keys(ALL_PRESETS)[0] ?? '';
const setupOf = () => show.setups?.[presetName] ?? show.setups?.default;
let diveAt: number | null = q.has('dive') ? num(q.get('dive'), 1) : null;
const DIVE = { down: 4, hold: 3, up: 4 };
const defaults = (): Params => (def.params as unknown as { parse(x: unknown): Params }).parse(presetName ? ALL_PRESETS[presetName] : objectName === 'Road' ? { path: 'road' } : {});
const defaultsOf = (def.params as unknown as { parse(x: unknown): Params }).parse(objectName === 'Road' ? { path: 'road' } : {});
let params: Params = { ...defaults(), ...readOverrides() };
if (objectName === 'Forces') { Object.assign(forcesParams, params); params = forcesParams; }
const timeQ = q.get('time'); if (timeQ !== null) forcesParams.time = num(timeQ, 11);
if (q.has('wind')) forcesParams.windStrength = num(q.get('wind'), 2);
if (q.has('winddir')) forcesParams.windDirection = num(q.get('winddir'), 90);
if (q.has('clouds')) forcesParams.cloudiness = num(q.get('clouds'), 0.15);
if (q.has('fog')) forcesParams.fog = num(q.get('fog'), 0);
let viewName = q.get('view') ?? 'general';
let demoIndex: number | null = q.has('demo') ? num(q.get('demo'), 0) : null;
const userEvents: { t: number; action: string; args: Record<string, unknown> }[] = [];
if (q.has('gust')) userEvents.push({ t: num(q.get('gust'), 2), action: 'gust', args: { strength: 9, duration: 3 } });

const DURATION = 30;
let t = num(q.get('t'), 0);
const film = q.get('film') === '1';
const filmSize = { w: num(q.get('w'), 1280), h: num(q.get('h'), 720) };
const FPS = num(q.get('fps'), 30);

// ---------- сцена вокруг объекта ----------
const VIEWS: Record<string, string> = { general: 'общий', close: 'крупно', ground: 'у земли', top: 'сверху' };

/** Камера витрины: именованные виды считаются от размера объекта (showcase.size) и высоты взгляда (showcase.eye). */
function viewShot(name: string): { at: Vec3; look: Vec3; fov: number; abs?: boolean } {
  const sv = setupOf()?.views?.[name];
  if (sv) return { at: sv.at, look: sv.look, fov: sv.fov ?? 45, abs: sv.abs === true };
  // объект меняет размер вместе с параметром height (если он есть): камера держит его в кадре
  const k = typeof params.height === 'number' && typeof defaultsOf.height === 'number' ? Math.max(0.3, params.height / defaultsOf.height) : 1;
  const far = show.kind === 'world' ? 0.4 : 1; // объекты мира снимаются ближе, относительно их размера
  const size = show.size * k, eye = (show.eye ?? show.size / 2) * k, a = (-35 * Math.PI) / 180;
  const at = (dist: number, h: number): Vec3 => [Math.sin(a) * dist, h, -Math.cos(a) * dist];
  switch (name) {
    case 'close': return { at: at(size * 2.5 * far, eye * 1.2), look: [0, eye * 1.05, 0], fov: 36 };
    case 'ground': return { at: at(size * 3.2 * far, Math.max(size * 0.06, 0.04)), look: [0, eye, 0], fov: 55 };
    case 'top': return { at: [0, size * 5 * far, -size * 0.6 * far], look: [0, 0, 0], fov: 45 };
    default: return { at: at(size * 5 * far, size * 1.1 * far), look: [0, eye, 0], fov: 45 };
  }
}

function build(): SceneDoc {
  const hills = show.ground === 'hills' || TERRAIN_LIKE.includes(objectName);
  const doc = buildScene((s) => {
    const setup = setupOf();
    if (objectName === 'Terrain') s.world.use('Terrain', params);
    else s.world.use('Terrain', hills ? (setup?.terrain ?? { style: 'hills', seed: 7 }) : { style: 'flat' });
    if (setup?.path) s.path('water', { points: setup.path });
    if (hills && objectName !== 'Water') s.world.use('Water', {});
    if (objectName === 'Sky') s.world.use('Sky', params);
    else { s.world.use('Sky', {}); s.world.use('Forces', objectName === 'Forces' ? params : forcesParams); }
    if (objectName === 'Road') { s.path('road', { points: [[-45, 0, -22], [-14, 0, -6], [10, 0, 3], [45, 0, 30]] }); s.world.use('Road', params); }
    else if (show.kind === 'world' && !['Terrain', 'Sky', 'Forces'].includes(objectName)) s.world.use(objectName, objectName === 'Water' && q.has('touch') ? { ...params, touchers: ['rover'] } : params);
    if (objectName === 'Water' && q.has('touch')) {
      // робот въезжает в мелководье: от него идут круги (touch=1)
      s.places({ rover0: [-13, 0, -10], rover1: [3, 0, -6] });
      const rover = s.add('Robot', {}, { at: 'rover0', heading: 90, id: 'rover' });
      s.at(0.5).do(rover.roll({ to: 'rover1', speed: 0.7 }));
    }
    if (show.kind === 'entity') { s.places({ center: [0, 0, 0] }); s.add(objectName, params, { at: 'center', heading: 175, id: objId }); }
    const v = viewShot(viewName);
    s.at(0).camera.shot('fixed', { at: v.at, look: v.look, fov: v.fov, aboveGround: !v.abs });
    const dv0 = setupOf()?.views?.dive;
    const dv = dv0 && q.has('dy') ? { ...dv0, at: [dv0.at[0], num(q.get('dy'), dv0.at[1]), dv0.at[2]] as [number, number, number] } : dv0;
    if (diveAt !== null && dv && v.abs) {
      // нырнуть: плавно под воду, подержать, вернуться
      const dsh = { fov: dv.fov ?? 55, aboveGround: false } as const;
      s.at(diveAt).camera.shot('glide', { from: v.at, to: dv.at, lookFrom: v.look, lookTo: dv.look, duration: DIVE.down, ...dsh });
      s.at(diveAt + DIVE.down + DIVE.hold).camera.shot('glide', { from: dv.at, to: v.at, lookFrom: dv.look, lookTo: v.look, duration: DIVE.up, ...dsh });
    }
  }, { id: `library-${objectName}`, title: `Витрина: ${objectName}`, duration: DURATION, seed: 11, aspect: '16:9' });
  const events: TimelineEvent[] = [];
  const demo = demoIndex !== null ? show.demos?.[demoIndex] : undefined;
  demo?.steps.forEach((st, i) => events.push({ id: `demo${i}`, t: st.t, target: st.target ?? objId, action: st.action, args: st.args }));
  userEvents.forEach((e, i) => events.push({ id: `user${i}`, t: e.t, target: 'forces', action: e.action, args: e.args }));
  doc.timeline = [...doc.timeline, ...events].map((e, i) => ({ e, i })).sort((a, b) => a.e.t - b.e.t || a.i - b.i).map((x) => x.e);
  return doc;
}

// ---------- движок и адаптер ----------
const msg = $('msg');
let doc = build();
const engine = createEngine({ registry });
function load(): boolean {
  doc = build();
  const r = validateAgainstRegistry(doc, registry);
  if (!r.ok) { msg.textContent = `Сцена не прошла проверку:\n${r.errors.join('\n')}`; return false; }
  msg.textContent = '';
  engine.load(r.doc);
  return true;
}
if (!load()) throw new Error(msg.textContent ?? '');

const backend = q.get('backend') === 'webgl2' ? 'webgl2' : 'auto';
const taa = { enabled: q.get('taa') !== '0', accumulate: Number(q.get('accum') ?? 0), warmup: Number(q.get('warmup') ?? 3) };
const fx = q.get('fx') !== '0';
const adapter = createThreeAdapter(film ? { backend, taa, fx, mode: 'film', filmSize, pixelRatio: 1 } : { backend, taa, fx });
const canvas = $<HTMLCanvasElement>('view');
await adapter.mount(canvas, doc, () => engine.sim());

let playing = !film;
let free = !film && $<HTMLInputElement>('free').checked;
if (film) { $<HTMLInputElement>('free').checked = false; $('play').textContent = '▶'; }

function frameSize() {
  const stage = $('stage').getBoundingClientRect();
  const a = 16 / 9, w = Math.min(stage.width, stage.height * a);
  return { w: Math.max(2, Math.floor(w)), h: Math.max(2, Math.floor(w / a)) };
}

const slider = $<HTMLInputElement>('t');
function draw(jump = false) {
  const w = engine.seek(t);
  if (jump) adapter.discontinuity();
  adapter.sync(w, engine.sim());
  const { w: cw, h: ch } = frameSize();
  adapter.render({ w: cw, h: ch });
  canvas.style.width = `${cw}px`; canvas.style.height = `${ch}px`;
  slider.value = String(t);
  $('time').textContent = `${t.toFixed(1)} / ${DURATION} с`;
  const forces = w.world?.forces as { time?: number } | undefined;
  $('state').textContent = JSON.stringify({ t: w.t, sun: w.sun, handles: w.handles, world: w.world, unlinked: w.unlinked, [objId]: w.entities[objId] && { action: w.entities[objId]!.action, antenna: w.entities[objId]!.antenna, eyeOpen: w.entities[objId]!.eyeOpen } }, (_k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v), 1) + `\n\nhash: ${hashWorldState(w)}`;
  const tm = $('f-time-out'); if (tm && forces?.time !== undefined) tm.textContent = clock(forces.time);
}
const clock = (h: number) => { const m = Math.round(h * 60) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

/** Параметры или ручки изменились: пересобрать сцену. remount — если меняется то, что вид читает только при создании (облик). */
function rebuild(remount: boolean) {
  if (!load()) return;
  if (remount) adapter.remount(doc);
  draw(true);
}

// ---------- панели ----------
type Field = ReturnType<typeof paramFields>[number];
function control(f: Field, store: Params, onChange: () => void, out?: string): HTMLElement {
  const row = document.createElement('div'); row.className = 'row';
  const tip = `${f.describe || f.name}${f.unit ? ` [${f.unit}]` : ''}${f.min !== undefined || f.max !== undefined ? `\nдиапазон ${f.min ?? '…'} … ${f.max ?? '…'}` : ''}${f.default !== undefined ? `\nпо умолчанию ${JSON.stringify(f.default)}` : ''}`;
  row.title = tip;
  const lab = document.createElement('label'); lab.htmlFor = `f-${f.name}`;
  lab.innerHTML = `${f.name}${f.unit ? ` <i>${f.unit}</i>` : ''}`;
  row.append(lab);
  const value = store[f.name];
  if (f.options) {
    const sel = document.createElement('select'); sel.id = `f-${f.name}`;
    for (const o of f.options) { const op = document.createElement('option'); op.value = o; op.textContent = o; sel.append(op); }
    sel.value = String(value); sel.onchange = () => { store[f.name] = sel.value; onChange(); };
    row.append(sel);
  } else if (f.boolean) {
    const c = document.createElement('input'); c.type = 'checkbox'; c.id = `f-${f.name}`; c.checked = Boolean(value);
    c.onchange = () => { store[f.name] = c.checked; onChange(); }; row.append(c);
  } else if (f.kind === 'color') {
    const c = document.createElement('input'); c.type = 'color'; c.id = `f-${f.name}`; c.value = String(value);
    c.oninput = () => { store[f.name] = c.value; onChange(); }; row.append(c);
  } else {
    const r = document.createElement('input'); r.type = 'range'; r.id = `f-${f.name}`;
    const min = f.min ?? 0, max = f.max ?? Math.max(1, Number(value) * 2);
    r.min = String(min); r.max = String(max); r.step = f.integer ? '1' : String((max - min) / 400);
    r.value = String(value);
    const o = document.createElement('output'); o.id = out ?? `f-${f.name}-out`; o.textContent = fmt(Number(value));
    r.oninput = () => { store[f.name] = Number(r.value); o.textContent = out === 'f-time-out' ? clock(Number(r.value)) : fmt(Number(r.value)); onChange(); };
    row.append(r, o);
  }
  return row;
}
const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));

function panels() {
  const db = document.getElementById('dive') as HTMLButtonElement | null;
  if (db) db.style.display = show.dive && setupOf()?.views?.dive ? '' : 'none';
  $('title').textContent = `Витрина: ${objectName}`;
  const sel = $<HTMLSelectElement>('object');
  sel.innerHTML = '';
  for (const k of Object.keys(registry.components)) { const o = document.createElement('option'); o.value = k; o.textContent = k; o.selected = k === objectName; sel.append(o); }
  sel.onchange = () => { const u = new URLSearchParams(); u.set('object', sel.value); location.search = u.toString(); };

  const pr = $('presets'); pr.innerHTML = '';
  if (!Object.keys(ALL_PRESETS).length) pr.textContent = '— у объекта нет пресетов';
  for (const name of Object.keys(ALL_PRESETS)) {
    const b = document.createElement('button'); b.textContent = name; b.className = name === presetName ? 'on' : '';
    b.onclick = () => {
      presetName = name;
      const next = { ...(def!.params as unknown as { parse(x: unknown): Params }).parse(ALL_PRESETS[name]) };
      if (objectName === 'Forces') Object.assign(forcesParams, next); else params = next;
      panels(); rebuild(true);
    };
    pr.append(b);
  }
  const ps = $('params'), hs = $('handles'); ps.innerHTML = ''; hs.innerHTML = '';
  for (const f of fields) {
    if (f.handle) hs.append(control(f, params, () => rebuild(false)));
    else ps.append(control(f, params, () => rebuild(true)));
  }
  if (!ps.children.length) ps.textContent = '— все параметры объекта — ручки справа';
  if (!hs.children.length) hs.textContent = '— у объекта нет ручек';

  const dm = $('demos'); dm.innerHTML = '';
  if (!show.demos?.length) dm.textContent = '— у объекта нет демо';
  show.demos?.forEach((d, i) => {
    const b = document.createElement('button'); b.textContent = `▶ ${d.title}`; b.className = demoIndex === i ? 'on' : '';
    b.onclick = () => { demoIndex = i; t = 0; playing = true; $('play').textContent = '⏸'; panels(); rebuild(false); };
    dm.append(b);
  });

  // силы мира (сверху): у Sky своё ручное солнце
  const fc = $('forces'); fc.querySelectorAll('.fc').forEach((n) => n.remove());
  const spec: [string, string, number, number, string][] = [['time', 'время', 0, 24, 'ч'], ['windStrength', 'ветер', 0, 20, 'м/с'], ['windDirection', 'куда дует', 0, 360, '°'], ['cloudiness', 'облачность', 0, 1, ''], ['fog', 'туман', 0, 1, '']];
  for (const [name, label, min, max, unit] of spec) {
    const w = document.createElement('label'); w.className = 'fc'; w.title = `${label}${unit ? `, ${unit}` : ''}`;
    const r = document.createElement('input'); r.type = 'range'; r.min = String(min); r.max = String(max); r.step = String((max - min) / 480); r.id = `force-${name}`;
    r.value = String(forcesParams[name]); r.disabled = objectName === 'Sky';
    const o = document.createElement('output'); o.id = name === 'time' ? 'f-time-out' : `force-${name}-out`; o.textContent = name === 'time' ? clock(Number(r.value)) : fmt(Number(r.value));
    r.oninput = () => { forcesParams[name] = Number(r.value); o.textContent = name === 'time' ? clock(Number(r.value)) : fmt(Number(r.value)); if (objectName === 'Forces') { const own = $<HTMLInputElement>(`f-${name}`); if (own) own.value = r.value; } rebuild(false); };
    w.append(`${label} `, r, o); fc.append(w);
  }

  const vs = $('views'); vs.innerHTML = '';
  for (const [k, label] of Object.entries(VIEWS)) {
    const b = document.createElement('button'); b.textContent = label; b.className = k === viewName ? 'on' : '';
    b.onclick = () => { viewName = k; panels(); setView(); };
    vs.append(b);
  }
}

/** Сменить вид: камера берётся из плана сцены, потом снова отдаётся мыши (облёт). */
function setView() {
  adapter.setFreeCamera(false);
  if (!load()) return;
  draw(true);
  if (free) adapter.setFreeCamera(true);
}

// ---------- управление ----------
$<HTMLButtonElement>('play').onclick = () => { playing = !playing; $('play').textContent = playing ? '⏸' : '▶'; };
$<HTMLButtonElement>('restart').onclick = () => { t = 0; draw(true); };
slider.oninput = () => { t = Number(slider.value); draw(true); };
$<HTMLInputElement>('free').onchange = (e) => { free = (e.target as HTMLInputElement).checked; adapter.setFreeCamera(free); };
const diveBtn = document.getElementById('dive') as HTMLButtonElement | null;
if (diveBtn) {
  diveBtn.style.display = show.dive && setupOf()?.views?.dive ? '' : 'none';
  diveBtn.onclick = () => { diveAt = Math.round(t * 60) / 60; playing = true; $('play').textContent = '⏸'; setView(); };
}
$<HTMLButtonElement>('gust').onclick = () => {
  if (objectName === 'Sky') return;
  userEvents.push({ t: Math.round(t * 60) / 60, action: 'gust', args: { strength: 9, duration: 3 } });
  playing = true; $('play').textContent = '⏸';
  rebuild(false);
};
$<HTMLButtonElement>('snap').onclick = async () => {
  draw();
  const bmp = await adapter.capture();
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d')!.drawImage(bmp, 0, 0);
  c.toBlob((b) => { if (!b) return; const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `${objectName}-${presetName || 'obj'}-t${t.toFixed(1)}.png`; a.click(); });
};
canvas.addEventListener('pointermove', () => { if (!playing) draw(); });
canvas.addEventListener('wheel', () => { if (!playing) draw(); });

let last = performance.now(); // часы живут только здесь, в приложении: логика движка времени не знает
function frame() {
  const n = performance.now();
  if (playing) {
    t += (n - last) / 1000;
    const wrapped = t > DURATION;
    if (wrapped) t = 0;
    draw(wrapped);
  }
  last = n;
  requestAnimationFrame(frame);
}

// для e2e: детерминированный кадр на заданной секунде (как у плеера)
(window as unknown as { __player: unknown }).__player = {
  show(sec: number, prev?: number) {
    playing = false;
    if (prev !== undefined) { t = prev; draw(true); t = sec; draw(); } else { t = sec; draw(true); }
    return hashWorldState(engine.state());
  },
  step(sec: number) { playing = false; t = sec; draw(); return hashWorldState(engine.state()); },
  gpuMs: () => adapter.gpuMs(),
  shaderBuilds: () => adapter.shaderBuilds(),
  shadowInfo: () => adapter.shadowInfo(),
  play(from: number, to: number) {
    playing = false;
    const n = Math.round((to - from) * FPS);
    for (let i = 0; i <= n; i++) { t = from + i / FPS; draw(i === 0); }
    return hashWorldState(engine.state());
  },
  state: () => engine.state(),
};

panels();
if (film) draw(true);
else { draw(true); if (free) adapter.setFreeCamera(true); }
frame();
