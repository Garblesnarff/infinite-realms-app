/**
 * Convert postgres.js RowList results to plain arrays before they cross an
 * Elysia response boundary. Elysia does not recognize Array subclasses as
 * JSON arrays and otherwise string-coerces RowList values.
 */
export async function normalizeRows<T>(query: PromiseLike<Iterable<T>>): Promise<T[]> {
  return Array.from(await query);
}
