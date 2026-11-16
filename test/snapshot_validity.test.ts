import { test, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validAgentSnapshot, agentSnapshotReceipt, consumeSnapshot } from '../scripts/lib/snapshot-validity.mts';
import { atomicPrivateWrite, safeSnapshotPath } from '../scripts/lib/snapshot-files.mts';

const root = mkdtempSync(join(tmpdir(), 'revskills-snapshot-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const sections = ['Resume-From-Here', 'What-Shipped', 'Active-Constraints', 'Do-Not-Repeat', 'Open-Loose-Ends'];
const content = (sid: string, date = new Date().toISOString()) => `---\nsession_id: ${sid}\ncreated: "${date}"\n---\n` + sections.map(name => `## ${name}\nConcrete session notes.\n`).join('\n');

test('snapshot gate rejects empty, mismatched, stale, mechanical, missing and fenced fake sections', () => {
  const sid = 'session-validity';
  for (const text of ['', 'hello', content('another'), content(sid, '2000-01-01T00:00:00Z'),
    content(sid).replace('---\n', '---\norigin: precompact-mechanical\n'),
    content(sid).replace('## What-Shipped\nConcrete session notes.', ''),
    content(sid).split('Concrete session notes.').join('### Heading only'),
    content(sid).split('Concrete session notes.').join('```\n\n```'),
    content(sid).replace('## Resume-From-Here', '```md\n## Resume-From-Here') + '\n```']) {
    atomicPrivateWrite(root, sid, text);
    expect(validAgentSnapshot(root, sid)).toBe(false);
  }
  atomicPrivateWrite(root, sid, content(sid)); expect(validAgentSnapshot(root, sid)).toBe(true);
});

test('a compaction consumes the exact snapshot; next cycle requires a new authored snapshot', () => {
  const sid = 'successive-compaction'; atomicPrivateWrite(root, sid, content(sid));
  expect(validAgentSnapshot(root, sid)).toBe(true); consumeSnapshot(root, sid);
  expect(validAgentSnapshot(root, sid)).toBe(false);
  atomicPrivateWrite(root, sid, content(sid) + '\nNew constraints after compaction.\n');
  expect(validAgentSnapshot(root, sid)).toBe(true);
});

test('consumption rejects content replaced after validation', () => {
  const sid = 'receipt-race'; atomicPrivateWrite(root, sid, content(sid));
  const receipt = agentSnapshotReceipt(root, sid)!;
  atomicPrivateWrite(root, sid, '');
  expect(consumeSnapshot(root, sid, receipt)).toBe(false);
  expect(validAgentSnapshot(root, sid)).toBe(false);
});

test('precompact replaces invalid snapshots privately and does not trust the mechanical result', () => {
  const sid = 'hook-invalid'; atomicPrivateWrite(root, sid, '');
  const result = spawnSync('node', ['scripts/snapshot-before-compact.js', '--mode=precompact'], {
    input: JSON.stringify({ sessionId: sid, cwd: root }), encoding: 'utf8',
    env: { ...process.env, REVEALUI_COORD_ROOT: root, HOME: root, GROK_HOME: join(root, '.grok') },
  });
  expect(result.status).toBe(0); expect(result.stderr).toContain('wrote mechanical');
  expect(validAgentSnapshot(root, sid)).toBe(false);
  expect(statSync(safeSnapshotPath(root, sid)).mode & 0o777).toBe(0o600);
});
