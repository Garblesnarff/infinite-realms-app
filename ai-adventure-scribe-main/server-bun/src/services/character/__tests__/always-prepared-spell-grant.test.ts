import { beforeEach, describe, expect, it, mock } from 'bun:test';

const CHARACTER_ID = 'character-1';
const USER_ID = 'user-1';

let characterRows: any[] = [];
let subclassRows: any[] = [];
let classRows: any[] = [];
let spellCatalogRows: any[] = [];
let heldRows: any[] = [];
const insertedSpells: any[] = [];
const updatedHeld: any[] = [];
const updatedCharacters: any[] = [];
const warnCalls: any[] = [];

function makeSelectChain() {
  let table: any = null;
  const chain: any = {
    from: (t: any) => {
      table = t;
      return chain;
    },
    where: () => chain,
    limit: () => chain,
    innerJoin: () => chain,
    then: (resolve: (rows: any[]) => unknown) => {
      switch (table?.__t) {
        case 'characters':
          return resolve(characterRows);
        case 'characterSubclasses':
          return resolve(subclassRows);
        case 'classes':
          return resolve(classRows);
        case 'spells':
          return resolve(spellCatalogRows);
        case 'characterSpells':
          return resolve(heldRows);
        default:
          return resolve([]);
      }
    },
  };
  return chain;
}

const selectMock = mock(() => makeSelectChain());
const insertMock = mock((_table: any) => ({
  values: (vals: any) => {
    insertedSpells.push(...(Array.isArray(vals) ? vals : [vals]));
    return Object.assign(Promise.resolve(), { onConflictDoUpdate: () => Promise.resolve() });
  },
}));
const updateMock = mock((table: any) => ({
  set: (values: any) => ({
    where: () => {
      if (table?.__t === 'characterSpells') updatedHeld.push(values);
      if (table?.__t === 'characters') updatedCharacters.push(values);
      return Promise.resolve();
    },
  }),
}));
const transactionMock = mock(async (cb: (tx: any) => Promise<unknown>) => cb(db));
const executeMock = mock(async () => ({}));

const db: any = {
  select: selectMock,
  insert: insertMock,
  update: updateMock,
  transaction: transactionMock,
  execute: executeMock,
};

mock.module('../../../../../db/client', () => ({ db }));
mock.module('../../../../../db/schema/index', () => ({
  characters: { __t: 'characters' },
  characterSpells: { __t: 'characterSpells' },
  characterSubclasses: { __t: 'characterSubclasses' },
  classes: { __t: 'classes' },
  spells: { __t: 'spells' },
}));
mock.module('../../../lib/logger.js', () => ({
  logger: {
    warn: (...args: any[]) => {
      warnCalls.push(args);
      return undefined;
    },
    info: mock(() => {}),
    error: mock(() => {}),
    debug: mock(() => {}),
    child: () => ({}),
  },
  combatLogger: {
    warn: mock(() => {}),
    info: mock(() => {}),
    error: mock(() => {}),
    debug: mock(() => {}),
    child: () => ({}),
  },
  spellLogger: {
    warn: mock(() => {}),
    info: mock(() => {}),
    error: mock(() => {}),
    debug: mock(() => {}),
    child: () => ({}),
  },
  progressionLogger: {
    warn: mock(() => {}),
    info: mock(() => {}),
    error: mock(() => {}),
    debug: mock(() => {}),
    child: () => ({}),
  },
  errorLogSerializers: {},
  default: {},
}));

const { grantAlwaysPreparedSubclassSpells } = await import('../always-prepared-spell-grant.js');

describe('grantAlwaysPreparedSubclassSpells logging (#1567)', () => {
  beforeEach(() => {
    characterRows = [
      {
        id: CHARACTER_ID,
        class: 'Paladin',
        level: 3,
        classLevels: null,
        classFeatures: null,
        knownSpells: 'Bless',
      },
    ];
    subclassRows = [{ className: 'Paladin', subclassName: 'Oath of Devotion' }];
    classRows = [{ id: 'paladin-class' }];
    spellCatalogRows = [{ id: 's1', name: 'Sanctuary', level: 1 }];
    heldRows = [];
    insertedSpells.length = 0;
    updatedHeld.length = 0;
    updatedCharacters.length = 0;
    warnCalls.length = 0;
    selectMock.mockClear();
    insertMock.mockClear();
    updateMock.mockClear();
    transactionMock.mockClear();
    executeMock.mockClear();
  });

  it('logs ALWAYS_PREPARED_SPELL_MISSING with missing names and count, no user ids', async () => {
    await grantAlwaysPreparedSubclassSpells(CHARACTER_ID, USER_ID);

    expect(warnCalls).toHaveLength(1);
    const payload = warnCalls[0][0];
    expect(payload.event).toBe('ALWAYS_PREPARED_SPELL_MISSING');
    expect(payload.missing).toEqual(['Protection from Evil and Good']);
    expect(payload.count).toBe(1);

    // no user identifiers
    expect(payload).not.toHaveProperty('characterId');
    expect(payload).not.toHaveProperty('userId');
    expect(payload).not.toHaveProperty('email');
    expect(payload).not.toHaveProperty('campaign');
    expect(payload).not.toHaveProperty('campaignId');

    // grants the found spell
    expect(insertedSpells).toHaveLength(1);
    expect(insertedSpells[0].spellId).toBe('s1');
  });

  it('does not log when all names are present', async () => {
    spellCatalogRows = [
      { id: 's1', name: 'Sanctuary', level: 1 },
      { id: 's2', name: 'Protection from Evil and Good', level: 1 },
    ];
    await grantAlwaysPreparedSubclassSpells(CHARACTER_ID, USER_ID);
    expect(warnCalls).toHaveLength(0);
  });
});
