/**
 * The companion MCP server: six companion tools served over Streamable HTTP
 * (MCP spec 2025-11-25; the SDK also negotiates the 2025-03-26 handshake).
 *
 * The transport is stateless: SDK stateless transports are single-use, so a
 * fresh McpServer + StreamableHTTPServerTransport is created for every HTTP
 * request (the documented stateless pattern). Game state lives server-side
 * in Infinite Realms, keyed by session and companion ids — never in the MCP
 * layer.
 */

import { createServer, type IncomingMessage, type Server as HttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { CompanionApiClient } from './ir-client.js';
import { tools } from './tools.js';

export const SERVER_NAME = 'infinite-realms-companion';
export const SERVER_VERSION = '1.0.0';

/** Hostnames that resolve to this machine. */
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', '::1', 'localhost', '[::1]']);
// Note: '[::1]' is the bracketed form. `new URL(origin).hostname` keeps the
// brackets for IPv6 literals, while the Host header parser above strips them,
// so both forms are listed.

function hostHeaderHostname(value: string | undefined): string | null {
  if (!value) return null;
  const host = value.trim().toLowerCase();
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end === -1 ? null : host.slice(1, end);
  }
  return host.split(':')[0] || null;
}

/**
 * DNS-rebinding guard. Binding to 127.0.0.1 alone does not stop a browser
 * from resolving an attacker-controlled domain to 127.0.0.1, so every
 * request must also carry a loopback Host header and (when present) a
 * loopback Origin; anything else is rejected with 403 before the transport
 * runs. The SDK's own allowedHosts/allowedOrigins are deprecated in favor of
 * external checks like this one.
 */
export function isLoopbackRequest(req: IncomingMessage): boolean {
  const host = hostHeaderHostname(req.headers.host);
  if (!host || !LOOPBACK_HOSTNAMES.has(host)) return false;
  const origin = req.headers.origin;
  if (origin !== undefined) {
    let originHostname: string;
    try {
      originHostname = new URL(origin).hostname.toLowerCase();
    } catch {
      return false;
    }
    if (!LOOPBACK_HOSTNAMES.has(originHostname)) return false;
  }
  return true;
}

export function createCompanionMcpServer(client: CompanionApiClient): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
      async (args) => tool.handler(args as Record<string, unknown>, client),
    );
  }
  return server;
}

export interface RunningMcpServer {
  url: string;
  close: () => Promise<void>;
}

/** Directory holding the simulated Alexa+ web client (#215 step 3b). */
const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');

const STATIC_CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

/**
 * Serve the simulated Alexa+ web client. Only GET/HEAD, never outside
 * WEB_DIR (path traversal → miss → 404). Returns true when it handled the
 * request. Loopback-only like everything else: the isLoopbackRequest guard
 * runs before this.
 */
async function serveWebClient(
  req: IncomingMessage,
  res: import('node:http').ServerResponse,
): Promise<boolean> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const urlPath = (req.url ?? '/').split('?')[0].split('#')[0];
  let rel: string;
  try {
    rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath.slice(1));
  } catch {
    return false;
  }
  const filePath = normalize(join(WEB_DIR, rel));
  if (filePath !== WEB_DIR && !filePath.startsWith(WEB_DIR + sep)) return false;
  let data: Buffer;
  try {
    data = await readFile(filePath);
  } catch {
    return false;
  }
  res.writeHead(200, {
    'content-type': STATIC_CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream',
    'content-length': data.length,
  });
  res.end(req.method === 'HEAD' ? undefined : data);
  return true;
}

/**
 * Start the MCP server on Streamable HTTP. Resolves once listening.
 * Pass port 0 for an ephemeral port (used by the proving test).
 */
export async function startMcpHttpServer(
  client: CompanionApiClient,
  port: number,
): Promise<RunningMcpServer> {
  const httpServer: HttpServer = createServer((req, res) => {
    if (!isLoopbackRequest(req)) {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden: loopback requests only' }));
      return;
    }
    if (req.url !== '/mcp') {
      void serveWebClient(req, res)
        .then((handled) => {
          if (!handled && !res.headersSent) {
            res.writeHead(404, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found' }));
          }
        })
        .catch((error) => {
          if (!res.headersSent) {
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal server error' }));
          }
          console.error('Static file error:', error instanceof Error ? error.message : error);
        });
      return;
    }
    void (async () => {
      // Stateless: a new server + transport per request; the SDK's
      // stateless transport cannot be reused across requests.
      const mcpServer = createCompanionMcpServer(client);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res);
    })().catch((error) => {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
      console.error('MCP request error:', error instanceof Error ? error.message : error);
    });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    // Loopback only: the MCP endpoint takes no caller credentials and is for
    // local demo use, so it must not be exposed to the network.
    httpServer.listen(port, '127.0.0.1', () => {
      httpServer.off('error', reject);
      resolve();
    });
  });

  const address = httpServer.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  return {
    url: `http://127.0.0.1:${actualPort}/mcp`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
