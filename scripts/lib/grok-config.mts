import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseTOML, getStaticTOMLValue, type AST } from 'toml-eslint-parser';
import { parse as parseTOMLValue } from 'smol-toml';

export interface Budget { tokens: number; percent: number; models: string[] }
type Table = Record<string, unknown>;
function table(value: unknown): value is Table {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
}
function readDocument(text: string): { ast: AST.TOMLProgram; value: Table } {
  try {
    const ast = parseTOML(text, { tomlVersion: '1.0' });
    // Independent value parser rejects malformed/duplicate TOML before any edit.
    parseTOMLValue(text);
    return { ast, value: getStaticTOMLValue(ast) as Table };
  } catch {
    // Parser diagnostics can contain source lines; config may contain secrets.
    throw new Error('Invalid TOML configuration');
  }
}
function at(value: unknown, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (!table(value) || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return value;
}
function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
/** Explicit model wins; optional top-level default_model is the only fallback.
 * Unknown/absent model never selects the first model table or an unscoped key. */
export function configNumbers(text: string, model?: string): { tokens: number | null; pct: number | null } {
  const { value } = readDocument(text);
  const selected = typeof model === 'string' && model.trim() ? model :
    typeof value.default_model === 'string' && value.default_model.trim() ? value.default_model : null;
  const tokens = selected ? at(value, ['model', selected, 'compaction_at_tokens']) : null;
  const pct = at(value, ['session', 'auto_compact_threshold_percent']);
  return { tokens: positiveInteger(tokens) ? tokens : null, pct: positiveInteger(pct) && pct <= 100 ? pct : null };
}
function keyText(key: string): string {
  return key && [...key].every((c) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'.includes(c)) ? key : JSON.stringify(key);
}
function prefix(parent: readonly string[], child: readonly string[]): boolean {
  return parent.length < child.length && parent.every((part, index) => part === child[index]);
}
function editNumber(text: string, keys: string[], number: number): string {
  const { ast, value } = readDocument(text);
  for (let i = 1; i < keys.length; i++) {
    const ancestor = at(value, keys.slice(0, i));
    if (ancestor !== undefined && !table(ancestor)) throw new Error('Budget target has a non-table ancestor');
  }
  const top = ast.body[0];
  const values: { keys: string[]; node: AST.TOMLKeyValue }[] = [];
  const inline: { keys: string[]; node: AST.TOMLInlineTable }[] = [];
  function visit(entries: AST.TOMLKeyValue[], base: string[]) {
    for (const node of entries) {
      const resolved = [...base, ...getStaticTOMLValue(node.key)];
      values.push({ keys: resolved, node });
      if (node.value.type === 'TOMLInlineTable') {
        inline.push({ keys: resolved, node: node.value });
        visit(node.value.body, resolved);
      }
    }
  }
  const tables: AST.TOMLTable[] = [];
  for (const node of top.body) {
    if (node.type === 'TOMLKeyValue') visit([node], []);
    else {
      if (node.kind === 'standard' && node.resolvedKey.every((part) => typeof part === 'string')) {
        tables.push(node);
        visit(node.body, node.resolvedKey as string[]);
      }
    }
  }
  const found = values.find((entry) => entry.keys.length === keys.length && entry.keys.every((key, i) => key === keys[i]));
  if (found) {
    if (found.node.value.type !== 'TOMLValue' || !new Set(['integer', 'float']).has(found.node.value.kind)) throw new Error('Budget target must be numeric');
    if (getStaticTOMLValue(found.node.value) === number) return text;
    const [start, end] = found.node.value.range;
    return text.slice(0, start) + String(number) + text.slice(end);
  }
  const inlineParent = inline.filter((entry) => prefix(entry.keys, keys)).sort((a, b) => b.keys.length - a.keys.length)[0];
  if (inlineParent) {
    const end = inlineParent.node.range[1] - 1;
    const addition = `${inlineParent.node.body.length ? ', ' : ' '}${keys.slice(inlineParent.keys.length).map(keyText).join('.')} = ${number} `;
    return text.slice(0, end) + addition + text.slice(end);
  }
  const section = tables.filter((node) => prefix(node.resolvedKey as string[], keys)).sort((a, b) => b.resolvedKey.length - a.resolvedKey.length)[0];
  if (section) {
    const next = top.body.find((node) => node.type === 'TOMLTable' && node.range[0] > section.range[0]);
    const end = next?.range[0] ?? text.length;
    const addition = `${end && text[end - 1] !== '\n' ? '\n' : ''}${keys.slice(section.resolvedKey.length).map(keyText).join('.')} = ${number}\n`;
    return text.slice(0, end) + addition + text.slice(end);
  }
  const parent = keys.slice(0, -1);
  if (at(value, parent) === undefined) {
    return `${text}${text && !text.endsWith('\n') ? '\n' : ''}${text ? '\n' : ''}[${parent.map(keyText).join('.')}]\n${keyText(keys[keys.length - 1])} = ${number}\n`;
  }
  // An implicit table introduced by dotted keys cannot be reopened as a table.
  // Add another dotted assignment in the root section before the first header.
  const firstTable = top.body.find((node) => node.type === 'TOMLTable');
  const end = firstTable?.range[0] ?? text.length;
  return text.slice(0, end) + `${end && text[end - 1] !== '\n' ? '\n' : ''}${keys.map(keyText).join('.')} = ${number}\n` + text.slice(end);
}
export function loadBudget(file: string): Budget {
  const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!table(value) || !positiveInteger(value.compactionAtTokens) || !positiveInteger(value.contextWindowTokens) || value.compactionAtTokens > value.contextWindowTokens) throw new Error('Budget requires positive integer tokens within the context window');
  const percent = Math.round(value.compactionAtTokens / value.contextWindowTokens * 100);
  if (percent < 1 || percent > 100) throw new Error('Derived compaction percent is outside 1..100');
  if (!Array.isArray(value.models) || !value.models.length || !value.models.every((model): model is string => typeof model === 'string' && model.trim().length > 0 && model.isWellFormed())) throw new Error('Budget requires nonempty model identifiers');
  if (new Set(value.models).size !== value.models.length) throw new Error('Duplicate budget model identifiers');
  return { tokens: value.compactionAtTokens, percent, models: value.models };
}
export function applyBudget(text: string, budget: Budget): string {
  if (!positiveInteger(budget.tokens) || !positiveInteger(budget.percent) || budget.percent > 100 || !Array.isArray(budget.models) || !budget.models.length || !budget.models.every((m) => typeof m === 'string' && m.trim() && m.isWellFormed())) throw new Error('Invalid budget');
  let next = editNumber(text, ['session', 'auto_compact_threshold_percent'], budget.percent);
  for (const model of budget.models) next = editNumber(next, ['model', model, 'compaction_at_tokens'], budget.tokens);
  // Parse the resulting document, then read the exact scoped fields back.
  for (const model of budget.models) {
    const actual = configNumbers(next, model);
    if (actual.tokens !== budget.tokens || actual.pct !== budget.percent) throw new Error('Budget readback mismatch');
  }
  return next;
}
interface FileState { bytes: Buffer; stat: fs.Stats }
function readRegular(file: string): FileState | null {
  let fd: number;
  try { fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new Error('Config must be a regular non-symlink file'); }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new Error('Config must be a regular file');
    return { stat, bytes: fs.readFileSync(fd) };
  } finally { fs.closeSync(fd); }
}
function ensureParentDirectory(file: string): void {
  const dir = path.dirname(file);
  let current = path.parse(dir).root;
  for (const segment of dir.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try { fs.mkdirSync(current, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Config parent must be a non-symlink directory');
  }
}
function parents(file: string): { file: string; stat: fs.Stats }[] {
  const result: { file: string; stat: fs.Stats }[] = [];
  let dir = path.dirname(file);
  for (;;) {
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Config parent must be a non-symlink directory');
    result.push({ file: dir, stat });
    const parent = path.dirname(dir); if (parent === dir) break; dir = parent;
  }
  return result;
}
function sameFile(a: FileState | null, b: FileState | null): boolean {
  return a === null || b === null ? a === b : a.stat.ino === b.stat.ino && a.stat.dev === b.stat.dev && a.stat.mode === b.stat.mode && a.bytes.equals(b.bytes);
}
export function syncBudgetFile(budgetFile: string, configFile: string): Budget {
  const budget = loadBudget(budgetFile);
  const file = path.resolve(configFile);
  ensureParentDirectory(file);
  const chain = parents(file);
  const lock = `${file}.lock`;
  let lockFd: number;
  try { lockFd = fs.openSync(lock, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600); }
  catch { throw new Error('Config writer lock is held or unsafe; inspect the active writer before recovering a stale lock'); }
  const lockStat = fs.fstatSync(lockFd);
  let temporary: string | null = null;
  try {
    const before = readRegular(file);
    const existing = before ? new TextDecoder('utf-8', { fatal: true }).decode(before.bytes) : '';
    const next = applyBudget(existing, budget);
    if (next === existing && before && (before.stat.mode & 0o777) === 0o600) return budget;
    temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
    const fd = fs.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
    try { fs.writeFileSync(fd, next); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    const readback = readRegular(temporary);
    if (!readback || readback.bytes.toString('utf8') !== next) throw new Error('Temporary config readback failed');
    for (const model of budget.models) {
      const values = configNumbers(readback.bytes.toString('utf8'), model);
      if (values.tokens !== budget.tokens || values.pct !== budget.percent) throw new Error('Temporary config budget readback failed');
    }
    for (const parent of chain) {
      const current = fs.lstatSync(parent.file);
      if (!current.isDirectory() || current.isSymbolicLink() || current.ino !== parent.stat.ino || current.dev !== parent.stat.dev) throw new Error('Config parent changed during write');
    }
    if (!sameFile(before, readRegular(file))) throw new Error('Config changed during write');
    fs.renameSync(temporary, file); temporary = null;
    const directory = fs.openSync(path.dirname(file), fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    return budget;
  } finally {
    if (temporary) {
      try { fs.unlinkSync(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    fs.closeSync(lockFd);
    const current = fs.lstatSync(lock);
    if (current.ino === lockStat.ino && current.dev === lockStat.dev && !current.isSymbolicLink()) fs.unlinkSync(lock);
  }
}
export function main(argv = process.argv.slice(2)): void {
  try {
    if (argv.length !== 2) throw new Error('Usage: sync-grok-token-budget.js <budget.json> <config.toml>');
    const budget = syncBudgetFile(argv[0], argv[1]);
    console.log(`sync-grok-token-budget: compaction_at_tokens=${budget.tokens} percent=${budget.percent} models=${budget.models.length}`);
  } catch (error) { console.error(`sync-grok-token-budget: ${(error as Error).message}`); process.exitCode = 1; }
}
