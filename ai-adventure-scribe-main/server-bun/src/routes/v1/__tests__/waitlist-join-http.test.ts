/**
 * The SSR landing form and POST /v1/waitlist share one request builder.
 * This posts that request through the real route. The database and the
 * confirmation email are stubbed so the test does not write a row or send mail.
 * The handler still validates the body: a misspelled path is 404, and the
 * stored email is the lowercased value the route writes.
 */
import { describe, expect, it, mock } from 'bun:test';

// waitlist.ts imports the auth middleware, which constructs the WorkOS client
// at module load. The join handler never calls it. These are placeholders.
process.env.WORKOS_API_KEY ||= 'test-workos-key';
process.env.WORKOS_CLIENT_ID ||= 'test-workos-client';

const inserted: Array<Record<string, unknown>> = [];

mock.module('../../../../../db/client', () => ({
  db: {
    query: {
      waitlist: {
        findFirst: async () => null,
      },
    },
    insert: () => ({
      values: (row: Record<string, unknown>) => ({
        returning: async () => {
          inserted.push(row);
          return [{ id: 'waitlist-row-1' }];
        },
      }),
    }),
  },
}));

mock.module('../../../services/email-service.js', () => ({
  sendWaitlistConfirmation: async () => {},
}));

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { waitlistRoutes } = await import('../waitlist.js');
const { buildWaitlistJoinRequest } =
  await import('../../../../../src/landing/waitlist-join-request.ts');

const app = createRequestPipelineApp().use(waitlistRoutes);

describe('SSR waitlist form posts to the live waitlist route', () => {
  it('accepts the request buildWaitlistJoinRequest builds', async () => {
    const join = buildWaitlistJoinRequest({
      email: 'Player@example.com',
      source: 'ai-gm-hero',
    });

    const response = await app.handle(
      new Request(`http://localhost${join.path}`, {
        method: join.method,
        headers: join.headers,
        body: JSON.stringify(join.body),
      }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      success: true,
      message: 'Successfully joined the waitlist',
      id: 'waitlist-row-1',
    });
    expect(inserted).toEqual([
      {
        email: 'player@example.com',
        name: null,
        source: 'ai-gm-hero',
        status: 'pending',
      },
    ]);
  });
});
