/**
 * #1595 shadow: a DM reply that narrates a ledger-dead NPC acting is reported as
 * `narrated_dead_npc_acting` (pattern names only). The reply itself is never changed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/services/client-failure-reporting', () => ({
  reportNarrationShadowHit: vi.fn(),
}));

import {
  deadNpcNamesFromSceneState,
  narratedDeadNpcActingPatterns,
  shadowNarratedDeadNpcActing,
} from '../narrated-dead-npc-shadow';

import logger from '@/lib/logger';
import { reportNarrationShadowHit } from '@/services/client-failure-reporting';

/** The scene_state block the renderer writes after the first fight (Run M16): Pellam is dead. */
const SCENE_STATE = `<scene_state>
<authority>These facts are TRUE. Never contradict them. They override memories and history.</authority>
  <entity type="npc" name="dutch pellam">
    status = {"state":"dead"}  (engine, turn 4)
  </entity>
  <entity type="npc" name="professor emil darkwater">
    status = {"state":"watching"}  (dm, turn 2)
  </entity>
</scene_state>`;

describe('deadNpcNamesFromSceneState', () => {
  it('returns the dead NPC names from the rendered block, and no living NPC', () => {
    expect(deadNpcNamesFromSceneState(SCENE_STATE)).toEqual(['dutch pellam']);
  });

  it('returns nothing without a block', () => {
    expect(deadNpcNamesFromSceneState(null)).toEqual([]);
    expect(deadNpcNamesFromSceneState(undefined)).toEqual([]);
  });
});

describe('narratedDeadNpcActingPatterns', () => {
  const dead = ['dutch pellam'];

  it('reports the M16 shape: the dead NPC narrated stepping into the ring and attacking', () => {
    const reply =
      'The gate groans open. Dutch Pellam steps into the ring, blade raised, and swings at you.';
    expect(narratedDeadNpcActingPatterns(reply, dead)).toEqual(['attack', 'return_or_entry']);
  });

  it('reports past-tense narration: "Dutch Pellam stepped into the ring"', () => {
    expect(narratedDeadNpcActingPatterns('Dutch Pellam stepped into the ring.', dead)).toEqual([
      'return_or_entry',
    ]);
  });

  it('reports past-tense attacks and speech', () => {
    expect(narratedDeadNpcActingPatterns('Dutch Pellam lunged at you.', dead)).toEqual(['attack']);
    expect(narratedDeadNpcActingPatterns('Dutch Pellam shouted a warning.', dead)).toEqual([
      'speech',
    ]);
    expect(narratedDeadNpcActingPatterns('Dutch Pellam came back up the sand.', dead)).toEqual([
      'return_or_entry',
    ]);
  });

  it('does not count "hits the sand" as an attack, and counts a hit on "you"', () => {
    expect(narratedDeadNpcActingPatterns('Dutch Pellam hits the sand.', dead)).toEqual([]);
    expect(narratedDeadNpcActingPatterns('Dutch Pellam hits you.', dead)).toEqual(['attack']);
  });

  it('does not count a body or ghost as the dead NPC acting', () => {
    expect(narratedDeadNpcActingPatterns("Dutch Pellam's body hits the sand.", dead)).toEqual([]);
    expect(narratedDeadNpcActingPatterns("Dutch Pellam's ghost whispers.", dead)).toEqual([]);
  });

  it('does not count a crowd that shouts his name after the NPC is dead', () => {
    expect(
      narratedDeadNpcActingPatterns('Dutch Pellam is dead, and the crowd shouts his name.', dead),
    ).toEqual([]);
  });

  it('ignores a believes status line and a status the engine did not write', () => {
    const believes = `<scene_state>
  <entity type="npc" name="dutch pellam">
    believes status = {"state":"dead"}  (engine, turn 4)
  </entity>
</scene_state>`;
    const dmSource = `<scene_state>
  <entity type="npc" name="dutch pellam">
    status = {"state":"dead"}  (dm, turn 4)
  </entity>
</scene_state>`;
    expect(deadNpcNamesFromSceneState(believes)).toEqual([]);
    expect(deadNpcNamesFromSceneState(dmSource)).toEqual([]);
  });

  it('reports a dead NPC narrated speaking', () => {
    const reply = 'Dutch Pellam says, "You will not leave this ring alive."';
    expect(narratedDeadNpcActingPatterns(reply, dead)).toEqual(['speech']);
  });

  it('does not report a dead NPC only mentioned as a body or as "the late"', () => {
    expect(
      narratedDeadNpcActingPatterns(
        'His body lies cold in the sand, and the late Dutch Pellam is remembered at the gate.',
        dead,
      ),
    ).toEqual([]);
    expect(narratedDeadNpcActingPatterns('His body lies cold in the sand.', dead)).toEqual([]);
  });

  it('does not report a negated act', () => {
    expect(narratedDeadNpcActingPatterns('Dutch Pellam does not attack.', dead)).toEqual([]);
  });

  it('does not report an act by a living NPC', () => {
    expect(narratedDeadNpcActingPatterns('Professor Darkwater swings a staff.', dead)).toEqual([]);
  });
});

describe('shadowNarratedDeadNpcActing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports the M16 shape with pattern names only and logs the shadow line', () => {
    const reply = 'Dutch Pellam steps into the ring, blade raised, and swings at you.';
    shadowNarratedDeadNpcActing({
      narration: reply,
      sessionId: 'sess-1595-fixture',
      sceneStateBlock: SCENE_STATE,
    });

    expect(reportNarrationShadowHit).toHaveBeenCalledTimes(1);
    expect(reportNarrationShadowHit).toHaveBeenCalledWith(
      'narrated_dead_npc_acting',
      'sess-1595-fixture',
      ['attack', 'return_or_entry'],
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'DM_NARRATION_SHADOW',
      expect.objectContaining({
        reason: 'narrated_dead_npc_acting',
        sessionId: 'sess-1595-fixture',
        patterns: ['attack', 'return_or_entry'],
      }),
    );
  });

  it('reports nothing for a mention-only reply', () => {
    shadowNarratedDeadNpcActing({
      narration: 'His body lies cold in the sand, and the late Dutch Pellam is remembered.',
      sessionId: 'sess-1595-fixture',
      sceneStateBlock: SCENE_STATE,
    });
    expect(reportNarrationShadowHit).not.toHaveBeenCalled();
  });

  it('reports nothing when no NPC is dead in the scene', () => {
    shadowNarratedDeadNpcActing({
      narration: 'Dutch Pellam steps into the ring.',
      sessionId: 'sess-1595-fixture',
      sceneStateBlock: null,
    });
    expect(reportNarrationShadowHit).not.toHaveBeenCalled();
  });

  it('never changes the reply it reads (pure report, no return value)', () => {
    const reply = 'Dutch Pellam steps into the ring.';
    const before = reply;
    const result = shadowNarratedDeadNpcActing({
      narration: reply,
      sessionId: 'sess-1595-fixture',
      sceneStateBlock: SCENE_STATE,
    });
    expect(result).toBeUndefined();
    expect(reply).toBe(before);
  });

  it('fails open: a report that throws does not reach the caller', () => {
    vi.mocked(reportNarrationShadowHit).mockImplementationOnce(() => {
      throw new Error('telemetry down');
    });
    expect(() =>
      shadowNarratedDeadNpcActing({
        narration: 'Dutch Pellam steps into the ring.',
        sessionId: 'sess-1595-fixture',
        sceneStateBlock: SCENE_STATE,
      }),
    ).not.toThrow();
  });
});
