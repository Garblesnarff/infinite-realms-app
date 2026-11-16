import { describe, expect, it } from 'bun:test';

import { lastCheckLine, reconcileCheckVerdict } from '../check-verdict-prompt';

const CLIENT = 'Athletics check: 9 (nat 4+5) success';
const SERVER_FAIL = 'Athletics check: 9 (nat 4+5) fail';
const row = (rollRequestId: string, message: string, verdict: 'SUCCESS' | 'FAIL') => ({
  rollRequestId,
  message,
  verdict,
});

describe('#1477 reconcileCheckVerdict', () => {
  it('rewrites a client SUCCESS to the server FAIL for the same roll request', () => {
    const result = reconcileCheckVerdict({
      history: [{ role: 'user', content: CLIENT }],
      prompt: `scene\n<player_input>${CLIENT}</player_input>`,
      rollRequestId: 'r1',
      rows: [row('r1', SERVER_FAIL, 'FAIL')],
    });
    expect(result.status).toBe('disagree');
    expect(result.history?.[0]?.content).toBe(SERVER_FAIL);
    expect(result.prompt).toBe(`scene\n<player_input>${SERVER_FAIL}</player_input>`);
  });

  it('never uses a row from another roll request, even with the same label and total', () => {
    const result = reconcileCheckVerdict({
      history: [{ role: 'user', content: CLIENT }],
      prompt: CLIENT,
      rollRequestId: 'r1',
      rows: [row('r2', SERVER_FAIL, 'FAIL'), row('r3', CLIENT, 'SUCCESS')],
    });
    expect(result.status).toBe('no_row');
    expect(result.history?.[0]?.content).toBe(CLIENT);
    expect(result.prompt).toBe(CLIENT);
  });

  it('reports no_row when the request id is missing', () => {
    const result = reconcileCheckVerdict({
      history: [{ role: 'user', content: CLIENT }],
      prompt: CLIENT,
      rollRequestId: undefined,
      rows: [row('r1', SERVER_FAIL, 'FAIL')],
    });
    expect(result.status).toBe('no_row');
  });

  it('reports no_row when the row for the request has a different total', () => {
    const result = reconcileCheckVerdict({
      history: [{ role: 'user', content: CLIENT }],
      prompt: CLIENT,
      rollRequestId: 'r1',
      rows: [row('r1', 'Athletics check: 17 (nat 12+5) success', 'SUCCESS')],
    });
    expect(result.status).toBe('no_row');
    expect(result.history?.[0]?.content).toBe(CLIENT);
  });

  it('reports agree and changes nothing when the words match', () => {
    const result = reconcileCheckVerdict({
      history: [{ role: 'user', content: CLIENT }],
      prompt: CLIENT,
      rollRequestId: 'r1',
      rows: [row('r1', CLIENT, 'SUCCESS')],
    });
    expect(result.status).toBe('agree');
    expect(result.history?.[0]?.content).toBe(CLIENT);
  });

  it('leaves the prompt alone when the client line is not exactly once in it', () => {
    const result = reconcileCheckVerdict({
      history: [{ role: 'user', content: CLIENT }],
      prompt: `${CLIENT}\n${CLIENT}`,
      rollRequestId: 'r1',
      rows: [row('r1', SERVER_FAIL, 'FAIL')],
    });
    expect(result.status).toBe('disagree');
    expect(result.history?.[0]?.content).toBe(SERVER_FAIL);
    expect(result.prompt).toBe(`${CLIENT}\n${CLIENT}`);
  });

  it('reports no_client_line for a history whose last user line is not a check', () => {
    const result = reconcileCheckVerdict({
      history: [
        { role: 'user', content: CLIENT },
        { role: 'user', content: 'I climb the wall.' },
      ],
      prompt: 'x',
      rollRequestId: 'r1',
      rows: [row('r1', SERVER_FAIL, 'FAIL')],
    });
    expect(result.status).toBe('no_client_line');
    expect(lastCheckLine([{ role: 'user', content: 'I climb the wall.' }])).toBeNull();
  });
});
