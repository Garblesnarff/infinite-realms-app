/** Enumerable name/message for `logger.error(msg, metadata)` so Error objects are not logged as `{}`. */
export function describeCaughtError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { name: typeof error, message: String(error) };
}
