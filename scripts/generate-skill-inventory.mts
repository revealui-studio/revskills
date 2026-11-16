#!/usr/bin/env node
// Derived from SKILL.md metadata and on-disk assets. Do not hand-edit its blocks.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSkill, validateSkill } from './lib/skill-metadata.mts';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const skillsRoot = join(root, 'skills');
const start = '<!-- skill-inventory:start -->';
const end = '<!-- skill-inventory:end -->';
const executable = new Set(['.js', '.cjs', '.mjs', '.ts', '.mts', '.sh', '.py', '.ps1']);
const check = process.argv.includes('--check');
if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('Usage: node scripts/generate-skill-inventory.mts [--check]');

function filesUnder(folder: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) found.push(...filesUnder(path));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}
function cell(value: string): string {
  return value.split('\n').join(' ').split('|').join('\\|');
}
function inventory() {
  const rows = [];
  for (const entry of readdirSync(skillsRoot, { withFileTypes: true }).sort((a,b)=>a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const file = join(skillsRoot, entry.name, 'SKILL.md');
    if (!statSync(file).isFile()) throw new Error(`Missing SKILL.md: ${entry.name}`);
    const errors = validateSkill(file);
    if (errors.length) throw new Error(`${entry.name}: ${errors.join('; ')}`);
    const { data } = readSkill(file);
    const metadata = data.metadata as Record<string,string>;
    const pack = metadata.pack;
    if (pack !== 'public' && pack !== 'studio') throw new Error(`Invalid pack: ${entry.name}`);
    const assets = filesUnder(join(skillsRoot, entry.name)).filter(path => path !== file);
    const helpers = assets.filter(path => executable.has(extname(path)));
    rows.push({ name: String(data.name), pack, description: String(data.description), compatibility: String(data.compatibility || ''), helpers: helpers.length,
      helperPaths: helpers.map(path => relative(root,path).split('\\').join('/')).sort(), assets: assets.length });
  }
  return rows;
}
function section(rows: ReturnType<typeof inventory>, linkPrefix: string): string {
  const publicRows = rows.filter(row => row.pack === 'public');
  const studioRows = rows.filter(row => row.pack === 'studio');
  const lines = [
    `**${rows.length} skills:** ${publicRows.length} public patterns and ${studioRows.length} Studio-context skills. Metadata and asset counts are generated from the skill directories.`,
    '',
    '| Skill | Pack | Executable assets | Compatibility |',
    '|---|---|---:|---|',
  ];
  for (const row of rows) lines.push(`| [${row.name}](${linkPrefix}${row.name}/) | ${row.pack} | ${row.helpers} | ${cell(row.compatibility)} |`);
  lines.push('', 'Executable assets include bundled `.js`, `.ts`, `.mts`, `.sh`, `.py`, and similar source files; a skill can contain guidance plus runnable helpers. The retired RevealUI design `ui_kits` are pointer pages, not self-contained component kits.');
  return lines.join('\n');
}
function replaceBlock(file: string, content: string) {
  const original = readFileSync(file, 'utf8');
  const a = original.indexOf(start), b = original.indexOf(end);
  if (a < 0 || b < 0 || b < a) throw new Error(`Missing inventory markers: ${relative(root,file)}`);
  const expected = original.slice(0,a + start.length) + '\n' + content + '\n' + original.slice(b);
  if (check) {
    if (original !== expected) throw new Error(`Stale generated inventory: ${relative(root,file)}`);
  } else if (original !== expected) writeFileSync(file, expected);
}
const rows = inventory();
const report = '# Skill inventory\n\nGenerated from skill metadata and on-disk assets by `node scripts/generate-skill-inventory.mts`.\n\n' + section(rows, '../skills/') + '\n\n## Executable asset paths\n\n' +
  rows.filter(row => row.helpers > 0).map(row => `- **${row.name}:** ${row.helperPaths.map(path => '`'+path+'`').join(', ')}`).join('\n') + '\n';
replaceBlock(join(root,'README.md'), section(rows,'skills/'));
replaceBlock(join(root,'docs','MASTER_SPEC.md'), section(rows,'../skills/'));
const reportFile = join(root,'docs','SKILL_INVENTORY.md');
if (check) {
  if (readFileSync(reportFile,'utf8') !== report) throw new Error('Stale generated inventory: docs/SKILL_INVENTORY.md');
} else writeFileSync(reportFile, report);
console.log(`skill inventory ${check ? 'checked' : 'written'}: ${rows.length} skills, ${rows.filter(row=>row.pack==='public').length} public, ${rows.filter(row=>row.pack==='studio').length} Studio`);
