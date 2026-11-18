import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { parseSkillText } from './skill-metadata.mts';
import { safeSnapshotPath, atomicPrivateWrite } from './snapshot-files.mts';

const required = new Set(['Resume-From-Here', 'What-Shipped', 'Active-Constraints', 'Do-Not-Repeat', 'Open-Loose-Ends']);
const digest = (text: string) => createHash('sha256').update(text).digest('hex');

type MarkdownNode = { type: string; value?: string; alt?: string | null; children?: readonly MarkdownNode[] };
function meaningful(node: MarkdownNode): boolean {
  if (node.type === 'heading' || node.type === 'definition' || node.type === 'html') return false;
  if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'code') return Boolean(node.value?.trim());
  if (node.type === 'image') return Boolean(node.alt?.trim());
  return node.children?.some(meaningful) ?? false;
}

export function agentSnapshotReceipt(coordRoot: string, sid: string, now = Date.now()): { sha256: string } | null {
  try {
    const file = safeSnapshotPath(coordRoot, sid);
    const bytes = readFileSync(file, 'utf8');
    const { data, body } = parseSkillText(bytes);
    if (data.session_id !== sid || data.origin === 'precompact-mechanical' || typeof data.created !== 'string') return null;
    const created = Date.parse(data.created);
    if (!Number.isFinite(created) || created > now + 60_000 || now - created > 24 * 60 * 60 * 1000) return null;
    const ast = fromMarkdown(body);
    const sections = new Map<string, boolean>();
    let current = '';
    for (const node of ast.children) {
      if (node.type === 'heading' && node.depth <= 2) {
        const title = node.children.map(child => child.type === 'text' ? child.value : '').join('');
        current = node.depth === 2 && required.has(title) ? title : '';
        if (current) {
          if (sections.has(current)) return null;
          sections.set(current, false);
        }
      } else if (current && meaningful(node)) {
        sections.set(current, true);
      }
    }
    if ([...required].some(name => sections.get(name) !== true)) return null;
    try {
      const receipt = JSON.parse(readFileSync(safeSnapshotPath(join(coordRoot, 'compaction-state'), sid), 'utf8'));
      if (receipt.sha256 === digest(bytes)) return null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return null;
    }
    return { sha256: digest(bytes) };
  } catch { return null; }
}

export function validAgentSnapshot(coordRoot: string, sid: string, now = Date.now()): boolean {
  return agentSnapshotReceipt(coordRoot, sid, now) !== null;
}

export function consumeSnapshot(coordRoot: string, sid: string, expected?: { sha256: string }): boolean {
  const bytes = readFileSync(safeSnapshotPath(coordRoot, sid), 'utf8');
  const sha256 = digest(bytes);
  if (expected && expected.sha256 !== sha256) return false;
  atomicPrivateWrite(join(coordRoot, 'compaction-state'), sid, JSON.stringify({ sha256, consumed: new Date().toISOString() }) + '\n');
  return true;
}
