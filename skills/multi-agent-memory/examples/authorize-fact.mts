import * as z from 'zod/v4';

export type Principal = Readonly<{ agentId: string }>;
export const factInput = z.object({
  session_id: z.string().min(1),
  content: z.string().min(1).max(10_000),
  fact_type: z.enum(['discovery', 'bug', 'decision', 'warning', 'question', 'answer']),
}).strict();
export type FactRecord = z.infer<typeof factInput> & Readonly<{ agent_id: string }>;
export type FactDependencies = Readonly<{
  authenticate: (request: Request) => Promise<Principal | null>;
  isSessionMember: (agentId: string, sessionId: string) => Promise<boolean>;
  insertFact: (record: FactRecord) => Promise<void>;
}>;

export async function publishFact(request: Request, deps: FactDependencies): Promise<Response> {
  const principal = await deps.authenticate(request);
  if (!principal) return new Response('Unauthorized', { status: 401 });
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  const parsed = factInput.safeParse(raw);
  if (!parsed.success) return new Response('Invalid fact', { status: 400 });
  if (!(await deps.isSessionMember(principal.agentId, parsed.data.session_id))) {
    return new Response('Forbidden', { status: 403 });
  }
  await deps.insertFact({ ...parsed.data, agent_id: principal.agentId });
  return new Response(null, { status: 201 });
}
