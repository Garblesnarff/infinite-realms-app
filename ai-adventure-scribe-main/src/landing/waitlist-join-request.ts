/**
 * The waitlist join request.
 * The server route test posts this value through POST /v1/waitlist.
 */
export function buildWaitlistJoinRequest(input: { email: string; source: string }): {
  path: string;
  method: 'POST';
  headers: { 'Content-Type': 'application/json' };
  body: { email: string; source: string };
} {
  return {
    path: '/v1/waitlist',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: {
      email: input.email,
      source: input.source,
    },
  };
}
