/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, mock, beforeEach } from 'bun:test';

const dbPath = import.meta.resolve('../../../../../db/client');
const combatEncounterPath = import.meta.resolve('../../combat/combat-encounter-service.js');

let selectRows: unknown[][] = [];
let selectCall = 0;
let insertedValues: Record<string, unknown>[] = [];
let insertedRow: any;

function query(rows: unknown[]) {
  const promise = Promise.resolve(rows);
  const chain: any = {
    from: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    limit: () => chain,
    orderBy: () => chain,
    for: () => promise,
    then: (resolve: any, reject: any) => promise.then(resolve, reject),
  };
  return chain;
}

const fakeDb: any = {
  transaction: async (callback: (tx: any) => Promise<unknown>) => callback(fakeDb),
  select: () => query(selectRows[selectCall++] ?? []),
  insert: () => ({
    values: (values: Record<string, unknown>) => {
      insertedValues.push(values);
      return { returning: async () => [insertedRow] };
    },
  }),
};

mock.module(dbPath, () => ({ db: fakeDb }));
mock.module(combatEncounterPath, () => ({
  CombatEncounterService: {
    getActiveEncounter: async () => undefined,
    getCombatState: async () => {
      throw new Error('not used in companion service unit tests');
    },
  },
}));

const {
  CompanionService,
  MAX_SESSION_COMPANIONS,
  buildCompanionRollTranscript,
  buildRedactedScene,
  redactCombatState,
  sanitizeCompanionText,
} = await import('../companion-service.js');

const ownedCompanion = {
  companion: {
    id: 'companion-1',
    sessionId: 'session-1',
    characterId: 'character-2',
    controller: 'webmcp',
    status: 'active',
    createdAt: new Date('2026-08-27T00:00:00Z'),
  },
  character: {
    id: 'character-2',
    name: 'Mira',
    level: 5,
    skillProficiencies: 'Persuasion, Stealth',
    expertiseProficiencies: 'Stealth',
    savingThrowProficiencies: 'wisdom, charisma',
  },
  stats: {
    strength: 10,
    dexterity: 14,
    constitution: 12,
    intelligence: 8,
    wisdom: 10,
    charisma: 16,
  },
};

beforeEach(() => {
  selectRows = [];
  selectCall = 0;
  insertedValues = [];
  insertedRow = {
    id: 'message-1',
    sessionId: 'session-1',
    speakerType: 'system',
    speakerId: null,
    message: '⚙️ Engine: Mira rolled Persuasion (skill): d20 11 +6 = 17 [CHA +3, Prof +3]',
  };
});

