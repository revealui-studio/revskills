# RevSkills

[Agent Skills](https://agentskills.io) for modern web development. Built by [RevealUI Studio](https://revealui.com).

**Agent Skills format:** skill trees under `skills/` are the source of truth. Compatible hosts can discover them; individual skills declare any Studio layout, adapter, service, or executable-helper requirements in frontmatter. The `.claude-plugin/` directory is a **Claude Code marketplace adapter**, not the only install path.

## Install

```bash
npx skills add RevealUIStudio/revskills
```

Install a specific skill only:

```bash
npx skills add RevealUIStudio/revskills --skill next-best-practices
```

Native continuity helpers can be installed with their committed source closure:

```sh
bash bin/install.sh --native --fleet-root /path/to/revealfleet
bash bin/install.sh --native --fleet-root /path/to/revealfleet --apply
```

This explicit installation deploys checkpoint, coordinate and rollup skills,
plus `revealui-coordinate` and `revealui-session-state`. It preserves existing
owner skills and commands and refuses dirty selected source. The versioned
helper closure remains usable after the source checkout is archived. Load the
shared session environment with `. "$(revealui-session-state)"`.

### Equal-adapter paths (manual)

| Harness | Where skills typically land |
|---------|------------------------------|
| Claude Code | `~/.claude/skills/` or Studio slash links under `~/.claude/commands/` |
| Grok | `[skills].paths` → this repo, or `~/.grok/skills/` |
| Cursor | `<project>/.cursor/skills/` |
| OpenCode / VS Code | per tool Agent Skills / agent-plugin docs |

## Skills

<!-- skill-inventory:start -->
**29 skills:** 13 public patterns and 16 Studio-context skills. Metadata and asset counts are generated from the skill directories.

| Skill | Pack | Executable assets | Compatibility |
|---|---|---:|---|
| [drizzle-db](skills/drizzle-db/) | public | 0 | Any Agent Skills host; examples require the framework packages named in this skill. |
| [electric-sync](skills/electric-sync/) | public | 1 | Agent Skills host; executable TypeScript examples require Node.js 24+, pnpm 10 and the dependencies in the revskills package manifest. |
| [exhaustive-audit](skills/exhaustive-audit/) | public | 13 | Agent Skills host with Node.js 24+ and local filesystem access for CLI helpers. Fleet mode requires a RevealFleet directory layout. |
| [grok-bot-checkpoint](skills/grok-bot-checkpoint/) | public | 0 | Grok Bot or compatible assistant with a writable checkpoint directory (see skill); no RevealFleet layout. |
| [knowledge-graph](skills/knowledge-graph/) | studio | 0 | RevealFleet knowledge graph via revkg CLI or kg_* MCP tools; unavailable without that service. |
| [mcp-server](skills/mcp-server/) | public | 1 | Agent Skills host; executable TypeScript examples require Node.js 24+, pnpm 10 and the dependencies in the revskills package manifest. |
| [multi-agent-memory](skills/multi-agent-memory/) | public | 1 | Agent Skills host; executable TypeScript examples require Node.js 24+, pnpm 10 and the dependencies in the revskills package manifest. |
| [next-best-practices](skills/next-best-practices/) | public | 0 | Any Agent Skills host; examples require the framework packages named in this skill. |
| [redundancy-scan](skills/redundancy-scan/) | public | 6 | Agent Skills host with Node.js 24+ and local filesystem access for CLI helpers. Fleet mode requires a RevealFleet directory layout. |
| [revealui-checkpoint](skills/revealui-checkpoint/) | studio | 0 | revealfleet Studio layout at REVEALFLEET_ROOT; executable helpers require Node.js 24+ and pnpm 10 when invoked. |
| [revealui-cleanup](skills/revealui-cleanup/) | studio | 0 | RevealFleet Studio layout at REVEALFLEET_ROOT; executable helpers require Node.js 24+ and pnpm 10 when invoked. |
| [revealui-coordinate](skills/revealui-coordinate/) | studio | 1 | revealfleet Studio layout at REVEALFLEET_ROOT; executable helpers require Node.js 24+ and pnpm 10 when invoked. |
| [revealui-design](skills/revealui-design/) | public | 0 | Agent Skills host; production React uses @revealui/tokens/design-context and @revealui/presentation. Static HTML mockups need no package runtime. |
| [revealui-design-status](skills/revealui-design-status/) | studio | 0 | RevealFleet Studio layout and Claude design adapter; requires the configured claude.ai design project. |
| [revealui-doctor](skills/revealui-doctor/) | studio | 0 | RevealFleet Studio layout at REVEALFLEET_ROOT; executable helpers require Node.js 24+ and pnpm 10 when invoked. |
| [revealui-ops](skills/revealui-ops/) | studio | 0 | RevealFleet Studio layout at REVEALFLEET_ROOT; executable helpers require Node.js 24+ and pnpm 10 when invoked. |
| [revealui-pickup](skills/revealui-pickup/) | studio | 0 | RevealFleet Studio layout at REVEALFLEET_ROOT; executable helpers require Node.js 24+ and pnpm 10 when invoked. |
| [revealui-recover](skills/revealui-recover/) | studio | 0 | RevealFleet Studio layout at REVEALFLEET_ROOT; executable helpers require Node.js 24+ and pnpm 10 when invoked. |
| [revealui-rollup](skills/revealui-rollup/) | studio | 0 | revealfleet Studio layout at REVEALFLEET_ROOT; executable helpers require Node.js 24+ and pnpm 10 when invoked. |
| [revealui-skills-test](skills/revealui-skills-test/) | studio | 0 | RevealFleet Studio layout at REVEALFLEET_ROOT; executable helpers require Node.js 24+ and pnpm 10 when invoked. |
| [revealui-snapshot](skills/revealui-snapshot/) | studio | 0 | RevealFleet Studio layout at REVEALFLEET_ROOT; executable helpers require Node.js 24+ and pnpm 10 when invoked. |
| [revealui-sync-lts](skills/revealui-sync-lts/) | studio | 0 | Deprecated historical reference for RevealFleet Studio on WSL; current disaster recovery uses RevKit weekly snapshots. |
| [revealui-sync-rules](skills/revealui-sync-rules/) | studio | 0 | RevealFleet Studio layout at REVEALFLEET_ROOT; executable helpers require Node.js 24+ and pnpm 10 when invoked. |
| [revealui-tracker](skills/revealui-tracker/) | studio | 0 | RevealFleet Studio layout at REVEALFLEET_ROOT; executable helpers require Node.js 24+ and pnpm 10 when invoked. |
| [revvault-resolve](skills/revvault-resolve/) | studio | 0 | RevealFleet Studio layout and configured RevVault; secret values must remain in the vault. |
| [security-hardening](skills/security-hardening/) | public | 1 | Agent Skills host; executable TypeScript examples require Node.js 24+, pnpm 10 and the dependencies in the revskills package manifest. |
| [tailwind-v4](skills/tailwind-v4/) | public | 0 | Any Agent Skills host; examples require the framework packages named in this skill. |
| [vitest-testing](skills/vitest-testing/) | public | 0 | Any Agent Skills host; examples require the framework packages named in this skill. |
| [yjs-collaboration](skills/yjs-collaboration/) | public | 1 | Agent Skills host; executable TypeScript examples require Node.js 24+, pnpm 10 and the dependencies in the revskills package manifest. |

Executable assets include bundled `.js`, `.ts`, `.mts`, `.sh`, `.py`, and similar source files; a skill can contain guidance plus runnable helpers. The retired RevealUI design `ui_kits` are pointer pages, not self-contained component kits.
<!-- skill-inventory:end -->

The full generated asset list is in [Skill inventory](docs/SKILL_INVENTORY.md). Studio skills name their required layout and services in `compatibility`; the public pack does not require a revealfleet checkout, though individual examples require the named framework packages.

### Operator boundary

Three planes: product runtime, operator laptop, Studio daemon. `bin/rfloop` is operator-only: a PR/CI operator disk state machine only (P0 stub; no LLM; auto-merge locked). It is not the fleet brain or the product AgentRuntime. Prefer `rfloop`; `bin/revloop` is a rename shim.

## Contributing

The two Grok hook entrypoints copied by RevKit are generated standalone bundles. See [Hook bundle build instructions](docs/HOOK_BUNDLES.md) before changing their source or imported libraries.

PRs welcome. Each skill must:

- Have a `SKILL.md` with valid frontmatter per the [Agent Skills spec](https://agentskills.io/specification)
- Pass `skills-ref validate ./skills/<name>` when that tool is available
- Include a keyword-rich description (discovery surface)
- Keep body under 500 lines — move detailed reference to `references/`
- **Public pack:** no private filesystem paths (grok-bot-checkpoint may document the public Grok Bot box checkpoint root). **Studio pack:** revealfleet layout is intentional; do not re-introduce Claude-only hard deps without an adapter label

### Pre-push validators

```bash
git config core.hooksPath .githooks
```

1. **skills-lint** — SKILL.md + optional multi-home command symlink check (`scripts/lint-all-skills.sh`)
2. **plugin-lint** — in-repo plugin metadata (`scripts/lint-plugins.sh .`; Claude cache optional)
3. **private-leak-scan** — private paths / secrets (`scripts/check-no-private-leaks.sh`)
4. **md-truth-self-test** — `skills/exhaustive-audit/scripts/md-truth-check.js --self-test`

Bypass (rare, document in the PR): `SKIP_PREPUSH=1 git push`.

## License

MIT

---

Part of the [revealfleet](https://revealui.com) — the agentic business runtime. Build your business, not your boilerplate.
