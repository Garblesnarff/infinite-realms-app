#!/usr/bin/env bun
/* eslint-disable max-lines -- single CLI entrypoint: arg parsing, prompts, and rendering. */
import { readFileSync } from 'node:fs';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';

import { config } from 'dotenv';

import { runAutoTurns, type AutoTurnSummary, type Persona } from './auto';
import { applyCliEnvironment } from './env';
import { failVerdict, type FailError } from './fail-rules';
import { selectPlaySession, templateListRows, type StarterTemplate } from './play-session';
import { installRequestIdCapture } from './request-id';
import { parseScript } from './script';
import { createTranscriptWriter } from './transcript';
import { loginWithPassword, loginWithTestAuth } from '../../shared/auth/headless-auth';

import type { CompletedHeadlessRoll, HeadlessEvent } from '@/services/headless-game-client';

import { mulberry32, setRngSeed } from '@/utils/rng';

type Args = {
  command?: string;
  campaign?: string;
  template?: string;
  character?: string;
  fresh: boolean;
  json: boolean;
  auto: boolean;
  testAuth: boolean;
  turns: number;
  delay: number;
  transcript?: string;
  persona?: Persona;
  seed?: number;
  script?: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    fresh: false,
    json: false,
    auto: false,
    testAuth: false,
    turns: 20,
    delay: 2_000,
  };
  const [command, subcommand, ...rest] = argv;
  args.command =
    command === 'sessions' || command === 'templates'
      ? `${command} ${subcommand || ''}`.trim()
      : command;
  const flags =
    command === 'sessions' || command === 'templates'
      ? rest
      : [subcommand, ...rest].filter(Boolean);
  for (let i = 0; i < flags.length; i += 1) {
    const flag = flags[i];
    if (flag === '--campaign') args.campaign = flags[++i];
    else if (flag === '--template') args.template = flags[++i];
    else if (flag === '--character') args.character = flags[++i];
    else if (flag === '--new') args.fresh = true;
    else if (flag === '--json') args.json = true;
    else if (flag === '--auto') args.auto = true;
    else if (flag === '--test-auth') args.testAuth = true;
    else if (flag === '--turns') args.turns = Number(flags[++i] || 20);
    else if (flag === '--delay') args.delay = Number(flags[++i] || 2_000);
    else if (flag === '--transcript') args.transcript = flags[++i];
    else if (flag === '--script') args.script = flags[++i];
    else if (flag === '--seed') {
      const seed = Number(flags[++i]);
      if (!Number.isInteger(seed)) throw new Error('--seed must be an integer');
      args.seed = seed;
    } else if (flag === '--persona') {
      const persona = flags[++i];
      if (!['careful', 'aggressive', 'chaotic'].includes(persona)) {
        throw new Error('--persona must be careful, aggressive, or chaotic');
      }
      args.persona = persona as Persona;
    }
  }
  return args;
}

/**
 * Build a random source for a run. With `--seed` it seeds the shared dice RNG
 * (and the dice engine) and returns the same reproducible stream. The server's
 * dice are seeded separately by its `DICE_SEED` env.
 */
function seedRandom(seed: number | undefined): () => number {
  if (seed === undefined) return Math.random;
  setRngSeed(seed);
  return mulberry32(seed);
}

async function authenticate(testAuth: boolean): Promise<void> {
  config({ path: new URL('../.env.cli', import.meta.url).pathname, override: false });
  const { apiUrl: baseUrl, supabaseUrl, supabaseAnonKey } = applyCliEnvironment();
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'CLI_SUPABASE_URL and CLI_SUPABASE_ANON_KEY are required (see cli/.env.cli.example)',
    );
  }
  let tokens;
  if (testAuth) {
    const secret = process.env.TEST_AUTH_SECRET;
    if (!secret) throw new Error('TEST_AUTH_SECRET is required for --test-auth');
    tokens = await loginWithTestAuth({ baseUrl, secret });
  } else {
    const email = process.env.SMOKE_EMAIL;
    const password = process.env.SMOKE_PASSWORD;
    if (!email || !password)
      throw new Error('SMOKE_EMAIL and SMOKE_PASSWORD are required (see cli/.env.cli.example)');
    tokens = await loginWithPassword({ baseUrl, email, password });
  }
  const { configureHeadlessSession } = await import('@/services/auth/TokenService');
  const { markAuthReady } = await import('@/lib/auth-gate');
  configureHeadlessSession({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
  });
  markAuthReady();
}

