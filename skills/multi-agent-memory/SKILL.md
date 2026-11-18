---
name: multi-agent-memory
description: Multi-agent shared memory patterns for AI agent coordination. Use when building shared fact logs, collaborative scratchpads, memory reconciliation, or coordinating discoveries between concurrent agents. Covers append-only fact tables, Yjs CRDT scratchpads, LLM-powered reconciliation, and session-scoped memory sharing.
license: MIT
compatibility: Agent Skills host; executable TypeScript examples require Node.js 24+, pnpm 10 and the dependencies in the revskills package manifest.
allowed-tools: Read Grep Glob
metadata:
  pack: public
  author: RevealUI Studio
  version: "0.2.1"
  website: https://revealui.com
---

# Multi-Agent Shared Memory

## Architecture Overview

Three layers, each building on the previous:

```
Layer 1: Shared Fact Log      — append-only discoveries, real-time sync
Layer 2: Yjs CRDT Scratchpad  — collaborative working document
Layer 3: Reconciliation       — LLM-powered canonical fact extraction
```

All layers scope by `session_id` (coordination session). Only agents in the same session share memory.

## Layer 1: Shared Fact Log

Append-only table of agent discoveries. No CRDT, no merge — pure append.

```sql
CREATE TABLE shared_facts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  content TEXT NOT NULL,
  fact_type TEXT NOT NULL CHECK (fact_type IN (
    'discovery', 'bug', 'decision', 'warning', 'question', 'answer'
  )),
  confidence REAL NOT NULL DEFAULT 1.0,
  tags JSONB NOT NULL DEFAULT '[]',
  source_ref JSONB,
  superseded_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Write path: agent publishes via REST API -> DB insert -> Electric syncs to subscribers.

The client may name a session, but the server derives `agent_id` from the authenticated principal and verifies session membership. See the executable [`examples/authorize-fact.mts`](examples/authorize-fact.mts) handler.

```typescript
await fetch('/api/sync/shared-facts', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    session_id: 'coord-abc123',
    content: 'auth module has race condition in session refresh',
    fact_type: 'bug',
  }),
});
```

The server must reject missing authentication or membership before inserting. It must also authorize the Electric fact shape, CLI read, scratchpad patch, and reconciliation endpoints against the same session membership. Client-supplied `agent_id` is never authoritative.

Read path (React): subscribe via Electric shape.

```typescript
function useSharedFacts(sessionId: string) {
  const { data, isLoading } = useShape({
    url: `${proxyBaseUrl}/api/shapes/shared-facts`,
    params: { session_id: sessionId },
  });
  return { facts: data, isLoading };
}
```

Read path (CLI agents): poll via daemon RPC or direct API call.

## Layer 2: Yjs CRDT Scratchpad

Multiple agents concurrently edit a shared document. Browser agents use WebSocket Yjs collab. CLI agents submit structured patches applied server-side.

### Patch Types

| Type | Description | Example |
|------|-------------|---------|
| `set_key` | Set root-level key to string | Title, status |
| `append_section` | Append to Y.Text section | Add findings |
| `append_item` | Push to Y.Array section | Add list item |
| `replace_section` | Replace section entirely | Rewrite plan |

### Structured Patch (CLI Agents)

```typescript
await fetch('/api/sync/yjs-document-patches', {
  method: 'POST',
  body: JSON.stringify({
    document_id: 'scratchpad-task-42',
    patch_type: 'append_item',
    path: 'findings',
    content: 'Database index missing on user_id column',
  }),
});
```

Server-side: authenticate the caller, derive the agent identity, verify document session membership, then load all persisted Yjs updates, apply the patch, and **append the incremental update atomically**. Electric can fan out after the insert. Do not replace a full-state row from a stale read; two overlapping writers would lose one patch. See the concurrent example and test in [`../yjs-collaboration/examples/append-updates.mts`](../yjs-collaboration/examples/append-updates.mts).

### Server-Side Patch Application

The shared [`appendPatch`](../yjs-collaboration/examples/append-updates.mts) implementation is the reference for `append_section`, `append_item`, and `set_key` operations. The server authenticates the agent and authorizes `document_id` before calling it. For `replace_section`, define whether the operation is a conditional whole-section replacement or a collaborative edit; an unconditional replacement can erase a concurrent writer's intended content even if every CRDT update is saved. Preserve the full update history until a transactionally safe compaction is implemented.

## Layer 3: Reconciliation

Periodic or on-demand LLM pass that reads the fact log, resolves contradictions, deduplicates, and produces canonical memories.

### Extending Existing Memory Tables

```sql
ALTER TABLE agent_memories ADD COLUMN scope TEXT DEFAULT 'private';
-- Values: 'private' (single agent), 'shared' (session-wide), 'reconciled' (LLM-verified)
ALTER TABLE agent_memories ADD COLUMN session_scope TEXT;
ALTER TABLE agent_memories ADD COLUMN source_facts JSONB DEFAULT '[]';
ALTER TABLE agent_memories ADD COLUMN reconciled_at TIMESTAMPTZ;
```

### Reconciliation Process

1. Query unreconciled facts (where `superseded_by IS NULL`)
2. Group related facts by tags, source references, semantic similarity
3. LLM prompt: determine canonical truths, contradictions, duplicates
4. Create `scope = 'reconciled'` memories with `source_facts` references
5. Mark source facts as `superseded_by` the new reconciled memory

### Heuristic Fallback (No LLM)

Normalize content, deduplicate by exact match, keep highest confidence per group.

## CLI vs Browser Agent Paths

| Action | Browser Agent | CLI Agent |
|--------|---------------|-----------|
| Read facts | Electric shape (real-time) | API poll or daemon RPC |
| Write facts | REST POST | Daemon RPC -> REST POST |
| Edit scratchpad | WebSocket Yjs (live) | Structured patches |
| Read scratchpad | Yjs doc state | API -> decoded JSON |
| Trigger reconciliation | REST POST | Daemon RPC -> REST POST |

## Session Scoping

All memory is scoped by coordination session ID. When agents start a shared task:

1. Generate or reuse a session ID (e.g., `coord-{taskId}`)
2. All fact publications include this session ID
3. Shape subscriptions filter by session ID only after the proxy verifies membership
4. Reconciliation processes one session at a time

## Session order

Same shape as the control layer. A session names the native store first, then the vendor.

1. Knowledge graph (`revealui.memory.v1`) is the durable product memory.
2. The vendor adapter is a pointer. Grok `[memory]`, Claude `~/.claude` memory files, and any other vendor home do not become a second durable store.
3. `revealui-harnesses session adapter <vendor>` prints that order and does not query the graph.
4. An operator who wants the read passes `--memory`. That calls `queryDurableMemory` and continues if the graph is down. Session hooks do not pass `--memory`.

## Durable vs working vs session facts

Keep these names distinct. Do not proxy `memory_publish_fact` into
`kg_add_episode` (that ingest is a later graph phase, not this skill).

| API | Store | Lifetime | Use |
|---|---|---|---|
| daemon `memory.store` / `memory.query` | PGlite | Process/machine working set | Self-scoped working memory. Not shared product memory. |
| `memory_publish_fact` (`revealui-memory` MCP) | `shared_facts` | Session | Layer-1 live discoveries. Electric `shared-facts` shape. |
| `kg_add_episode` | `kg_*` | Durable, bi-temporal | What any in-scope agent has learned, queryable after session death. See the `knowledge-graph` skill. |
| Yjs kg-view / scratchpad | `yjs_documents` | Ephemeral overlay | Layout, annotations, session scratchpad. Flush to a `manual` episode to keep. |
