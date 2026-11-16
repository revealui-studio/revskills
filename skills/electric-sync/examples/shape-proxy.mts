import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from '@electric-sql/client';

export type Session = Readonly<{ user: Readonly<{ id: string }> }>;
export type Dependencies = Readonly<{
  authenticate: (request: Request) => Promise<Session | null>;
  canReadScope: (userId: string, scopeId: string) => Promise<boolean>;
  electricUrl: string;
  fetchUpstream: typeof fetch;
}>;

export async function serveShape(request: Request, deps: Dependencies): Promise<Response> {
  const session = await deps.authenticate(request);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const incoming = new URL(request.url);
  const scopeId = incoming.searchParams.get('scope_id');
  if (!scopeId || !(await deps.canReadScope(session.user.id, scopeId))) {
    return new Response('Forbidden', { status: 403 });
  }

  const origin = new URL('/v1/shape', deps.electricUrl);
  for (const [key, value] of incoming.searchParams) {
    if (ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(key)) origin.searchParams.set(key, value);
  }
  origin.searchParams.set('table', 'your_table');
  origin.searchParams.set('where', 'scope_id = $1');
  origin.searchParams.set('params[1]', scopeId);

  const upstream = await deps.fetchUpstream(origin);
  const headers = new Headers(upstream.headers);
  headers.delete('content-encoding');
  headers.delete('content-length');
  headers.set('Cache-Control', 'private, no-store');
  headers.set('Vary', 'Cookie, Authorization');
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}
