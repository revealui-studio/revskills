---
type: master-spec
repo: revskills
last-updated: 2026-10-09
owner: RevealUI Studio
staleness-status: FRESH
---

# RevSkills — Master Spec

**Last Updated:** 2026-10-09

**Status:** Pre-1.0 per skill — see the generated inventory below for the current count
**Repo:** [RevealUIStudio/revskills](https://github.com/RevealUIStudio/revskills)

> SKILL.md format, distribution surface, harness compatibility. Companion to [`MASTER_PLAN.md`](./MASTER_PLAN.md).

---

## Mission

Curated [Agent Skills](https://agentskills.io) for modern web development. Built by RevealUI Studio. **Vendor-agnostic:** skills are the SSOT; Claude Code, Grok, Cursor, OpenCode, VS Code, and any agentskills.io consumer are equal adapters.

A **skill** is a unit of agent context — a markdown file with frontmatter — that an LLM tool can install, list, and invoke. Skills are prompt-shaped guidance the agent reads when it matches the skill's `description`. Some skills also bundle executable helpers, TypeScript examples, templates, and tests; the generated inventory counts these assets.

---

## Repository structure

```
revskills/
├── README.md                       # install + skill table
├── LICENSE                         # MIT
├── bin/                            # optional adapter launchers (e.g. claude-safe)
├── scripts/                        # validators + session helpers
├── skills/                         # one directory per skill (SSOT; generated count below)
│   ├── next-best-practices/
│   │   └── SKILL.md
│   └── …
├── .claude-plugin/                 # Claude Code marketplace adapter only
└── docs/
    ├── MASTER_PLAN.md
    ├── MASTER_SPEC.md              # this file
    └── AUTO_RECOVERY.md
```

---

## SKILL.md format

Every skill is a single `SKILL.md` file with YAML frontmatter:

```markdown
---
name: next-best-practices
description: Next.js 15+ App Router best practices …
license: MIT
allowed-tools: Read Grep Glob
metadata:
  author: RevealUI Studio
  version: "0.1.0"
  website: https://revealui.com
---
```

### Frontmatter fields

| Field | Required | Purpose |
|---|---|---|
| `name` | yes | Stable skill identifier matching the directory name; command aliases belong in string metadata. |
| `description` | yes | LLM-targeted match-trigger description |
| `license` | yes | SPDX (`MIT` for everything here) |
| `allowed-tools` | no | Capability whitelist (see §Tool capability map) |
| `metadata.author` | yes | "RevealUI Studio" |
| `metadata.version` | yes | SemVer per skill |
| `metadata.website` | no | Canonical site |
| `metadata.pack` | yes here | `public` or `studio` classification for generated inventory |
| `compatibility` | yes here | Runtime, layout, service, or adapter prerequisites |

### Body conventions

- **First H1**: skill title
- **Sections**: H2-headed, scannable
- **Code blocks**: realistic snippets
- **When NOT to use**: explicit anti-patterns

---

## Distribution surface

**SSOT:** directories under `skills/`.

### Bundle install (preferred, multi-harness)

```bash
npx skills add RevealUIStudio/revskills
```

### Single-skill install

```bash
npx skills add RevealUIStudio/revskills --skill next-best-practices
```

### Manual install (equal adapters)

| Harness | Typical path |
|---|---|
| Claude Code (user) | `~/.claude/skills/<name>/` or `~/.claude/commands/` (Studio slash links) |
| Claude Code (project) | `<project>/.claude/skills/<name>/` |
| Grok | `~/.grok/skills/` paths or `[skills].paths` → this repo's `skills/` |
| Cursor | `<project>/.cursor/skills/` |
| OpenCode / VS Code | tool-specific Agent Skills / agent-plugin dirs |
| Generic | copy `skills/<name>/` per [agentskills.io](https://agentskills.io) |

### Claude Code plugin (adapter only)

`.claude-plugin/` is a **marketplace adapter** for Claude Code users. It is not the product center. Description/keywords may mention Claude for that storefront; README and this spec own multi-harness truth.

---

## Harness compatibility

| Harness | Compat | Notes |
|---|---|---|
| Claude Code | ✓ | Plugin adapter + skills/commands homes |
| Grok | ✓ | `[skills].paths` / thin `~/.grok` pointers to this tree |
| Cursor | ✓ | Project skills |
| OpenCode | ✓ | Agent Skills / plugin paths per tool |
| VS Code agent | ✓ | Agent plugins / skills per tool |
| Other agentskills.io tools | ✓ | Spec-defined |

---

## Tool capability map (`allowed-tools`)

Skills ship **Claude-style capability names** as the common Agent Skills dialect. Harnesses that use different tool identifiers **map or ignore** the field; they must not invent a second frontmatter schema.

| Capability | Claude dialect | Grok (illustrative) | Intent |
|---|---|---|---|
| shell | `Bash` | `run_terminal_command` | Run shell commands |
| read | `Read` | `read_file` | Read files |
| search | `Grep`, `Glob` | `grep`, `list_dir` | Search / list |
| edit | `Write`, `Edit` | `search_replace`, `write` | Mutate files |

Enforcement: only harnesses that honor `allowed-tools` restrict tools; others ignore gracefully.

---

## Public patterns and Studio context

<!-- skill-inventory:start -->
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
<!-- skill-inventory:end -->

The generated [asset-level inventory](./SKILL_INVENTORY.md) lists bundled scripts and examples. Public skills can still require their named framework packages; Studio-context skills require the declared fleet services. The Claude design-status skill is explicitly adapter-specific.

## Auto-recovery launchers

`bin/claude-safe` is the **Claude Code adapter** for crash recovery (see [`AUTO_RECOVERY.md`](./AUTO_RECOVERY.md)). Grok and other harnesses recover via `/recover` (or harness-native session restore) without that binary. Multi-harness notes live in AUTO_RECOVERY.md.

---

## Versioning

Per-skill SemVer is in `metadata.version`. The inventory count and pack classification come from parsed skill metadata via `node scripts/generate-skill-inventory.mts --check`.

---

## License

MIT — everything in this repo.

---

## Compose / coexistence

| Other product | Relationship |
|---|---|
| **RevealUI** | Studio workflow skills target the fleet layout |
| **RevCon** | Profiles / harness content may pointer into this tree |
| **RevDev** | Future list/invoke via daemon |
| **RevVault, RevForge, RevKit** | Related tooling; some skills bundle executable helpers or require Studio services |

---

## Agent-loop planes

Product runtime, operator laptop, and Studio daemon are three planes. `rfloop` is operator-only: a PR/CI disk state machine (P0 stub; no LLM; auto-merge locked), not the product AgentRuntime. Prefer `rfloop`; `revloop` is a rename shim (`bin/revloop`).

## See also

- [`docs/MASTER_PLAN.md`](./MASTER_PLAN.md)
- [`docs/AUTO_RECOVERY.md`](./AUTO_RECOVERY.md)
- [`README.md`](../README.md)
