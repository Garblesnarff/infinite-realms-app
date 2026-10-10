/**
 * Proving test for #215 step 1: the companion MCP server.
 *
 * Against a local stub of the Infinite Realms companion API (wired with the
 * REAL route definitions from companion-routes.ts), an MCP client:
 *   1. lists the tools,
 *   2. then runs join → get_scene → speak → roll.
 *
 * The stub service returns the full shapes production sends, and the stub
 * auth enforces the bearer token, so this exercises the real HTTP contract
 * end to end: MCP client -> Streamable HTTP -> MCP server -> IR API.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { request as httpRequest } from 'node:http';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { CompanionApiClient } from '../src/ir-client.js';
import { startMcpHttpServer, type RunningMcpServer } from '../src/server.js';
import { DEMO_TOKEN, startStubIrApi, type RunningStubApi } from './stub-ir-api.js';

const SESSION_ID = 'session-1';

let stubApi: RunningStubApi;
let mcp: RunningMcpServer;
let client: Client;

function textOf(result: unknown): string {
  if (!result || typeof result !== 'object' || !('content' in result)) {
    throw new Error('Expected a tool result with content');
  }
  const content = (result as { content: unknown }).content;
  if (!Array.isArray(content)) throw new Error('Expected a content array');
  const block = content[0] as { type?: unknown; text?: unknown } | undefined;
  if (!block || block.type !== 'text' || typeof block.text !== 'string') {
    throw new Error('Expected a text content block');
  }
  return block.text;
}

describe('companion MCP server proving test (#215 step 1)', () => {
  beforeAll(async () => {
    stubApi = await startStubIrApi();
    const apiClient = new CompanionApiClient(stubApi.url, DEMO_TOKEN);
    mcp = await startMcpHttpServer(apiClient, 0);
    client = new Client({ name: 'proving-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(mcp.url)));
  });

  afterAll(async () => {
    await client.close();
    await mcp.close();
    await stubApi.close();
  });

  test('lists the six companion tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();
    expect(names).toEqual([
      'get_scene',
      'join_party',
      'leave_party',
      'list_companions',
      'roll_for_companion',
      'speak_as_companion',
    ]);
    for (const tool of tools) {
      expect((tool.description ?? '').length).toBeGreaterThan(0);
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  test('join -> get_scene -> speak -> roll', async () => {
    const joinResult = await client.callTool({
      name: 'join_party',
      arguments: { session_id: SESSION_ID, character_id: 'character-2' },
    });
    expect(joinResult.isError).toBeFalsy();
    const joined = JSON.parse(textOf(joinResult)) as {
      companion: { id: string; character_id: string; status: string };
      party: Array<{ name: string }>;
    };
    expect(joined.companion.character_id).toBe('character-2');
    expect(joined.companion.status).toBe('active');
    expect(joined.party.map((member) => member.name)).toContain('Mira');
    const companionId = joined.companion.id;

    const sceneResult = await client.callTool({
      name: 'get_scene',
      arguments: { session_id: SESSION_ID },
    });
    expect(sceneResult.isError).toBeFalsy();
    const scene = JSON.parse(textOf(sceneResult)) as {
      campaign: { name: string };
      session: { current_scene_description: string };
      party: unknown[];
      dialogue_history: Array<{ text: string }>;
      combat: null;
    };
    expect(scene.campaign.name).toBe('The Sunken Spires');
    expect(scene.session.current_scene_description.length).toBeGreaterThan(0);
    expect(scene.party.length).toBeGreaterThanOrEqual(1);
    expect(scene.dialogue_history.length).toBeGreaterThanOrEqual(1);
    expect(scene.combat).toBeNull();

    const speakResult = await client.callTool({
      name: 'speak_as_companion',
      arguments: {
        session_id: SESSION_ID,
        companion_id: companionId,
        text: 'Stay behind me.',
      },
    });
    expect(speakResult.isError).toBeFalsy();
    const spoken = JSON.parse(textOf(speakResult)) as {
      message: { speaker_type: string; text: string };
    };
    expect(spoken.message.speaker_type).toBe('companion');
    expect(spoken.message.text).toBe('Stay behind me.');

    const rollResult = await client.callTool({
      name: 'roll_for_companion',
      arguments: {
        session_id: SESSION_ID,
        companion_id: companionId,
        kind: 'skill',
        name: 'Perception',
        reason: 'spotting the tripwire',
      },
    });
    expect(rollResult.isError).toBeFalsy();
    const roll = JSON.parse(textOf(rollResult)) as {
      d20: number;
      modifier: number;
      total: number;
      breakdown: string[];
    };
    expect(roll.total).toBe(roll.d20 + roll.modifier);
    expect(roll.breakdown.length).toBeGreaterThan(0);
  });

  test('an unknown session surfaces as an MCP tool error, never the token', async () => {
    const result = await client.callTool({
      name: 'get_scene',
      arguments: { session_id: 'no-such-session' },
    });
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain('Session not found');
    expect(text).not.toContain(DEMO_TOKEN);
  });

  test('the stub API rejects a wrong bearer token with 401 like requireAuth', async () => {
    const response = await fetch(`${stubApi.url}/v1/sessions/session-1/scene`, {
      headers: { authorization: 'Bearer wrong-token' },
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized', code: 'unauthorized' });
  });

  test('leave with an unknown companion surfaces a 404 tool error', async () => {
    const result = await client.callTool({
      name: 'leave_party',
      arguments: { session_id: SESSION_ID, companion_id: 'companion-999' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('404');
  });

  test('join enforces the two-companion cap like production', async () => {
    // The flow test above already joined character-2, so one more join fills
    // the cap and the next one must fail with 422.
    const second = await client.callTool({
      name: 'join_party',
      arguments: { session_id: SESSION_ID, character_id: 'character-3' },
    });
    expect(second.isError).toBeFalsy();
    const capped = await client.callTool({
      name: 'join_party',
      arguments: { session_id: SESSION_ID, character_id: 'character-4' },
    });
    expect(capped.isError).toBe(true);
    expect(textOf(capped)).toContain('422');
  });

  test('rejects non-loopback Host and Origin with 403 (DNS rebinding guard)', async () => {
    const port = Number(new URL(mcp.url).port);
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' });

    // Host is a forbidden header for fetch, so set it via node:http.
    const hostStatus = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port,
          path: '/mcp',
          method: 'POST',
          headers: { host: 'evil.example.com', 'content-type': 'application/json' },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        },
      );
      req.on('error', reject);
      req.end(body);
    });
    expect(hostStatus).toBe(403);

    const originBlocked = await fetch(mcp.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://evil.example.com' },
      body,
    });
    expect(originBlocked.status).toBe(403);

    // A loopback Host and loopback Origin still reach the MCP layer: the
    // ping is not a real tool, so this is a transport-level error, not 403.
    const loopbackOk = await fetch(mcp.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: `http://127.0.0.1:${port}`,
      },
      body,
    });
    expect(loopbackOk.status).not.toBe(403);
  });

  test('a wrong token surfaces a 401 tool error through the MCP client, never the token', async () => {
    const wrongToken = 'wrong-token-proving-only';
    const badMcp = await startMcpHttpServer(
      new CompanionApiClient(stubApi.url, wrongToken),
      0,
    );
    const badClient = new Client({ name: 'proving-test-bad-token', version: '1.0.0' });
    await badClient.connect(new StreamableHTTPClientTransport(new URL(badMcp.url)));
    try {
      const result = await badClient.callTool({
        name: 'get_scene',
        arguments: { session_id: SESSION_ID },
      });
      expect(result.isError).toBe(true);
      const text = textOf(result);
      expect(text).toContain('401');
      expect(text).not.toContain(wrongToken);
    } finally {
      await badClient.close();
      await badMcp.close();
    }
  });

  test('join_party rejects an empty and an oversized session_id', async () => {
    const empty = await client.callTool({
      name: 'join_party',
      arguments: { session_id: '', character_id: 'character-2' },
    });
    expect(empty.isError).toBe(true);
    const oversized = await client.callTool({
      name: 'join_party',
      arguments: { session_id: 's'.repeat(10_000), character_id: 'character-2' },
    });
    expect(oversized.isError).toBe(true);
  });
});
