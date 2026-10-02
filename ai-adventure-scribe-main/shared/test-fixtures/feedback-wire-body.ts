/**
 * The body the Send feedback modal posts to `POST /v1/feedback` from the game screen, and the
 * GET /version body its `build` comes from.
 *
 * Shared so the client test asserts the modal sends exactly `feedbackWireBody` and the server
 * test posts that same body through the real route schema (AGENTS.md §4, #2280).
 * `versionBody` is the full output of the server's createVersionPayloadBuilder, which always
 * sets all five fields; the modal reads only `short`.
 */
export const versionBody = {
  commit: '6ecb80f2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  short: '6ecb80f2',
  builtAt: '2026-10-01T00:00:00.000Z',
  bundle: 'main-DMthKkaE.js',
  clientBuild: '6ecb80f2',
};

export const feedbackWireBody = {
  message: 'The map is blank.',
  page: '/app/game/camp-1',
  campaignSlug: 'camp-1',
  sessionId: 'b1c1a1f0-0000-4000-8000-000000000001',
  build: versionBody.short,
};
