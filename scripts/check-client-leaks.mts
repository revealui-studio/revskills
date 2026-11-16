#!/usr/bin/env node
// Private rule data is supplied to trusted code. Candidate trees are only data.
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readFileSync, readdirSync, readlinkSync, type BigIntStats } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

type Rule = { id: string; literal: string };
type Identity = Readonly<{ dev: bigint; ino: bigint }>;
type ScanHooks = Readonly<{
  // Synthetic race fixtures only. The CLI never supplies these hooks.
  afterRuleOpen?: () => void;
  afterDirectoryList?: (logicalPath: string) => void;
  afterCandidateStat?: (logicalPath: string) => void;
  afterCandidateOpen?: (logicalPath: string) => void;
}>;
const excluded = new Set(['.git']);
const fileRef = (file: string) => createHash('sha256').update(file).digest('hex');
const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const fileFlags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

function requireDescriptorTraversal(): void {
  if (process.platform !== 'linux' || !existsSync('/proc/self/fd')) {
    throw new Error('Linux /proc/self/fd descriptor traversal required');
  }
}

function fdPath(fd: number, child?: string): string {
  const pinned = `/proc/self/fd/${fd}`;
  return child === undefined ? pinned : `${pinned}/${child}`;
}

function sameFile(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
}

function openAnchoredParent(file: string): { fd: number; name: string } {
  requireDescriptorTraversal();
  const parts = resolve(file).split(sep).filter(Boolean);
  if (parts.length === 0) throw new Error('root path has no parent');
  let fd = openSync(sep, directoryFlags);
  try {
    for (const part of parts.slice(0, -1)) {
      const next = openSync(fdPath(fd, part), directoryFlags);
      closeSync(fd);
      fd = next;
    }
    return { fd, name: parts[parts.length - 1] };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function contentMetadataMatches(before: BigIntStats, after: BigIntStats): boolean {
  return sameFile(before, after) && before.size === after.size &&
    before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs;
}

function loadRules(file: string, hooks: ScanHooks = {}): { rules: Rule[]; identity: Identity } {
  const parent = openAnchoredParent(file);
  try {
    const fd = openSync(fdPath(parent.fd, parent.name), fileFlags);
    try {
      const stat = fstatSync(fd, { bigint: true });
      if (!stat.isFile() || (stat.mode & 0o7777n) !== 0o600n) {
        throw new Error('rules must be a private 0600 regular file');
      }
      hooks.afterRuleOpen?.();
      const source = readFileSync(fd, 'utf8');
      if (!contentMetadataMatches(stat, fstatSync(fd, { bigint: true }))) throw new Error('rules changed during scan');
      const parsed: unknown = JSON.parse(source);
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('nonempty rules required');
      const ids = new Set<string>();
      for (const rule of parsed) {
        if (!rule || typeof rule.id !== 'string' || !rule.id.startsWith('rule-') ||
          ![...rule.id.slice(5)].every(c => '0123456789'.includes(c)) || rule.id.length <= 5 ||
          typeof rule.literal !== 'string' || !rule.literal.trim() || ids.has(rule.id)) {
          throw new Error('invalid private rules');
        }
        ids.add(rule.id);
      }
      return { rules: parsed, identity: { dev: stat.dev, ino: stat.ino } };
    } finally {
      closeSync(fd);
    }
  } finally {
    closeSync(parent.fd);
  }
}

export function readRules(file: string): Rule[] {
  return loadRules(file).rules;
}

export function scan(paths: string[], rulesFile: string, hooks: ScanHooks = {}) {
  const { rules, identity: rulesIdentity } = loadRules(rulesFile, hooks);
  const hits: { rule: string; file_ref: string; line: number }[] = [];
  let files = 0;

  function inspectBytes(bytes: Buffer, logicalPath: string, base: string): void {
    files++;
    for (const rule of rules) {
      const needle = Buffer.from(rule.literal);
      const offset = bytes.indexOf(needle);
      const pathMatch = relative(base, logicalPath).includes(rule.literal);
      if (offset < 0 && !pathMatch) continue;
      let line = offset < 0 ? 0 : 1;
      if (offset >= 0) for (const byte of bytes.subarray(0, offset)) if (byte === 10) line++;
      hits.push({ rule: rule.id, file_ref: fileRef(relative(base, logicalPath)), line });
    }
  }

  function visitAt(parentFd: number, name: string, logicalPath: string, base: string): void {
    const child = fdPath(parentFd, name);
    const before = lstatSync(child, { bigint: true }); // ENOENT/EACCES are errors, never clean.
    hooks.afterCandidateStat?.(logicalPath);
    if (before.isSymbolicLink()) {
      const target = readlinkSync(child); // Link text only; never follow its target.
      if (!sameFile(before, lstatSync(child, { bigint: true }))) throw new Error('candidate changed during scan');
      inspectBytes(Buffer.from(target), logicalPath, base);
      return;
    }
    if (before.isDirectory()) {
      const fd = openSync(child, directoryFlags);
      try {
        const opened = fstatSync(fd, { bigint: true });
        if (!sameFile(before, opened)) throw new Error('directory changed during scan');
        const entries = readdirSync(fdPath(fd));
        hooks.afterDirectoryList?.(logicalPath);
        for (const entry of entries) if (!excluded.has(entry)) visitAt(fd, entry, join(logicalPath, entry), base);
        if (!contentMetadataMatches(opened, fstatSync(fd, { bigint: true }))) {
          throw new Error('directory changed during scan');
        }
      } finally {
        closeSync(fd);
      }
      return;
    }
    const fd = openSync(child, fileFlags);
    try {
      const stat = fstatSync(fd, { bigint: true });
      if (!sameFile(before, stat)) throw new Error('candidate changed during scan');
      if (!stat.isFile() || (stat.mode & 0o444n) === 0n) throw new Error('unreadable candidate');
      if (stat.dev === rulesIdentity.dev && stat.ino === rulesIdentity.ino) {
        throw new Error('private rules are inside the public scan scope');
      }
      hooks.afterCandidateOpen?.(logicalPath);
      const bytes = readFileSync(fd);
      if (!contentMetadataMatches(stat, fstatSync(fd, { bigint: true }))) throw new Error('candidate changed during scan');
      inspectBytes(bytes, logicalPath, base);
    } finally {
      closeSync(fd);
    }
  }

  for (const input of paths) {
    const logicalPath = resolve(input);
    if (logicalPath === sep) {
      const fd = openSync(sep, directoryFlags);
      try {
        const opened = fstatSync(fd, { bigint: true });
        for (const entry of readdirSync(fdPath(fd))) if (!excluded.has(entry)) visitAt(fd, entry, join(sep, entry), sep);
        if (!contentMetadataMatches(opened, fstatSync(fd, { bigint: true }))) {
          throw new Error('directory changed during scan');
        }
      } finally {
        closeSync(fd);
      }
      continue;
    }
    const parent = openAnchoredParent(logicalPath);
    try {
      const stat = lstatSync(fdPath(parent.fd, parent.name), { bigint: true });
      visitAt(parent.fd, parent.name, logicalPath, stat.isDirectory() ? logicalPath : dirname(logicalPath));
    } finally {
      closeSync(parent.fd);
    }
  }
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
    console.error('[client-leak] incomplete scan: Linux /proc/self/fd and private rules/readable candidate paths required');
    process.exitCode = 2;
  }
}
