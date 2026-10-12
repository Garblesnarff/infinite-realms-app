import { createRequire } from 'node:module';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { DEMO_TOKEN, startStubIrApi, type RunningStubApi } from './stub-ir-api.js';
import { CompanionApiClient } from '../src/ir-client.js';
import { startMcpHttpServer, type RunningMcpServer } from '../src/server.js';
import { main, runDemo, handleInput } from '../web/app.js';

// Use the app's existing jsdom dependency; CI already installs this package.
const require = createRequire(new URL('../../ai-adventure-scribe-main/package.json', import.meta.url));
const { JSDOM } = require('jsdom');

let stubApi: RunningStubApi;
let mcp: RunningMcpServer;
let document: Document;
let closeDom: () => void;
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');

function calledTools(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('#log .log-call')).map(
    (element) => element.dataset.tool!,
  );
}

describe('simulated Alexa+ web client (#215 step 3b)', () => {
  beforeAll(async () => {
    stubApi = await startStubIrApi();
    mcp = await startMcpHttpServer(new CompanionApiClient(stubApi.url, DEMO_TOKEN), 0);
    const page = await fetch(mcp.url.replace(/\/mcp$/, '/'));
    expect(page.status).toBe(200);
    const dom = new JSDOM(await page.text());
    document = dom.window.document;
    closeDom = () => dom.window.close();
    Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
    await main(mcp.url);
    expect(document.querySelector('#status')!.className).toBe('ok');
  });

  afterAll(async () => {
    closeDom?.();
    for (const [name, descriptor] of [['document', originalDocument], ['window', originalWindow]] as const) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    await mcp?.close();
    await stubApi?.close();
  });

  test('scripted demo runs join → get_scene → speak → roll in order', async () => {
    document.querySelector<HTMLInputElement>('#session-id')!.value = 'session-1';
    document.querySelector<HTMLInputElement>('#character-id')!.value = 'character-2';
    await runDemo();
    expect(document.querySelector('[data-demo-done]')).not.toBeNull();
    expect(calledTools()).toEqual(['join_party', 'get_scene', 'speak_as_companion', 'roll_for_companion']);
    const reply = document.querySelector('#reply')!.textContent!;
    expect(reply.length).toBeGreaterThan(0);
    expect(reply.length).toBeLessThan(200);
    expect(reply).toContain('Perception');
  });

  test('free text input maps to the right tool', async () => {
    const before = calledTools().length;
    await handleInput('look around');
    expect(calledTools().slice(before)).toEqual(['get_scene']);
  });
});
