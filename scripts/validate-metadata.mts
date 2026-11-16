#!/usr/bin/env node
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import semver from 'semver';
import { record, validateSkill } from './lib/skill-metadata.mts';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2];
const root = resolve(process.argv[3] || repo);
const failures: string[] = [];
let count = 0;
let commandDirs = 0;
const excluded = new Set(['.git', 'node_modules', '.pnpm', 'dist', 'build', 'coverage']);

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const file = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(file));
    else if (entry.isFile()) files.push(file);
  }
  return files;
}

function skill(file: string) {
  failures.push(...validateSkill(file).map(message => `${file}: ${message}`));
}

function pin(value: unknown) {
  return typeof value === 'string' && (semver.valid(value) !== null ||
    (value.length >= 7 && value.length <= 40 && [...value].every(c => 'abcdef0123456789'.includes(c))));
}

try {
  if (mode === 'skills') {
    for (const dir of readdirSync(join(root, 'skills'), { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const file = join(root, 'skills', dir.name, 'SKILL.md');
      count++;
      skill(file);
      const result = spawnSync('awk', ['-f', join(repo, 'scripts/lib/lint-skill.awk'), file], { encoding: 'utf8' });
      if (result.error || result.status !== 0) failures.push(`${file}: rule scanner failed`);
      if (result.stdout.trim()) failures.push(result.stdout.trim());
    }
    const home = process.env.HOME || '';
    const dirs = process.env.REVSKILLS_COMMAND_DIRS?.split(':') || ['.claude', '.grok', '.cursor'].map(name => join(home, name, 'commands'));
    for (const dir of dirs) {
      let entries;
      try { entries = readdirSync(dir); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !process.env.REVSKILLS_COMMAND_DIRS) continue;
        throw error;
      }
      commandDirs++;
      for (const name of entries) {
        if (!name.toLowerCase().endsWith('.md')) continue;
        const file = join(dir, name);
        if (lstatSync(file).isSymbolicLink()) {
          try { realpathSync(file); } catch { failures.push(`${file}: broken command symlink`); }
        }
      }
    }
  } else if (mode === 'plugins') {
    const manifests = walk(root).filter(file => basename(file) === 'plugin.json' && basename(dirname(file)) === '.claude-plugin');
    for (const file of manifests) {
      count++;
      let data: unknown;
      try { data = JSON.parse(readFileSync(file, 'utf8')); } catch { failures.push(`${file}: invalid JSON`); continue; }
      if (!record(data)) { failures.push(`${file}: manifest must be an object`); continue; }
      for (const key of ['name', 'description']) {
        if (typeof data[key] !== 'string' || !data[key].trim()) failures.push(`${file}: missing required field '${key}' or non-string value`);
      }
      const plugin = dirname(dirname(file));
      if (!pin(data.version ?? basename(plugin))) failures.push(`${file}: version must be pinned semver or commit hash`);
      for (const item of walk(plugin)) {
        const parts = item.slice(plugin.length + 1).split('/');
        if (parts.some(part => ['test', 'tests', '__tests__'].includes(part)) || item.endsWith('.test.sh')) continue;
        if (basename(item) === 'SKILL.md') skill(item);

      }
    }
  } else throw new Error('usage: validate-metadata.mts skills|plugins [root]');
  if (count === 0) failures.push(`no ${mode} found`);
} catch {
  failures.push('cannot complete metadata inventory; check the root, permissions and installed dependencies');
}

if (process.argv.includes('--json') || process.env.PLUGIN_LINT_JSON) {
  console.log(JSON.stringify({ count, plugins: mode === 'plugins' ? count : undefined, failures: failures.length, total: failures.length, warnings: 0, command_dirs: commandDirs, errors: failures }));
} else {
  console.log(`${mode}-lint: ${failures.length ? 'FAIL' : 'OK'} (${count} ${mode}; ${failures.length} violations)`);
  for (const failure of failures) console.error(failure);
}
process.exitCode = failures.length ? 1 : 0;
