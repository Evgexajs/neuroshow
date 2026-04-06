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

  describe('buildSlidingWindow', () => {
    function createTestEvent(
      sequenceNumber: number,
      senderId: string,
      content: string,
      channel: ChannelType,
      audienceIds: string[]
    ): ShowEvent {
      return {
        id: `event-${sequenceNumber}`,
        showId: 'show-1',
        timestamp: 1000 + sequenceNumber * 100,
        sequenceNumber,
        phaseId: 'phase-1',
        type: EventType.speech,
        channel,
        visibility: channel,
        senderId,
        receiverIds: [],
        audienceIds,
        content,
        metadata: {},
        seed: 'test-seed',
      };
    }

    it('should return EventSummary[] with correct fields', async () => {
      const events: ShowEvent[] = [
        createTestEvent(1, 'char-1', 'Hello everyone', ChannelType.PUBLIC, ['char-1', 'char-2']),
      ];

      const store = createMockStore({
        getEventsForCharacter: vi.fn().mockResolvedValue(events),
      });
      const journal = new EventJournal(store);
      const builder = new ContextBuilder(journal, store);

      const window = await builder.buildSlidingWindow('char-1', 'show-1', 10);

      expect(window.length).toBe(1);
      expect(window[0]).toEqual({
        senderId: 'char-1',
        channel: ChannelType.PUBLIC,
        content: 'Hello everyone',
        timestamp: 1100,
      });
    });

    it('should return <= limit events', async () => {
      // Create 20 events
      const allCharacters = ['char-1', 'char-2', 'char-3'];
      const events: ShowEvent[] = Array.from({ length: 20 }, (_, i) =>
        createTestEvent(i + 1, 'char-1', `Message ${i + 1}`, ChannelType.PUBLIC, allCharacters)
      );

      // Mock returns last 10 events (getVisibleEvents handles limit)
      const store = createMockStore({
        getEventsForCharacter: vi.fn().mockResolvedValue(events.slice(-10)),
      });
      const journal = new EventJournal(store);
      const builder = new ContextBuilder(journal, store);

      const window = await builder.buildSlidingWindow('char-1', 'show-1', 10);

      expect(window.length).toBeLessThanOrEqual(10);
    });

    it('should filter PRIVATE events from other characters via getVisibleEvents', async () => {
      // char-1 should only see:
      // - PUBLIC events
      // - PRIVATE events where char-1 is in audienceIds
      const visibleEvents: ShowEvent[] = [
        createTestEvent(1, 'char-2', 'Public message', ChannelType.PUBLIC, ['char-1', 'char-2', 'char-3']),
        createTestEvent(3, 'char-2', 'Private to char-1', ChannelType.PRIVATE, ['char-1', 'char-2']),
      ];

      // getEventsForCharacter already filters by audienceIds
      const store = createMockStore({
        getEventsForCharacter: vi.fn().mockResolvedValue(visibleEvents),
      });
      const journal = new EventJournal(store);
      const builder = new ContextBuilder(journal, store);

      const window = await builder.buildSlidingWindow('char-1', 'show-1', 10);

      expect(window.length).toBe(2);
      expect(window.map(e => e.content)).toContain('Public message');
      expect(window.map(e => e.content)).toContain('Private to char-1');
    });

    it('should return events in chronological order', async () => {
      const events: ShowEvent[] = [
        createTestEvent(1, 'char-1', 'First', ChannelType.PUBLIC, ['char-1', 'char-2']),
        createTestEvent(2, 'char-2', 'Second', ChannelType.PUBLIC, ['char-1', 'char-2']),
        createTestEvent(3, 'char-1', 'Third', ChannelType.PUBLIC, ['char-1', 'char-2']),
      ];

      const store = createMockStore({
        getEventsForCharacter: vi.fn().mockResolvedValue(events),
      });
      const journal = new EventJournal(store);
      const builder = new ContextBuilder(journal, store);

      const window = await builder.buildSlidingWindow('char-1', 'show-1', 10);

      expect(window[0].content).toBe('First');
      expect(window[1].content).toBe('Second');
      expect(window[2].content).toBe('Third');
    });

    it('should return empty array if no visible events', async () => {
      const store = createMockStore({
        getEventsForCharacter: vi.fn().mockResolvedValue([]),
      });
      const journal = new EventJournal(store);
      const builder = new ContextBuilder(journal, store);

      const window = await builder.buildSlidingWindow('char-1', 'show-1', 10);

      expect(window).toEqual([]);
    });

    it('should use getVisibleEvents with correct parameters', async () => {
      const store = createMockStore({
        getEventsForCharacter: vi.fn().mockResolvedValue([]),
      });
      const journal = new EventJournal(store);
      vi.spyOn(journal, 'getVisibleEvents');
      const builder = new ContextBuilder(journal, store);

      await builder.buildSlidingWindow('char-1', 'show-1', 15);

      expect(journal.getVisibleEvents).toHaveBeenCalledWith('show-1', 'char-1', 15);
    });
  });
});
