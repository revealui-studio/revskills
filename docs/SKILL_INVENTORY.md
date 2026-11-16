# Skill inventory

Generated from skill metadata and on-disk assets by `node scripts/generate-skill-inventory.mts`.

**29 skills:** 13 public patterns and 16 Studio-context skills. Metadata and asset counts are generated from the skill directories.

| Skill | Pack | Executable assets | Compatibility |
|---|---|---:|---|
| [drizzle-db](../skills/drizzle-db/) | public | 0 | Any Agent Skills host; examples require the framework packages named in this skill. |
| [electric-sync](../skills/electric-sync/) | public | 1 | Agent Skills host; executable TypeScript examples require Node.js 24+, pnpm 10 and the dependencies in the revskills package manifest. |
| [exhaustive-audit](../skills/exhaustive-audit/) | public | 13 | Agent Skills host with Node.js 24+ and local filesystem access for CLI helpers. Fleet mode requires a RevealFleet directory layout. |
| [grok-bot-checkpoint](../skills/grok-bot-checkpoint/) | public | 0 | Grok Bot or compatible assistant with a writable checkpoint directory (see skill); no RevealFleet layout. |
| [knowledge-graph](../skills/knowledge-graph/) | studio | 0 | RevealFleet knowledge graph via revkg CLI or kg_* MCP tools; unavailable without that service. |
| [mcp-server](../skills/mcp-server/) | public | 1 | Agent Skills host; executable TypeScript examples require Node.js 24+, pnpm 10 and the dependencies in the revskills package manifest. |
| [multi-agent-memory](../skills/multi-agent-memory/) | public | 1 | Agent Skills host; executable TypeScript examples require Node.js 24+, pnpm 10 and the dependencies in the revskills package manifest. |
| [next-best-practices](../skills/next-best-practices/) | public | 0 | Any Agent Skills host; examples require the framework packages named in this skill. |
| [redundancy-scan](../skills/redundancy-scan/) | public | 6 | Agent Skills host with Node.js 24+ and local filesystem access for CLI helpers. Fleet mode requires a RevealFleet directory layout. |
| [revealui-checkpoint](../skills/revealui-checkpoint/) | studio | 0 | RevealFleet Studio layout at REVEALFLEET_ROOT; executable helpers require Node.js 24+ and pnpm 10 when invoked. |
| [revealui-cleanup](../skills/revealui-cleanup/) | studio | 0 | RevealFleet Studio layout at REVEALFLEET_ROOT; executable helpers require Node.js 24+ and pnpm 10 when invoked. |
| [revealui-coordinate](../skills/revealui-coordinate/) | studio | 1 | RevealFleet Studio layout at REVEALFLEET_ROOT; executable helpers require Node.js 24+ and pnpm 10 when invoked. |
| [revealui-design](../skills/revealui-design/) | public | 0 | Agent Skills host; production React uses @revealui/tokens/design-context and @revealui/presentation. Static HTML mockups need no package runtime. |
| [revealui-design-status](../skills/revealui-design-status/) | studio | 0 | RevealFleet Studio layout and Claude design adapter; requires the configured claude.ai design project. |
| [revealui-doctor](../skills/revealui-doctor/) | studio | 0 | RevealFleet Studio layout at REVEALFLEET_ROOT; executable helpers require Node.js 24+ and pnpm 10 when invoked. |
| [revealui-ops](../skills/revealui-ops/) | studio | 0 | RevealFleet Studio layout at REVEALFLEET_ROOT; executable helpers require Node.js 24+ and pnpm 10 when invoked. |
| [revealui-pickup](../skills/revealui-pickup/) | studio | 0 | RevealFleet Studio layout at REVEALFLEET_ROOT; executable helpers require Node.js 24+ and pnpm 10 when invoked. |
| [revealui-recover](../skills/revealui-recover/) | studio | 0 | RevealFleet Studio layout at REVEALFLEET_ROOT; executable helpers require Node.js 24+ and pnpm 10 when invoked. |
| [revealui-rollup](../skills/revealui-rollup/) | studio | 0 | RevealFleet Studio layout at REVEALFLEET_ROOT; executable helpers require Node.js 24+ and pnpm 10 when invoked. |
| [revealui-skills-test](../skills/revealui-skills-test/) | studio | 0 | RevealFleet Studio layout at REVEALFLEET_ROOT; executable helpers require Node.js 24+ and pnpm 10 when invoked. |
| [revealui-snapshot](../skills/revealui-snapshot/) | studio | 0 | RevealFleet Studio layout at REVEALFLEET_ROOT; executable helpers require Node.js 24+ and pnpm 10 when invoked. |
| [revealui-sync-lts](../skills/revealui-sync-lts/) | studio | 0 | Deprecated historical reference for RevealFleet Studio on WSL; current disaster recovery uses RevKit weekly snapshots. |
| [revealui-sync-rules](../skills/revealui-sync-rules/) | studio | 0 | RevealFleet Studio layout at REVEALFLEET_ROOT; executable helpers require Node.js 24+ and pnpm 10 when invoked. |
| [revealui-tracker](../skills/revealui-tracker/) | studio | 0 | RevealFleet Studio layout at REVEALFLEET_ROOT; executable helpers require Node.js 24+ and pnpm 10 when invoked. |
| [revvault-resolve](../skills/revvault-resolve/) | studio | 0 | RevealFleet Studio layout and configured RevVault; secret values must remain in the vault. |
| [security-hardening](../skills/security-hardening/) | public | 1 | Agent Skills host; executable TypeScript examples require Node.js 24+, pnpm 10 and the dependencies in the revskills package manifest. |
| [tailwind-v4](../skills/tailwind-v4/) | public | 0 | Any Agent Skills host; examples require the framework packages named in this skill. |
| [vitest-testing](../skills/vitest-testing/) | public | 0 | Any Agent Skills host; examples require the framework packages named in this skill. |
| [yjs-collaboration](../skills/yjs-collaboration/) | public | 1 | Agent Skills host; executable TypeScript examples require Node.js 24+, pnpm 10 and the dependencies in the revskills package manifest. |

