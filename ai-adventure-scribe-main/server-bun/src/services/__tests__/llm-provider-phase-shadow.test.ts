/**
 * #1159: the phase shadow counter pads empty omitted sections, base or
 * extension. A narrative turn carrying an empty combat_exits (the 97-case
 * from the 10-26 nightly) and a tactical turn carrying an empty items
 * (the 1-case) are padding, not mismatches; populated omitted sections
 * still flag by name. Fixtures follow the full DM reply shape (VALID_DM_REPLY
 * in llm-provider-strict-shadow.test.ts, which follows the real producer).
 *
 * #1258: the 10-28 nightly carried POPULATED combat_exits on narrative turns
 * and rest, damage, final_beat_reached and scene_spec on tactical turns.
 * All five are live-schema fields the prompt names, and the route consumes
 * or gracefully handles each on those phases — so the phase schemas now
 * declare them and they do not flag at all. Populated sections the phase
 * still omits (xp_award, items, conditions, campaign_ending,
 * tracker_changes on fight turns) still flag by name.
 *
 * #1258 round 3: the fight-phase schemas declare the five keys required +
 * nullable (null when unused) so tactical fits the 24-optional budget.
 * The shadow pads an absent required-nullable key with null before
 * validating — absence is equivalent to null for these keys — so plain
 * fight-turn replies still read as no mismatch, while present-but-wrong
 * values still flag. Direct Ajv tests below carry the keys as null; only
 * findPhaseShadowMismatch pads.
 */
import Ajv from 'ajv';
import { describe, expect, it } from 'bun:test';

import {
  dmResponseSchemaForPhase,
  phaseOmittedExtensionSections,
} from '../dm/dm-response-schema.js';
import { findPhaseShadowMismatch } from '../llm-provider-service.js';

const BASE_REPLY = {
  text: 'The lantern flickers over a wet cobblestone street.',
  options: [],
  narration_segments: [],
  roll_requests: [],
  combat_transition: 'none',
  map_actions: [],
  handout_actions: [],
  combatants: [],
  combat_actions: [],
};

describe('findPhaseShadowMismatch: empty omitted extensions are padding (#1159)', () => {
  it('narrative + empty combat_exits is not a mismatch', () => {
    expect(findPhaseShadowMismatch({ ...BASE_REPLY, combat_exits: [] }, 'narrative')).toBeNull();
  });

  it('narrative + populated combat_exits is not a mismatch (#1258)', () => {
    // #1159's open question, answered by the 10-28 nightly: populated exits
    // on a narrative turn are a narrative-phase section, not a phase error.
    expect(
      findPhaseShadowMismatch(
        {
          ...BASE_REPLY,
          combat_exits: [{ participant_id: 'goblin-1', exit: 'fled' }],
        },
        'narrative',
      ),
    ).toBeNull();
  });

  it('combat + populated xp_award still flags by name', () => {
    expect(
      findPhaseShadowMismatch(
        { ...BASE_REPLY, xp_award: { amount: 10, reason: 'solved the mystery' } },
        'combat',
      ),
    ).toEqual(
      expect.objectContaining({
        keyword: 'additionalProperties',
        additionalProperty: 'xp_award',
      }),
    );
  });

  it('tactical + empty items is not a mismatch', () => {
    expect(findPhaseShadowMismatch({ ...BASE_REPLY, items: [] }, 'tactical')).toBeNull();
  });

  it('tactical + populated items still flags by name', () => {
    expect(
      findPhaseShadowMismatch(
        {
          ...BASE_REPLY,
          items: [{ name: 'Rope', quantity: 1, change: 'gain' }],
        },
        'tactical',
      ),
    ).toEqual(
      expect.objectContaining({
        keyword: 'additionalProperties',
        additionalProperty: 'items',
      }),
    );
  });

  it('combat + empty items is not a mismatch', () => {
    expect(findPhaseShadowMismatch({ ...BASE_REPLY, items: [] }, 'combat')).toBeNull();
  });

  it('combat + empty conditions is not a mismatch', () => {
    expect(findPhaseShadowMismatch({ ...BASE_REPLY, conditions: [] }, 'combat')).toBeNull();
  });

  it('direct combat phase validation still rejects xp_award (asymmetry pin)', () => {
    // #1258 moved the asymmetry pin: narrative now declares combat_exits,
    // so the pin lives on a still-omitted extension. A combat-valid reply
    // has no map_actions (not a combat key), so xp_award is the only
    // additional key and the first error names it. The envelope carries
    // the fight phase's required-nullable keys as null (direct Ajv has
    // no padding — only findPhaseShadowMismatch pads).
    const { map_actions: _droppedMap, ...combatReply } = BASE_REPLY;
    const validate = new Ajv({ strict: false, allErrors: false }).compile(
      dmResponseSchemaForPhase('combat'),
    );
    expect(
      validate({
        ...combatReply,
        scene_spec: null,
        combat_exits: null,
        rest: null,
        damage: null,
        final_beat_reached: null,
        xp_award: { amount: 10, reason: 'solved the mystery' },
      }),
    ).toBe(false);
    expect(
      (validate.errors?.[0]?.params as { additionalProperty?: unknown } | undefined)
        ?.additionalProperty,
    ).toBe('xp_award');
  });

  it('direct narrative phase validation accepts populated combat_exits (#1159 pin restored, #1258)', () => {
    // #1159's narrative pin, rewritten into the combat/xp_award pin by
    // #1258 and restored here: a narrative envelope WITH combat_exits
    // passes. Narrative keeps combat_exits optional, so no null keys
    // are needed — the envelope is a narrative-valid reply plus exits.
    const {
      map_actions: _droppedMap,
      combat_actions: _droppedCombat,
      ...narrativeReply
    } = BASE_REPLY;
    const validate = new Ajv({ strict: false, allErrors: false }).compile(
      dmResponseSchemaForPhase('narrative'),
    );
    expect(
      validate({
        ...narrativeReply,
        combat_exits: [{ participant_id: 'goblin-1', exit: 'fled' }],
      }),
    ).toBe(true);
  });

  it('narrative + null combat_exits is a type mismatch, not a phase mismatch (#1258)', () => {
    // The phase schema now declares combat_exits, so a null value fails the
    // value's own type instead of the phase boundary. The strict branch
    // still catches it; the shadow counter reports the type keyword.
    expect(findPhaseShadowMismatch({ ...BASE_REPLY, combat_exits: null }, 'narrative')).toEqual(
      expect.objectContaining({ keyword: 'type' }),
    );
  });

  it('narrative + populated combat_actions still flags by name (base rule intact)', () => {
    expect(
      findPhaseShadowMismatch({ ...BASE_REPLY, combat_actions: [{ action: 'move' }] }, 'narrative'),
    ).toEqual(
      expect.objectContaining({
        keyword: 'additionalProperties',
        additionalProperty: 'combat_actions',
      }),
    );
  });

  it('narrative + plain valid reply is not a mismatch', () => {
    expect(findPhaseShadowMismatch({ ...BASE_REPLY }, 'narrative')).toBeNull();
  });
});

