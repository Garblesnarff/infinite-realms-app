import { describe, expect, it } from 'bun:test';

import { sanitizeSceneSpec } from '../scene-spec-sanitizer.js';

const SESSION_ID = '11111111-2222-4333-8444-555555555555';

describe('sanitizeSceneSpec', () => {
  it('replaces a model-invented sessionId with the route parameter and reports the override', () => {
    const result = sanitizeSceneSpec(
      { environment: 'tavern', sessionId: 'eternal_feast_01', id: 'main_floor_confrontation' },
      SESSION_ID,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sceneSpec.sessionId).toBe(SESSION_ID);
    expect(result.sceneSpec.id).toBeUndefined();
    expect(result.overrides).toContain('sessionId');
    expect(result.overrides).toContain('id');
  });

  it('drops model-supplied entities, which would become tactical entity ids', () => {
    const result = sanitizeSceneSpec(
      {
        environment: 'cave',
        pcEntities: [{ id: 'not-a-participant', x: 0, y: 0 }],
        enemyEntities: [{ id: 'also-not-a-participant', x: 1, y: 1 }],
      },
      SESSION_ID,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sceneSpec.pcEntities).toBeUndefined();
    expect(result.sceneSpec.enemyEntities).toBeUndefined();
    expect(result.overrides).toContain('entities');
  });

  it('keeps a usable seed and discards an unusable one', () => {
    const kept = sanitizeSceneSpec({ environment: 'road', seed: 12345 }, SESSION_ID);
    expect(kept.ok && kept.sceneSpec.seed).toBe(12345);

    const dropped = sanitizeSceneSpec({ environment: 'road', seed: 'lucky' }, SESSION_ID);
    expect(dropped.ok).toBe(true);
    if (!dropped.ok) return;
    expect(dropped.sceneSpec.seed).toBeUndefined();
    expect(dropped.overrides).toContain('seed');
  });

  it('falls back to a medium scene for an unknown size and leaves placement to the generator', () => {
    const result = sanitizeSceneSpec(
      { environment: 'ruins', size: 'colossal', enemyPlacement: 'surrounding' },
      SESSION_ID,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sceneSpec.size).toBe('medium');
    expect(result.sceneSpec.enemyPlacement).toBeUndefined();
    expect(result.overrides).toEqual(expect.arrayContaining(['size', 'enemyPlacement']));
  });

  it('rejects an unknown environment and a non-object spec', () => {
    expect(sanitizeSceneSpec({ environment: 'space_station' }, SESSION_ID)).toMatchObject({
      ok: false,
    });
    expect(sanitizeSceneSpec('tavern', SESSION_ID)).toMatchObject({ ok: false });
    expect(sanitizeSceneSpec([{ environment: 'tavern' }], SESSION_ID)).toMatchObject({ ok: false });
  });

  it('truncates an overlong scene description instead of rejecting the start', () => {
    const result = sanitizeSceneSpec(
      { environment: 'tavern', sceneDescription: 'x'.repeat(5_000) },
      SESSION_ID,
    );
    expect(result.ok && result.sceneSpec.sceneDescription?.length).toBe(2_000);
  });
});
