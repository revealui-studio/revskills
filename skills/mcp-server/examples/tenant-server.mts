import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

export type TenantCredentials = Readonly<{ apiKey: string }>;
export type SearchApi = (apiKey: string, query: string, limit: number) => Promise<unknown>;

export function createTenantSearch(credentials: TenantCredentials, searchApi: SearchApi) {
  const apiKey = credentials.apiKey;
  if (!apiKey) throw new Error('Tenant API key is required');
  return async (query: string, limit: number) => searchApi(apiKey, query, limit);
}

export const tenantSearchInput = z.object({
  query: z.string().min(1).max(200),
  limit: z.number().int().min(1).max(50).default(10),
}).strict();

export function createTenantServer(credentials: TenantCredentials, searchApi: SearchApi) {
  const search = createTenantSearch(credentials, searchApi);
  const server = new McpServer({ name: 'tenant-search', version: '1.0.0' });
  server.registerTool('tenant_search', {
    description: 'Search only the current tenant catalog.',
    inputSchema: tenantSearchInput,
  }, async ({ query, limit }) => {
    const data = await search(query, limit);
    return { content: [{ type: 'text', text: JSON.stringify(data) }] };
  });
  return server;
}

// A stdio process serves one tenant. Resolve credentials before startup from
// the host's secret store. A multi-tenant HTTP host must authenticate each
// request and create/bind a separate server instance for that request.
export async function startTenantStdio(credentials: TenantCredentials, searchApi: SearchApi) {
  await serveStdio(() => createTenantServer(credentials, searchApi));
}
