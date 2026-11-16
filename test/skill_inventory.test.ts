import { test, expect } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const source = resolve(import.meta.dirname, '..');

test('generated skill inventory detects drift in published docs', () => {
  const temp = mkdtempSync(join(tmpdir(), 'revskills-inventory-'));
  try {
    mkdirSync(join(temp, 'scripts', 'lib'), { recursive: true });
    mkdirSync(join(temp, 'docs'));
    for (const file of ['scripts/generate-skill-inventory.mts', 'scripts/lib/skill-metadata.mts', 'README.md', 'docs/MASTER_SPEC.md', 'docs/SKILL_INVENTORY.md']) {
      copyFileSync(join(source, file), join(temp, file));
    }
    symlinkSync(join(source, 'skills'), join(temp, 'skills'), 'dir');
    symlinkSync(join(source, 'node_modules'), join(temp, 'node_modules'), 'dir');
    const run = () => spawnSync('node', ['scripts/generate-skill-inventory.mts', '--check'], { cwd: temp, encoding: 'utf8' });
    expect(run().status).toBe(0);
    writeFileSync(join(temp, 'README.md'), readFileSync(join(temp, 'README.md'), 'utf8').replace('29 skills', '28 skills'));
    const drift = run();
    expect(drift.status).not.toBe(0);
    expect(drift.stderr).toContain('Stale generated inventory');
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
