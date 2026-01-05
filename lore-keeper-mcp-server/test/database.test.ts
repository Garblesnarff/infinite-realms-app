
import { test, describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import sinon from 'sinon';
import { SupabaseClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import * as db from '../src/database.js';
import { clients } from '../src/clients.js';

// Helper to mock the Supabase query builder chain
const setupQueryBuilderMock = (
  fromStub: sinon.SinonStub,
  returnData: any,
  errorData: any = null
) => {
  const queryBuilderMock: any = {
    select: sinon.stub(),
    eq: sinon.stub(),
    contains: sinon.stub(),
    ilike: sinon.stub(),
    in: sinon.stub(),
    limit: sinon.stub(),
    single: sinon.stub(),
    order: sinon.stub(),
    then: (resolve: any) => resolve({ data: returnData, error: errorData }),
  };

  // All chainable methods should return the mock itself.
  Object.keys(queryBuilderMock).forEach(key => {
      if (key !== 'single' && key !== 'then') {
        queryBuilderMock[key].returns(queryBuilderMock);
      }
  });

  // The 'single' method is a terminator that resolves with the data/error.
  queryBuilderMock.single.resolves({ data: returnData, error: errorData });

  fromStub.returns(queryBuilderMock);
  return queryBuilderMock;
};

describe('Database Operations', () => {
  beforeEach(() => {
    // Stub the client creation functions before each test
    sinon.stub(clients, 'createSupabaseClient').returns(sinon.createStubInstance(SupabaseClient));
    sinon.stub(clients, 'createOpenAIClient').returns(sinon.createStubInstance(OpenAI));
  });

  afterEach(() => {
    // Restore all stubs after each test
    sinon.restore();
  });

  describe('Initialization', () => {
    it('should throw an error if a database function is called before initialize()', async () => {
      // Un-stub the initialize method to test the uninitialized state
      sinon.restore();
      // Need to re-stub createClient to avoid actual client creation
      sinon.stub(clients, 'createSupabaseClient');

      await assert.rejects(
        () => db.getNPC('test-campaign', 'Gandalf'),
        /Database not initialized/
      );
    });
  });

  describe('With Initialized DB', () => {
    let supabaseMock: sinon.SinonStubbedInstance<SupabaseClient>;
    let openaiMock: sinon.SinonStubbedInstance<OpenAI>;
    let rpcStub: sinon.SinonStub;
    let fromStub: sinon.SinonStub;

    beforeEach(() => {
      supabaseMock = sinon.createStubInstance(SupabaseClient);
      openaiMock = sinon.createStubInstance(OpenAI);

      // Restore and re-stub to provide our specific mocks
      sinon.restore();
      sinon.stub(clients, 'createSupabaseClient').returns(supabaseMock);
      sinon.stub(clients, 'createOpenAIClient').returns(openaiMock);

      db.initialize('http://dummy.url', 'dummy.key', 'dummy.openai.key');

      rpcStub = sinon.stub();
      (supabaseMock as any).rpc = rpcStub;
      fromStub = sinon.stub();
      (supabaseMock as any).from = fromStub;

      openaiMock.embeddings = {
        create: sinon.stub().resolves({ data: [{ embedding: [0.1, 0.2, 0.3] }] } as any),
      } as any;
    });

    describe('listCampaigns()', () => {
      it('should return campaigns with no filters', async () => {
        const campaignData = [{ id: '1', title: 'Campaign 1' }];
        const { order } = setupQueryBuilderMock(fromStub, campaignData);
        const campaigns = await db.listCampaigns();
        assert.strictEqual(campaigns.length, 1);
        assert(order.calledWith('title'));
      });

      it('should apply genre, difficulty, and featured filters', async () => {
        const campaignData = [{ id: '2', title: 'Filtered Campaign' }];
        const { contains, eq } = setupQueryBuilderMock(fromStub, campaignData);

        await db.listCampaigns({ genre: 'fantasy', difficulty: 'hard', featured: true });

        assert(contains.calledWith('genre', ['fantasy']));
        assert(eq.calledWith('difficulty', 'hard'));
        assert(eq.calledWith('is_featured', true));
      });
    });

    describe('getCampaignOverview()', () => {
        it('should return a campaign overview when found', async () => {
            const overviewData = { id: '1', title: 'Test Campaign' };
            const { single } = setupQueryBuilderMock(fromStub, overviewData);
            const overview = await db.getCampaignOverview('1');
            assert.strictEqual(overview?.title, 'Test Campaign');
            assert(single.called);
        });

        it('should return null for a not-found campaign (PGRST116)', async () => {
            setupQueryBuilderMock(fromStub, null, { code: 'PGRST116' });
            const overview = await db.getCampaignOverview('not-found');
            assert.strictEqual(overview, null);
        });
    });

    describe('getNPC()', () => {
      it('should return an NPC when found', async () => {
        const npcData = { id: '1', entity_name: 'Gandalf', chunk_type: 'npc_tier1' };
        rpcStub.resolves({ data: [npcData], error: null });
        const npc = await db.getNPC('test-campaign', 'Gandalf');
        assert.deepStrictEqual(npc?.entityName, 'Gandalf');
      });

      it('should return null for empty name parameter', async () => {
        const npc = await db.getNPC('test-campaign', '');
        assert.strictEqual(npc, null);
        assert(rpcStub.notCalled);
      });

      it('should use fallback query if RPC fails', async () => {
        const npcData = { id: '1', entity_name: 'Gandalf', chunk_type: 'npc_tier1' };
        rpcStub.resolves({data: null, error: new Error('RPC failed')});
        const { single } = setupQueryBuilderMock(fromStub, npcData);

        const npc = await db.getNPC('test-campaign', 'Gandalf');

        assert(single.called);
        assert.strictEqual(npc?.entityName, 'Gandalf');
      });
    });

    describe('getMechanics()', () => {
        it('should return mechanics for a campaign', async () => {
            const mechanicsData = [{ id: '1', chunk_type: 'mechanic', entity_name: 'Magic System' }];
            setupQueryBuilderMock(fromStub, mechanicsData);
            const mechanics = await db.getMechanics('test-campaign');
            assert.strictEqual(mechanics.length, 1);
        });

        it('should propagate database errors', async () => {
            setupQueryBuilderMock(fromStub, null, { message: 'A generic DB error' });
            await assert.rejects(
                () => db.getMechanics('test-campaign'),
                /Failed to get mechanics: A generic DB error/
            );
        });
    });

    describe('searchLore()', () => {
        it('should apply custom options like limit, threshold, and chunkTypes', async () => {
            const searchData = [{ id: '1', content: 'Some lore', similarity: 0.9 }];
            rpcStub.resolves({ data: searchData, error: null });

            await db.searchLore('test-campaign', 'lore query', {
                limit: 10,
                threshold: 0.8,
                chunkTypes: ['location', 'npc_tier1']
            });

            assert(rpcStub.calledWith('search_campaign_lore', sinon.match({
                p_limit: 10,
                p_threshold: 0.8,
                p_chunk_types: ['location', 'npc_tier1']
            })));
        });
    });

    describe('getStarterParties()', () => {
        it('should return parties for a campaign', async () => {
            const partyData = [{ id: 'p1', party_name: 'The Adventurers' }];
            setupQueryBuilderMock(fromStub, partyData);
            const parties = await db.getStarterParties('test-campaign');
            assert.strictEqual(parties.length, 1);
            assert.strictEqual(parties[0].partyName, 'The Adventurers');
        });

        it('should return an empty array for a campaign with no parties', async () => {
            setupQueryBuilderMock(fromStub, []);
            const parties = await db.getStarterParties('no-party-campaign');
            assert.deepStrictEqual(parties, []);
        });
    });

    describe('getPartyDetails()', () => {
        it('should return party details and characters', async () => {
            const partyData = { id: 'p1', party_name: 'The Crew' };
            const charData = [{ id: 'c1', character_name: 'Bob' }];
            const mock = setupQueryBuilderMock(fromStub, charData);
            // The first call to the builder gets the party...
            mock.single.resolves({ data: partyData, error: null });
            // The second call (without single) gets the characters.
            fromStub.onSecondCall().returns(mock);

            const details = await db.getPartyDetails('p1');

            assert.strictEqual(details?.party.partyName, 'The Crew');
            assert.strictEqual(details?.characters.length, 1);
            assert.strictEqual(details?.characters[0].characterName, 'Bob');
        });

        it('should return null if party is not found', async () => {
            setupQueryBuilderMock(fromStub, null, { code: 'PGRST116' });
            const details = await db.getPartyDetails('not-found');
            assert.strictEqual(details, null);
        });

        it('should return a party with no characters', async () => {
            const partyData = { id: 'p1', party_name: 'Solo Act' };
            const mock = setupQueryBuilderMock(fromStub, []); // char data is empty
            mock.single.resolves({ data: partyData, error: null });// party data is not
            fromStub.onSecondCall().returns(mock);

            const details = await db.getPartyDetails('p1');

            assert.strictEqual(details?.party.partyName, 'Solo Act');
            assert.deepStrictEqual(details?.characters, []);
        });
    });
  });
});
