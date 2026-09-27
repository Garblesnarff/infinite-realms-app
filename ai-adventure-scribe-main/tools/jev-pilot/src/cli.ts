import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { CostLedger } from './cost-ledger';
import { DecisionsClient, readApiKey } from './decisions-client';
import { INPUT_TOKEN_CAP } from './decisions-types';
import {
  fixtureDir,
  loadImportanceFixtures,
  loadNarrationFixtures,
  loadPool,
  loadRerankFixtures,
} from './fixtures';
import { agreement, compareImportance } from './metrics';
import { loadRegexChecker } from './regex-checker';
import { chunkImportance, importanceRequest, narrationRequest, rerankRequest } from './requests';
import {
  estimateRequests,
  runImportance,
  runNarration,
  runRerank,
  scoreRerankBaselines,
} from './run-experiments';

import type { ImportanceComparison } from './metrics';

type ExperimentName = 'A' | 'B' | 'C' | 'all';

export type CliOptions = {
  experiment: ExperimentName;
  dryRun: boolean;
  outDir: string;
  appRoot: string;
};

export function parseArgs(argv: string[]): CliOptions {
  let experiment: ExperimentName = 'all';
  let dryRun = false;
  let outDir = path.join(import.meta.dir, '..', 'out');
  let appRoot = path.join(import.meta.dir, '..', '..', '..');
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--experiment') {
      const value = argv[index + 1];
      if (value !== 'A' && value !== 'B' && value !== 'C' && value !== 'all') {
        throw new Error('--experiment must be A, B, C, or all');
      }
      experiment = value;
      index += 1;
    } else if (arg === '--out') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--out needs a directory');
      }
      outDir = value;
      index += 1;
    } else if (arg === '--app-root') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--app-root needs a directory');
      }
      appRoot = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument ${arg}`);
    }
  }
  return { experiment, dryRun, outDir, appRoot };
}

function printLine(line: string): void {
  process.stdout.write(`${line}\n`);
}

function wants(options: CliOptions, name: 'A' | 'B' | 'C'): boolean {
  return options.experiment === 'all' || options.experiment === name;
}

function formatRate(rate: number | null): string {
  if (rate === null) {
    return 'n/a';
  }
  return rate.toFixed(3);
}

function renderMarkdown(output: Record<string, unknown>): string {
  const lines = ['# Jev pilot results', ''];
  const usage = output.usage;
  if (usage && typeof usage === 'object') {
    lines.push('## Usage', '', '```json', JSON.stringify(usage, null, 2), '```', '');
  }
  lines.push('## Payload', '', '```json', JSON.stringify(output, null, 2), '```', '');
  return lines.join('\n');
}

export async function main(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
): Promise<number> {
  const options = parseArgs(argv);
  const dir = fixtureDir();
  const narration = loadNarrationFixtures(path.join(dir, 'narration.jsonl'));
  const pool = loadPool(path.join(dir, 'memory-pool.jsonl'));
  const rerank = loadRerankFixtures(path.join(dir, 'memory-rerank.jsonl'), pool);
  const importance = loadImportanceFixtures(path.join(dir, 'importance.jsonl'));
  const bodies: unknown[] = [];
  if (wants(options, 'A')) {
    for (const row of narration) {
      bodies.push(narrationRequest(row));
    }
  }
  if (wants(options, 'B')) {
    for (const row of rerank) {
      bodies.push(rerankRequest(row));
    }
  }
  if (wants(options, 'C')) {
    for (const chunk of chunkImportance(importance, 20)) {
      bodies.push(importanceRequest(chunk));
    }
  }
  const estimate = estimateRequests(bodies);
  printLine(
    `estimate input_tokens=${estimate} cap=${INPUT_TOKEN_CAP} requests=${bodies.length} under_cap=${estimate <= INPUT_TOKEN_CAP}`,
  );
  if (estimate > INPUT_TOKEN_CAP) {
    printLine('Refusing to run: the estimate is over the 2000000 input-token cap.');
    return 1;
  }
  const baselineOnly: ImportanceComparison[] = importance.map((row) =>
    compareImportance(row, null, undefined),
  );
  const rerankBaselines = scoreRerankBaselines(rerank);
  printLine(
    `fixture narration=${narration.length} rerank=${rerank.length} importance=${importance.length} baseline_hand_agreement=${formatRate(agreement(baselineOnly, 'baseline'))}`,
  );
  printLine(
    `rerank importance_recall=${formatRate(rerankBaselines.importanceRecall)} similarity_recall=${formatRate(rerankBaselines.similarityRecall)} similarity_rows=${rerankBaselines.similarityRows}/${rerank.length}`,
  );
  if (options.dryRun) {
    printLine('dry-run: no request was sent.');
    return 0;
  }
  const apiKey = readApiKey(env);
  if (!apiKey) {
    printLine('OPENROUTER_API_KEY is not set. No live request was sent.');
    return 2;
  }
  const ledger = new CostLedger();
  const client = new DecisionsClient({ apiKey, ledger });
  mkdirSync(options.outDir, { recursive: true });
  const checker = wants(options, 'A') ? await loadRegexChecker(options.appRoot) : null;
  const output: Record<string, unknown> = {};
  if (wants(options, 'A')) {
    output.narration = await runNarration(client, narration, checker);
  }
  if (wants(options, 'B')) {
    output.rerank = await runRerank(client, rerank);
  }
  if (wants(options, 'C')) {
    const rows = await runImportance(client, importance);
    output.importance = {
      rows,
      jev_hand_agreement: agreement(rows, 'jev'),
      baseline_hand_agreement: agreement(rows, 'baseline'),
    };
  }
  output.usage = {
    input_tokens: ledger.inputTokens,
    output_tokens: ledger.outputTokens,
    cost_usd: ledger.costUsd,
    requests: ledger.requests,
  };
  writeFileSync(path.join(options.outDir, 'results.json'), `${JSON.stringify(output, null, 2)}\n`);
  writeFileSync(path.join(options.outDir, 'results.md'), renderMarkdown(output));
  printLine(
    `live input_tokens=${ledger.inputTokens} output_tokens=${ledger.outputTokens} cost_usd=${ledger.costUsd.toFixed(6)} requests=${ledger.requests}`,
  );
  printLine(`wrote ${options.outDir}`);
  return 0;
}

if (import.meta.main) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'pilot failed';
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
}
