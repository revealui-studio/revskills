import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { InMemoryTransport, LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/server';
import { createTenantSearch, createTenantServer, tenantSearchInput } from '../skills/mcp-server/examples/tenant-server.mts';
import { serveShape, type Dependencies as ShapeDependencies } from '../skills/electric-sync/examples/shape-proxy.mts';
import { publishFact, type FactDependencies, type FactRecord } from '../skills/multi-agent-memory/examples/authorize-fact.mts';
import { allowCookieMutation } from '../skills/security-hardening/examples/csrf.mts';
import { appendPatch, readDocument, type UpdateStore } from '../skills/yjs-collaboration/examples/append-updates.mts';

async function tenantIsolation() {
  assert.equal(tenantSearchInput.parse({ query: 'x' }).limit, 10);
  for (const bad of [{ query: 1 }, { query: 'x', limit: -1 }, { query: 'x', limit: 51 }, { query: 'x', extra: true }]) {
    assert.equal(tenantSearchInput.safeParse(bad).success, false);
  }
  createTenantServer({ apiKey: 'A' }, async () => []);
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const seen: [string, string][] = [];
  const api = async (key: string, query: string) => {
    await barrier;
    seen.push([key, query]);
    return key;
  };
  const a = createTenantSearch({ apiKey: 'A' }, api);
  const b = createTenantSearch({ apiKey: 'B' }, api);
  const pending = [a('one', 10), b('two', 10)];
  release();
  assert.deepEqual(await Promise.all(pending), ['A', 'B']);
  assert.deepEqual(seen, [['A', 'one'], ['B', 'two']]);
  assert.throws(() => createTenantSearch({ apiKey: '' }, api));
}

async function mcpToolDispatch() {
  const calls: [string, string, number][] = [];
  const server = createTenantServer({ apiKey: 'tenant-A' }, async (key, query, limit) => {
    calls.push([key, query, limit]);
    return { key, query, limit };
  });
  const [client, host] = InMemoryTransport.createLinkedPair();
  type RpcResponse = { id: string | number; result?: { content: { text?: string }[]; isError?: boolean }; error?: { message: string } };
  const pending = new Map<string | number, (response: RpcResponse) => void>();
  client.onmessage = message => {
    if ('id' in message && message.id !== undefined) {
      const callback = pending.get(message.id);
      if (callback) { pending.delete(message.id); callback(message as RpcResponse); }
    }
  };
  let id = 0;
  const request = (method: string, params: Record<string, unknown>) => new Promise<RpcResponse>((resolve, reject) => {
    const next = ++id;
    pending.set(next, resolve);
    void client.send({ jsonrpc: '2.0', id: next, method, params }).catch(reject);
  });
  await client.start();
  await server.connect(host);
  try {
    const initialized = await request('initialize', {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    });
    assert.equal(initialized.error, undefined);
    await client.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const valid = await request('tools/call', { name: 'tenant_search', arguments: { query: 'hello', limit: 2 } });
    assert.equal(valid.result?.isError, undefined);
    assert.deepEqual(JSON.parse(valid.result?.content[0]?.text ?? ''), { key: 'tenant-A', query: 'hello', limit: 2 });
    assert.deepEqual(calls, [['tenant-A', 'hello', 2]]);
    const invalid = await request('tools/call', { name: 'tenant_search', arguments: { query: 4 } });
    assert.equal(invalid.result?.isError, true);
    assert.deepEqual(calls, [['tenant-A', 'hello', 2]]);
  } finally {
    await server.close();
    await client.close();
  }
}

async function shapeAuthorization() {
  const calls: URL[] = [];
  const request = new Request('https://app.example/api/shape?scope_id=team-b&where=1%3D1&table=secrets&offset=42');
  const base: ShapeDependencies = {
    authenticate: async () => ({ user: { id: 'user-a' } }),
    canReadScope: async (user, scope) => user === 'user-a' && scope === 'team-a',
    electricUrl: 'https://electric.example',
    fetchUpstream: async url => {
      calls.push(new URL(typeof url === 'string' ? url : url instanceof URL ? url : url.url));
      return new Response('ok', { headers: { 'Cache-Control': 'public, max-age=3600' } });
    },
  };
  assert.equal((await serveShape(request, base)).status, 403);
  assert.equal(calls.length, 0);
  assert.equal((await serveShape(request, { ...base, authenticate: async () => null })).status, 401);
  const permitted = new Request('https://app.example/api/shape?scope_id=team-a&where=1%3D1&table=secrets&offset=42');
  const allowed = await serveShape(permitted, base);
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(allowed.headers.get('Vary'), 'Cookie, Authorization');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].searchParams.get('table'), 'your_table');
  assert.equal(calls[0].searchParams.get('where'), 'scope_id = $1');
  assert.equal(calls[0].searchParams.get('params[1]'), 'team-a');
  assert.equal(calls[0].searchParams.get('scope_id'), null);
  assert.equal(calls[0].searchParams.get('offset'), '42');
  const quoted = new Request("https://app.example/api/shape?scope_id=" + encodeURIComponent("a' OR 1=1--"));
  assert.equal((await serveShape(quoted, { ...base, canReadScope: async () => true })).status, 200);
  assert.equal(calls[1].searchParams.get('where'), 'scope_id = $1');
  assert.equal(calls[1].searchParams.get('params[1]'), "a' OR 1=1--");
}

