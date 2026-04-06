/**
 * Tests for SqliteStore - TASK-013
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStore } from '../../src/storage/sqlite-store.js';
import Database from 'better-sqlite3';
import { unlinkSync, existsSync } from 'fs';

const TEST_DB_PATH = './data/test-sqlite-store.db';

describe('SqliteStore', () => {
  let store: SqliteStore;

  beforeEach(async () => {
    // Clean up if exists
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
    store = new SqliteStore(TEST_DB_PATH);
  });

  afterEach(async () => {
    await store.close();
    // Clean up
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
  });

  describe('initSchema', () => {
    it('should create all 5 tables', async () => {
      await store.initSchema();

      // Check tables via SQL
      const db = new Database(TEST_DB_PATH);
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as { name: string }[];
      db.close();

      const tableNames = tables.map((t) => t.name);
      expect(tableNames).toContain('shows');
      expect(tableNames).toContain('show_characters');
      expect(tableNames).toContain('show_events');
      expect(tableNames).toContain('llm_calls');
      expect(tableNames).toContain('token_budgets');
    });

    it('should create indexes for show_events', async () => {
      await store.initSchema();

      const db = new Database(TEST_DB_PATH);
      const indexes = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='show_events'"
        )
        .all() as { name: string }[];
      db.close();

      const indexNames = indexes.map((i) => i.name);
      expect(indexNames).toContain('idx_show_events_show_id');
      expect(indexNames).toContain('idx_show_events_sequence');
    });
  });

  describe('shows CRUD - TASK-014', () => {
    beforeEach(async () => {
      await store.initSchema();
    });

    it('should create and get a show', async () => {
      const show = {
        id: 'show-001',
        formatId: 'coalition-v1',
        seed: 'test-seed-123',
        status: 'running' as const,
        currentPhaseId: 'phase-1',
        startedAt: Date.now(),
        completedAt: null,
        configSnapshot: JSON.stringify({ maxPlayers: 5 }),
      };

      const returnedId = await store.createShow(show);
      expect(returnedId).toBe('show-001'); // createShow must return id
      const retrieved = await store.getShow('show-001');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe('show-001');
      expect(retrieved!.formatId).toBe('coalition-v1');
      expect(retrieved!.seed).toBe('test-seed-123');
      expect(retrieved!.status).toBe('running');
      expect(retrieved!.currentPhaseId).toBe('phase-1');
    });

    it('should update show status and verify changes', async () => {
      const show = {
        id: 'show-002',
        formatId: 'coalition-v1',
        seed: 'seed-456',
        status: 'running' as const,
        currentPhaseId: 'phase-1',
        startedAt: Date.now(),
        completedAt: null,
        configSnapshot: JSON.stringify({}),
      };

      await store.createShow(show);

      // Update status to completed
      await store.updateShow('show-002', {
        status: 'completed' as const,
        completedAt: Date.now(),
        currentPhaseId: null,
      });

      const updated = await store.getShow('show-002');

      expect(updated).not.toBeNull();
      expect(updated!.status).toBe('completed');
      expect(updated!.completedAt).not.toBeNull();
      expect(updated!.currentPhaseId).toBeNull();
    });

    it('should list all shows', async () => {
      const shows = [
        {
          id: 'show-a',
          formatId: 'format-1',
          seed: 'seed-a',
          status: 'running' as const,
          currentPhaseId: 'p1',
          startedAt: Date.now(),
          completedAt: null,
          configSnapshot: '{}',
        },
        {
          id: 'show-b',
          formatId: 'format-1',
          seed: 'seed-b',
          status: 'completed' as const,
          currentPhaseId: null,
          startedAt: Date.now() - 1000,
          completedAt: Date.now(),
          configSnapshot: '{}',
        },
      ];

      for (const s of shows) {
        await store.createShow(s);
      }

      const allShows = await store.listShows();
      expect(allShows.length).toBe(2);

      const runningShows = await store.listShows('running');
      expect(runningShows.length).toBe(1);
      expect(runningShows[0].id).toBe('show-a');
    });

    it('should return null for non-existent show', async () => {
      const result = await store.getShow('non-existent');
      expect(result).toBeNull();
    });

    it('should serialize configSnapshot as JSON', async () => {
      const config = { maxPlayers: 5, phases: ['intro', 'main', 'finale'] };
      const show = {
        id: 'show-json',
        formatId: 'format-1',
        seed: 'seed',
        status: 'running' as const,
        currentPhaseId: null,
        startedAt: Date.now(),
        completedAt: null,
        configSnapshot: JSON.stringify(config),
      };

      await store.createShow(show);
      const retrieved = await store.getShow('show-json');

      expect(retrieved).not.toBeNull();
      const parsedConfig = JSON.parse(retrieved!.configSnapshot);
      expect(parsedConfig.maxPlayers).toBe(5);
      expect(parsedConfig.phases).toEqual(['intro', 'main', 'finale']);
    });
  });

  describe('show_characters CRUD - TASK-015', () => {
    beforeEach(async () => {
      await store.initSchema();
      // Create a show to associate characters with
      await store.createShow({
        id: 'show-chars',
        formatId: 'coalition-v1',
        seed: 'chars-seed',
        status: 'running' as const,
        currentPhaseId: 'phase-1',
        startedAt: Date.now(),
        completedAt: null,
        configSnapshot: '{}',
      });
    });

    it('should add and get characters for a show', async () => {
      const chars = [
        {
          showId: 'show-chars',
          characterId: 'char-1',
          modelAdapterId: 'openai-gpt4',
          privateContext: {
            secrets: ['I am the traitor'],
            alliances: [],
            goals: ['Win the game'],
            wildcards: [],
          },
        },
        {
          showId: 'show-chars',
          characterId: 'char-2',
          modelAdapterId: 'openai-gpt4',
          privateContext: {
            secrets: [],
            alliances: [{ partnerId: 'char-1', agreement: 'Help each other', isActive: true }],
            goals: ['Survive'],
            wildcards: [],
          },
        },
        {
          showId: 'show-chars',
          characterId: 'char-3',
          modelAdapterId: 'mock-adapter',
          privateContext: {
            secrets: ['Secret mission'],
            alliances: [],
            goals: ['Complete mission'],
            wildcards: [{ content: 'Immunity idol', isRevealed: false }],
          },
        },
      ];

      // Add 3 characters
      for (const char of chars) {
        await store.createCharacter(char);
      }

      // Get all characters for the show
      const retrieved = await store.getCharacters('show-chars');
      expect(retrieved.length).toBe(3);

      // Verify character IDs
      const charIds = retrieved.map((c) => c.characterId);
      expect(charIds).toContain('char-1');
      expect(charIds).toContain('char-2');
      expect(charIds).toContain('char-3');
    });

    it('should get a single character by showId and characterId', async () => {
      await store.createCharacter({
        showId: 'show-chars',
        characterId: 'char-single',
        modelAdapterId: 'openai-gpt4',
        privateContext: {
          secrets: ['My secret'],
          alliances: [],
          goals: ['Win'],
          wildcards: [],
        },
      });

      const retrieved = await store.getCharacter('show-chars', 'char-single');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.characterId).toBe('char-single');
      expect(retrieved!.modelAdapterId).toBe('openai-gpt4');
      expect(retrieved!.privateContext.secrets).toEqual(['My secret']);
    });

    it('should return null for non-existent character', async () => {
      const result = await store.getCharacter('show-chars', 'non-existent');
      expect(result).toBeNull();
    });

    it('should serialize and deserialize privateContext as JSON', async () => {
      const privateContext = {
        secrets: ['Secret 1', 'Secret 2'],
        alliances: [
          { partnerId: 'ally-1', agreement: 'Mutual defense', isActive: true },
          { partnerId: 'ally-2', agreement: 'Trade deal', isActive: false },
        ],
        goals: ['Primary goal', 'Secondary goal'],
        wildcards: [
          { content: 'Power card', isRevealed: false },
          { content: 'Used card', isRevealed: true },
        ],
      };

      await store.createCharacter({
        showId: 'show-chars',
        characterId: 'char-json',
        modelAdapterId: 'adapter-1',
        privateContext,
      });

      const retrieved = await store.getCharacter('show-chars', 'char-json');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.privateContext.secrets).toEqual(['Secret 1', 'Secret 2']);
      expect(retrieved!.privateContext.alliances.length).toBe(2);
      expect(retrieved!.privateContext.alliances[0].partnerId).toBe('ally-1');
      expect(retrieved!.privateContext.alliances[1].isActive).toBe(false);
      expect(retrieved!.privateContext.goals).toEqual(['Primary goal', 'Secondary goal']);
      expect(retrieved!.privateContext.wildcards.length).toBe(2);
      expect(retrieved!.privateContext.wildcards[0].isRevealed).toBe(false);
    });

    it('should update character private context', async () => {
      await store.createCharacter({
        showId: 'show-chars',
        characterId: 'char-update',
        modelAdapterId: 'adapter-1',
        privateContext: {
          secrets: ['Initial secret'],
          alliances: [],
          goals: ['Initial goal'],
          wildcards: [],
        },
      });

      // Update the private context
      await store.updateShowCharacterContext('show-chars', 'char-update', {
        secrets: ['Updated secret', 'New secret'],
        alliances: [{ partnerId: 'new-ally', agreement: 'New alliance', isActive: true }],
        goals: ['Updated goal'],
        wildcards: [{ content: 'New wildcard', isRevealed: false }],
      });

      const retrieved = await store.getCharacter('show-chars', 'char-update');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.privateContext.secrets).toEqual(['Updated secret', 'New secret']);
      expect(retrieved!.privateContext.alliances.length).toBe(1);
      expect(retrieved!.privateContext.alliances[0].partnerId).toBe('new-ally');
      expect(retrieved!.privateContext.wildcards.length).toBe(1);
    });
  });

  describe('show_events CRUD - TASK-016', () => {
    beforeEach(async () => {
      await store.initSchema();
      // Create a show to associate events with
      await store.createShow({
        id: 'show-events',
        formatId: 'coalition-v1',
        seed: 'events-seed',
        status: 'running' as const,
        currentPhaseId: 'phase-1',
        startedAt: Date.now(),
        completedAt: null,
        configSnapshot: '{}',
      });
    });

    it('should append events and auto-increment sequenceNumber', async () => {
      const baseEvent = {
        id: '',
        showId: 'show-events',
        timestamp: Date.now(),
        phaseId: 'phase-1',
        type: 'speech' as const,
        channel: 'PUBLIC' as const,
        visibility: 'PUBLIC' as const,
        senderId: 'char-1',
        receiverIds: [] as string[],
        audienceIds: ['char-1', 'char-2', 'char-3'],
        content: '',
        metadata: {},
        seed: 'test-seed',
      };

      // Append 5 events
      const seq1 = await store.appendEvent({ ...baseEvent, id: 'evt-1', content: 'Message 1' });
      const seq2 = await store.appendEvent({ ...baseEvent, id: 'evt-2', content: 'Message 2' });
      const seq3 = await store.appendEvent({ ...baseEvent, id: 'evt-3', content: 'Message 3' });
      const seq4 = await store.appendEvent({ ...baseEvent, id: 'evt-4', content: 'Message 4' });
      const seq5 = await store.appendEvent({ ...baseEvent, id: 'evt-5', content: 'Message 5' });

      expect(seq1).toBe(1);
      expect(seq2).toBe(2);
      expect(seq3).toBe(3);
      expect(seq4).toBe(4);
      expect(seq5).toBe(5);
    });

    it('should get events in order by sequenceNumber', async () => {
      const baseEvent = {
        id: '',
        showId: 'show-events',
        timestamp: Date.now(),
        phaseId: 'phase-1',
        type: 'speech' as const,
        channel: 'PUBLIC' as const,
        visibility: 'PUBLIC' as const,
        senderId: 'char-1',
        receiverIds: [] as string[],
        audienceIds: ['char-1', 'char-2'],
        content: '',
        metadata: {},
        seed: 'test-seed',
      };

      // Add events out of timestamp order but sequenceNumber should be in order
      await store.appendEvent({ ...baseEvent, id: 'evt-a', content: 'First' });
      await store.appendEvent({ ...baseEvent, id: 'evt-b', content: 'Second' });
      await store.appendEvent({ ...baseEvent, id: 'evt-c', content: 'Third' });

      const events = await store.getEvents('show-events');

      expect(events.length).toBe(3);
      expect(events[0].content).toBe('First');
      expect(events[0].sequenceNumber).toBe(1);
      expect(events[1].content).toBe('Second');
      expect(events[1].sequenceNumber).toBe(2);
      expect(events[2].content).toBe('Third');
      expect(events[2].sequenceNumber).toBe(3);
    });

    it('should delete events after sequence number (rollback)', async () => {
      const baseEvent = {
        id: '',
        showId: 'show-events',
        timestamp: Date.now(),
        phaseId: 'phase-1',
        type: 'speech' as const,
        channel: 'PUBLIC' as const,
        visibility: 'PUBLIC' as const,
        senderId: 'char-1',
        receiverIds: [] as string[],
        audienceIds: ['char-1', 'char-2', 'char-3'],
        content: '',
        metadata: {},
        seed: 'test-seed',
      };

      // Add 5 events
      await store.appendEvent({ ...baseEvent, id: 'evt-1', content: 'Message 1' });
      await store.appendEvent({ ...baseEvent, id: 'evt-2', content: 'Message 2' });
      await store.appendEvent({ ...baseEvent, id: 'evt-3', content: 'Message 3' });
      await store.appendEvent({ ...baseEvent, id: 'evt-4', content: 'Message 4' });
      await store.appendEvent({ ...baseEvent, id: 'evt-5', content: 'Message 5' });

      // Verify 5 events exist
      let events = await store.getEvents('show-events');
      expect(events.length).toBe(5);

      // Rollback to sequence 3 (delete events after 3)
      await store.deleteEventsAfter('show-events', 3);

      // Verify only 3 events remain
      events = await store.getEvents('show-events');
      expect(events.length).toBe(3);
      expect(events[0].sequenceNumber).toBe(1);
      expect(events[1].sequenceNumber).toBe(2);
      expect(events[2].sequenceNumber).toBe(3);
    });

    it('should filter events by audience (getEventsForCharacter)', async () => {
      const timestamp = Date.now();

      // Event visible to char-1 and char-2 only
      await store.appendEvent({
        id: 'evt-private-12',
        showId: 'show-events',
        timestamp,
        phaseId: 'phase-1',
        type: 'speech' as const,
        channel: 'PRIVATE' as const,
        visibility: 'PRIVATE' as const,
        senderId: 'char-1',
        receiverIds: ['char-2'],
        audienceIds: ['char-1', 'char-2'],
        content: 'Private between 1 and 2',
        metadata: {},
        seed: 'test-seed',
      });

      // Event visible to everyone (char-1, char-2, char-3)
      await store.appendEvent({
        id: 'evt-public',
        showId: 'show-events',
        timestamp,
        phaseId: 'phase-1',
        type: 'speech' as const,
        channel: 'PUBLIC' as const,
        visibility: 'PUBLIC' as const,
        senderId: 'char-2',
        receiverIds: [],
        audienceIds: ['char-1', 'char-2', 'char-3'],
        content: 'Public message',
        metadata: {},
        seed: 'test-seed',
      });

      // Event visible to char-2 and char-3 only
      await store.appendEvent({
        id: 'evt-private-23',
        showId: 'show-events',
        timestamp,
        phaseId: 'phase-1',
        type: 'speech' as const,
        channel: 'PRIVATE' as const,
        visibility: 'PRIVATE' as const,
        senderId: 'char-2',
        receiverIds: ['char-3'],
        audienceIds: ['char-2', 'char-3'],
        content: 'Private between 2 and 3',
        metadata: {},
        seed: 'test-seed',
      });

      // Check char-1 sees 2 events
      const char1Events = await store.getEventsForCharacter('show-events', 'char-1');
      expect(char1Events.length).toBe(2);

      // Check char-2 sees all 3 events
      const char2Events = await store.getEventsForCharacter('show-events', 'char-2');
      expect(char2Events.length).toBe(3);

      // Check char-3 sees 2 events
      const char3Events = await store.getEventsForCharacter('show-events', 'char-3');
      expect(char3Events.length).toBe(2);
    });

    it('should get latest sequence number', async () => {
      const baseEvent = {
        id: '',
        showId: 'show-events',
        timestamp: Date.now(),
        phaseId: 'phase-1',
        type: 'speech' as const,
        channel: 'PUBLIC' as const,
        visibility: 'PUBLIC' as const,
        senderId: 'char-1',
        receiverIds: [] as string[],
        audienceIds: ['char-1'],
        content: 'Test',
        metadata: {},
        seed: 'test-seed',
      };

      // Initially no events
      let latest = await store.getLatestSequence('show-events');
      expect(latest).toBe(0);

      // Add some events
      await store.appendEvent({ ...baseEvent, id: 'evt-1' });
      await store.appendEvent({ ...baseEvent, id: 'evt-2' });
      await store.appendEvent({ ...baseEvent, id: 'evt-3' });

      latest = await store.getLatestSequence('show-events');
      expect(latest).toBe(3);

      // After rollback
      await store.deleteEventsAfter('show-events', 1);
      latest = await store.getLatestSequence('show-events');
      expect(latest).toBe(1);
    });

    it('should get events from a specific sequence number', async () => {
      const baseEvent = {
        id: '',
        showId: 'show-events',
        timestamp: Date.now(),
        phaseId: 'phase-1',
        type: 'speech' as const,
        channel: 'PUBLIC' as const,
        visibility: 'PUBLIC' as const,
        senderId: 'char-1',
        receiverIds: [] as string[],
        audienceIds: ['char-1'],
        content: '',
        metadata: {},
        seed: 'test-seed',
      };

      await store.appendEvent({ ...baseEvent, id: 'evt-1', content: 'One' });
      await store.appendEvent({ ...baseEvent, id: 'evt-2', content: 'Two' });
      await store.appendEvent({ ...baseEvent, id: 'evt-3', content: 'Three' });
      await store.appendEvent({ ...baseEvent, id: 'evt-4', content: 'Four' });

      // Get events from sequence 3 onwards
      const events = await store.getEvents('show-events', 3);
      expect(events.length).toBe(2);
      expect(events[0].content).toBe('Three');
      expect(events[1].content).toBe('Four');
    });
  });

  describe('llm_calls and token_budgets CRUD - TASK-017', () => {
    beforeEach(async () => {
      await store.initSchema();
      // Create a show to associate with
      await store.createShow({
        id: 'show-llm',
        formatId: 'coalition-v1',
        seed: 'llm-seed',
        status: 'running' as const,
        currentPhaseId: 'phase-1',
        startedAt: Date.now(),
        completedAt: null,
        configSnapshot: '{}',
      });
    });

    it('should create and get token budget', async () => {
      const budget = {
        showId: 'show-llm',
        totalLimit: 100000,
        usedPrompt: 0,
        usedCompletion: 0,
        mode: 'normal' as const,
        lastUpdated: Date.now(),
      };

      await store.createBudget(budget);
      const retrieved = await store.getBudget('show-llm');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.showId).toBe('show-llm');
      expect(retrieved!.totalLimit).toBe(100000);
      expect(retrieved!.usedPrompt).toBe(0);
      expect(retrieved!.usedCompletion).toBe(0);
      expect(retrieved!.mode).toBe('normal');
    });

    it('should update token budget with used tokens', async () => {
      await store.createBudget({
        showId: 'show-llm',
        totalLimit: 100000,
        usedPrompt: 0,
        usedCompletion: 0,
        mode: 'normal' as const,
        lastUpdated: Date.now(),
      });

      // Add some tokens
      await store.updateBudget('show-llm', 500, 200);

      let budget = await store.getBudget('show-llm');
      expect(budget!.usedPrompt).toBe(500);
      expect(budget!.usedCompletion).toBe(200);

      // Add more tokens
      await store.updateBudget('show-llm', 300, 100);

      budget = await store.getBudget('show-llm');
      expect(budget!.usedPrompt).toBe(800);
      expect(budget!.usedCompletion).toBe(300);
    });

    it('should return null for non-existent budget', async () => {
      const result = await store.getBudget('non-existent');
      expect(result).toBeNull();
    });

    it('should set budget mode', async () => {
      await store.createBudget({
        showId: 'show-llm',
        totalLimit: 100000,
        usedPrompt: 0,
        usedCompletion: 0,
        mode: 'normal' as const,
        lastUpdated: Date.now(),
      });

      await store.setBudgetMode('show-llm', 'budget_saving');
      let budget = await store.getBudget('show-llm');
      expect(budget!.mode).toBe('budget_saving');

      await store.setBudgetMode('show-llm', 'graceful_finish');
      budget = await store.getBudget('show-llm');
      expect(budget!.mode).toBe('graceful_finish');
    });

    it('should log LLM call and retrieve by showId', async () => {
      const call = {
        id: 'llm-call-1',
        eventId: 'evt-1',
        showId: 'show-llm',
        characterId: 'char-1',
        modelAdapterId: 'openai-gpt4',
        promptTokens: 500,
        completionTokens: 200,
        rawRequest: JSON.stringify({ prompt: 'Hello' }),
        rawResponse: JSON.stringify({ text: 'Hi there' }),
        latencyMs: 150,
        createdAt: Date.now(),
      };

      await store.logLLMCall(call);

      const calls = await store.getLLMCalls('show-llm');
      expect(calls.length).toBe(1);
      expect(calls[0].id).toBe('llm-call-1');
      expect(calls[0].characterId).toBe('char-1');
      expect(calls[0].promptTokens).toBe(500);
      expect(calls[0].completionTokens).toBe(200);
    });

    it('should get LLM call by eventId', async () => {
      const call1 = {
        id: 'llm-call-1',
        eventId: 'evt-1',
        showId: 'show-llm',
        characterId: 'char-1',
        modelAdapterId: 'openai-gpt4',
        promptTokens: 500,
        completionTokens: 200,
        rawRequest: '{}',
        rawResponse: '{}',
        latencyMs: 150,
        createdAt: Date.now(),
      };

      const call2 = {
        id: 'llm-call-2',
        eventId: 'evt-2',
        showId: 'show-llm',
        characterId: 'char-2',
        modelAdapterId: 'openai-gpt4',
        promptTokens: 400,
        completionTokens: 150,
        rawRequest: '{}',
        rawResponse: '{}',
        latencyMs: 120,
        createdAt: Date.now() + 100,
      };

      await store.logLLMCall(call1);
      await store.logLLMCall(call2);

      // Get by eventId
      const retrieved = await store.getLLMCallByEventId('evt-1');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe('llm-call-1');
      expect(retrieved!.characterId).toBe('char-1');

      // Get another by eventId
      const retrieved2 = await store.getLLMCallByEventId('evt-2');
      expect(retrieved2).not.toBeNull();
      expect(retrieved2!.id).toBe('llm-call-2');
      expect(retrieved2!.characterId).toBe('char-2');
    });

    it('should return null for non-existent eventId', async () => {
      const result = await store.getLLMCallByEventId('non-existent');
      expect(result).toBeNull();
    });

    it('should handle LLM call with null eventId', async () => {
      const call = {
        id: 'llm-call-no-event',
        eventId: null,
        showId: 'show-llm',
        characterId: 'char-1',
        modelAdapterId: 'mock-adapter',
        promptTokens: null,
        completionTokens: null,
        rawRequest: '{}',
        rawResponse: '{}',
        latencyMs: null,
        createdAt: Date.now(),
      };

      await store.logLLMCall(call);

      const calls = await store.getLLMCalls('show-llm');
      expect(calls.length).toBe(1);
      expect(calls[0].eventId).toBeNull();
      expect(calls[0].promptTokens).toBeNull();
    });
  });
});
