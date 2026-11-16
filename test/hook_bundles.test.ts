import { afterEach, expect, test } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const created: string[] = [];
afterEach(() => { for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function isolatedHooks() {
  const root = mkdtempSync(join(tmpdir(), 'revskills-copied-hooks-')); created.push(root);
  const hooks = join(root, 'hooks'); mkdirSync(hooks);
  for (const name of ['snapshot-before-compact.js', 'sync-grok-token-budget.js']) copyFileSync(resolve('scripts', name), join(hooks, name));
  expect(readdirSync(hooks)).toEqual(['snapshot-before-compact.js', 'sync-grok-token-budget.js']);
  const env = { HOME: root, GROK_HOME: join(root, '.grok'), REVEALUI_COORD_ROOT: join(root, 'coord'), NODE_PATH: '', NODE_OPTIONS: '' };
  return { root, hooks, env };
}
function run(file: string, args: string[], input: string | undefined, root: string, env: Record<string, string>) {
  return spawnSync(process.execPath, [file, ...args], { cwd: root, env, encoding: 'utf8', input });
}
function signal(root: string, sid: string, used: number) {
  const dir = join(root, '.grok', 'sessions', encodeURIComponent(root), sid); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'signals.json'), JSON.stringify({ contextTokensUsed: used, contextWindowTokens: 10000 }));
}

test('committed hook bundles match deterministic source build', () => {
  const result = spawnSync(process.execPath, ['scripts/build-hooks.mts', '--check'], { encoding: 'utf8' });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('2 entrypoints');
  const notices = readFileSync('scripts/HOOK_BUNDLES_LICENSES.txt', 'utf8');
  expect(notices).toContain('toml-eslint-parser@');
  expect(notices).toContain('mdast-util-from-markdown@');
});

test('copied snapshot bundle reads budget, blocks stale sessions, accepts fresh authored snapshots, and writes mechanical fallback', () => {
  const f = isolatedHooks();
  const budget = join(f.root, 'budget.json');
  writeFileSync(budget, JSON.stringify({ compactionAtTokens: 9000, contextWindowTokens: 10000, snapshotHeadroomTokens: 1000 }));
  const env = { ...f.env, REVEALUI_TOKEN_BUDGET_JSON: budget };
  const hook = join(f.hooks, 'snapshot-before-compact.js');
  signal(f.root, 'under-budget', 6000);
  const under = run(hook, ['--mode=stop'], JSON.stringify({ sessionId: 'under-budget', cwd: f.root }), f.root, env);
  expect(under.status).toBe(0); expect(under.stdout).toBe(''); expect(under.stderr).toContain('occupancy 60% < gate 80%');

  signal(f.root, 'needs-snapshot', 9000);
  const blocked = run(hook, ['--mode=stop'], JSON.stringify({ sessionId: 'needs-snapshot', cwd: f.root }), f.root, env);
  expect(blocked.status).toBe(0); expect(JSON.parse(blocked.stdout).decision).toBe('block');
  const mechanical = run(hook, ['--mode=precompact'], JSON.stringify({ sessionId: 'needs-snapshot', cwd: f.root }), f.root, env);
  expect(mechanical.status).toBe(0); expect(mechanical.stderr).toContain('wrote mechanical');
  const file = join(f.root, 'coord', 'snapshots', 'needs-snapshot.md');
  expect(readFileSync(file, 'utf8')).toContain('origin: precompact-mechanical');
  expect(statSync(file).mode & 0o777).toBe(0o600);

  signal(f.root, 'authored', 9000);
  const authoredFile = join(f.root, 'coord', 'snapshots', 'authored.md');
  const sections = ['Resume-From-Here', 'What-Shipped', 'Active-Constraints', 'Do-Not-Repeat', 'Open-Loose-Ends'];
  writeFileSync(authoredFile, `---\nsession_id: authored\ncreated: "${new Date().toISOString()}"\n---\n${sections.map(name => `## ${name}\nConcrete current session notes.\n`).join('\n')}`, { mode: 0o600 });
  const accepted = run(hook, ['--mode=stop'], JSON.stringify({ sessionId: 'authored', cwd: f.root }), f.root, env);
  expect(accepted.status).toBe(0); expect(accepted.stdout).toBe(''); expect(accepted.stderr).toContain('agent snapshot authored');
});

test('copied sync bundle edits TOML numbers while preserving comments and inactive model values', () => {
  const f = isolatedHooks();
  const budgetFile = join(f.root, 'budget.json'); const configFile = join(f.root, 'config.toml');
  writeFileSync(budgetFile, JSON.stringify({ compactionAtTokens: 160000, contextWindowTokens: 500000, models: ['active.model'] }));
  writeFileSync(configFile, '# auto_compact_threshold_percent = 85\n[session]\nauto_compact_threshold_percent = 90 # preserve percent comment\n[model.inactive]\ncompaction_at_tokens = 9 # inactive\n[model."active.model"]\ncompaction_at_tokens = 1000 # preserve token comment\n');
  const result = run(join(f.hooks, 'sync-grok-token-budget.js'), [budgetFile, configFile], undefined, f.root, f.env);
  expect(result.status).toBe(0);
  const next = readFileSync(configFile, 'utf8');
  expect(next).toContain('auto_compact_threshold_percent = 32 # preserve percent comment');
  expect(next).toContain('compaction_at_tokens = 160000 # preserve token comment');
  expect(next).toContain('compaction_at_tokens = 9 # inactive');
  expect(statSync(configFile).mode & 0o777).toBe(0o600);
  expect(readdirSync(f.hooks)).toEqual(['snapshot-before-compact.js', 'sync-grok-token-budget.js']);
});
