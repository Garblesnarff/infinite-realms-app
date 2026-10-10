/**
 * Headless test for #215 step 3b: the simulated Alexa+ web client.
 *
 * Drives the real page in headless Chromium (CDP) against the stub IR API.
 * This Chromium build blocks navigations to loopback (Local Network Access),
 * so the test injects the page via Page.setDocumentContent and relays the
 * page's MCP fetch() calls through CDP Fetch interception — the page's JS
 * runs unmodified, performs real MCP JSON-RPC, and the test asserts the
 * scripted demo performs join_party → get_scene → speak_as_companion →
 * roll_for_companion in order.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CompanionApiClient } from '../src/ir-client.js';
import { startMcpHttpServer, type RunningMcpServer } from '../src/server.js';
import { DEMO_TOKEN, startStubIrApi, type RunningStubApi } from './stub-ir-api.js';

const CHROME = '/opt/meta-chromium/chrome';
const SESSION_ID = 'session-1';
const CHARACTER_ID = 'character-2';

/** Minimal CDP driver over a WebSocket, with event subscriptions. */
class CdpPage {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, (value: unknown) => void>();
  private listeners = new Map<string, Array<(params: unknown) => void>>();

  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data)) as {
        id?: number;
        method?: string;
        params?: unknown;
        result?: unknown;
      };
      if (msg.id !== undefined) {
        const resolve = this.pending.get(msg.id);
        if (resolve) {
          this.pending.delete(msg.id);
          resolve(msg.result);
        }
      } else if (msg.method) {
        for (const fn of this.listeners.get(msg.method) ?? []) fn(msg.params);
      }
    });
  }

  on(method: string, fn: (params: unknown) => void): void {
    const list = this.listeners.get(method) ?? [];
    list.push(fn);
    this.listeners.set(method, list);
  }

  send<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out`));
      }, 15_000);
      this.pending.set(id, (result) => {
        clearTimeout(timer);
        resolve(result as T);
      });
      this.ws.send(JSON.stringify({ id, method, params: params ?? {} }));
    });
  }

  evaluate<T>(expression: string): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP evaluate timed out: ${expression.slice(0, 80)}`));
      }, 15_000);
      this.pending.set(id, (result) => {
        clearTimeout(timer);
        const r = result as { result?: { value?: T }; exceptionDetails?: unknown };
        if (r?.exceptionDetails) reject(new Error(`CDP exception: ${JSON.stringify(r.exceptionDetails).slice(0, 200)}`));
        else resolve(r?.result?.value as T);
      });
      this.ws.send(
        JSON.stringify({
          id,
          method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true },
        }),
      );
    });
  }

  close(): void {
    this.ws.close();
  }
}

interface LaunchedChrome {
  page: CdpPage;
  proc: ChildProcess;
  userDataDir: string;
}

/**
 * Build a single-file version of the web client: inline CSS/JS and point
 * the MCP client at the absolute server URL (the injected document has no
 * http origin for relative URLs).
 */
async function buildTestPage(base: string, mcpUrl: string): Promise<string> {
  const get = async (path: string): Promise<string> => {
    const res = await fetch(base + path);
    if (!res.ok) throw new Error(`failed to fetch ${path}: ${res.status}`);
    return res.text();
  };
  const html = await get('/');
  const css = await get('/style.css');
  const mcpJs = (await get('/mcp-client.js')).replace('export class McpHttpClient', 'class McpHttpClient');
  const appJs = (await get('/app.js'))
    .replace(`import { McpHttpClient } from './mcp-client.js';`, '')
    .replace(`new McpHttpClient('/mcp')`, `new McpHttpClient(${JSON.stringify(mcpUrl)})`);
  return html
    .replace('<link rel="stylesheet" href="/style.css">', `<style>${css}</style>`)
    .replace(
      '<script type="module" src="/app.js"></script>',
      `<script type="module">${mcpJs}\n${appJs}</script>`,
    );
}

