import { test, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const root = mkdtempSync(join(tmpdir(), 'revskills-budget-namespace-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
test('a retired namespace cannot supply the control budget', () => {
  const legacy = join(root, 'legacy');
  const target = join(legacy, 'revealui/.revealui/adapters/grok');
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, 'token-budget.json'), JSON.stringify({ compactionAtTokens: 12345 }));
  const script = join(root, 'read.cjs');
  writeFileSync(script, `const { readTokenBudget } = require(${JSON.stringify(resolve('scripts/lib/read-token-budget.js'))});\nconsole.log(JSON.stringify(readTokenBudget()));\n`);
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: root, REVEALUI_TOKEN_BUDGET_JSON: '', REVEALFLEET_ROOT: join(root, 'canonical') };
  env[['REV', 'FLEET_ROOT'].join('')] = legacy;
  const result = spawnSync('node', [script], { env, encoding: 'utf8' });
  expect(result.status).toBe(0); expect(result.stdout.trim()).toBe('null');
});
