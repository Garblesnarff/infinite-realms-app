import { describe, expect, it } from 'bun:test';

import {
  carryServerEngineLines,
  setServerEngineLines,
  stripModelEngineLines,
} from '../server-engine-lines.js';

/**
 * #1597 (2): `engine_lines` is server-owned. A model-supplied value never reaches the client;
 * (3): the combat-entry seating path re-parses the reply and must carry the server's lines over.
 */
describe('engine_lines is server-owned (#1597)', () => {
  it('strips a model-supplied engine_lines from the parsed envelope', () => {
    const envelope: Record<string, unknown> = {
      text: 'You feel restored.',
      engine_lines: ['The model invented a heal.'],
    };
    stripModelEngineLines(envelope);
    expect(envelope).not.toHaveProperty('engine_lines');
    expect(envelope.text).toBe('You feel restored.');
  });

  it('sets the server lines only when there are some, and clears otherwise', () => {
    const envelope: Record<string, unknown> = {};
    setServerEngineLines(envelope, ['The Hero restores 5 HP.']);
    expect(envelope.engine_lines).toEqual(['The Hero restores 5 HP.']);
    setServerEngineLines(envelope, []);
    expect(envelope).not.toHaveProperty('engine_lines');
  });

  it('carries the server lines onto a re-parsed seated envelope', () => {
    const served: Record<string, unknown> = { engine_lines: ['The Hero restores 5 HP.'] };
    const seated: Record<string, unknown> = { text: 'The fight begins.' };
    carryServerEngineLines(served, seated);
    expect(seated.engine_lines).toEqual(['The Hero restores 5 HP.']);
  });

  it('drops a stale value on the seated envelope when the server set none', () => {
    const served: Record<string, unknown> = {};
    const seated: Record<string, unknown> = { engine_lines: ['stale model value'] };
    carryServerEngineLines(served, seated);
    expect(seated).not.toHaveProperty('engine_lines');
  });
});
