import { describe, expect, it } from 'bun:test';

import { CostLedger } from './cost-ledger';
import { DecisionsClient, DecisionsHttpError, parseDecisionsResponse } from './decisions-client';
import { DECISIONS_URL, JEV_MODEL } from './decisions-types';
import { RequestShapeError } from './validate-request';

import type { FetchLike } from './decisions-client';

const recorded = {
  id: 'gen-dec-test',
  model: 'typesafe/jev-1.13-20260917',
  provider: 'TypeSafe',
  answers: {
    unresolved_action: { type: 'noul', noul: 0.91 },
    team: {
      type: 'choice',
      choice: 'billing',
      confidence: 0.8,
      probabilities: { billing: 0.8, other: 0.2 },
    },
    frustration: {
      type: 'score',
      score: 1.4,
      confidence: 0.7,
      legend: { '0': 'low', '1': 'mid', '2': 'high' },
      probabilities: { '0': 0.1, '1': 0.4, '2': 0.5 },
    },
  },
  usage: { input_tokens: 120, output_tokens: 30, cost: 0.000005 },
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('Decisions API client', () => {
  it('parses a recorded noul, choice, and score response', () => {
    const parsed = parseDecisionsResponse(recorded);
    expect(parsed.answers.unresolved_action).toEqual({ type: 'noul', noul: 0.91 });
    expect(parsed.answers.team).toMatchObject({ type: 'choice', choice: 'billing' });
    expect(parsed.answers.frustration).toMatchObject({ type: 'score', score: 1.4 });
    expect(parsed.usage.input_tokens).toBe(120);
  });

  it('posts to the decisions endpoint with the Jev model, never chat completions', async () => {
    let url = '';
    let body = '';
    const fetchImpl: FetchLike = async (input, init) => {
      url = input;
      body = String(init.body);
      return jsonResponse(200, recorded);
    };
    const client = new DecisionsClient({
      apiKey: 'test-key-not-real',
      ledger: new CostLedger(),
      fetchImpl,
    });
    await client.decide({
      state: 'a narration',
      questions: {
        unresolved_action: {
          type: 'noul',
          instructions: 'Did it invent an action?',
          criteria: { true: 'yes', false: 'no' },
        },
      },
    });
    expect(url).toBe(DECISIONS_URL);
    expect(url.includes('/chat/completions')).toBe(false);
    const sent = JSON.parse(body) as { model: string };
    expect(sent.model).toBe(JEV_MODEL);
  });

  it('does not retry a 400, and redacts the key if a body echoes it', async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return jsonResponse(400, { error: { message: 'bad test-key-not-real' } });
    };
    const client = new DecisionsClient({
      apiKey: 'test-key-not-real',
      ledger: new CostLedger(),
      fetchImpl,
    });
    await expect(
      client.decide({
        state: 'x',
        questions: { q: { type: 'noul', instructions: 'yes?' } },
      }),
    ).rejects.toThrow(/\[REDACTED\]/);
    expect(calls).toBe(1);
  });

  it('retries a 429 and then records usage', async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse(429, { error: { message: 'slow down' } });
      }
      return jsonResponse(200, recorded);
    };
    const ledger = new CostLedger();
    const client = new DecisionsClient({
      apiKey: 'test-key-not-real',
      ledger,
      fetchImpl,
      sleep: async () => {},
    });
    const result = await client.decide({
      state: 'x',
      questions: { q: { type: 'noul', instructions: 'yes?' } },
    });
    expect(calls).toBe(2);
    expect(result.usage.input_tokens).toBe(120);
    // The failed attempt keeps its reservation. The success replaces only its own.
    expect(ledger.inputTokens).toBeGreaterThan(120);
    expect(ledger.requests).toBe(1);
  });

  it('rejects a score question with object criteria before any request', async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return jsonResponse(200, recorded);
    };
    const client = new DecisionsClient({
      apiKey: 'test-key-not-real',
      ledger: new CostLedger(),
      fetchImpl,
    });
    await expect(
      client.decide({
        state: 'x',
        questions: {
          q: {
            type: 'score',
            instructions: 'how much?',
            criteria: { low: 'a', high: 'b' } as unknown as string[],
          },
        },
      }),
    ).rejects.toBeInstanceOf(RequestShapeError);
    expect(calls).toBe(0);
  });

  it('stops before a call that would pass the token cap', async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return jsonResponse(200, recorded);
    };
    const client = new DecisionsClient({
      apiKey: 'test-key-not-real',
      ledger: new CostLedger(10),
      fetchImpl,
    });
    await expect(
      client.decide({
        state: 'this state is long enough that the estimate exceeds ten tokens easily',
        questions: { q: { type: 'noul', instructions: 'yes or no?' } },
      }),
    ).rejects.toThrow(/cap/);
    expect(calls).toBe(0);
  });

  it('throws a non-retryable error when the answer type is missing', () => {
    expect(() =>
      parseDecisionsResponse({
        model: 'm',
        answers: { q: { type: 'noul' } },
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    ).toThrow(DecisionsHttpError);
  });
});
