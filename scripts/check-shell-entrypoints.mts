#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const files: string[] = [];
function walk(dir: string) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'fixtures') walk(file); continue; }
    if (!entry.isFile()) continue;
    const first = readFileSync(file, 'utf8').split('\n', 1)[0];
    if (entry.name.endsWith('.sh') || ['#!/usr/bin/env bash', '#!/bin/bash', '#!/bin/sh', '#!/usr/bin/env sh'].includes(first)) files.push(file);
  }
}
try {
  for (const dir of ['scripts', 'bin', '.githooks', 'test']) walk(resolve(dir));
  if (!files.length) throw new Error('no shell entrypoints');
  const result = spawnSync('shellcheck', ['--severity=warning', ...files], { stdio: 'inherit' });
  if (result.error) throw result.error;
  console.log(`ShellCheck covered ${files.length} shell files, including extensionless entrypoints.`);
  process.exitCode = result.status ?? 1;
} catch {
  console.error('Shell entrypoint validation could not complete.');
  process.exitCode = 2;
}
