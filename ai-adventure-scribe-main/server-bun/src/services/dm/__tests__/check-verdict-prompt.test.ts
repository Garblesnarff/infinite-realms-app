import { describe, expect, it } from 'bun:test';

import { reconcileCheckVerdict } from '../check-verdict-prompt';

const CLIENT = 'Athletics check: 9 (nat 4+5) success';
const row = (message: string, verdict: 'SUCCESS' | 'FAIL') => ({ message, verdict });

describe('#1477 reconcileCheckVerdict', () => {
  it('rewrites a client SUCCESS to the server FAIL in the history and the prompt', () => {
    const result = reconcileCheckVerdict({
      history: [{ role: 'user', content: CLIENT }],
      prompt: `scene\n<player_input>${CLIENT}</player_input>`,
      rows: [row('Athletics check: 9 (nat 4+5) fail', 'FAIL')],
    });
    expect(result.status).toBe('disagree');
    expect(result.history?.[0]?.content).toBe('Athletics check: 9 (nat 4+5) fail');
    expect(result.prompt).toBe(
      'scene\n<player_input>Athletics check: 9 (nat 4+5) fail</player_input>',
    );
  });

  it('reports agree and changes nothing when the words match', () => {
    const result = reconcileCheckVerdict({
      history: [{ role: 'user', content: CLIENT }],
      prompt: CLIENT,
      rows: [row(CLIENT, 'SUCCESS')],
    });
    expect(result.status).toBe('agree');
    expect(result.history?.[0]?.content).toBe(CLIENT);
  });

  it('ignores a row whose total differs from the client line', () => {
    const result = reconcileCheckVerdict({
      history: [{ role: 'user', content: CLIENT }],
      prompt: CLIENT,
      rows: [row('Athletics check: 17 (nat 12+5) success', 'SUCCESS')],
    });
    expect(result.status).toBe('no_server_row');
    expect(result.prompt).toBe(CLIENT);
  });

  it('leaves the prompt alone when the client line is not exactly once in it', () => {
    const result = reconcileCheckVerdict({
      history: [{ role: 'user', content: CLIENT }],
      prompt: `${CLIENT}\n${CLIENT}`,
      rows: [row('Athletics check: 9 (nat 4+5) fail', 'FAIL')],
    });
    expect(result.status).toBe('disagree');
    expect(result.history?.[0]?.content).toBe('Athletics check: 9 (nat 4+5) fail');
    expect(result.prompt).toBe(`${CLIENT}\n${CLIENT}`);
  });

  it('reports no_client_line for a history with no check line', () => {
    const result = reconcileCheckVerdict({
      history: [{ role: 'user', content: 'I climb the wall.' }],
      prompt: 'x',
      rows: [row('Athletics check: 9 (nat 4+5) fail', 'FAIL')],
    });
    expect(result.status).toBe('no_client_line');
  });
});
