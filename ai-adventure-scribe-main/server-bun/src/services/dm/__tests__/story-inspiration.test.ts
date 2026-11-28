/**
 * #1537: the DM grants Inspiration. The DM provider is never called here: the reply is handed in
 * as data, and the character lookup, the grant write and the engine line are injected stubs.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import { dmResponseSchemaForPhase } from '../dm-response-schema.js';
import {
  applyStoryInspiration,
  inspirationGrantCounts,
  inspirationGrantMode,
  resetInspirationGrantCountsForTests,
  type InspirationGrantDeps,
  type InspirationGrantMode,
} from '../story-inspiration.js';

import type { EngineChatLineInput } from '../../engine-chat-line.js';

const originalMode = process.env.LLM_INSPIRATION_GRANT;

const held = JSON.stringify({ traits: ['Brave'], inspiration: true });
const notHeld = JSON.stringify({ traits: ['Brave'], inspiration: false });

function makeDeps(
  overrides: {
    row?: unknown;
    mode?: InspirationGrantMode;
    grant?: InspirationGrantDeps['grant'];
    publish?: InspirationGrantDeps['publish'];
  } = {},
) {
  const row =
    overrides.row === undefined
      ? { id: 'char-mira', name: 'Mira', personalityNotes: notHeld }
      : overrides.row;
  const character = mock(async () => row as never);
  const grant =
    overrides.grant ??
    mock(async (_characterId: string, _userId: string) => ({
      success: true as const,
      inspiration: true as const,
    }));
  const writeLine = mock(async (_input: EngineChatLineInput) => undefined);
  const publish = overrides.publish ?? mock((_sessionId: string, _reason: string) => undefined);
  const deps: InspirationGrantDeps = {
    mode: overrides.mode ?? 'on',
    character,
    grant,
    writeLine,
    publish,
  };
  return { deps, grant, writeLine, publish };
}

const input = { userId: 'user-1', sessionId: 'session-1', grant: { character_name: 'Mira' } };

describe('applyStoryInspiration (#1537)', () => {
  beforeEach(() => {
    resetInspirationGrantCountsForTests();
  });

  afterEach(() => {
    if (originalMode === undefined) delete process.env.LLM_INSPIRATION_GRANT;
    else process.env.LLM_INSPIRATION_GRANT = originalMode;
  });

  it('a grant request writes true once and posts one engine line', async () => {
    const { deps, grant, writeLine } = makeDeps();
    const outcome = await applyStoryInspiration(input, deps);

    expect(outcome).toBe('granted');
    expect(grant).toHaveBeenCalledTimes(1);
    expect(grant).toHaveBeenCalledWith('char-mira', 'user-1');
    expect(writeLine).toHaveBeenCalledTimes(1);
    expect(writeLine.mock.calls[0][0]).toMatchObject({
      sessionId: 'session-1',
      userId: 'user-1',
      text: 'Mira gains Inspiration.',
    });
    expect(inspirationGrantCounts()).toEqual({ granted: 1 });
  });

  it('a second grant while the hero holds Inspiration is refused with no write', async () => {
    const { deps, grant, writeLine } = makeDeps({
      row: { id: 'char-mira', name: 'Mira', personalityNotes: held },
    });
    const outcome = await applyStoryInspiration(input, deps);

    expect(outcome).toBe('already_held');
    expect(grant).not.toHaveBeenCalled();
    expect(writeLine).not.toHaveBeenCalled();
  });

  it('a grant that loses the write race to an existing flag is refused and posts no line', async () => {
    const { deps, grant, writeLine } = makeDeps({
      grant: mock(async (_characterId: string, _userId: string) => ({
        success: false as const,
        reason: 'already_held' as const,
      })),
    });
    const outcome = await applyStoryInspiration(input, deps);

    expect(outcome).toBe('already_held');
    expect(grant).toHaveBeenCalledTimes(1);
    expect(writeLine).not.toHaveBeenCalled();
  });

  it('a grant for a character the user does not own is refused with no write', async () => {
    // ownedSessionCharacter returns null for a character the user does not own in this session.
    const { deps, grant, writeLine } = makeDeps({ row: null });
    const outcome = await applyStoryInspiration(input, deps);

    expect(outcome).toBe('no_character');
    expect(grant).not.toHaveBeenCalled();
    expect(writeLine).not.toHaveBeenCalled();
  });

  it("a grant that names a different character than the sender's is refused", async () => {
    const { deps, grant, writeLine } = makeDeps();
    const outcome = await applyStoryInspiration(
      { ...input, grant: { character_name: 'Someone Else' } },
      deps,
    );

    expect(outcome).toBe('name_mismatch');
    expect(grant).not.toHaveBeenCalled();
    expect(writeLine).not.toHaveBeenCalled();
  });

  it('a grant on a turn that asks for a roll is not applied yet', async () => {
    const { deps, grant } = makeDeps();
    const outcome = await applyStoryInspiration({ ...input, rollRequested: true }, deps);

    expect(outcome).toBe('roll_pending');
    expect(grant).not.toHaveBeenCalled();
  });

  it('shadow mode writes nothing and counts one', async () => {
    const { deps, grant, writeLine } = makeDeps({ mode: 'shadow' });
    const outcome = await applyStoryInspiration(input, deps);

    expect(outcome).toBe('shadow');
    expect(grant).not.toHaveBeenCalled();
    expect(writeLine).not.toHaveBeenCalled();
    expect(inspirationGrantCounts()).toEqual({ shadow: 1 });
  });

  it('mode on grant publishes exactly once with (session-1, story_inspiration)', async () => {
    const { deps, publish } = makeDeps();
    const outcome = await applyStoryInspiration(input, deps);

    expect(outcome).toBe('granted');
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith('session-1', 'story_inspiration');
  });

  it('shadow mode does not publish', async () => {
    const { deps, publish } = makeDeps({ mode: 'shadow' });
    const outcome = await applyStoryInspiration(input, deps);

    expect(outcome).toBe('shadow');
    expect(publish).not.toHaveBeenCalled();
  });

  it('already held does not publish', async () => {
    const { deps, publish } = makeDeps({
      row: { id: 'char-mira', name: 'Mira', personalityNotes: held },
    });
    const outcome = await applyStoryInspiration(input, deps);

    expect(outcome).toBe('already_held');
    expect(publish).not.toHaveBeenCalled();
  });

  it('a publish that throws still returns granted and writes the engine line', async () => {
    const publish = mock(() => {
      throw new Error('boom');
    });
    const { deps, writeLine } = makeDeps({ publish });
    const outcome = await applyStoryInspiration(input, deps);

    expect(outcome).toBe('granted');
    expect(writeLine).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('the flag defaults to shadow, and only LLM_INSPIRATION_GRANT=on turns writing on', () => {
    delete process.env.LLM_INSPIRATION_GRANT;
    expect(inspirationGrantMode()).toBe('shadow');
    process.env.LLM_INSPIRATION_GRANT = 'on';
    expect(inspirationGrantMode()).toBe('on');
    process.env.LLM_INSPIRATION_GRANT = 'anything-else';
    expect(inspirationGrantMode()).toBe('shadow');
  });
});

describe('inspiration_grant in the DM reply schema (#1537)', () => {
  it('is an optional narrative field with one required character_name string', () => {
    const narrative = dmResponseSchemaForPhase('narrative') as {
      properties: Record<string, unknown>;
      required: string[];
    };
    const field = narrative.properties.inspiration_grant as {
      type: string;
      additionalProperties: boolean;
      required: string[];
      properties: Record<string, { type: string }>;
    };
    expect(field.type).toBe('object');
    expect(field.additionalProperties).toBe(false);
    expect(field.required).toEqual(['character_name']);
    expect(field.properties.character_name.type).toBe('string');
    expect(narrative.required).not.toContain('inspiration_grant');
  });

  it('is not declared in the fight phases', () => {
    for (const phase of ['combat', 'tactical'] as const) {
      const schema = dmResponseSchemaForPhase(phase) as { properties: Record<string, unknown> };
      expect(schema.properties.inspiration_grant).toBeUndefined();
    }
  });
});