async function getStarterCampaign(slug: string) {
  const { supabase } = await import('@/integrations/supabase/client');
  const { data, error } = await supabase
    .from('starter_campaigns')
    .select('id, title, premise, genre, tone, difficulty, cover_image_url, estimated_sessions, overview')
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
    genre: Array.isArray(data.genre)
      ? data.genre.filter((value): value is string => typeof value === 'string')
      : [],
    tone: Array.isArray(data.tone)
      ? data.tone.filter((value): value is string => typeof value === 'string')
      : [],
    difficulty: data.difficulty,
    coverImageUrl: data.cover_image_url,
    estimatedSessions: data.estimated_sessions,
    overview: data.overview,
  };
}

async function chooseStarterTemplate(
  args: Args,
  templates: StarterTemplate[],
  random: () => number,
): Promise<StarterTemplate> {
  if (args.auto) {
    const template = templates[Math.floor(random() * templates.length)];
    console.log(
      `Auto-selected starter template ${template.template_key} (${template.name}, ${template.class}).`,
    );
    return template;
  }
  console.table(
    templates.map((template) => ({
      key: template.template_key,
      name: template.name,
      class: template.class,
    })),
  );
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

async function selectSession(args: Args, random: () => number): Promise<string> {
  const { userDataApi } = await import('@/services/user-data-api');
  return selectPlaySession(args, userDataApi, {
    getStarterCampaign,
    chooseTemplate: (templates) => chooseStarterTemplate(args, templates, random),
    log: (message) => console.log(message),
  });
}

/**
 * A failed combat entry must leave a full record in the transcript: the DM envelope that
 * produced it and the server's response body. Without those, a broken run reads as a bare
 * "Error: ... 500" with nothing to diagnose.
 */
function errorDetail(error: unknown): Record<string, unknown> | null {
  const candidate = error as { toTranscriptDetail?: () => Record<string, unknown> };
  return typeof candidate?.toTranscriptDetail === 'function'
    ? candidate.toTranscriptDetail()
    : null;
}

function printError(error: unknown, json: boolean, write: (line: string) => void): void {
  printEvent({ type: 'error', message: String(error) }, json, write);
  const detail = errorDetail(error);
  if (detail) write(JSON.stringify(detail));
}

function printEvent(event: HeadlessEvent, json: boolean, write: (line: string) => void): void {
  if (json) return write(JSON.stringify(event));
  if (event.type === 'narration') write(`\n${event.text}\n`);
  else if (event.type === 'options')
    event.options.forEach((option: string, i: number) => write(`${i + 1}. ${option}`));
  else if (event.type === 'roll_request')
    event.requests.forEach((request, i: number) =>
      write(`Roll ${i + 1}: ${request.formula} — ${request.purpose}`),
    );
  else if (event.type === 'roll_result')
    write(`Rolled ${event.result.expression}: ${event.result.total}`);
  else if (event.type === 'map_state') {
    const order = event.initiative
      .map((entry) => `${entry.isCurrent ? '▶ ' : ''}${entry.name} ${entry.initiative}`)
      .join(' | ');
    write(
      `${event.ascii}\nTACTICAL DIGEST\n${event.digest}${order ? `\nINITIATIVE\n${order}` : ''}`,
    );
  } else write(`Error: ${event.message}`);
}

async function runPlay(args: Args): Promise<void> {
  const transcript = args.transcript ? createTranscriptWriter(args.transcript) : undefined;
  const write = (line: string) => {
    console.log(line);
    transcript?.write(line);
  };
  const errors: FailError[] = [];
  const recordError = (error: unknown): void => {
    const candidate = error as { status?: unknown; message?: unknown };
    const message =
      error instanceof Error
        ? error.message
        : typeof candidate?.message === 'string'
          ? candidate.message
          : String(error);
    errors.push(
      typeof candidate?.status === 'number' ? { status: candidate.status, message } : { message },
    );
  };
  const onError = (error: unknown): void => {
    recordError(error);
    printError(error, args.json, write);
  };
  if (transcript) installRequestIdCapture();
  const scriptedInputs = args.script ? parseScript(readFileSync(args.script, 'utf8')) : undefined;
  const random = seedRandom(args.seed);
  const sessionId = await selectSession(args, random);
  const { HeadlessGameClient } = await import('@/services/headless-game-client');
  const client = new HeadlessGameClient(sessionId);
  await client.load();
  const run = async (message: string, rolls?: readonly CompletedHeadlessRoll[]) => {
    const events = await client.play(message, rolls);
    events.forEach((event) => printEvent(event, args.json, write));
    rolls?.forEach((roll) =>
      printEvent(
        { type: 'roll_result', request: roll.request, result: roll.result },
        args.json,
        write,
      ),
    );
    const narration = events.find((event) => event.type === 'narration');
    return narration && narration.type === 'narration'
      ? { provider: narration.provider, model: narration.model }
      : {};
  };
  const handleInput = async (line: string): Promise<boolean> => {
    if (line === 'quit' || line === 'exit') return false;
    const move = /^move\s+(\S+)\s+(\d+)\s+(\d+)$/i.exec(line);
    if (move) {
      try {
        write(
          JSON.stringify(await client.move(move[1], Number(move[2]), Number(move[3])), null, 2),
        );
      } catch (error) {
        onError(error);
      }
      return true;
    }
    if (line === 'roll') {
      const roll = client.roll();
      if (roll.skipped) {
        recordError(roll.error);
        printEvent({ type: 'error', message: roll.error.message }, args.json, write);
        try {
          await run('I attempt it.');
        } catch (error) {
          onError(error);
        }
        return true;
      }
      try {
        await run(`I rolled ${roll.result.total}.`, [roll]);
      } catch (error) {
        onError(error);
      }
      return true;
    }
    try {
      await run(line);
    } catch (error) {
      onError(error);
    }
    return true;
  };

  let summary: AutoTurnSummary | undefined;
  if (args.auto) {
    summary = await runAutoTurns(
      {
        get pendingRolls() {
          return client.pendingRolls;
        },
        get availableOptions() {
          return client.availableOptions;
        },
        roll: () => client.roll(),
        play: async (message, rolls) =>
          run(message, rolls as readonly CompletedHeadlessRoll[] | undefined),
      },
      args.turns,
      onError,
      {
        delayMs: args.delay,
        persona: args.persona,
        random,
        scriptedInputs,
      },
    );
    write(JSON.stringify({ type: 'summary', ...summary }));
    if (summary.verdict) write(`VERDICT: ${summary.verdict}`);
  } else if (scriptedInputs) {
    for (const line of scriptedInputs) {
      if (!(await handleInput(line))) break;
    }
  } else {
    const readline = createInterface({ input, output });
    for await (const line of readline) {
      if (!(await handleInput(line))) break;
    }
    readline.close();
  }

  const fail = failVerdict({ errors, ...(summary ? { summary } : {}) });
  write(fail ? `RESULT: FAIL ${fail}` : 'RESULT: PASS');
  if (fail) process.exitCode = 1;
}

const args = parseArgs(process.argv.slice(2));
try {
  await authenticate(args.testAuth);
  if (args.command === 'sessions list') {
    const { userDataApi } = await import('@/services/user-data-api');
    console.table(await userDataApi.listSessions({ status: 'active' }));
  } else if (args.command === 'templates list') {
    if (!args.campaign) throw new Error('Usage: ir templates list --campaign <slug>');
    const { userDataApi } = await import('@/services/user-data-api');
    const templates = await userDataApi.listStarterCharacterTemplates(args.campaign);
    console.table(templateListRows(templates));
  } else if (args.command === 'play') await runPlay(args);
  else
    throw new Error(
      'Usage: ir templates list --campaign the-eternal-feast | ir play --campaign the-eternal-feast [--new] [--template <key>] [--character <id|template-key>] [--json] [--auto --turns 20 --delay 2000 --persona <careful|aggressive|chaotic>] [--seed <int>] [--script <file>] [--transcript <file>] [--test-auth] | ir sessions list. The client RNG is seeded by --seed; the server rolls its own dice from DICE_SEED.',
    );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
