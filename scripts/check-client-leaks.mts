#!/usr/bin/env node
// Private rule data is supplied to trusted code. Candidate trees are only data.
import { lstatSync, readFileSync, readdirSync, realpathSync, readlinkSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

type Rule = { id: string; literal: string };
const excluded = new Set(['.git']);
const fileRef = (file: string) => createHash('sha256').update(file).digest('hex');

export function readRules(file: string): Rule[] {
  const stat = lstatSync(file);
  if (!stat.isFile() || (stat.mode & 0o077) !== 0) throw new Error('rules must be a private regular file');
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('nonempty rules required');
  const ids = new Set<string>();
  for (const rule of parsed) {
    if (!rule || typeof rule.id !== 'string' || !rule.id.startsWith('rule-') ||
      ![...rule.id.slice(5)].every(c => '0123456789'.includes(c)) || rule.id.length <= 5 ||
      typeof rule.literal !== 'string' || !rule.literal.trim() || ids.has(rule.id)) throw new Error('invalid private rules');
    ids.add(rule.id);
  }
  return parsed;
}

export function scan(paths: string[], rulesFile: string) {
  const rules = readRules(rulesFile);
  const rulesPath = realpathSync(rulesFile);
  const hits: { rule: string; file_ref: string; line: number }[] = [];
  const visited = new Set<string>();
  let files = 0;
  function visit(file: string, base: string) {
    const stat = lstatSync(file); // ENOENT/EACCES are errors, never a clean scan.
    if (stat.isDirectory()) {
      for (const entry of readdirSync(file)) if (!excluded.has(entry)) visit(join(file, entry), base);
      return;
    }
    if ((!stat.isFile() && !stat.isSymbolicLink()) || (stat.mode & 0o444) === 0) throw new Error('unreadable candidate');
    const real = stat.isSymbolicLink() ? resolve(file) : realpathSync(file);
    if (real === rulesPath) throw new Error('private rules are inside the public scan scope');
    if (visited.has(real)) return;
    visited.add(real);
    const bytes = stat.isSymbolicLink() ? Buffer.from(readlinkSync(file)) : readFileSync(file);
    files++;
    // Search every byte sequence, including binaries, without filename exclusions.
    for (const rule of rules) {
      const needle = Buffer.from(rule.literal);
      const offset = bytes.indexOf(needle);
      const pathMatch = relative(base, file).includes(rule.literal);
      if (offset < 0 && !pathMatch) continue;
      let line = offset < 0 ? 0 : 1;
      if (offset >= 0) for (const byte of bytes.subarray(0, offset)) if (byte === 10) line++;
      hits.push({ rule: rule.id, file_ref: fileRef(relative(base, file)), line });
    }
  }
  for (const input of paths) { const file = resolve(input); visit(file, lstatSync(file).isDirectory() ? file : dirname(file)); }
  if (!files) throw new Error('empty scan scope');
  return { files, violations: hits.length, entries: hits };
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const explicit = args.indexOf('--rules');
    const rules = explicit >= 0 ? args.splice(explicit, 2)[1] : process.env.REVSKILLS_CLIENT_RULES_FILE;
    if (!rules) throw new Error('private rules missing');
    const report = scan(args.length ? args : [resolve(dirname(fileURLToPath(import.meta.url)), '..')], rules);
    console.log(JSON.stringify(report));
    process.exitCode = report.violations ? 1 : 0;
  } catch {
    // Never echo parser errors, input, paths, private rule text or snippets.
    console.error('[client-leak] incomplete scan: supply valid private rules and readable candidate paths');
    process.exitCode = 2;
  }
}
