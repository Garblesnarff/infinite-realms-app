import { NotFoundError } from '../../lib/errors.js';

type ContextLoader = (sessionId: string, userId: string) => Promise<unknown>;

export async function getSessionContextRouteResult(
  sessionId: string,
  userId: string,
  load: ContextLoader,
) {
  try {
    return { status: 200 as const, body: await load(sessionId, userId) };
  } catch (error) {
    if (error instanceof NotFoundError) {
      return { status: 404 as const, body: { error: 'Not found' } };
    }
    throw error;
  }
}
