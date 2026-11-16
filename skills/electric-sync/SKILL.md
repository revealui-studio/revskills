---
name: electric-sync
description: ElectricSQL v1.x real-time sync patterns for PostgreSQL. Use when setting up shape subscriptions, authenticated proxy routes, mutation endpoints, offline-first sync, or connecting Electric to Neon. Covers read-only sync, row-level filtering, write-through-API, and conflict resolution.
license: MIT
compatibility: Agent Skills host; executable TypeScript examples require Node.js 24+, pnpm 10 and the dependencies in the revskills package manifest.
allowed-tools: Read Grep Glob
metadata:
  pack: public
  author: RevealUI Studio
  version: "0.1.2"
  website: https://revealui.com
---

# ElectricSQL Sync Patterns

## Architecture

Electric v1.x is **read-only sync**: Postgres WAL -> Electric -> clients via HTTP. Writes go through your own API. Electric picks up WAL changes and pushes to shape subscribers.

```
Postgres (Neon/Supabase) --> Electric (sync service) --> Clients (HTTP shapes)
         ^                                                    |
         |                                                    v
         +--- Your API <--- REST mutations <--- Client writes
```

## Shape Proxy Route (Next.js)

[`examples/shape-proxy.mts`](examples/shape-proxy.mts) is an executable route helper. The caller may request a scope, but the server must check that the authenticated user can read it **on every shape request**. The proxy forwards only Electric protocol parameters, sets the table itself, and uses Electric's parameterized `where` binding. No handwritten character whitelist or SQL interpolation is needed. The official [Electric proxy example](https://github.com/electric-sql/electric/blob/main/examples/proxy-auth/app/shape-proxy/route.ts) uses the same protocol allowlist and parameter binding.

```typescript
const session = await authenticate(request);
if (!session) return new Response('Unauthorized', { status: 401 });
const scopeId = new URL(request.url).searchParams.get('scope_id');
if (!scopeId || !(await canReadScope(session.user.id, scopeId))) {
  return new Response('Forbidden', { status: 403 });
}
const origin = new URL('/v1/shape', electricUrl);
for (const [key, value] of new URL(request.url).searchParams) {
  if (ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(key)) origin.searchParams.set(key, value);
}
origin.searchParams.set('table', 'your_table');
origin.searchParams.set('where', 'scope_id = $1');
origin.searchParams.set('params[1]', scopeId);
```

The helper removes stale `content-encoding` and `content-length` headers after `fetch` decompresses the upstream response. It sends `Cache-Control: private, no-store` and varies on both Cookie and Authorization so an upstream public cache header cannot expose a tenant shape through a shared cache. Keep the Electric service secret server-side.

## Mutation Route (Write Path)

Writes go through REST, then Electric picks up the WAL change:

```typescript
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getSession(request.headers);
  if (!session) return unauthorized();

  const body = await request.json();
  // Validate body fields

  const db = getClient();
  const [created] = await db.insert(table).values({ ... }).returning();

  // Electric automatically syncs this to all shape subscribers
  return NextResponse.json(created, { status: 201 });
}
```

## Client Hook (React)

```typescript
import { useShape } from '@electric-sql/react';

function useMyData(scopeId: string) {
  const { proxyBaseUrl } = useElectricConfig();

  const { data, isLoading, error } = useShape({
    url: `${proxyBaseUrl}/api/shapes/my-table`,
    params: { scope_id: scopeId },
  });

  return { data, isLoading, error };
}
```

## Database Requirements

- PostgreSQL 14+ with `wal_level = logical`
- Direct connection (not pooled) for replication
- Neon: logical replication available on all plans
- Supabase: logical replication enabled by default

## Electric Configuration

```
DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=require
ELECTRIC_SECRET=your-secret-key
```

Health check: `GET /v1/health` returns `{"status":"active"}`

## Offline-First Pattern

```typescript
import { useShape } from '@electric-sql/react';

// Shape data is cached locally. When reconnecting,
// Electric resumes from the last sync position.
const { data, isLoading } = useShape({
  url: `${proxyBaseUrl}/api/shapes/my-table`,
  params: { scope_id: id },
  fetchClient: fetchWithTimeout, // 10s timeout
});
```

## Row-Level Security

Electric shape filtering is set in the authenticated proxy. A filter limits **which rows stream**; it does not authorize a caller on its own. Check membership for client-requested scopes, derive the authorized identifier from the session when possible, and bind it through `params[1]` instead of concatenating a WHERE string. Apply the same rule to fact shapes and other session-scoped subscriptions.

## Conflict Resolution

Electric is read-only sync. Conflicts happen at the write API level:

- **Last-write-wins**: Compare timestamps, keep latest
- **Server-wins**: Always accept server state on 409
- **Optimistic**: Use `If-Match` / `ETag` headers for version checks
- **Queue**: Buffer offline mutations, replay on reconnect with coalescing
