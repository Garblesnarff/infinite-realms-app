import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'bun:test';

import { main } from './cli';
import { CostCapError, CostLedger } from './cost-ledger';
import { JEV_MODEL } from './decisions-types';
import { NARRATION_QUESTION_IDS } from './questions';

describe('cost cap', () => {
  it('writes partial results when the cap trips, and prints the estimate beside usage', async () => {
    const ledger = new CostLedger();
    let calls = 0;
    const client = {
      decide: async () => {
        calls += 1;
        if (calls > 1) {
          throw new CostCapError(80, 40, 100);
        }
        ledger.inputTokens += 80;
        ledger.outputTokens += 4;
        ledger.requests += 1;
        return {
          model: JEV_MODEL,
          answers: Object.fromEntries(
            NARRATION_QUESTION_IDS.map((id) => [id, { type: 'noul', noul: 0.1 }]),
          ),
          usage: { input_tokens: 80, output_tokens: 4 },
        };
      },
    };
    const outDir = mkdtempSync(path.join(tmpdir(), 'jev-cap-'));
    const lines: string[] = [];
    const original = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    let code = 0;
    try {
      code = await main(
        ['--experiment', 'A', '--out', outDir],
        {},
        { ledger, client: client as never },
      );
    } finally {
      process.stdout.write = original;
    }
    expect(code).toBe(1);
    const text = lines.join('');
    expect(text.includes('experiment A estimate=')).toBe(true);
    expect(text.includes('usage.input_tokens=80')).toBe(true);
    const written = await Bun.file(path.join(outDir, 'results.json')).json();
    expect(written.narration.stopped).toBe('cost_cap');
    expect(written.usage.input_tokens).toBe(80);
  });
});
