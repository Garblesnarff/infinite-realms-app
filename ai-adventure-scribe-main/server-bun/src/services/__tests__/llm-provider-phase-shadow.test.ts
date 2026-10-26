/**
 * #1159: the phase shadow counter pads empty omitted sections, base or
 * extension. A narrative turn carrying an empty combat_exits (the 97-case
 * from the 10-26 nightly) and a tactical turn carrying an empty items
 * (the 1-case) are padding, not mismatches; populated omitted sections
 * still flag by name. Fixtures follow the full DM reply shape (VALID_DM_REPLY
 * in llm-provider-strict-shadow.test.ts, which follows the real producer).
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

  it('narrative + populated combat_exits still flags by name', () => {
    expect(
      findPhaseShadowMismatch(
        {
          ...BASE_REPLY,
          combat_exits: [{ participant_id: 'goblin-1', exit: 'fled' }],
        },
        'narrative',
      ),
    ).toEqual(
      expect.objectContaining({
        keyword: 'additionalProperties',
        additionalProperty: 'combat_exits',
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

  it('direct narrative phase validation still rejects empty combat_exits (asymmetry pin)', () => {
    // A narrative-valid reply has no combat_actions/map_actions (those are
    // not narrative keys), so combat_exits is the only additional key and
    // the first error names it.
    const { map_actions: _droppedMap, combat_actions: _droppedCombat, ...narrativeReply } =
      BASE_REPLY;
    const validate = new Ajv({ strict: false, allErrors: false }).compile(
      dmResponseSchemaForPhase('narrative'),
    );
    expect(validate({ ...narrativeReply, combat_exits: [] })).toBe(false);
    expect(
      (validate.errors?.[0]?.params as { additionalProperty?: unknown } | undefined)
        ?.additionalProperty,
    ).toBe('combat_exits');
  });

  it('narrative + non-array combat_exits still flags by name', () => {
    expect(findPhaseShadowMismatch({ ...BASE_REPLY, combat_exits: null }, 'narrative')).toEqual(
      expect.objectContaining({
        keyword: 'additionalProperties',
        additionalProperty: 'combat_exits',
      }),
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

describe('phaseOmittedExtensionSections', () => {
  it('narrative omits only combat_exits', () => {
    expect(phaseOmittedExtensionSections('narrative')).toEqual(['combat_exits']);
  });

  it('combat and tactical omit the story extensions', () => {
    const story = [
      'xp_award',
      'items',
      'conditions',
      'rest',
      'damage',
      'campaign_ending',
      'tracker_changes',
      'final_beat_reached',
    ];
    expect(phaseOmittedExtensionSections('combat')).toEqual(story);
    expect(phaseOmittedExtensionSections('tactical')).toEqual(story);
  });

  it('full omits nothing', () => {
    expect(phaseOmittedExtensionSections('full')).toEqual([]);
  });
});
