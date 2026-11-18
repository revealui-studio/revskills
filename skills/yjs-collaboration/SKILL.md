---
name: yjs-collaboration
description: Yjs CRDT collaboration patterns for real-time and offline-first editing. Use when building collaborative documents, shared scratchpads, or multi-user editing. Covers Y.Doc, Y.Map, Y.Array, Y.Text, state encoding, structured patches, server-side document manipulation, and conflict-free merge semantics.
license: MIT
compatibility: Agent Skills host; executable TypeScript examples require Node.js 24+, pnpm 10 and the dependencies in the revskills package manifest.
allowed-tools: Read Grep Glob
metadata:
  pack: public
  author: RevealUI Studio
  version: "0.1.1"
  website: https://revealui.com
---

# Yjs CRDT Collaboration

## Core Concepts

Yjs is a CRDT framework. Multiple peers can edit concurrently and merge without conflicts. Every operation is commutative and idempotent.

```typescript
import * as Y from 'yjs';

const doc = new Y.Doc();
const root = doc.getMap('root');
```

## Type System

| Type | Use Case | API |
|------|----------|-----|
| `Y.Map` | Key-value store | `set(key, val)`, `get(key)`, `delete(key)` |
| `Y.Array` | Ordered list | `push([item])`, `insert(idx, [item])`, `delete(idx, len)` |
| `Y.Text` | Rich/plain text | `insert(idx, str)`, `delete(idx, len)`, `toString()` |

Nested types: Y.Map values can be other shared types.

```typescript
const root = doc.getMap('root');

// String values
root.set('title', 'My Document');

// Nested Y.Text
const findings = new Y.Text();
findings.insert(0, 'Initial finding...');
root.set('findings', findings);

// Nested Y.Array
const items = new Y.Array();
items.push(['Item 1', 'Item 2']);
root.set('items', items);
```

## State Encoding & Persistence

Yjs binary updates are commutative, associative, and idempotent when every update is delivered. Persist each incremental update as an **atomic append**; do not write a whole state computed from a stale row. The full [executable example](examples/append-updates.mts) applies loaded updates, captures a state vector, and appends only the new delta. See the official [Yjs document updates guide](https://docs.yjs.dev/api/document-updates).

```sql
CREATE TABLE yjs_document_updates (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id TEXT NOT NULL,
  update BYTEA NOT NULL
);
CREATE INDEX yjs_document_updates_document_id_id_idx
  ON yjs_document_updates (document_id, id);
```

For `appendUpdate`, issue one `INSERT` per delta in the database. `loadUpdates` selects every row for a document in `id` order. PostgreSQL commits concurrent inserts without replacing another writer's delta. A snapshot compaction process may merge updates, but it must preserve all updates added during compaction with a transaction or version check. Multi-writer tests should reconstruct the document after simultaneous appends.

## Server-Side Document Manipulation

Use [`appendPatch`](examples/append-updates.mts) for CLI or batch edits. It loads persisted updates, applies a patch to a fresh `Y.Doc`, computes only the delta since the pre-patch state vector, and appends that delta. Stable top-level names such as `text:findings` and `list:findings` avoid concurrent creation of conflicting nested types. Two concurrent `set_key` writes to the same key still follow Y.Map conflict resolution; use application-level version checks if both values must be retained.

```typescript
await appendPatch(store, documentId, {
  kind: 'append_item',
  path: 'findings',
  content: 'Database index missing',
});
```

## Reading Document Content

Replay every persisted update into a new document, then read the stable top-level shared types. The executable example's `readDocument(store, documentId)` returns text, findings, and map values and destroys its temporary `Y.Doc` in `finally`.

## Merging Two Documents

```typescript
// Two docs edited independently
const doc1 = new Y.Doc();
const doc2 = new Y.Doc();

// ... edits happen on each ...

// Merge: apply each doc's state to the other
const state1 = Y.encodeStateAsUpdate(doc1);
const state2 = Y.encodeStateAsUpdate(doc2);

Y.applyUpdate(doc1, state2); // doc1 now has both edits
Y.applyUpdate(doc2, state1); // doc2 now has both edits
// Both docs are identical after merge
```

## WebSocket Provider (Real-Time)

For browser agents that need live character-by-character collaboration:

```typescript
import { WebsocketProvider } from 'y-websocket';

const doc = new Y.Doc();
const provider = new WebsocketProvider(
  'wss://collab.example.com',
  'document-id',
  doc,
);

provider.on('status', ({ status }) => {
  console.log('Connection:', status); // 'connecting' | 'connected' | 'disconnected'
});
```

## Awareness (Presence)

```typescript
const awareness = provider.awareness;

// Set local state (cursor position, user info)
awareness.setLocalState({
  user: { name: 'Agent A', color: '#ff0000' },
  cursor: { index: 42, length: 0 },
});

// Listen for remote state changes
awareness.on('change', () => {
  const states = awareness.getStates();
  // Map<clientId, { user, cursor }>
});
```

## Best Practices

- Always call `doc.destroy()` after server-side operations to free memory
- Use `Buffer.from(state)` when storing in Postgres bytea columns
- Use `new Uint8Array(buffer)` when reading from Postgres bytea columns
- Prefer `Y.Text` over plain strings for content that may be collaboratively edited
- Use `Y.Array` for ordered lists (append-heavy patterns)
- Use `Y.Map` as the root container for structured documents
- Server-side patches and WebSocket edits merge when every update is delivered; persist append-only updates or use a transactionally safe merge
