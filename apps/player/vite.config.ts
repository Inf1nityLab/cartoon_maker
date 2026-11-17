import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

// Часть B (nanite-lib): ez-tree растёт в worker, а его npm-сборка вшивает 20 картинок и грузит их через DOM (в worker нет DOM).
// Берём исходники пакета (они лежат в самом пакете) и подменяем модуль текстур заглушкой: геометрии они не нужны.
// Картинки для рендерера (bark/leaf) идут из того же пакета через псевдоним `ez-tree-assets`.
const EZ = fileURLToPath(new URL('../../packages/render-three/node_modules/@dgreenheck/ez-tree/src/lib/', import.meta.url));
const ezTreeWithoutTextures = (): Plugin => ({
  name: 'ez-tree-without-textures',
  enforce: 'pre',
  load(id) {
    if (id.split('?')[0].replace(/\\/g, '/').endsWith('/ez-tree/src/lib/textures.js')) return 'export const getBarkTexture = () => null;\nexport const getLeafTexture = () => null;\n';
  },
});

export default defineConfig({
  plugins: [ezTreeWithoutTextures()],
  resolve: {
    alias: [
      { find: /^@dgreenheck\/ez-tree$/, replacement: `${EZ}index.js` },
      { find: /^ez-tree-assets\//, replacement: `${EZ}assets/` },
    ],
  },
  // include: зависимости, которые Vite иначе «открывает» на лету и перезагружает страницу посреди теста («Execution context was destroyed»)
  optimizeDeps: { exclude: ['@dgreenheck/ez-tree'], include: ['three', 'three/tsl', 'three/webgpu', 'three/addons/controls/OrbitControls.js', 'three/addons/csm/CSMShadowNode.js', 'three/addons/utils/BufferGeometryUtils.js', 'meshoptimizer', 'zod'] }, // (dev-сервер не должен предсобирать ez-tree из npm-сборки мимо псевдонима)
  worker: { format: 'es', plugins: () => [ezTreeWithoutTextures()] },
  server: { fs: { allow: ['../..'] } },
  build: { rolldownOptions: { input: { main: fileURLToPath(new URL('./index.html', import.meta.url)), nanite: fileURLToPath(new URL('./nanite.html', import.meta.url)), library: fileURLToPath(new URL('./library.html', import.meta.url)) } } },
});
