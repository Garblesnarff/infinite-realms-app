#!/usr/bin/env bun
import { config } from 'dotenv';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { loginWithPassword } from '../../shared/auth/headless-auth';
import { runAutoTurns } from './auto';

import type { HeadlessEvent } from '@/services/headless-game-client';

type Args = { command?: string; campaign?: string; template?: string; fresh: boolean; json: boolean; auto: boolean; turns: number; transcript?: string };

function parseArgs(argv: string[]): Args {
  const args: Args = { fresh: false, json: false, auto: false, turns: 20 };
  const [command, subcommand, ...rest] = argv;
  args.command = command === 'sessions' ? `${command} ${subcommand || ''}`.trim() : command;
  const flags = command === 'sessions' ? rest : [subcommand, ...rest].filter(Boolean);
  for (let i = 0; i < flags.length; i += 1) {
    const flag = flags[i];
    if (flag === '--campaign') args.campaign = flags[++i];
    else if (flag === '--template') args.template = flags[++i];
    else if (flag === '--new') args.fresh = true;
    else if (flag === '--json') args.json = true;
    else if (flag === '--auto') args.auto = true;
    else if (flag === '--turns') args.turns = Number(flags[++i] || 20);
    else if (flag === '--transcript') args.transcript = flags[++i];
  }
  return args;
}

async function authenticate(): Promise<void> {
  config({ path: new URL('../.env.cli', import.meta.url).pathname, override: false });
  const baseUrl = process.env.CLI_API_URL || process.env.VITE_API_URL || 'http://localhost:8888';
  process.env.VITE_API_URL = baseUrl;
  const email = process.env.SMOKE_EMAIL;
  const password = process.env.SMOKE_PASSWORD;
  if (!email || !password) throw new Error('SMOKE_EMAIL and SMOKE_PASSWORD are required (see cli/.env.cli.example)');
  const tokens = await loginWithPassword({ baseUrl, email, password });
  const { configureHeadlessSession } = await import('@/services/auth/TokenService');
  const { markAuthReady } = await import('@/lib/auth-gate');
  configureHeadlessSession({ access_token: tokens.accessToken, refresh_token: tokens.refreshToken });
  markAuthReady();
}

async function selectSession(args: Args): Promise<string> {
  const { userDataApi } = await import('@/services/user-data-api');
  const sessions = await userDataApi.listSessions({ status: 'active', starterOnly: Boolean(args.campaign), limit: 100 });
  const matching = sessions.filter((session) => !args.campaign || session.starter_campaign_id === args.campaign);
  const current = matching[0];
  if (!args.fresh && !args.template && current) return current.id;
  if (!current) throw new Error(`No active session for ${args.campaign || 'this account'}; create one in the browser first.`);
  const context = await userDataApi.getSessionContext(current.id);
  let characterId = context.character_id;
  if (args.template) {
    if (!args.campaign) throw new Error('--template requires --campaign');
    const templates = await userDataApi.listStarterCharacterTemplates(args.campaign);
    const template = templates.find((entry: Record<string, unknown>) => entry.template_key === args.template);
    if (!template) throw new Error(`Starter template not found: ${args.template}`);
    const { seedStarterCharacter } = await import('@/services/character/starter-character-seeding');
    const character = await seedStarterCharacter(template as never, String(context.campaign_id), userDataApi.createCharacter);
    characterId = character.id;
  }
  const created = await userDataApi.createSession({
    session_number: Number(current.session_number || 0) + 1,
    status: 'active', campaign_id: context.campaign_id, character_id: characterId,
    turn_count: 0, current_scene_description: 'The adventure begins...', session_notes: '',
    starter_campaign_id: args.campaign || context.starter_campaign_id || null,
  });
  return String(created.id);
}

function printEvent(event: HeadlessEvent, json: boolean, write: (line: string) => void): void {
  if (json) return write(JSON.stringify(event));
  if (event.type === 'narration') write(`\n${event.text}\n`);
  else if (event.type === 'options') event.options.forEach((option: string, i: number) => write(`${i + 1}. ${option}`));
  else if (event.type === 'roll_request') event.requests.forEach((request, i: number) => write(`Roll ${i + 1}: ${request.formula} — ${request.purpose}`));
  else if (event.type === 'roll_result') write(`Rolled ${event.result.expression}: ${event.result.total}`);
  else if (event.type === 'map_state') write(`${event.ascii}\nTACTICAL DIGEST\n${event.digest}`);
  else write(`Error: ${event.message}`);
}

async function runPlay(args: Args): Promise<void> {
  const sessionId = await selectSession(args);
  const { HeadlessGameClient } = await import('@/services/headless-game-client');
  const client = new HeadlessGameClient(sessionId);
  await client.load();
  const lines: string[] = [];
  const write = (line: string) => { lines.push(line); console.log(line); };
  let completed = 0;
  let rolls = 0;
  let violations = 0;
  const run = async (message: string, roll?: ReturnType<typeof client.roll>) => {
    try {
      const events = await client.play(message, roll);
      events.forEach((event) => printEvent(event, args.json, write));
      if (roll) { rolls += 1; printEvent({ type: 'roll_result', request: roll.request, result: roll.result }, args.json, write); }
      completed += 1;
    } catch (error) { violations += 1; printEvent({ type: 'error', message: error instanceof Error ? error.message : String(error) }, args.json, write); }
  };
  if (args.auto) {
    const summary = await runAutoTurns({
      get pendingRolls() { return client.pendingRolls; },
      roll: () => client.roll(),
      play: async (message, roll) => run(message, roll as ReturnType<typeof client.roll>),
    }, args.turns, (error) => printEvent({ type: 'error', message: String(error) }, args.json, write));
    write(JSON.stringify({ type: 'summary', turnsCompleted: summary.turnsCompleted, rollsMade: summary.rollsMade, contractViolations: summary.contractViolations + violations }));
  } else {
    const readline = createInterface({ input, output });
    for await (const line of readline) {
      if (line === 'quit' || line === 'exit') break;
      const move = /^move\s+(\S+)\s+(\d+)\s+(\d+)$/i.exec(line);
      if (move) { try { write(JSON.stringify(await client.move(move[1], Number(move[2]), Number(move[3])), null, 2)); } catch (error) { printEvent({ type: 'error', message: String(error) }, args.json, write); } continue; }
      if (line === 'roll') { const roll = client.roll(); await run(`I rolled ${roll.result.total}.`, roll); continue; }
      await run(line);
    }
    readline.close();
  }
  if (args.transcript) await Bun.write(args.transcript, `${lines.join('\n')}\n`);
}

const args = parseArgs(process.argv.slice(2));
try {
  await authenticate();
  if (args.command === 'sessions list') {
    const { userDataApi } = await import('@/services/user-data-api');
    console.table(await userDataApi.listSessions({ status: 'active' }));
  }
  else if (args.command === 'play') await runPlay(args);
  else throw new Error('Usage: ir play --campaign the-eternal-feast [--new] [--json] [--auto --turns 20] | ir sessions list');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