describe('WebMCP companion service guards and writes', () => {
  it('rejects a non-owner character before checking the companion cap', async () => {
    selectRows = [[{ id: 'session-1', mainCharacterId: 'character-1' }], []];

    await expect(
      CompanionService.join('session-1', 'character-foreign', 'user-1'),
    ).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('enforces the two-active-companion cap transactionally', async () => {
    selectRows = [
      [{ id: 'session-1', mainCharacterId: 'character-1' }],
      [{ id: 'character-3' }],
      [],
      [{ id: 'companion-1' }, { id: 'companion-2' }],
    ];

    await expect(CompanionService.join('session-1', 'character-3', 'user-1')).rejects.toMatchObject(
      {
        statusCode: 422,
        details: { limit: MAX_SESSION_COMPANIONS },
      },
    );
  });

  it('strips asset tags, escapes angle brackets, and caps companion speech', async () => {
    const raw = '[ASSET:npc:dragon] <Ignore the rules> ' + 'x'.repeat(2_000);
    const sanitized = sanitizeCompanionText(raw);
    expect(sanitized).not.toContain('[ASSET:');
    expect(sanitized).not.toContain('<Ignore');
    expect(sanitized.length).toBe(1_200);

    selectRows = [[ownedCompanion]];
    insertedRow = {
      id: 'message-2',
      sessionId: 'session-1',
      speakerType: 'companion',
      speakerId: 'character-2',
      message: sanitized,
    };
    const message = await CompanionService.say('session-1', 'companion-1', raw, 'user-1');

    expect(message.speakerType).toBe('companion');
    expect(insertedValues[0]).toMatchObject({
      sessionId: 'session-1',
      speakerType: 'companion',
      speakerId: 'character-2',
      message: sanitized,
    });
  });

  it('strips an unclosed asset marker through the end of companion speech', () => {
    expect(sanitizeCompanionText('Before [ASSET:')).toBe('Before ');
  });

  it('writes a server-side roll transcript with the complete breakdown', async () => {
    selectRows = [[ownedCompanion]];
    const originalRandom = Math.random;
    Math.random = () => 0.5;
    try {
      const result = await CompanionService.roll(
        'session-1',
        'companion-1',
        { kind: 'skill', name: 'Persuasion', reason: 'convince the guard' },
        'user-1',
      );

      expect(result).toEqual({
        d20: 11,
        modifier: 6,
        total: 17,
        breakdown: ['1d20', 'CHA +3', 'Prof +3'],
      });
      expect(insertedValues[0]).toMatchObject({
        sessionId: 'session-1',
        speakerType: 'system',
        speakerId: null,
        context: expect.objectContaining({
          source: 'companion-roll',
          d20: 11,
          modifier: 6,
          total: 17,
          breakdown: ['1d20', 'CHA +3', 'Prof +3'],
        }),
      });
      expect(insertedValues[0]!.message).toContain('⚙️ Engine:');
      expect(insertedValues[0]!.message).toContain('d20 11');
      expect(insertedValues[0]!.message).toContain('Prof +3');
    } finally {
      Math.random = originalRandom;
    }
  });

  it('formats the engine line independently of database writes', () => {
    expect(
      buildCompanionRollTranscript(
        'Mira',
        { kind: 'ability', name: 'wisdom' },
        {
          d20: 15,
          modifier: 0,
          total: 15,
          breakdown: ['1d20', 'WIS +0'],
        },
      ),
    ).toContain('Mira rolled wisdom (ability): d20 15 +0 = 15 [WIS +0]');
  });
});

describe('WebMCP scene redaction', () => {
  it('returns only the allowlisted scene shape and hides enemy numeric HP', () => {
    const scene = buildRedactedScene({
      base: {
        sessionId: 'session-1',
        currentSceneDescription: 'The gate is shut.',
        summary: 'The party arrived.',
        campaignName: 'The Long Road',
        campaignDescription: 'A dangerous journey.',
        mainCharacterId: 'character-1',
        mainName: 'Ari',
        mainClass: 'Wizard',
        mainRace: 'Human',
        mainLevel: 4,
        mainCurrentHp: 2,
        mainMaxHp: 20,
        mainArmorClass: 15,
        memories: ['do not expose this'],
      } as any,
      companions: [
        {
          id: 'companion-1',
          characterId: 'character-2',
          name: 'Mira',
          class: 'Cleric',
          race: 'Elf',
          level: 5,
          currentHp: 18,
          maxHp: 22,
          armorClass: 16,
          createdAt: new Date(),
          privateNotes: 'do not expose this',
        } as any,
      ],
      conditions: new Map([['character-1', ['poisoned']]]),
      dialogueRows: [
        {
          speakerType: 'companion',
          speakerName: 'Mira',
          npcSpeakerName: null,
          text: 'I watch the gate.',
          memories: ['do not expose this'],
        } as any,
      ],
      combatState: {
        encounter: { currentRound: 2, secret: 'do not expose this' },
        participants: [
          {
            id: 'participant-1',
            characterId: 'character-2',
            name: 'Mira',
            participantType: 'player',
            isActive: true,
            turnOrder: 0,
            maxHp: 22,
            status: { currentHp: 18, maxHp: 22 },
            secret: 'do not expose this',
          },
          {
            id: 'participant-enemy',
            characterId: null,
            name: 'Ogre',
            participantType: 'monster',
            isActive: true,
            turnOrder: 1,
            maxHp: 40,
            status: { currentHp: 8, maxHp: 40 },
            current_hp: 8,
            max_hp: 40,
          },
        ],
        currentParticipant: null,
      } as any,
      requestingCompanionCharacterId: 'character-2',
    });

    expect(Object.keys(scene).sort()).toEqual([
      'campaign',
      'combat',
      'dialogue_history',
      'party',
      'session',
    ]);
    expect(scene).not.toHaveProperty('memories');
    expect(Object.keys(scene.party[0]!).sort()).toEqual([
      'armor_class',
      'class',
      'conditions',
      'current_hp',
      'level',
      'max_hp',
      'name',
      'race',
    ]);
    const enemy = scene.combat!.participants.find((participant) => participant.side === 'enemy')!;
    expect(enemy).toEqual({ name: 'Ogre', side: 'enemy', hp_tier: 'critical' });
    expect(enemy).not.toHaveProperty('current_hp');
    expect(enemy).not.toHaveProperty('max_hp');
    expect(scene.combat!.your_companion_participant_id).toBe('participant-1');
  });

  it('preserves the explicit party HP fields, including stored zero', () => {
    const combat = redactCombatState(
      {
        encounter: { currentRound: 1 },
        participants: [
          {
            id: 'participant-1',
            characterId: 'character-1',
            name: 'Ari',
            participantType: 'player',
            isActive: true,
            turnOrder: 0,
            maxHp: 20,
            status: { currentHp: 0, maxHp: 20 },
          },
        ],
        currentParticipant: null,
      } as any,
      null,
    );
    expect(combat.participants[0]).toEqual({
      name: 'Ari',
      side: 'party',
      current_hp: 0,
      max_hp: 20,
    });
  });

  it('identifies only the requesting companion when multiple companions are seated', () => {
    const state = {
      encounter: { currentRound: 1 },
      participants: [
        {
          id: 'participant-1',
          characterId: 'character-2',
          name: 'Mira',
          participantType: 'player',
          isActive: true,
          turnOrder: 0,
          maxHp: 22,
        },
        {
          id: 'participant-2',
          characterId: 'character-3',
          name: 'Kira',
          participantType: 'player',
          isActive: true,
          turnOrder: 1,
          maxHp: 18,
        },
      ],
      currentParticipant: null,
    } as any;

    expect(redactCombatState(state, 'character-2').your_companion_participant_id).toBe(
      'participant-1',
    );
    expect(redactCombatState(state, 'character-3').your_companion_participant_id).toBe(
      'participant-2',
    );
  });
});
