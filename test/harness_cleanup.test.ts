import { test, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

for (const code of [0, 7]) {
  test(`parent cleanup removes nested command-substitution sandboxes on exit ${code}`, () => {
    const result = spawnSync('bash', ['-c', `source test/lib/harness.sh
first="$(make_sandbox)"
second="$(make_sandbox)"
printf '%s\\n' "$TEST_SANDBOX_ROOT" "$first" "$second"
exit ${code}`], { encoding: 'utf8' });
    expect(result.status).toBe(code);
    const paths = result.stdout.trim().split('\n');
    expect(paths.length).toBe(3);
    for (const path of paths) expect(existsSync(path)).toBe(false);
  });
}
