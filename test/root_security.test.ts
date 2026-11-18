import { test, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, symlinkSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { scan } from '../scripts/check-client-leaks.mts';
import { validateSkill } from '../scripts/lib/skill-metadata.mts';

const root = mkdtempSync(join(tmpdir(), 'revskills-security-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
function fixture() {
  const folder = mkdtempSync(join(root, 'case-'));
  const candidate = join(folder, 'candidate'); mkdirSync(candidate);
  const rules = join(folder, 'rules.json');
  writeFileSync(rules, JSON.stringify([{ id: 'rule-001', literal: 'SyntheticPrivateCanary' }]), { mode: 0o600 });
  return { folder, candidate, rules };
}

test('private rules detect binary, changelog and scanner-named files without emitting content', () => {
  const f = fixture();
  for (const name of ['CHANGELOG.md', 'check-client-leaks.sh', '.gitleaks.issues.toml', 'secret.png']) writeFileSync(join(f.candidate, name), 'SyntheticPrivateCanary');
  const report = scan([f.candidate], f.rules);
  expect(report.violations).toBe(4);
  expect(JSON.stringify(report)).not.toContain('SyntheticPrivateCanary');
  expect(JSON.stringify(report)).not.toContain('secret.png');
});

test('missing configuration, empty scope, bad rules, missing roots and unreadable inputs fail closed', () => {
  const f = fixture();
  expect(() => scan([f.candidate], f.rules)).toThrow();
  expect(() => scan([join(f.folder, 'missing')], f.rules)).toThrow();
  const file = join(f.candidate, 'file'); writeFileSync(file, 'safe'); chmodSync(file, 0);
  expect(() => scan([f.candidate], f.rules)).toThrow(); chmodSync(file, 0o600);
  chmodSync(f.rules, 0o644); expect(() => scan([f.candidate], f.rules)).toThrow(); chmodSync(f.rules, 0o600);
  const result = spawnSync('node', ['scripts/check-client-leaks.mts', f.candidate], { env: { ...process.env, REVSKILLS_CLIENT_RULES_FILE: '' }, encoding: 'utf8' });
  expect(result.status).toBe(2);
});

test('candidate symlinks are inspected as link data without following external files', () => {
  const f = fixture();
  writeFileSync(join(f.folder, 'outside'), 'SyntheticPrivateCanary');
  symlinkSync('../outside', join(f.candidate, 'link'));
  expect(scan([f.candidate], f.rules).violations).toBe(0);
  symlinkSync('SyntheticPrivateCanary', join(f.candidate, 'named-link'));
  expect(scan([f.candidate], f.rules).violations).toBe(1);
});

test('the private dictionary itself cannot be included in a candidate scope', () => {
  const f = fixture(); expect(() => scan([f.folder], f.rules)).toThrow();
});

test('published names and dependency directories cannot bypass private-name checks', () => {
  const f = fixture(); mkdirSync(join(f.candidate, 'node_modules'));
  writeFileSync(join(f.candidate, 'node_modules/published.txt'), 'SyntheticPrivateCanary');
  writeFileSync(join(f.candidate, 'SyntheticPrivateCanary.md'), 'safe content');
  expect(scan([f.candidate], f.rules).violations).toBe(2);
});

test('recovery inventory omits every user-controlled content field in both adapters', () => {
  const f = fixture(); const canary = 'SyntheticPrivateCanary' + '.'.repeat(300);
  const grok = join(f.folder, '.grok/sessions/work/sid'); mkdirSync(grok, { recursive: true });
  writeFileSync(join(grok, 'summary.json'), JSON.stringify({ info: { id: canary, cwd: canary }, generated_title: canary, last_active_at: new Date().toISOString(), num_chat_messages: 2 }));
  writeFileSync(join(grok, 'chat_history.jsonl'), JSON.stringify({ role: 'assistant', content: canary }));
  const claude = join(f.folder, '.claude/projects/work'); mkdirSync(claude, { recursive: true });
  writeFileSync(join(claude, 'id.jsonl'), JSON.stringify({ role: 'user', content: canary }));
  const result = spawnSync('node', ['scripts/recover-inventory.js'], { env: { ...process.env, HOME: f.folder, TMPDIR: f.candidate }, encoding: 'utf8' });
  expect(result.status).toBe(0); expect(result.stdout).toContain('unique=2');
  expect(result.stdout + result.stderr).not.toContain('SyntheticPrivateCanary');
});

test('metadata validator rejects malformed frontmatter, nonstring fields, duplicate keys and bad portable metadata', () => {
  const f = fixture(); const dir = join(f.candidate, 'sample'); mkdirSync(dir); const file = join(dir, 'SKILL.md');
  for (const yaml of [
    'name: sample\ndescription: [invalid]', 'name: sample\nname: sample\ndescription: valid',
    'name: sample\ndescription: valid\nmetadata:\n  related: [a,b]',
    'name: sample\ndescription: valid\nallowed-tools: Read, Bash',
    'name: Wrong\ndescription: valid',
  ]) { writeFileSync(file, `---\n${yaml}\n---\nBody\n`); expect(validateSkill(file).length).toBeGreaterThan(0); }
  writeFileSync(file, '---\nname: sample\ndescription: valid\n'); expect(validateSkill(file).length).toBeGreaterThan(0);
  writeFileSync(file, '---\nname: sample\ndescription: valid\nmetadata:\n  related: a b\n---\nBody\n'); expect(validateSkill(file)).toEqual([]);
});

test('explicit recovery locator index is private, contains no transcript text and cannot overwrite an existing file', () => {
  const f = fixture(); const sessions = join(f.folder, '.grok/sessions/work/session');
  mkdirSync(sessions, { recursive: true });
  writeFileSync(join(sessions, 'summary.json'), JSON.stringify({ generated_title: 'SyntheticPrivateCanary', last_active_at: new Date().toISOString() }));
  const index = join(f.folder, 'locators.json');
  const run = () => spawnSync('node', ['scripts/recover-inventory.js', '--index-file', index], { env: { ...process.env, HOME: f.folder, TMPDIR: f.candidate }, encoding: 'utf8' });
  const result = run(); expect(result.status).toBe(0);
  expect(result.stdout + result.stderr).not.toContain('SyntheticPrivateCanary');
  const text = readFileSync(index, 'utf8'); expect(text).not.toContain('SyntheticPrivateCanary');
  const records = JSON.parse(text); expect(records[0].sourcePath).toBe(join(sessions, 'summary.json'));
  expect(statSync(index).mode & 0o777).toBe(0o600);
  expect(run().status).toBe(2); expect(readFileSync(index, 'utf8')).toBe(text);
});

test('plugin validator rejects malformed JSON and an empty plugin tree', () => {
  const f = fixture();
  const run = () => spawnSync('node', ['scripts/validate-metadata.mts', 'plugins', f.candidate], { encoding: 'utf8' });
  expect(run().status).toBe(1);
  mkdirSync(join(f.candidate, '.claude-plugin'));
  writeFileSync(join(f.candidate, '.claude-plugin/plugin.json'), '{"name":"bad", "description":"bad", "version":"1.0.0"');
  expect(run().status).toBe(1);
});

test('retired operator entrypoints cannot label PRs, parse outcomes, or create state', () => {
  const f = fixture();
  for (const launcher of ['bin/rfloop', 'bin/revloop']) for (const flags of [[], ['--dry-run', '--owner-ok'], ['--owner-ok', '--dry-run'], ['../escape']]) {
    const result = spawnSync('bash', [launcher, ...flags], { env: { ...process.env, HOME: f.folder }, encoding: 'utf8' });
    expect(result.status).toBe(2); expect(result.stderr).toContain('P0 stub');
  }
});