async function factIdentity() {
  const inserted: FactRecord[] = [];
  const makeRequest = (body: unknown) => new Request('https://app.example/api/facts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const deps: FactDependencies = {
    authenticate: async () => ({ agentId: 'authenticated-agent' }),
    isSessionMember: async (agent, session) => agent === 'authenticated-agent' && session === 's1',
    insertFact: async fact => { inserted.push(fact); },
  };
  const input = { session_id: 's2', content: 'x', fact_type: 'bug' };
  assert.equal((await publishFact(makeRequest(input), deps)).status, 403);
  assert.equal(inserted.length, 0);
  assert.equal((await publishFact(makeRequest({ ...input, session_id: 's1', agent_id: 'impersonated-agent' }), deps)).status, 400);
  assert.equal((await publishFact(makeRequest({ ...input, session_id: 's1' }), deps)).status, 201);
  assert.equal(inserted[0].agent_id, 'authenticated-agent');
  assert.equal((await publishFact(makeRequest(input), { ...deps, authenticate: async () => null })).status, 401);
}

function csrfGuard() {
  const headers = { Origin: 'https://app.example', 'X-CSRF-Token': 'fixed-length-token' };
  assert.equal(allowCookieMutation(new Request('https://app.example', { method: 'POST', headers }), 'https://app.example', 'fixed-length-token'), true);
  assert.equal(allowCookieMutation(new Request('https://app.example', { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' } }), 'https://app.example', 'fixed-length-token'), false);
  assert.equal(allowCookieMutation(new Request('https://app.example', { method: 'POST', headers: { 'X-CSRF-Token': 'fixed-length-token' } }), 'https://app.example', 'fixed-length-token'), false);
  assert.equal(allowCookieMutation(new Request('https://app.example', { method: 'POST', headers }), 'https://app.example', 'another-session-token'), false);
  assert.equal(allowCookieMutation(new Request('https://app.example', { method: 'POST', headers: { Origin: 'https://app.example' } }), 'https://app.example', 'fixed-length-token'), false);
  assert.equal(allowCookieMutation(new Request('https://app.example', { method: 'GET', headers }), 'https://app.example', 'fixed-length-token'), false);
}

async function concurrentYjsUpdates() {
  const updates: Uint8Array[] = [];
  let reads = 0;
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const store: UpdateStore = {
    loadUpdates: async () => {
      reads += 1;
      if (reads === 2) release();
      await barrier;
      return updates.slice();
    },
    appendUpdate: async (_id, update) => { updates.push(update); },
  };
  await Promise.all([
    appendPatch(store, 'doc', { kind: 'append_item', path: 'findings', content: 'A' }),
    appendPatch(store, 'doc', { kind: 'append_item', path: 'findings', content: 'B' }),
  ]);
  assert.equal(updates.length, 2);
  const read = await readDocument(store, 'doc');
  assert.deepEqual(new Set(read.findings), new Set(['A', 'B']));
}

describe('public skill executable examples', () => {
  it('isolates overlapping tenant credentials and validates tool input', tenantIsolation);
  it('validates a registered MCP tool before dispatching its tenant handler', mcpToolDispatch);
  it('authorizes Electric scopes and binds filter parameters', shapeAuthorization);
  it('binds fact identity to authenticated session membership', factIdentity);
  it('rejects cross-origin and missing-token cookie mutations', csrfGuard);
  it('retains both updates from concurrent Yjs writers', concurrentYjsUpdates);
});
