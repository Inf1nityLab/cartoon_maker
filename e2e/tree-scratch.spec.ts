import { test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { coldShot } from './capture.ts';
const lib = (q: string) => `/library.html?backend=webgl2&film=1&w=1280&h=720&${q}`;
test('scratch', async () => {
  test.setTimeout(600_000);
  mkdirSync('/private/tmp/claude-501/B2-trees', { recursive: true });
  const list = (process.env.SHOTS ?? '').split(';').filter(Boolean).map((x) => x.split('|'));
  for (const [n, q, t] of list) {
    const s = await coldShot(lib(q!), Number(t ?? 1), Number(t ?? 1) - 1 / 30);
    writeFileSync(`/private/tmp/claude-501/B2-trees/${n}.png`, s.png);
    console.log(n, s.errors, s.hash);
  }
});
