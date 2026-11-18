import { readFileSync, lstatSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

type Entry = { source: string; sha256: string; generatedFrom?: string };
type Manifest = { editor: string; mode: string; generatedFrom?: string; profiles: string[]; files: Record<string, Entry> };
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
function relative(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') || value.split('/').some(part => !part || part === '.' || part === '..')) throw Error('invalid relative manifest path');
}
function regular(root: string, rel: string): string {
  relative(rel);
  let file = root;
  const parts = rel.split('/');
  for (const [index, part] of parts.entries()) {
    file = join(file, part);
    const stat = lstatSync(file);
    if (stat.isSymbolicLink() || (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) throw Error(`unsafe policy path: ${rel}`);
  }
  return readFileSync(file, 'utf8');
}
function manifest(root: string, dot: string, editor: string): Manifest {
  const value: unknown = JSON.parse(regular(root, `${dot}/.revcon-manifest.json`));
  if (!object(value) || value.editor !== editor || value.mode !== 'copy' || !Array.isArray(value.profiles) || !value.profiles.length || !value.profiles.every(p => typeof p === 'string' && p.length > 0) || !object(value.files) || !Object.keys(value.files).length) throw Error(`invalid policy manifest: ${dot}`);
  for (const [rel, entry] of Object.entries(value.files)) {
    relative(rel);
    if (!object(entry)) throw Error('invalid entry');
    relative(entry.source);
    if (typeof entry.sha256 !== 'string' || entry.sha256.length !== 64 || [...entry.sha256].some(c => !'0123456789abcdef'.includes(c))) throw Error('invalid policy digest');
    const source = entry.source.split('/');
    if (source[0] !== 'profiles' || source[2] !== 'revealui') throw Error('policy source must be native profile');
    const text = regular(root, `${dot}/${rel}`);
    if (createHash('sha256').update(text).digest('hex') !== entry.sha256) throw Error(`policy digest mismatch: ${dot}/${rel}`);
  }
  return value as Manifest;
}
export function verifyPolicyProjections(target: string, tracked = true): void {
  const root = resolve(target);
  const native = manifest(root, '.revealui', 'revealui');
  for (const dot of ['.claude', '.grok']) {
    const vendor = manifest(root, dot, dot.slice(1));
    if (vendor.generatedFrom !== '.revealui' || JSON.stringify(vendor.profiles) !== JSON.stringify(native.profiles)) throw Error('projection provenance mismatch');
    const expected = new Set(Object.keys(native.files));
    for (const [rel, entry] of Object.entries(vendor.files)) {
      const from = `content/${rel}`;
      const source = native.files[from];
      if (!source || entry.source !== source.source || entry.generatedFrom !== `.revealui/${from}` || !expected.delete(from)) throw Error('projection entry provenance mismatch');
      const body = regular(root, `.revealui/${from}`);
      const projection = regular(root, `${dot}/${rel}`);
      if (projection !== `<!-- generated from .revealui/${from} -->\n${body}`) throw Error(`projection content mismatch: ${dot}/${rel}`);
    }
    if (expected.size) throw Error('projection omits native policy');
  }
  if (tracked) {
    for (const dot of ['.revealui', '.claude', '.grok']) {
      const result = spawnSync('bash', [join(import.meta.dirname, 'verify-copy-lockstep.sh'), '--target', root, '--dot', dot], { encoding: 'utf8' });
      if (result.status !== 0) throw Error(result.stderr || result.stdout || 'copy gate failed');
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { verifyPolicyProjections(process.argv[2] || '.'); console.log('policy projections: 3 manifests, native content and generated bodies verified'); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
