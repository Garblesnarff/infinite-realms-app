/**
 * Configuration for the companion MCP server (#215 step 1).
 *
 * Auth model (per the step-0 decision on #215): a static demo token for the
 * local demo, read from the IR_DEMO_TOKEN environment variable and never
 * committed. The token is forwarded as the bearer credential to the Infinite
 * Realms companion API; it is never logged, returned to MCP clients, or
 * written to disk by this server.
 */

export interface CompanionMcpConfig {
  /** Base URL of the Infinite Realms server-bun API, e.g. http://localhost:8888 */
  irApiBaseUrl: string;
  /** Static demo token, sent as `Authorization: Bearer <token>` to the API */
  demoToken: string;
  /** Port the MCP Streamable HTTP endpoint listens on */
  mcpPort: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CompanionMcpConfig {
  const demoToken = env.IR_DEMO_TOKEN;
  if (!demoToken) {
    throw new Error(
      'IR_DEMO_TOKEN is required: set it to the static demo token for the local demo ' +
        '(never commit the value; see .env.example).',
    );
  }
  const mcpPort = Number(env.MCP_PORT ?? '8893');
  if (!Number.isInteger(mcpPort) || mcpPort <= 0 || mcpPort > 65535) {
    throw new Error(`MCP_PORT must be a valid TCP port, got ${JSON.stringify(env.MCP_PORT ?? '')}`);
  }
  const irApiBaseUrl = (env.IR_API_BASE_URL ?? 'http://localhost:8888').replace(/\/+$/, '');
  return { irApiBaseUrl, demoToken, mcpPort };
}
