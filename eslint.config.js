import tseslint from 'typescript-eslint';

const LOGIC = ['packages/schema/src/**', 'packages/engine/src/**', 'packages/components/src/**', 'packages/director/src/**'];

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', 'e2e/**', 'playwright-report/**', 'test-results/**', 'sources/_eval/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Правило 3: Three.js только в packages/render-three
      'no-restricted-imports': ['error', { patterns: [{ group: ['three', 'three/*'], message: 'Three.js разрешён только в packages/render-three (и export).' }] }],
    },
  },
  {
    // Правило 2: детерминизм — никаких часов и случайности в логике
    files: LOGIC,
    rules: {
      'no-restricted-properties': ['error',
        { object: 'Math', property: 'random', message: 'Случайность — только ctx.rng (seed + id компонента).' },
        { object: 'Date', property: 'now', message: 'Время — только из таймлайна.' },
        { object: 'performance', property: 'now', message: 'Время — только из таймлайна.' },
      ],
      'no-restricted-globals': ['error', { name: 'Date', message: 'Время — только из таймлайна.' }, { name: 'performance', message: 'Время — только из таймлайна.' }],
      'no-restricted-syntax': ['error', { selector: "NewExpression[callee.name='Date']", message: 'new Date() запрещён: время только из таймлайна.' }],
    },
  },
  {
    // Правило 10: зависимости только сверху вниз
    files: ['packages/schema/src/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [{ group: ['@cartoon/*', 'three', 'three/*'], message: 'schema ничего не знает о других пакетах.' }] }] },
  },
  {
    files: ['packages/engine/src/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [{ group: ['@cartoon/components', '@cartoon/director', '@cartoon/render-three', '@cartoon/export', 'three', 'three/*'], message: 'engine зависит только от schema.' }] }] },
  },
  {
    files: ['packages/components/src/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [{ group: ['@cartoon/director', '@cartoon/render-three', '@cartoon/export', 'three', 'three/*'], message: 'components зависят только от schema и engine, без three.' }] }] },
  },
  { files: ['packages/render-three/src/**', 'packages/export/src/**'], rules: { 'no-restricted-imports': 'off' } },
  {
    // Чужой код (vendor): стилевые правила выключены, чужой стиль не переписываем (раздел 3.1).
    // Правило 3 («three только в render-three») остаётся в силе: vendor лежит внутри render-three, снаружи его импортировать три нельзя,
    // это сторожит tests/boundaries.test.ts (три-импорты по всему репозиторию).
    files: ['packages/render-three/vendor/**'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-unsafe-declaration-merging': 'off',
      'prefer-const': 'off',
    },
  },
);
