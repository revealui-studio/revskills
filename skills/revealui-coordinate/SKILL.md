---
name: revealui-coordinate
description: >
  Live peer coordination packet for Grok Build (and equal adapters).
  Use when the user runs /coordinate, asks to coordinate with peers,
  or asks who else is live / what to stay off.
  Snapshot calls --mode=report (read-only). Checkpoint calls --mode=refresh
  (overwrite this session's workboard.d/active row). Manual default is full.
  Not /checkpoint (session-end archive). Not /pickup. Not grok-bot-handoff
  (cloud bots; use --bots to print a facts block for that skill).
license: MIT
compatibility: revealfleet Studio layout at REVEALFLEET_ROOT; executable helpers require Node.js 24+ and pnpm 10 when invoked.
allowed-tools: Bash Read Write
metadata:
  pack: studio
  alias: coordinate
  author: RevealUI Studio
  version: "0.1.2"
  website: https://revealui.com
  related: "revealui-checkpoint revealui-snapshot grok-bot-handoff"
---

# Coordinate (`/coordinate`) — live peer packet

One helper, three modes. Writes **only this session's**
`$JV_REPO/.revealui/workboard.d/active/<id>.md`. Never commits. Never
pushes into a cloud Grok Bot session.

Load helpers:

```bash
. "$(revealui-session-state)"
COORD=revealui-coordinate
```

## Modes

| Mode | When | Writes |
|------|------|--------|
| `report` | `/snapshot` Step 2 | none |
| `refresh` | `/checkpoint` after inventory | own `active/<sid>.md` |
| `full` | `/coordinate` (default) | own `active/<sid>.md`; `--bots` prints facts for `grok-bot-handoff` |

```bash
"$COORD" --mode=report
"$COORD" --mode=refresh --claim 'GAP-494' --stay-off 'revdev'
"$COORD" --mode=full --bots
```

`--json` for machine output. `--id` overrides `ss_session_id` / `AGENT_SESSION_ID`.

## Manual `/coordinate` (full)

1. Run `node "$COORD" --mode=full` (add `--claim` / `--stay-off` / `--bots` as asked).
2. Print the COORDINATE report. Fold conflicts into the current task's stay-off.
3. Do **not** open a checkpoint PR. Do **not** steal a named GAP another active row owns.
4. `--bots`: pass the printed FACTS block to `grok-bot-handoff`. Do not emit a `/pickup` fence as a bot prompt.

## Snapshot hook (`report`)

After snapshot Step 2 mechanical state, run `--mode=report` and paste a short
**Peers** list into `## Active-Constraints`. No writes.

## Checkpoint hook (`refresh`)

After checkpoint inventory, run `--mode=refresh` with this session's claim.
The existing Step 5b fragment commit ships `workboard.d/active`. Do not start
a second PR.

## Audiences (do not mix)

| Audience | Channel |
|----------|---------|
| Grok Build peers | `active_sessions.json` + `workboard.d/active` |
| Cloud Grok Bot | `--bots` facts → `grok-bot-handoff` (paste only) |
| Hosted RevealUI agents | out of v1 |

## Do not

- Do not treat this as `/checkpoint` or `/pickup`.
- Do not invent a second TRACKER.
- Do not `gh pr merge`, `--admin`, `--auto`, or `--no-verify`.
- Do not write `CURRENT-HANDOFF.md` or `workboard.md`.
- Do not claim a bot was notified unless a real channel exists (v1 has none).
