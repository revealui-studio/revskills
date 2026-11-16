import { readFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { parseDocument } from 'yaml';

export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function readSkill(file: string) {
  return parseSkillText(readFileSync(file, 'utf8'));
}

export function parseSkillText(text: string) {
  const lines = text.split('\n').map(line => line.endsWith('\r') ? line.slice(0, -1) : line);
  if (lines[0] !== '---') throw new Error('missing YAML frontmatter');
  const end = lines.indexOf('---', 1);
  if (end < 0) throw new Error('unterminated YAML frontmatter');
  const doc = parseDocument(lines.slice(1, end).join('\n'), { uniqueKeys: true, stringKeys: true });
  if (doc.errors.length || doc.warnings.length) throw new Error('invalid YAML frontmatter');
  const data: unknown = doc.toJS({ maxAliasCount: 0 });
  if (!record(data)) throw new Error('frontmatter must be a mapping');
  return { data, body: lines.slice(end + 1).join('\n'), doc, end };
}

export function validateSkill(file: string): string[] {
  try {
    const { data, body } = readSkill(file);
    const errors: string[] = [];
    const permitted = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);
    for (const key of Object.keys(data)) if (!permitted.has(key)) errors.push(`unsupported portable field '${key}'`);
    for (const key of ['name', 'description']) {
      if (typeof data[key] !== 'string' || !data[key].trim()) errors.push(`missing '${key}:' field or non-string value`);
    }
    const name = data.name;
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789-';
    if (typeof name === 'string' && (name.length > 64 || !name.length ||
      [...name].some(char => !alphabet.includes(char)) || name.startsWith('-') ||
      name.endsWith('-') || name.includes('--') || name !== basename(dirname(file)))) {
      errors.push('name must match its directory and use 1–64 lowercase letters, digits and single hyphens');
    }
    if (typeof data.description === 'string' && data.description.length > 1024) errors.push('description exceeds 1024 characters');
    if (data.compatibility !== undefined && (typeof data.compatibility !== 'string' || data.compatibility.length > 500)) errors.push('compatibility must be a string of at most 500 characters');
    if (data.license !== undefined && typeof data.license !== 'string') errors.push('license must be a string');
    if (data.metadata !== undefined && (!record(data.metadata) || Object.values(data.metadata).some(value => typeof value !== 'string'))) errors.push('metadata must map strings to strings');
    if (data['allowed-tools'] !== undefined && (typeof data['allowed-tools'] !== 'string' || data['allowed-tools'].includes(','))) errors.push('allowed-tools must be a space-delimited string');
    if (!body.trim()) errors.push('skill body is empty');
    return errors;
  } catch (error) {
    return [error instanceof Error ? error.message : 'unreadable skill'];
  }
}