describe('findPhaseShadowMismatch: #1258 keys are phase-schema fields', () => {
  // Fixture values follow the real producers: the scene shape is the
  // combat-entry gate's scene_spec, the damage/rest shapes are the story
  // appliers' inputs in the llm.ts story step, and the final-beat flag is
  // the tracker step's input. Each reply is the full DM reply shape
  // (VALID_DM_REPLY) plus the one key.
  const SCENE_SPEC = {
    environment: 'dungeon_room',
    size: 'small',
    sceneDescription: 'A torch-lit guardroom.',
    seed: 7,
    enemyPlacement: 'guarding',
  };
  it('tactical + scene_spec is not a mismatch', () => {
    expect(
      findPhaseShadowMismatch({ ...BASE_REPLY, scene_spec: SCENE_SPEC }, 'tactical'),
    ).toBeNull();
  });
  it('combat + scene_spec is not a mismatch', () => {
    expect(
      findPhaseShadowMismatch({ ...BASE_REPLY, scene_spec: SCENE_SPEC }, 'combat'),
    ).toBeNull();
  });
  it('tactical + damage is not a mismatch', () => {
    expect(
      findPhaseShadowMismatch(
        { ...BASE_REPLY, damage: { amount: 3, source: 'falling debris' } },
        'tactical',
      ),
    ).toBeNull();
  });
  it('tactical + rest is not a mismatch', () => {
    expect(
      findPhaseShadowMismatch({ ...BASE_REPLY, rest: { type: 'short' } }, 'tactical'),
    ).toBeNull();
  });
  it('tactical + populated final_beat_reached is not a mismatch', () => {
    expect(
      findPhaseShadowMismatch({ ...BASE_REPLY, final_beat_reached: true }, 'tactical'),
    ).toBeNull();
  });
  it('combat + populated final_beat_reached is not a mismatch', () => {
    expect(
      findPhaseShadowMismatch({ ...BASE_REPLY, final_beat_reached: true }, 'combat'),
    ).toBeNull();
  });
  it('direct tactical validation accepts all four #1258 keys at once', () => {
    const validate = new Ajv({ strict: false, allErrors: false }).compile(
      dmResponseSchemaForPhase('tactical'),
    );
    expect(
      validate({
        ...BASE_REPLY,
        scene_spec: SCENE_SPEC,
        combat_exits: [],
        damage: { amount: 3, source: 'falling debris' },
        rest: { type: 'short' },
        final_beat_reached: true,
      }),
    ).toBe(true);
  });
});

