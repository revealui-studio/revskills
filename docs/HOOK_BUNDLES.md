# Copied Grok hook bundles

RevKit copies `scripts/snapshot-before-compact.js` and `scripts/sync-grok-token-budget.js` into a hooks directory. It does not copy this repository's `scripts/lib/` modules or `node_modules/`. The files at those two paths are generated, standalone Node.js 24 CommonJS bundles. Edit `scripts/src/snapshot-before-compact.cjs` or `scripts/src/sync-grok-token-budget.cjs` and the shared libraries instead of editing the bundles.

After changing a source or imported library, run:

```bash
pnpm install --frozen-lockfile
node scripts/build-hooks.mts
node scripts/build-hooks.mts --check
pnpm exec vitest run test/hook_bundles.test.ts
```

Commit both generated JavaScript entrypoints and `scripts/HOOK_BUNDLES_LICENSES.txt`. The build uses pinned esbuild, no source maps, and an in-memory output comparison for `--check`; the notice is generated from the packages actually included in the bundles. The test copies only those two entrypoints into a temporary directory outside the checkout and runs snapshot and TOML update cases without sibling modules or installed packages. RevKit's three copied hook scripts and the separate `read-token-budget.js` remain the same file-level copy contract; the snapshot bundle embeds its reader so that it does not depend on the separately copied file.

CodeQL excludes only the two generated JavaScript entrypoints through `.github/codeql/codeql-config.yml`. It still scans the authored hook sources in `scripts/src/`, their shared `scripts/lib/` modules, and the builder. `pnpm test` runs `build-hooks.mts --check` before the behavioral tests, so a committed bundle must match the analyzed source and pinned dependencies. The generated bundles embed third-party parser code; alerts in that code should be traced to the package source before changing an authored module or broadening an exclusion.
