#!/usr/bin/env node
// This trusted helper reads event payloads as data, never shell source.
import { readFileSync, writeFileSync } from 'node:fs';
const target = process.argv[2];
try {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!, 'utf8'));
  const values: string[] = [];
  for (const item of [event.issue, event.pull_request, event.comment]) {
    if (!item || typeof item !== 'object') continue;
    for (const key of ['title', 'body']) if (typeof item[key] === 'string') values.push(item[key]);
  }
  writeFileSync(target, values.join('\n'), { flag: 'wx', mode: 0o600 });
} catch {
  console.error('Cannot prepare event scan input.');
  process.exitCode = 2;
}