describe('findPhaseShadowMismatch: required-nullable padding (#1258 round 3)', () => {
  // The fight-phase schemas require the five keys (nullable). The shadow
  // pads an absent key with null, so ordinary fight-turn replies — which
  // omit these keys on most turns — still read as no mismatch, while
  // present-but-wrong values still flag and the caller's object is never
  // mutated by the fill.
  it('combat + plain valid reply is not a mismatch', () => {
    expect(findPhaseShadowMismatch({ ...BASE_REPLY }, 'combat')).toBeNull();
  });

  it('tactical + plain valid reply is not a mismatch', () => {
    expect(findPhaseShadowMismatch({ ...BASE_REPLY }, 'tactical')).toBeNull();
  });

  it('tactical + minimal scene_spec is not a mismatch (nested padding)', () => {
    expect(
      findPhaseShadowMismatch(
        { ...BASE_REPLY, scene_spec: { environment: 'dungeon_room', seed: 1 } },
        'tactical',
      ),
    ).toBeNull();
  });

  it('tactical + explicit null keys is not a mismatch', () => {
    expect(
      findPhaseShadowMismatch(
        {
          ...BASE_REPLY,
          scene_spec: null,
          combat_exits: null,
          rest: null,
          damage: null,
          final_beat_reached: null,
        },
        'tactical',
      ),
    ).toBeNull();
  });

  it('tactical + wrong-typed damage still flags by type', () => {
    expect(
      findPhaseShadowMismatch(
        { ...BASE_REPLY, damage: { amount: 'three', source: 'falling debris' } },
        'tactical',
      ),
    ).toEqual(expect.objectContaining({ keyword: 'type' }));
  });

  it('combat + targeted combat action is not a mismatch (variant unions are never padded)', () => {
    // Self-review catch: the fill must not descend into the combat-action
    // variants — a targeted action must not gain the AoE variant's
    // `direction`, which would fail both branches.
    const action = {
      actor_id: 'hero',
      action_type: 'attack',
      target_ids: ['goblin-1'],
      movement_feet: 30,
    };
    expect(
      findPhaseShadowMismatch({ ...BASE_REPLY, combat_actions: [action] }, 'combat'),
    ).toBeNull();
    expect(
      findPhaseShadowMismatch({ ...BASE_REPLY, combat_actions: [action] }, 'tactical'),
    ).toBeNull();
    expect('direction' in action).toBe(false);
  });

  it('combat + AoE combat action is not a mismatch', () => {
    const action = {
      actor_id: 'hero',
      action_type: 'cast_spell',
      spell_id: 'fireball',
      origin: { x: 1, y: 1 },
      direction: { x: 2, y: 2 },
    };
    expect(
      findPhaseShadowMismatch({ ...BASE_REPLY, combat_actions: [action] }, 'combat'),
    ).toBeNull();
  });

  it("the padding never mutates the caller's reply", () => {
    const reply = { ...BASE_REPLY };
    expect(findPhaseShadowMismatch(reply, 'tactical')).toBeNull();
    expect(reply).toEqual(BASE_REPLY);
    expect('scene_spec' in reply).toBe(false);
    expect('damage' in reply).toBe(false);
    // Nested objects are cloned too: a minimal scene_spec gains no keys.
    const sceneSpec = { environment: 'dungeon_room', seed: 1 };
    const nested = { ...BASE_REPLY, scene_spec: sceneSpec };
    expect(findPhaseShadowMismatch(nested, 'tactical')).toBeNull();
    expect(sceneSpec).toEqual({ environment: 'dungeon_room', seed: 1 });
    expect('size' in sceneSpec).toBe(false);
  });
});

describe('phaseOmittedExtensionSections', () => {
  it('narrative omits no extensions (#1258)', () => {
    expect(phaseOmittedExtensionSections('narrative')).toEqual([]);
  });

  it('combat and tactical omit the narrative-only story extensions', () => {
    const story = ['xp_award', 'items', 'conditions', 'campaign_ending', 'tracker_changes'];
    expect(phaseOmittedExtensionSections('combat')).toEqual(story);
    expect(phaseOmittedExtensionSections('tactical')).toEqual(story);
  });

  it('full omits nothing', () => {
    expect(phaseOmittedExtensionSections('full')).toEqual([]);
  });
});
