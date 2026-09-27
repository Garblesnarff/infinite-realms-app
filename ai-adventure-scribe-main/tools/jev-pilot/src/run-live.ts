import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { agreement } from './metrics';
import { chunkImportance, importanceRequest, narrationRequest, rerankRequest } from './requests';
import {
  ExperimentCapStop,
  estimateRequests,
  runImportance,
  runNarration,
  runRerank,
} from './run-experiments';

import type { CostLedger } from './cost-ledger';
import type { DecisionsClient } from './decisions-client';
import type { ImportanceFixture, NarrationFixture, RerankFixture } from './fixtures';
import type { NarrationChecker } from './regex-checker';

type BatchName = 'A' | 'B' | 'C';

function renderMarkdown(output: Record<string, unknown>): string {
  return ['# Jev pilot results', '', '```json', JSON.stringify(output, null, 2), '```', ''].join(
    '\n',
  );
}

export async function runLive(input: {
  narration: NarrationFixture[];
  rerank: RerankFixture[];
  importance: ImportanceFixture[];
  batches: BatchName[];
  estimate: number;
  outDir: string;
  checker: NarrationChecker | null;
  ledger: CostLedger;
  client: DecisionsClient;
  printLine: (line: string) => void;
}): Promise<number> {
  const output: Record<string, unknown> = {};
  const estimates: Record<BatchName, number> = {
    A: estimateRequests(input.narration.map((row) => narrationRequest(row))),
    B: estimateRequests(input.rerank.map((row) => rerankRequest(row))),
    C: estimateRequests(
      chunkImportance(input.importance, 20).map((chunk) => importanceRequest(chunk)),
    ),
  };
  let capHit = false;
  for (const name of input.batches) {
    const before = input.ledger.inputTokens;
    try {
      if (name === 'A') {
        output.narration = await runNarration(input.client, input.narration, input.checker);
      } else if (name === 'B') {
        output.rerank = await runRerank(input.client, input.rerank);
      } else {
        const rows = await runImportance(input.client, input.importance);
        output.importance = {
          rows,
          jev_hand_agreement: agreement(rows, 'jev'),
          baseline_hand_agreement: agreement(rows, 'baseline'),
        };
      }
    } catch (error) {
      if (!(error instanceof ExperimentCapStop)) {
        throw error;
      }
      output[name === 'A' ? 'narration' : name === 'B' ? 'rerank' : 'importance'] = error.partial;
      capHit = true;
    }
    const used = input.ledger.inputTokens - before;
    input.printLine(`experiment ${name} estimate=${estimates[name]} usage.input_tokens=${used}`);
  }
  output.usage = {
    input_tokens: input.ledger.inputTokens,
    output_tokens: input.ledger.outputTokens,
    cost_usd: input.ledger.costUsd,
    requests: input.ledger.requests,
    estimate: input.estimate,
  };
  mkdirSync(input.outDir, { recursive: true });
  writeFileSync(path.join(input.outDir, 'results.json'), `${JSON.stringify(output, null, 2)}\n`);
  writeFileSync(path.join(input.outDir, 'results.md'), renderMarkdown(output));
  input.printLine(
    `live estimate=${input.estimate} usage.input_tokens=${input.ledger.inputTokens} output_tokens=${input.ledger.outputTokens} cost_usd=${input.ledger.costUsd.toFixed(6)} requests=${input.ledger.requests}`,
  );
  input.printLine(`wrote ${input.outDir}`);
  if (capHit) {
    input.printLine('Stopped: the input-token cap tripped. Partial results were written.');
    return 1;
  }
  return 0;
}