Executable assets include bundled `.js`, `.ts`, `.mts`, `.sh`, `.py`, and similar source files; a skill can contain guidance plus runnable helpers. The retired RevealUI design `ui_kits` are pointer pages, not self-contained component kits.

## Executable asset paths

- **electric-sync:** `skills/electric-sync/examples/shape-proxy.mts`
- **exhaustive-audit:** `skills/exhaustive-audit/scripts/claim-shard.js`, `skills/exhaustive-audit/scripts/coverage-status.js`, `skills/exhaustive-audit/scripts/lib/fleet-scope.js`, `skills/exhaustive-audit/scripts/lib/integrity.js`, `skills/exhaustive-audit/scripts/lib/review-candidates.js`, `skills/exhaustive-audit/scripts/lib/text-lines.js`, `skills/exhaustive-audit/scripts/manifest-build.js`, `skills/exhaustive-audit/scripts/md-truth-check.js`, `skills/exhaustive-audit/scripts/open-run.js`, `skills/exhaustive-audit/scripts/shard-plan.js`, `skills/exhaustive-audit/scripts/w1-auto-class-md.js`, `skills/exhaustive-audit/scripts/w4-jv-present-md.js`, `skills/exhaustive-audit/scripts/w5-homes-md.js`
- **mcp-server:** `skills/mcp-server/examples/tenant-server.mts`
- **multi-agent-memory:** `skills/multi-agent-memory/examples/authorize-fact.mts`
- **redundancy-scan:** `skills/redundancy-scan/scripts/hash-dups.js`, `skills/redundancy-scan/scripts/lib.js`, `skills/redundancy-scan/scripts/marker-scan.js`, `skills/redundancy-scan/scripts/merge-report.js`, `skills/redundancy-scan/scripts/name-collision.js`, `skills/redundancy-scan/scripts/run-scan.js`
- **revealui-coordinate:** `skills/revealui-coordinate/scripts/coordinate.js`
- **security-hardening:** `skills/security-hardening/examples/csrf.mts`
- **yjs-collaboration:** `skills/yjs-collaboration/examples/append-updates.mts`
