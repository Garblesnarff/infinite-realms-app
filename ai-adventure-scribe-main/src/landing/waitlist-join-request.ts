/**
 * The request the SSR landing waitlist form sends.
 * `initWaitlistForms` is the only caller. The route test posts this same value.
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
