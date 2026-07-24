#!/usr/bin/env bun
import { config } from 'dotenv';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { loginWithPassword } from '../../shared/auth/headless-auth';
import { runAutoTurns } from './auto';
import { selectPlaySession, templateListRows, type StarterTemplate } from './play-session';

import type { HeadlessEvent } from '@/services/headless-game-client';

type Args = { command?: string; campaign?: string; template?: string; character?: string; fresh: boolean; json: boolean; auto: boolean; turns: number; delay: number; transcript?: string };

function parseArgs(argv: string[]): Args {
  const args: Args = { fresh: false, json: false, auto: false, turns: 20, delay: 2_000 };
  const [command, subcommand, ...rest] = argv;
  args.command = command === 'sessions' || command === 'templates'
    ? `${command} ${subcommand || ''}`.trim()
    : command;
  const flags = command === 'sessions' || command === 'templates' ? rest : [subcommand, ...rest].filter(Boolean);
  for (let i = 0; i < flags.length; i += 1) {
    const flag = flags[i];
    if (flag === '--campaign') args.campaign = flags[++i];
    else if (flag === '--template') args.template = flags[++i];
    else if (flag === '--character') args.character = flags[++i];
    else if (flag === '--new') args.fresh = true;
    else if (flag === '--json') args.json = true;
    else if (flag === '--auto') args.auto = true;
    else if (flag === '--turns') args.turns = Number(flags[++i] || 20);
    else if (flag === '--delay') args.delay = Number(flags[++i] || 2_000);
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

async function getStarterCampaign(slug: string) {
  const { supabase } = await import('@/integrations/supabase/client');
  const { data, error } = await supabase
    .from('starter_campaigns')
    .select('id, title, premise, genre, tone, difficulty, cover_image_url')
    .eq('slug', slug)
    .eq('is_published', true)
    .eq('is_complete', true)
    .single();
  if (error?.code === 'PGRST116') return null;
  if (error) throw new Error(`Failed to load starter campaign ${slug}: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id,
    title: data.title,
    premise: data.premise,
    genre: data.genre || [],
    tone: data.tone || [],
    difficulty: data.difficulty,
    coverImageUrl: data.cover_image_url,
  };
}

async function chooseStarterTemplate(args: Args, templates: StarterTemplate[]): Promise<StarterTemplate> {
  if (args.auto) {
    const template = templates[Math.floor(Math.random() * templates.length)];
    console.log(`Auto-selected starter template ${template.template_key} (${template.name}, ${template.class}).`);
    return template;
  }
  console.table(templates.map((template) => ({ key: template.template_key, name: template.name, class: template.class })));
  const readline = createInterface({ input, output });
  try {
    const key = (await readline.question('Starter template key: ')).trim();
    const template = templates.find((entry) => entry.template_key === key);
    if (!template) throw new Error(`Starter template not found: ${key}`);
    return template;
  } finally {
    readline.close();
  }
}

async function selectSession(args: Args): Promise<string> {
  const { userDataApi } = await import('@/services/user-data-api');
  return selectPlaySession(args, userDataApi, {
    getStarterCampaign,
    chooseTemplate: (templates) => chooseStarterTemplate(args, templates),
    log: (message) => console.log(message),
  });
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
      const narration = events.find((event) => event.type === 'narration');
      return narration && narration.type === 'narration'
        ? { provider: narration.provider, model: narration.model }
        : {};
    } catch (error) { violations += 1; printEvent({ type: 'error', message: error instanceof Error ? error.message : String(error) }, args.json, write); }
  };
  if (args.auto) {
    const summary = await runAutoTurns({
      get pendingRolls() { return client.pendingRolls; },
      roll: () => client.roll(),
      play: async (message, roll) => run(message, roll as ReturnType<typeof client.roll>),
    }, args.turns, (error) => printEvent({ type: 'error', message: String(error) }, args.json, write), { delayMs: args.delay });
    write(JSON.stringify({ type: 'summary', turnsCompleted: summary.turnsCompleted, rollsMade: summary.rollsMade, contractViolations: summary.contractViolations + violations, providerCounts: summary.providerCounts, providerModelCounts: summary.providerModelCounts }));
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
  else if (args.command === 'templates list') {
    if (!args.campaign) throw new Error('Usage: ir templates list --campaign <slug>');
    const { userDataApi } = await import('@/services/user-data-api');
    const templates = await userDataApi.listStarterCharacterTemplates(args.campaign);
    console.table(templateListRows(templates));
  }
  else if (args.command === 'play') await runPlay(args);
  else throw new Error('Usage: ir templates list --campaign the-eternal-feast | ir play --campaign the-eternal-feast [--new] [--template <key>] [--character <id|template-key>] [--json] [--auto --turns 20 --delay 2000] | ir sessions list');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