async function launchChrome(pageHtml: string, mcpBase: string): Promise<LaunchedChrome> {
  const userDataDir = await mkdtemp(join(tmpdir(), 'chrome-3b-'));
  const proc = spawn(
    CHROME,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--user-data-dir=${userDataDir}`,
      '--remote-debugging-port=0',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const wsUrl = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for DevTools URL')), 30_000);
    let stderr = '';
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    proc.on('error', reject);
    proc.on('exit', (code) => reject(new Error(`chrome exited early: ${code}`)));
  });
  const httpBase = wsUrl.replace(/^ws:\/\//, 'http://').replace(/\/devtools\/browser\/.*$/, '');
  let pageWs = '';
  for (let i = 0; i < 50 && !pageWs; i++) {
    const targets = (await (await fetch(`${httpBase}/json/list`)).json()) as Array<{
      type: string;
      url: string;
      webSocketDebuggerUrl: string;
    }>;
    pageWs = targets.find((t) => t.type === 'page' && t.url === 'about:blank')?.webSocketDebuggerUrl ?? '';
    if (!pageWs) await new Promise((r) => setTimeout(r, 200));
  }
  if (!pageWs) throw new Error('no page target found');
  const ws = new WebSocket(pageWs);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP websocket connect timed out')), 15_000);
    ws.addEventListener('open', () => {
      clearTimeout(timer);
      resolve();
    });
    ws.addEventListener('error', reject);
  });
  const page = new CdpPage(ws);

  // Relay the page's network requests through the test process (bun's fetch
  // reaches loopback fine). This is what lets the page talk MCP.
  // Note: the injected document has an opaque origin, so the page's fetches
  // are cross-origin and trigger CORS preflights; answer those directly
  // (the real page is same-origin and never preflights).
  page.on('Fetch.requestPaused', (params) => {
    void (async () => {
      const { requestId, request } = params as {
        requestId: string;
        request: { url: string; method: string; headers: Record<string, string>; postData?: string };
      };
      try {
        if (request.method === 'OPTIONS') {
          await page.send('Fetch.fulfillRequest', {
            requestId,
            responseCode: 204,
            responseHeaders: [
              { name: 'access-control-allow-origin', value: '*' },
              { name: 'access-control-allow-methods', value: 'POST, GET, OPTIONS' },
              { name: 'access-control-allow-headers', value: '*' },
              { name: 'access-control-max-age', value: '86400' },
            ],
            body: '',
          });
          return;
        }
        if (!request.url.startsWith(mcpBase)) {
          await page.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
          return;
        }
        const res = await fetch(request.url, {
          method: request.method,
          // Strip the Origin header: the injected test document has an
          // opaque origin (sends `Origin: null`, which the server's
          // rebinding guard correctly rejects). The real page is
          // same-origin and never sends a null Origin.
          headers: Object.fromEntries(
            Object.entries(request.headers).filter(
              ([name]) => name.toLowerCase() !== 'origin',
            ),
          ),
          body: request.postData,
        });
        const body = Buffer.from(await res.arrayBuffer()).toString('base64');
        const responseHeaders = [...res.headers].map(([name, value]) => ({ name, value }));
        // The relayed response must carry CORS headers for the opaque-origin page.
        responseHeaders.push({ name: 'access-control-allow-origin', value: '*' });
        await page.send('Fetch.fulfillRequest', {
          requestId,
          responseCode: res.status,
          responseHeaders,
          body,
        });
      } catch (error) {
        await page.send('Fetch.failRequest', {
          requestId,
          errorReason: 'Failed',
        }).catch(() => undefined);
        throw error;
      }
    })();
  });
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });

  const tree = await page.send<{ frameTree: { frame: { id: string } } }>('Page.getFrameTree');
  await page.send('Page.setDocumentContent', {
    frameId: tree.frameTree.frame.id,
    html: pageHtml,
  });
  return { page, proc, userDataDir };
}

/** Poll a CDP expression until it returns truthy. */
async function waitFor(page: CdpPage, expression: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await page.evaluate<boolean>(expression)) return;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timed out waiting for: ${expression.slice(0, 100)}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

let stubApi: RunningStubApi;
let mcp: RunningMcpServer;
let chrome: LaunchedChrome | null = null;

describe('simulated Alexa+ web client (#215 step 3b)', () => {
  beforeAll(async () => {
    stubApi = await startStubIrApi();
    mcp = await startMcpHttpServer(new CompanionApiClient(stubApi.url, DEMO_TOKEN), 0);
    const base = mcp.url.replace(/\/mcp$/, '');
    const pageHtml = await buildTestPage(base, mcp.url);
    chrome = await launchChrome(pageHtml, mcp.url);
    // The page connects on load; wait for the connected status.
    await waitFor(
      chrome.page,
      `document.querySelector('#status').className === 'ok'`,
      30_000,
    );
  }, 60_000);

  afterAll(async () => {
    chrome?.page.close();
    chrome?.proc.kill();
    if (chrome) await rm(chrome.userDataDir, { recursive: true, force: true });
    await mcp.close();
    await stubApi.close();
  });

  test('scripted demo runs join → get_scene → speak → roll in order', async () => {
    const page = chrome!.page;
    await page.evaluate(
      `document.querySelector('#session-id').value = '${SESSION_ID}';` +
        `document.querySelector('#character-id').value = '${CHARACTER_ID}';` +
        `document.querySelector('#run-demo').click();`,
    );
    await waitFor(page, `document.querySelector('[data-demo-done]') !== null`, 45_000);
    const tools = await page.evaluate<string[]>(
      `Array.from(document.querySelectorAll('#log .log-call')).map((el) => el.dataset.tool)`,
    );
    const wanted = ['join_party', 'get_scene', 'speak_as_companion', 'roll_for_companion'];
    let at = 0;
    for (const tool of tools) {
      if (tool === wanted[at]) at++;
      if (at === wanted.length) break;
    }
    expect(at).toBe(wanted.length);
    // The voice card shows the final roll reply, short and speakable.
    const reply = await page.evaluate<string>(
      `document.querySelector('#reply').textContent`,
    );
    expect(reply.length).toBeGreaterThan(0);
    expect(reply.length).toBeLessThan(200);
    expect(reply).toContain('Perception');
  });

  test('free text input maps to the right tool', async () => {
    const page = chrome!.page;
    const before = await page.evaluate<number>(
      `document.querySelectorAll('#log .log-call').length`,
    );
    await page.evaluate(
      `document.querySelector('#input').value = 'look around';` +
        `document.querySelector('#send').click();`,
    );
    await waitFor(
      page,
      `document.querySelectorAll('#log .log-call').length > ${before}`,
      30_000,
    );
    const tools = await page.evaluate<string[]>(
      `Array.from(document.querySelectorAll('#log .log-call')).map((el) => el.dataset.tool).slice(${before})`,
    );
    expect(tools).toContain('get_scene');
  });
});
