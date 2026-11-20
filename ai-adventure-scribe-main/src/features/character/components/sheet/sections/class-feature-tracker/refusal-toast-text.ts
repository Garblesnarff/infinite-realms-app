/**
 * #1643: a refusal the server explained (a 4xx with its reason) shows that reason alone, with no
 * HTTP status number. Anything else keeps the error's message.
 */
export function refusalToastText(error: unknown): string {
  const status = (error as { status?: unknown } | null)?.status;
  const reason = (error as { payload?: { error?: unknown } } | null)?.payload?.error;
  if (typeof status === 'number' && status >= 400 && status < 500 && reason) {
    return String(reason);
  }
  return error instanceof Error ? error.message : 'Nothing was spent.';
}
