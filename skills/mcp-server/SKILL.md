---
name: mcp-server
description: Model Context Protocol server development patterns. Use when building custom MCP servers, exposing tools and resources, handling JSON-RPC, implementing credential isolation, or integrating with Claude Desktop, Cursor, or AI agents. Covers @modelcontextprotocol/server v2, serveStdio, tool schemas, and multi-tenant credential patterns.
license: MIT
compatibility: Agent Skills host; executable TypeScript examples require Node.js 24+, pnpm 10 and the dependencies in the revskills package manifest.
allowed-tools: Read Grep Glob
metadata:
  pack: public
  author: RevealUI Studio
  version: "0.1.1"
  website: https://revealui.com
---

# MCP Server Development

## Supported SDK and executable example

This guide targets the **v2 TypeScript SDK** (`@modelcontextprotocol/server`), not the older `@modelcontextprotocol/sdk` v1 import paths. The complete typed example is [`examples/tenant-server.mts`](examples/tenant-server.mts). The official v2 [server guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/get-started/first-server.md) and [tool guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/servers/tools.md) define the APIs used below.

```typescript
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

// Bind one immutable tenant credential to this server instance.
const apiKey = credentials.apiKey;
if (!apiKey) throw new Error('Tenant API key is required');
const server = new McpServer({ name: 'tenant-search', version: '1.0.0' });
server.registerTool('tenant_search', {
  description: 'Search only the current tenant catalog.',
  inputSchema: z.object({
    query: z.string().min(1).max(200),
    limit: z.number().int().min(1).max(50).default(10),
  }).strict(),
}, async ({ query, limit }) => ({
  content: [{ type: 'text', text: JSON.stringify(await searchApi(apiKey, query, limit)) }],
}));
```

The same schema is advertised to clients and validates arguments before the handler runs. Invalid query types, missing query, and out-of-range limits never reach `searchApi`. The handler receives typed data; a TypeScript cast on `request.params.arguments` would not validate a caller.

## Startup and credential isolation

For stdio, resolve a single tenant's key in the host's secret store **before** constructing the server. `serveStdio(() => createTenantServer(credentials, searchApi))` creates a server for that connection. Keep stdout for MCP traffic and log to stderr.

For a multi-tenant HTTP host, authenticate every request, resolve that tenant's credential, then create or bind a server instance with that immutable credential for the request. Never swap a module-global override around an awaited handler, and never fall back from a missing tenant credential to `process.env.API_KEY`: overlapping requests could use another tenant's key. The [executable example](examples/tenant-server.mts) exposes `createTenantSearch` so the overlap invariant can be tested without a live host.

## HTTP API Helper Pattern

```typescript
function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'MyServer-MCP/0.1.0',
  };
}

async function apiPost(path: string, body: Record<string, unknown>): Promise<unknown> {
  const { apiUrl, token } = getConfig();
  const res = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `API error ${res.status}`);
  return data;
}
```

## Hypervisor Registration

```typescript
hypervisor.registerServer({
  name: 'my-server',
  command: 'node',
  args: ['dist/servers/my-server.js'],
  env: { API_KEY: 'tenant-key-injected-by-secret-store' },
  requiredTier: 'pro',
});
```

## Claude Desktop Configuration

```json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["/path/to/dist/servers/my-server.js"],
      "env": {
        "API_KEY": "your-api-key"
      }
    }
  }
}
```

## Response Format

For text results, return a `content` array with `type: 'text'`:

```typescript
// Success
return {
  content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
};

// Error
return {
  content: [{ type: 'text', text: `Error: ${message}` }],
  isError: true,
};
```

## Best Practices

- Define a runtime `inputSchema` so invalid tool arguments never reach API calls
- Include `_meta` with duration, server name, tool name, timestamp
- Use descriptive tool names with a namespace prefix (e.g., `stripe_`, `memory_`)
- Keep tool descriptions actionable: what it does, when to use it
- Set `required` only for truly required fields; use defaults for optional
- Handle timeouts gracefully (AbortController with 10-30s limits)
- Log errors server-side but return clean error messages to clients
