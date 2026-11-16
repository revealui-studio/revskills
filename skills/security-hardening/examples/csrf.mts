import { timingSafeEqual } from 'node:crypto';

// Authenticate the session separately. expectedToken is a fixed-size,
// unpredictable token associated with that session.
export function allowCookieMutation(request: Request, allowedOrigin: string, expectedToken: string): boolean {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return false;
  if (request.headers.get('Origin') !== allowedOrigin) return false;
  const received = request.headers.get('X-CSRF-Token');
  if (!received || !expectedToken) return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expectedToken);
  return left.length === right.length && timingSafeEqual(left, right);
}
