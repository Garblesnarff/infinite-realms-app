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
import { estimateRequests, scoreRerankBaselines } from './run-experiments';
import { runLive } from './run-live';

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

export type LiveDeps = {
  ledger: CostLedger;
  client: DecisionsClient;
};

export async function main(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
  deps?: LiveDeps,
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
  const apiKey = deps ? 'injected' : readApiKey(env);
  if (!apiKey) {
    printLine('OPENROUTER_API_KEY is not set. No live request was sent.');
    return 2;
  }
  const ledger = deps?.ledger ?? new CostLedger();
  const client = deps?.client ?? new DecisionsClient({ apiKey, ledger });
  const batches = (['A', 'B', 'C'] as const).filter((name) => wants(options, name));
  return runLive({
    narration,
    rerank,
    importance,
    batches,
    estimate,
    outDir: options.outDir,
    checker: batches.includes('A') ? await loadRegexChecker(options.appRoot) : null,
    ledger,
    client,
    printLine,
  });
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
