/**
 * A fake postgres.js client good enough to drive a REAL Drizzle instance.
 *
 * This exists so combat-start HTTP tests exercise the production query *builder* rather
 * than a hand-mocked `db` object. The bug that broke every structured combat start was
 * thrown by Drizzle's insert-select validator before a single byte reached Postgres, so a
 * stubbed `db` would have reproduced nothing. Faking the wire instead of the ORM keeps
 * that class of failure inside test coverage.
 *
 * Drizzle's postgres-js driver calls `client.unsafe(sql, params)` and then either awaits it
 * directly (statements with no field mapping) or calls `.values()` on it (anything with a
 * select list or RETURNING), which must resolve to positional row arrays.
 */
export interface FakeQueryHandler {
  /** Matched against the generated SQL. First match wins. */
  match: RegExp;
  /** Column order of the query's select/RETURNING list — positional mapping depends on it. */
  columns: readonly string[];
  /** Rows to return, as objects keyed by the `columns` above. */
  rows: (params: readonly unknown[], sql: string) => Array<Record<string, unknown>>;
}

export interface FakePostgresClient {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
  unsafe(query: string, params?: readonly unknown[]): PromiseLike<unknown[]> & {
    values(): Promise<unknown[][]>;
  };
  /** Drizzle's postgres-js driver installs transparent date parsers here on construction. */
  options: { parsers: Record<string, unknown>; serializers: Record<string, unknown> };
  queries: Array<{ sql: string; params: readonly unknown[] }>;
}

/**
 * `handlers` may be a provider so a single client (and therefore a single Drizzle instance,
 * which module mocking requires to be a stable binding) can be re-pointed between tests.
 */
export function createFakePostgresClient(
  handlers: FakeQueryHandler[] | (() => FakeQueryHandler[]),
): FakePostgresClient {
  const queries: Array<{ sql: string; params: readonly unknown[] }> = [];
  const currentHandlers = () => (typeof handlers === 'function' ? handlers() : handlers);

  const resolve = (query: string, params: readonly unknown[]) => {
    const handler = currentHandlers().find((candidate) => candidate.match.test(query));
    if (!handler) {
      throw new Error(`FakePostgresClient: no handler matched query: ${query.slice(0, 240)}`);
    }
    return { handler, rows: handler.rows(params, query) };
  };

  const client = ((..._args: unknown[]) => Promise.resolve([])) as unknown as FakePostgresClient;

  client.options = { parsers: {}, serializers: {} };
  client.queries = queries;
  client.unsafe = (query: string, params: readonly unknown[] = []) => {
    queries.push({ sql: query, params });
    const objectRows = () => resolve(query, params).rows;
    const positionalRows = () => {
      const { handler, rows } = resolve(query, params);
      return rows.map((row) => handler.columns.map((column) => row[column]));
    };
    const thenable = {
      then: (onFulfilled?: (value: unknown[]) => unknown, onRejected?: (reason: unknown) => unknown) =>
        Promise.resolve()
          .then(objectRows)
          .then(onFulfilled, onRejected),
      values: () => Promise.resolve().then(positionalRows),
    };
    return thenable as PromiseLike<unknown[]> & { values(): Promise<unknown[][]> };
  };

  return client;
}
