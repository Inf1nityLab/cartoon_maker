// Часть B: страница показа nanite-lib. Запускает показ из render-three и выставляет window.__nanite для теста.
// По умолчанию — фиксированный режим (occlusion выключен, prepass листьев выключен, list-guard выключен): предпросмотр
// должен совпадать с будущим видео. `?live=1` — list-guard и prepass листьев в режимах автора (для сравнения).
// Occlusion выключен всегда (решение владельца); `?occ=1` — только диагностика известного дефекта.
const q = new URLSearchParams(location.search);
const live = q.get('live') === '1';
if (!live) {
  // vendor читает эти параметры из location.search при загрузке своих модулей, поэтому ставим их до динамического import
  for (const [k, v] of [['listguard', '0'], ['leafpre', '0']] as const) if (!q.has(k)) q.set(k, v);
  history.replaceState(null, '', `${location.pathname}?${q}`);
}
const { startNaniteDemo } = await import('@cartoon/render-three/nanite');
const W = Number(q.get('w') ?? 960), H = Number(q.get('h') ?? 540);
(window as unknown as { __nanite: unknown }).__nanite = startNaniteDemo({ canvas: document.getElementById('view') as HTMLCanvasElement, width: W, height: H, fixed: q.get('occ') !== '1' });
