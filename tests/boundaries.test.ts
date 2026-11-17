import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : f.endsWith('.ts') ? [join(dir, f)] : []));
const imports = (dir: string) => files(dir).flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => ({ f, i: m[1]! })));

// граф раздела 3: пакет → что ему разрешено импортировать из @cartoon/*
const ALLOWED: Record<string, string[]> = {
  schema: [],
  engine: ['schema'],
  components: ['schema', 'engine'],
  director: ['schema', 'engine', 'components'],
  'render-three': ['schema', 'engine', 'components'],
  export: ['engine', 'render-three', 'schema'],
};

describe('границы слоёв (тест 6, страховка к ESLint)', () => {
  for (const [pkg, allowed] of Object.entries(ALLOWED)) {
    it(`${pkg}: зависимости только вниз по графу`, () => {
      for (const { f, i } of imports(`packages/${pkg}/src`)) {
        const m = i.match(/^@cartoon\/([^/]+)/);
        if (m) expect(allowed, `${f} импортирует ${i}`).toContain(m[1]);
        if (pkg !== 'render-three' && pkg !== 'export') expect(i, `${f}: three только в render-three`).not.toMatch(/^three($|\/)/);
      }
    });
  }
  it('в логике нет Math.random / Date.now / performance.now / new Date', () => {
    for (const pkg of ['schema', 'engine', 'components', 'director']) {
      for (const f of files(`packages/${pkg}/src`)) {
        expect(readFileSync(f, 'utf8'), f).not.toMatch(/Math\.random|Date\.now|performance\.now|new Date\(/);
      }
    }
  });
});

describe('лицензии (тест 7)', () => {
  it('все зависимости входят в разрешённый список раздела 3.1', async () => {
    // @ts-expect-error обычный .mjs-скрипт без типов
    const { checkLicenses } = await import('../scripts/check-licenses.mjs');
    expect(checkLicenses()).toEqual([]);
  }, 60_000);
});

// Часть B: сторонний код nanite-lib лежит в packages/render-three/vendor/. Правило 3 действует и для него.
const walk = (dir: string, skip: RegExp): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (skip.test(p)) return [];
    return statSync(p).isDirectory() ? walk(p, skip) : [p];
  });
const SKIP = /(^|\/)(node_modules|dist|sources|test-results|playwright-report|\.git)(\/|$)/;

describe('vendor и граница three (часть B, шаг 6)', () => {
  const VENDOR = 'packages/render-three/vendor/threejs-nanites';
  it('three импортируется только в packages/render-three и packages/export (включая vendor и apps)', () => {
    for (const root of ['apps', 'packages', 'scenes', 'tests', 'e2e']) {
      for (const f of walk(root, SKIP).filter((x) => /\.(ts|js|mjs|html)$/.test(x))) {
        if (f.startsWith('packages/render-three/') || f.startsWith('packages/export/') || f === 'tests/boundaries.test.ts') continue;
        const src = readFileSync(f, 'utf8');
        expect(src, `${f}: three только в render-three`).not.toMatch(/from\s+'three(\/[^']*)?'|import\s*\(\s*'three(\/[^']*)?'\s*\)|import\s+'three(\/[^']*)?'/);
      }
    }
  });
  it('в vendor только исходники .ts и LICENSE', () => {
    const names = walk(VENDOR, SKIP);
    expect(names).toContain(`${VENDOR}/LICENSE`);
    for (const f of names) expect(f.endsWith('.ts') || f === `${VENDOR}/LICENSE`, f).toBe(true);
  });
  it('в дереве нет модели Lucy (*.nm), аудио и текстур из public/ nanites', () => {
    for (const f of walk('.', SKIP)) expect(f, f).not.toMatch(/\.(nm|mp3)$/);
  });
  it('каждая правка vendor помечена // OURS: (файл с OURS не пустой пометкой)', () => {
    for (const f of walk(VENDOR, SKIP).filter((x) => x.endsWith('.ts'))) {
      for (const m of readFileSync(f, 'utf8').matchAll(/\/\/ OURS(.*)/g)) expect(m[1], `${f}: после OURS нужно «: причина»`).toMatch(/^: \S/);
    }
  });
});
