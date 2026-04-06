/**
 * Tests for ContextBuilder
 * TASK-025: Context Builder: метод buildFactsList()
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContextBuilder } from '../../src/core/context-builder.js';
import { EventJournal } from '../../src/core/event-journal.js';
import { IStore, ShowCharacterRecord } from '../../src/types/interfaces/store.interface.js';
import { ShowEvent } from '../../src/types/events.js';
import { EventType, ChannelType, SpeakFrequency } from '../../src/types/enums.js';
import { PrivateContext } from '../../src/types/context.js';

// Mock store implementation
function createMockStore(overrides: Partial<IStore> = {}): IStore {
  return {
    createShow: vi.fn(),
    getShow: vi.fn(),
    updateShow: vi.fn(),
    listShows: vi.fn(),
    createCharacter: vi.fn(),
    getCharacter: vi.fn().mockResolvedValue(null),
    getCharacters: vi.fn(),
    updateShowCharacterContext: vi.fn(),
    appendEvent: vi.fn(),
    getEvents: vi.fn().mockResolvedValue([]),
    getEventsForCharacter: vi.fn().mockResolvedValue([]),
    deleteEventsAfter: vi.fn(),
    getLatestSequence: vi.fn().mockResolvedValue(0),
    logLLMCall: vi.fn(),
    getLLMCalls: vi.fn(),
    getLLMCallByEventId: vi.fn(),
    createBudget: vi.fn(),
    getBudget: vi.fn(),
    updateBudget: vi.fn(),
    setBudgetMode: vi.fn(),
    initSchema: vi.fn(),
    close: vi.fn(),
    ...overrides,
  } as IStore;
}

function createTestPrivateContext(): PrivateContext {
  return {
    secrets: ['I know where the money is hidden', 'I am actually a spy'],
    goals: ['Win the game', 'Expose the traitor'],
    alliances: [
      { partnerId: 'char-2', agreement: 'Vote together', isActive: true },
      { partnerId: 'char-3', agreement: 'Old alliance', isActive: false },
    ],
    wildcards: [
      { content: 'I have evidence of the crime', isRevealed: false },
      { content: 'My secret identity', isRevealed: true },
    ],
  };
}

function createTestCharacter(characterId: string, privateContext: PrivateContext): ShowCharacterRecord {
  return {
    showId: 'show-1',
    characterId,
    modelAdapterId: 'mock-adapter',
    privateContext,
  };
}

function createRevelationEvent(
  senderId: string,
  content: string,
  audienceIds: string[],
  sequenceNumber: number
): ShowEvent {
  return {
    id: `event-${sequenceNumber}`,
    showId: 'show-1',
    timestamp: Date.now(),
    sequenceNumber,
    phaseId: 'phase-1',
    type: EventType.revelation,
    channel: ChannelType.PUBLIC,
    visibility: ChannelType.PUBLIC,
    senderId,
    receiverIds: [],
    audienceIds,
    content,
    metadata: {},
    seed: 'test-seed',
  };
}

describe('ContextBuilder', () => {
  describe('buildFactsList', () => {
    it('should return empty array for non-existent character', async () => {
      const store = createMockStore();
      const journal = new EventJournal(store);
      const builder = new ContextBuilder(journal, store);

      const facts = await builder.buildFactsList('non-existent', 'show-1');

      expect(facts).toEqual([]);
    });

    it('should include all secrets from private context', async () => {
      const privateContext = createTestPrivateContext();
      const character = createTestCharacter('char-1', privateContext);
      const store = createMockStore({
        getCharacter: vi.fn().mockResolvedValue(character),
      });
      const journal = new EventJournal(store);
      const builder = new ContextBuilder(journal, store);

      const facts = await builder.buildFactsList('char-1', 'show-1');

      expect(facts).toContain('[Secret] I know where the money is hidden');
      expect(facts).toContain('[Secret] I am actually a spy');
    });

    it('should include all goals from private context', async () => {
      const privateContext = createTestPrivateContext();
      const character = createTestCharacter('char-1', privateContext);
      const store = createMockStore({
        getCharacter: vi.fn().mockResolvedValue(character),
      });
      const journal = new EventJournal(store);
      const builder = new ContextBuilder(journal, store);

      const facts = await builder.buildFactsList('char-1', 'show-1');

      expect(facts).toContain('[Goal] Win the game');
      expect(facts).toContain('[Goal] Expose the traitor');
    });

    it('should include only active alliances', async () => {
      const privateContext = createTestPrivateContext();
      const character = createTestCharacter('char-1', privateContext);
      const store = createMockStore({
        getCharacter: vi.fn().mockResolvedValue(character),
      });
      const journal = new EventJournal(store);
      const builder = new ContextBuilder(journal, store);

      const facts = await builder.buildFactsList('char-1', 'show-1');

      // Active alliance should be included
      expect(facts).toContainEqual(expect.stringContaining('Partner: char-2'));
      expect(facts).toContainEqual(expect.stringContaining('Vote together'));

      // Inactive alliance should not be included
      expect(facts).not.toContainEqual(expect.stringContaining('Partner: char-3'));
      expect(facts).not.toContainEqual(expect.stringContaining('Old alliance'));
    });

    it('should include only unrevealed wildcards from private context', async () => {
      const privateContext = createTestPrivateContext();
      const character = createTestCharacter('char-1', privateContext);
      const store = createMockStore({
        getCharacter: vi.fn().mockResolvedValue(character),
      });
      const journal = new EventJournal(store);
      const builder = new ContextBuilder(journal, store);

      const facts = await builder.buildFactsList('char-1', 'show-1');

      // Unrevealed wildcard should be included
      expect(facts).toContain('[Wildcard] I have evidence of the crime');

      // Revealed wildcard should NOT be in [Wildcard] format (it will come from journal)
      expect(facts).not.toContain('[Wildcard] My secret identity');
    });

    it('should include revealed wildcards from journal events', async () => {
      const privateContext = createTestPrivateContext();
      const character = createTestCharacter('char-1', privateContext);

      // Create revelation events visible to char-1
      const revelationEvents: ShowEvent[] = [
        createRevelationEvent('char-1', 'My secret identity', ['char-1', 'char-2', 'char-3'], 1),
        createRevelationEvent('char-2', 'I was the traitor all along', ['char-1', 'char-2', 'char-3'], 2),
      ];

      const store = createMockStore({
        getCharacter: vi.fn().mockResolvedValue(character),
        getEventsForCharacter: vi.fn().mockResolvedValue(revelationEvents),
      });
      const journal = new EventJournal(store);
      const builder = new ContextBuilder(journal, store);

      const facts = await builder.buildFactsList('char-1', 'show-1');

      // Own revealed wildcard
      expect(facts).toContain('[My Revealed Wildcard] My secret identity');

      // Others' revealed wildcard
      expect(facts).toContain('[Revealed by char-2] I was the traitor all along');
    });

    it('should collect facts correctly from full private context', async () => {
      const privateContext = createTestPrivateContext();
      const character = createTestCharacter('char-1', privateContext);

      const revelationEvent = createRevelationEvent(
        'char-2',
        'Revealed secret',
        ['char-1', 'char-2'],
        1
      );

      const store = createMockStore({
        getCharacter: vi.fn().mockResolvedValue(character),
        getEventsForCharacter: vi.fn().mockResolvedValue([revelationEvent]),
      });
      const journal = new EventJournal(store);
      const builder = new ContextBuilder(journal, store);

      const facts = await builder.buildFactsList('char-1', 'show-1');

      // Expected: 2 secrets + 2 goals + 1 active alliance + 1 unrevealed wildcard + 1 revealed from journal = 7
      expect(facts.length).toBe(7);

      // Verify structure
      expect(facts.filter(f => f.startsWith('[Secret]')).length).toBe(2);
      expect(facts.filter(f => f.startsWith('[Goal]')).length).toBe(2);
      expect(facts.filter(f => f.startsWith('[Alliance]')).length).toBe(1);
      expect(facts.filter(f => f.startsWith('[Wildcard]')).length).toBe(1);
      expect(facts.filter(f => f.startsWith('[Revealed by')).length).toBe(1);
    });

    it('should filter revelation events correctly (only revelation type)', async () => {
      const privateContext: PrivateContext = {
        secrets: [],
        goals: [],
        alliances: [],
        wildcards: [],
      };
      const character = createTestCharacter('char-1', privateContext);

      // Mix of event types
      const events: ShowEvent[] = [
        createRevelationEvent('char-2', 'A revelation', ['char-1', 'char-2'], 1),
        {
          id: 'event-2',
          showId: 'show-1',
          timestamp: Date.now(),
          sequenceNumber: 2,
          phaseId: 'phase-1',
          type: EventType.speech, // Not a revelation
          channel: ChannelType.PUBLIC,
          visibility: ChannelType.PUBLIC,
          senderId: 'char-2',
          receiverIds: [],
          audienceIds: ['char-1', 'char-2'],
          content: 'Just a speech',
          metadata: {},
          seed: 'test-seed',
        },
      ];

      const store = createMockStore({
        getCharacter: vi.fn().mockResolvedValue(character),
        getEventsForCharacter: vi.fn().mockResolvedValue(events),
      });
      const journal = new EventJournal(store);
      const builder = new ContextBuilder(journal, store);

      const facts = await builder.buildFactsList('char-1', 'show-1');

      // Only revelation events should be included
      expect(facts.length).toBe(1);
      expect(facts).toContain('[Revealed by char-2] A revelation');
      expect(facts).not.toContainEqual(expect.stringContaining('Just a speech'));
    });
  });
});
