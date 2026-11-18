import { test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { coldShot } from './capture.ts';
const lib = (q: string) => `/library.html?backend=webgl2&film=1&w=1280&h=720&${q}`;
test('scratch', async () => {
  test.setTimeout(300_000);
  mkdirSync('/private/tmp/claude-501/B2-trees', { recursive: true });
  for (const [n, q, t] of [['oak', 'object=Tree&preset=oak&view=general', 1], ['family', 'object=Tree&family=1', 1]] as const) {
    const s = await coldShot(lib(q), t, t - 1 / 30);
    writeFileSync(`/private/tmp/claude-501/B2-trees/${n}.png`, s.png);
    console.log(n, s.errors, s.hash);
  }
});
