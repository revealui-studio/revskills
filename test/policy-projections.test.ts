import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { verifyPolicyProjections } from '../scripts/verify-policy-projections.mts';
const root = resolve(import.meta.dirname, '..');
function fixture(fn: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'policy-test-'));
  try { for (const dot of ['.revealui', '.claude', '.grok']) cpSync(join(root, dot), join(dir, dot), { recursive: true }); fn(dir); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}
const manifestPath = (dir: string, dot: string) => join(dir, dot, '.revcon-manifest.json');
function editManifest(dir: string, dot: string, edit: (value: any) => void) {
  const file = manifestPath(dir, dot); const value = JSON.parse(readFileSync(file, 'utf8')); edit(value); writeFileSync(file, JSON.stringify(value));
}
describe('materialized policy provenance', () => {
  it('accepts all current native and generated policy', () => fixture(dir => expect(() => verifyPolicyProjections(dir, false)).not.toThrow()));
  it.each(['.revealui/content', '.claude', '.grok'])('rejects body tampering in %s', dot => fixture(dir => {
    writeFileSync(join(dir, dot, 'rules/durable-solutions.md'), 'tampered'); expect(() => verifyPolicyProjections(dir, false)).toThrow();
  }));
  it('rejects projection tampering even with updated local hash', () => fixture(dir => {
    const text = 'changed policy'; writeFileSync(join(dir, '.claude/rules/durable-solutions.md'), text);
    editManifest(dir, '.claude', m => { m.files['rules/durable-solutions.md'].sha256 = createHash('sha256').update(text).digest('hex'); });
    expect(() => verifyPolicyProjections(dir, false)).toThrow();
  }));
  it('rejects missing native coverage', () => fixture(dir => { editManifest(dir, '.grok', m => { delete m.files['rules/planning.md']; }); expect(() => verifyPolicyProjections(dir, false)).toThrow(); }));
  it('rejects traversal paths', () => fixture(dir => { editManifest(dir, '.claude', m => { m.files['../outside'] = m.files['rules/planning.md']; }); expect(() => verifyPolicyProjections(dir, false)).toThrow(); }));
  it('rejects malformed schema', () => fixture(dir => { writeFileSync(manifestPath(dir, '.revealui'), '{"files":[]}'); expect(() => verifyPolicyProjections(dir, false)).toThrow(); }));
  it('rejects symlinked policy', () => fixture(dir => { const file = join(dir, '.claude/rules/planning.md'); rmSync(file); symlinkSync(join(dir, '.grok/rules/planning.md'), file); expect(() => verifyPolicyProjections(dir, false)).toThrow(); }));
  it('retains stronger no-one-off and fleet naming policy', () => {
    const text = readFileSync(join(root, '.revealui/content/rules/durable-solutions.md'), 'utf8');
    expect(text).toContain('No one-off exception'); expect(text).toContain('never authorizes a new one-off'); expect(text).toContain('The only fleet identity is `revealfleet`'); expect(text).not.toContain('Hotfixes are allowed only as registered debt');
  });
});
