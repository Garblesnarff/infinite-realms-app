/**
 * Minimal MCP client over Streamable HTTP (spec 2025-11-25), dependency-free
 * so it runs in any browser. Used by the simulated Alexa+ web client
 * (#215 step 3b). No DOM here — this module is pure protocol.
 */

const PROTOCOL_VERSION = '2025-11-25';

function parseSsePayload(text) {
  const datas = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('data:')) datas.push(line.slice(5).trim());
  }
  if (datas.length === 0) throw new Error('MCP: empty SSE stream');
  return JSON.parse(datas[datas.length - 1]);
}

export class McpHttpClient {
  /** @param {string} url The Streamable HTTP endpoint, e.g. '/mcp' */
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.protocolVersion = PROTOCOL_VERSION;
  }

  async rpc(method, params) {
    const isNotification = method.startsWith('notifications/');
    const message = { jsonrpc: '2.0', method };
    if (!isNotification) message.id = this.nextId++;
    if (params !== undefined && params !== null) message.params = params;

    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': this.protocolVersion,
      },
      body: JSON.stringify(message),
    });
    if (res.status === 202) return null; // notification accepted
    const text = await res.text();
    if (!res.ok) throw new Error(`MCP HTTP ${res.status}: ${text.slice(0, 200)}`);
    const contentType = res.headers.get('content-type') ?? '';
    const payload = contentType.includes('text/event-stream')
      ? parseSsePayload(text)
      : JSON.parse(text);
    if (payload.error) {
      throw new Error(`MCP error ${payload.error.code}: ${payload.error.message}`);
    }
    return payload.result ?? null;
  }

  async connect() {
    const result = await this.rpc('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'simulated-alexa-web-client', version: '1.0.0' },
    });
    if (result && result.protocolVersion) this.protocolVersion = result.protocolVersion;
    await this.rpc('notifications/initialized', null);
  }

  async listTools() {
    const result = await this.rpc('tools/list', {});
    return (result && result.tools) || [];
  }

  /** @returns the tool result object (content blocks / isError) */
  async callTool(name, args) {
    return this.rpc('tools/call', { name, arguments: args || {} });
  }
}
