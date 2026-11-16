import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync, linkSync, lstatSync, mkdtempSync, mkdirSync, readlinkSync,
  readdirSync, renameSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'vitest';
import { readRules, scan } from '../scripts/check-client-leaks.mts';

const sandboxes: string[] = [];
afterEach(() => {
  for (const box of sandboxes.splice(0)) rmSync(box, { recursive: true, force: true });
});

function fixture() {
  const box = mkdtempSync(join(tmpdir(), 'client-leak-race-'));
  sandboxes.push(box);
  const candidate = join(box, 'candidate');
  mkdirSync(candidate);
  const rules = join(box, 'rules.json');
  writeFileSync(rules, JSON.stringify([{ id: 'rule-001', literal: 'SyntheticPrivateCanary' }]), { mode: 0o600 });
  return { box, candidate, rules };
}

function fixtureDescriptors(box: string): number {
  let count = 0;
  for (const entry of readdirSync('/proc/self/fd')) {
    try {
      if (readlinkSync(join('/proc/self/fd', entry)).includes(box)) count++;
    } catch {
      // This read can itself temporarily create a descriptor.
    }
  }
  return count;
}

describe('descriptor-anchored client leak scanner', () => {
  it('fails closed when the opened private rule path is swapped to a symlink', () => {
    const f = fixture();
    writeFileSync(join(f.candidate, 'payload.txt'), 'SyntheticPrivateCanary');
    const forged = join(f.box, 'forged.json');
    writeFileSync(forged, JSON.stringify([{ id: 'rule-001', literal: 'OtherValue' }]));
    assert.throws(() => scan([f.candidate], f.rules, {
      afterRuleOpen: () => {
        renameSync(f.rules, join(f.box, 'opened-rules.json'));
        symlinkSync(forged, f.rules);
      },
    }));
    assert.throws(() => readRules(f.rules));
    assert.equal(fixtureDescriptors(f.box), 0);
  });

  it('rejects an in-place rule permission change after opening', () => {
    const f = fixture();
    writeFileSync(join(f.candidate, 'safe.txt'), 'safe');
    assert.throws(() => scan([f.candidate], f.rules, {
      afterRuleOpen: () => chmodSync(f.rules, 0o644),
    }));
    assert.equal(fixtureDescriptors(f.box), 0);
  });

  it('reads a pinned directory after its original path becomes an external symlink', () => {
    const f = fixture();
    writeFileSync(join(f.candidate, 'inside.txt'), 'SyntheticPrivateCanary');
    const outside = join(f.box, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'outside.txt'), 'safe');
    const opened: string[] = [];
    assert.throws(() => scan([f.candidate], f.rules, {
      afterDirectoryList: logicalPath => {
        if (logicalPath !== f.candidate) return;
        renameSync(f.candidate, join(f.box, 'moved'));
        symlinkSync(outside, f.candidate);
      },
      afterCandidateOpen: logicalPath => opened.push(logicalPath),
    }));
    assert.deepEqual(opened, [join(f.candidate, 'inside.txt')]);
    assert.equal(fixtureDescriptors(f.box), 0);
  });

  it('fails closed when a listed regular file becomes a symlink before open', () => {
    const f = fixture();
    const file = join(f.candidate, 'payload.txt');
    writeFileSync(file, 'safe');
    writeFileSync(join(f.box, 'outside.txt'), 'SyntheticPrivateCanary');
    assert.throws(() => scan([f.candidate], f.rules, {
      afterCandidateStat: logicalPath => {
        if (logicalPath !== file) return;
        renameSync(file, join(f.candidate, 'moved.txt'));
        symlinkSync(join(f.box, 'outside.txt'), file);
      },
    }));
    assert.equal(fixtureDescriptors(f.box), 0);
  });

  it('rejects an in-place candidate write while reading', () => {
    const f = fixture();
    const file = join(f.candidate, 'payload.txt');
    writeFileSync(file, 'original');
    assert.throws(() => scan([f.candidate], f.rules, {
      afterCandidateOpen: logicalPath => {
        if (logicalPath === file) writeFileSync(file, 'modified');
      },
    }));
    assert.equal(fixtureDescriptors(f.box), 0);
  });

  it('rejects a hard link to private rules before reading it', () => {
    const f = fixture();
    linkSync(f.rules, join(f.candidate, 'copy.json'));
    assert.throws(() => scan([f.candidate], f.rules), error =>
      error instanceof Error && error.message.includes('private rules are inside'));
    assert.equal(fixtureDescriptors(f.box), 0);
  });

  it('fails closed if an entry is added after directory enumeration', () => {
    const f = fixture();
    writeFileSync(join(f.candidate, 'safe.txt'), 'safe');
    assert.throws(() => scan([f.candidate], f.rules, {
      afterDirectoryList: logicalPath => {
        if (logicalPath === f.candidate) writeFileSync(join(f.candidate, 'late.txt'), 'SyntheticPrivateCanary');
      },
    }));
    assert.equal(fixtureDescriptors(f.box), 0);
  });

  it('scans each hard-link filename even when content inode is shared', () => {
    const f = fixture();
    const first = join(f.candidate, 'safe.txt');
    writeFileSync(first, 'safe');
    linkSync(first, join(f.candidate, 'SyntheticPrivateCanary.txt'));
    const report = scan([f.candidate], f.rules);
    assert.equal(report.files, 2);
    assert.equal(report.violations, 1);
  });

  it('checks a root filename when that root changes from directory to file before visit', () => {
    const f = fixture();
    const namedRoot = join(f.box, 'SyntheticPrivateCanary');
    mkdirSync(namedRoot);
    const report = scan([namedRoot], f.rules, {
      beforeRootVisit: logicalPath => {
        if (logicalPath !== namedRoot) return;
        renameSync(namedRoot, join(f.box, 'moved-root'));
        writeFileSync(namedRoot, 'safe');
      },
    });
    assert.equal(report.files, 1);
    assert.equal(report.violations, 1);
    assert.equal(report.entries[0].line, 0);
    assert.equal(fixtureDescriptors(f.box), 0);
  });

  it('rejects a FIFO promptly and closes all pinned descriptors', () => {
    const f = fixture();
    const fifo = join(f.candidate, 'pipe');
    const result = spawnSync('mkfifo', [fifo], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(lstatSync(fifo).isFIFO(), true);
    const started = Date.now();
    assert.throws(() => scan([f.candidate], f.rules));
    assert.ok(Date.now() - started < 2000);
    assert.equal(fixtureDescriptors(f.box), 0);
  });
});
