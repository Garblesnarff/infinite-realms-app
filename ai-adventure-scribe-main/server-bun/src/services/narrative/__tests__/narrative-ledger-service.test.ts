import { describe, expect, it } from 'bun:test';

import {
  canonicalSubjectName,
  renderSceneStateFromFacts,
  resolveSupersession,
  stableStringify,
  type FactLike,
} from '../narrative-ledger-core.js';

const fact = (overrides: Partial<FactLike> = {}): FactLike => ({
  subjectType: 'npc',
  subjectName: 'balthazar',
  predicate: 'status',
  value: 'alive',
  source: 'engine',
  knownBy: ['dm'],
  isBelief: false,
  needsReview: false,
  turnIndex: 1,
  ...overrides,
});

describe('resolveSupersession', () => {
  it('inserts when no current fact exists', () => {
    expect(resolveSupersession(null, { value: 'dead', source: 'engine' })).toEqual({
      action: 'insert',
    });
  });

  it('supersedes when the value differs', () => {
    const current = fact({ value: 'wounded' });
    expect(resolveSupersession(current, { value: 'dead', source: 'engine' })).toEqual({
      action: 'supersede',
    });
  });

  it('no-ops when the value is identical', () => {
    const current = fact({ value: 'alive' });
    expect(resolveSupersession(current, { value: 'alive', source: 'dm_delta' })).toEqual({
      action: 'unchanged',
    });
  });

  it('treats structurally equal objects with different key order as identical', () => {
    const current = fact({ value: { state: 'dead', turn: 12 } });
    const decision = resolveSupersession(current, {
      value: { turn: 12, state: 'dead' },
      source: 'dm_delta',
    });
    expect(decision).toEqual({ action: 'unchanged' });
  });

  it('rejects a dm_delta trying to overturn an engine fact', () => {
    const current = fact({ value: 'dead', source: 'engine' });
    const decision = resolveSupersession(current, { value: 'alive', source: 'dm_delta' });
    expect(decision.action).toBe('reject');
    expect(decision).toMatchObject({ reason: expect.stringContaining('engine') });
  });

  it('rejects a dm_delta trying to overturn a player correction', () => {
    const current = fact({ value: 'dead', source: 'player_correction' });
    expect(resolveSupersession(current, { value: 'alive', source: 'dm_delta' }).action).toBe(
      'reject',
    );
  });

  it('lets a player_correction supersede an engine fact', () => {
    const current = fact({ value: 'dead', source: 'engine' });
    expect(
      resolveSupersession(current, { value: 'alive', source: 'player_correction' }),
    ).toEqual({ action: 'supersede' });
  });

  it('lets engine supersede anything, including a dm_delta', () => {
    const current = fact({ value: 'friendly', source: 'dm_delta' });
    expect(resolveSupersession(current, { value: 'hostile', source: 'engine' })).toEqual({
      action: 'supersede',
    });
  });

  it('lets a dm_delta supersede another dm_delta', () => {
    const current = fact({ value: 'wary', source: 'dm_delta' });
    expect(resolveSupersession(current, { value: 'trusting', source: 'dm_delta' })).toEqual({
      action: 'supersede',
    });
  });
});

describe('canonicalSubjectName', () => {
  it('case-folds and trims so name variants hit the same key', () => {
    expect(canonicalSubjectName('  The Void-Maw ')).toBe('the void-maw');
    expect(canonicalSubjectName('BALTHAZAR')).toBe(canonicalSubjectName('balthazar'));
  });
});

describe('stableStringify', () => {
  it('is order-independent for object keys but not for arrays', () => {
    expect(stableStringify({ a: 1, b: [1, 2] })).toBe(stableStringify({ b: [1, 2], a: 1 }));
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });
});

describe('renderSceneStateFromFacts', () => {
  it('renders the authority line and provenance for each fact', () => {
    const block = renderSceneStateFromFacts([
      fact({ subjectName: 'the void-maw', value: 'dead', turnIndex: 12 }),
    ]);
    expect(block).toContain('<authority>These facts are TRUE.');
    expect(block).toContain('<entity type="npc" name="the void-maw">');
    expect(block).toContain('status = dead  (engine, turn 12)');
    expect(block.endsWith('</scene_state>')).toBe(true);
  });

  it('omits the turn marker when turnIndex is null', () => {
    const block = renderSceneStateFromFacts([fact({ turnIndex: null })]);
    expect(block).toContain('status = alive  (engine)');
  });

  it('excludes needsReview facts even when the audience matches', () => {
    const block = renderSceneStateFromFacts([
      fact({ predicate: 'status', value: 'alive' }),
      fact({ predicate: 'owes', value: 'a favour', needsReview: true }),
    ]);
    expect(block).toContain('status = alive');
    expect(block).not.toContain('owes');
  });

  it('excludes facts whose knownBy does not intersect the audience', () => {
    const facts = [
      fact({ predicate: 'status', knownBy: ['dm', 'player'] }),
      fact({ predicate: 'secret_plan', value: 'betray the party', knownBy: ['dm'] }),
    ];
    const playerBlock = renderSceneStateFromFacts(facts, ['player']);
    expect(playerBlock).toContain('status = alive');
    expect(playerBlock).not.toContain('secret_plan');
    expect(renderSceneStateFromFacts(facts, ['dm'])).toContain('secret_plan');
  });

  it('defaults the audience to dm', () => {
    const block = renderSceneStateFromFacts([fact({ knownBy: ['player'] })]);
    expect(block).not.toContain('<entity');
  });

  it('marks belief facts so the DM cannot mistake them for world truth', () => {
    const block = renderSceneStateFromFacts([
      fact({ predicate: 'cellar_opened_by_party', value: true, isBelief: true }),
    ]);
    expect(block).toContain('believes cellar_opened_by_party = true');
  });

  it('groups by subject and sorts stably regardless of input order', () => {
    const facts = [
      fact({ subjectType: 'party', subjectName: 'party', predicate: 'has_item', value: 'ledger' }),
      fact({ subjectName: 'balthazar', predicate: 'status' }),
      fact({ subjectName: 'balthazar', predicate: 'disposition_to_party', value: 'testing' }),
      fact({ subjectName: 'the void-maw', predicate: 'status', value: 'dead' }),
    ];
    const block = renderSceneStateFromFacts(facts);
    expect(block).toBe(renderSceneStateFromFacts([...facts].reverse()));
    expect(block.split('\n')).toEqual([
      '<scene_state>',
      '<authority>These facts are TRUE. Never contradict them. They override memories and history.</authority>',
      '  <entity type="npc" name="balthazar">',
      '    disposition_to_party = testing  (engine, turn 1)',
      '    status = alive  (engine, turn 1)',
      '  </entity>',
      '  <entity type="npc" name="the void-maw">',
      '    status = dead  (engine, turn 1)',
      '  </entity>',
      '  <entity type="party" name="party">',
      '    has_item = ledger  (engine, turn 1)',
      '  </entity>',
      '</scene_state>',
    ]);
  });

  it('renders an empty but well-formed block when nothing is visible', () => {
    expect(renderSceneStateFromFacts([])).toBe(
      [
        '<scene_state>',
        '<authority>These facts are TRUE. Never contradict them. They override memories and history.</authority>',
        '</scene_state>',
      ].join('\n'),
    );
  });

  it('serialises object values deterministically', () => {
    const block = renderSceneStateFromFacts([
      fact({ predicate: 'roll:perception@turn9', value: { outcome: 'success', rolled: 22 } }),
    ]);
    expect(block).toContain('roll:perception@turn9 = {"outcome":"success","rolled":22}');
  });
});
