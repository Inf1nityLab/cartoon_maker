// Раздел 3.1: разрешены только перечисленные лицензии. Всё остальное роняет сборку.
// Прод-зависимости — строго по списку документа. Dev-инструменты (линтер, тесты) в продукт не попадают:
// для них добавлены ещё две разрешающие лицензии, которые тащит ESLint.
import { execFileSync } from 'node:child_process';

export const ALLOWED_PROD = ['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'Zlib', 'MPL-2.0', 'CC0-1.0', 'CC-BY-4.0'];
export const ALLOWED_DEV = [...ALLOWED_PROD, 'Python-2.0', 'BlueOak-1.0.0'];

const list = (prod) => JSON.parse(execFileSync('pnpm', ['licenses', 'list', '--json', ...(prod ? ['--prod'] : [])], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));

export function checkLicenses() {
  const bad = [];
  for (const [prod, allowed] of [[true, ALLOWED_PROD], [false, ALLOWED_DEV]]) {
    for (const [license, pkgs] of Object.entries(list(prod))) {
      if (!allowed.includes(license)) for (const p of pkgs) bad.push(`${p.name}@${(p.versions ?? [p.version]).join(',')}: ${license}${prod ? ' (прод)' : ' (dev)'}`);
    }
  }
  return bad;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const bad = checkLicenses();
  if (bad.length) { console.error('Запрещённые лицензии:\n' + bad.join('\n')); process.exit(1); }
  console.log('Лицензии в порядке.');
}
