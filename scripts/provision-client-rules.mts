#!/usr/bin/env node
// Trusted workflow helper. Never run this file from a candidate PR checkout.
import { writeFileSync, chmodSync } from 'node:fs';
import { readRules } from './check-client-leaks.mts';
const file = process.argv[2];
try {
  const input = process.env.CLIENT_LEAK_RULES_JSON;
  delete process.env.CLIENT_LEAK_RULES_JSON;
  if (!file || !input) throw new Error('required rules missing');
  writeFileSync(file, input, { flag: 'wx', mode: 0o600 });
  chmodSync(file, 0o600);
  readRules(file);
} catch {
  console.error('Private scan configuration is missing or invalid; scan cannot pass.');
  process.exitCode = 2;
}
