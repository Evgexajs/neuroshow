/**
 * Unit tests for EventJournal
 * TASK-018: Event Journal with append and query methods
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventJournal } from '../../src/core/event-journal.js';
import { IStore } from '../../src/types/interfaces/store.interface.js';
import { ShowEvent } from '../../src/types/events.js';
import { EventType, ChannelType } from '../../src/types/enums.js';

// Create a mock store implementing IStore
function createMockStore(): IStore {
  const events: ShowEvent[] = [];

  return {
    // Events (Journal)
    appendEvent: vi.fn(async (event: ShowEvent) => {
      events.push(event);
      return event.sequenceNumber;
    }),
    getEvents: vi.fn(async (showId: string, fromSequence?: number) => {
      return events
        .filter((e) => e.showId === showId)
        .filter((e) => (fromSequence ? e.sequenceNumber >= fromSequence : true))
        .sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    }),
    getEventsForCharacter: vi.fn(
      async (showId: string, characterId: string, fromSequence?: number) => {
        return events
          .filter((e) => e.showId === showId)
          .filter((e) => e.audienceIds.includes(characterId))
          .filter((e) => (fromSequence ? e.sequenceNumber >= fromSequence : true))
          .sort((a, b) => a.sequenceNumber - b.sequenceNumber);
      }
    ),
    deleteEventsAfter: vi.fn(async () => {}),
    getLatestSequence: vi.fn(async (showId: string) => {
      const showEvents = events.filter((e) => e.showId === showId);
      if (showEvents.length === 0) return 0;
      return Math.max(...showEvents.map((e) => e.sequenceNumber));
    }),

    // Stubs for other methods (not used in EventJournal)
    createShow: vi.fn(),
    getShow: vi.fn(),
    updateShow: vi.fn(),
    listShows: vi.fn(),
    createCharacter: vi.fn(),
    getCharacter: vi.fn(),
    getCharacters: vi.fn(),
    updateShowCharacterContext: vi.fn(),
    logLLMCall: vi.fn(),
    getLLMCalls: vi.fn(),
    getLLMCallByEventId: vi.fn(),
    createBudget: vi.fn(),
    getBudget: vi.fn(),
    updateBudget: vi.fn(),
    setBudgetMode: vi.fn(),
    initSchema: vi.fn(),
    close: vi.fn(),
  };
}

function createEventData(
  showId: string,
  overrides: Partial<Omit<ShowEvent, 'sequenceNumber'>> = {}
): Omit<ShowEvent, 'sequenceNumber'> {
  return {
    id: `evt-${Math.random().toString(36).substring(7)}`,
    showId,
    timestamp: Date.now(),
    phaseId: 'phase-1',
    type: EventType.speech,
    channel: ChannelType.PUBLIC,
    visibility: ChannelType.PUBLIC,
    senderId: 'char-1',
    receiverIds: [],
    audienceIds: ['char-1', 'char-2', 'char-3'],
    content: 'Test content',
    metadata: {},
    seed: 'test-seed',
    ...overrides,
  };
}

describe('EventJournal', () => {
  let store: IStore;
  let journal: EventJournal;

  beforeEach(() => {
    store = createMockStore();
    journal = new EventJournal(store);
  });

  describe('append', () => {
    it('should append event and assign sequenceNumber 1 for first event', async () => {
      const eventData = createEventData('show-1');
      const result = await journal.append(eventData);

      expect(result.sequenceNumber).toBe(1);
      expect(result.id).toBe(eventData.id);
      expect(result.content).toBe(eventData.content);
      expect(store.appendEvent).toHaveBeenCalledWith(
        expect.objectContaining({ sequenceNumber: 1 })
      );
    });

    it('should assign incrementing sequenceNumbers for multiple events', async () => {
      const showId = 'show-1';

      const event1 = await journal.append(createEventData(showId, { content: 'Event 1' }));
      const event2 = await journal.append(createEventData(showId, { content: 'Event 2' }));
      const event3 = await journal.append(createEventData(showId, { content: 'Event 3' }));

      expect(event1.sequenceNumber).toBe(1);
      expect(event2.sequenceNumber).toBe(2);
      expect(event3.sequenceNumber).toBe(3);
    });

    it('should return complete ShowEvent with all fields', async () => {
      const eventData = createEventData('show-1');
      const result = await journal.append(eventData);

      expect(result).toMatchObject({
        id: eventData.id,
        showId: eventData.showId,
        timestamp: eventData.timestamp,
        phaseId: eventData.phaseId,
        type: eventData.type,
        channel: eventData.channel,
        visibility: eventData.visibility,
        senderId: eventData.senderId,
        receiverIds: eventData.receiverIds,
        audienceIds: eventData.audienceIds,
        content: eventData.content,
        metadata: eventData.metadata,
        seed: eventData.seed,
        sequenceNumber: 1,
      });
    });
  });

  describe('getEvents', () => {
    it('should return events in order by sequenceNumber', async () => {
      const showId = 'show-1';
      await journal.append(createEventData(showId, { content: 'Event 1' }));
      await journal.append(createEventData(showId, { content: 'Event 2' }));
      await journal.append(createEventData(showId, { content: 'Event 3' }));

      const events = await journal.getEvents(showId);

      expect(events.length).toBe(3);
      expect(events[0].sequenceNumber).toBe(1);
      expect(events[1].sequenceNumber).toBe(2);
      expect(events[2].sequenceNumber).toBe(3);
    });

    it('should support cursor option for pagination', async () => {
      const showId = 'show-1';
      await journal.append(createEventData(showId, { content: 'Event 1' }));
      await journal.append(createEventData(showId, { content: 'Event 2' }));
      await journal.append(createEventData(showId, { content: 'Event 3' }));

      const events = await journal.getEvents(showId, { cursor: 2 });

      expect(events.length).toBe(2);
      expect(events[0].sequenceNumber).toBe(2);
      expect(events[1].sequenceNumber).toBe(3);
    });

    it('should support limit option', async () => {
      const showId = 'show-1';
      await journal.append(createEventData(showId, { content: 'Event 1' }));
      await journal.append(createEventData(showId, { content: 'Event 2' }));
      await journal.append(createEventData(showId, { content: 'Event 3' }));

      const events = await journal.getEvents(showId, { limit: 2 });

      expect(events.length).toBe(2);
    });

    it('should support characterId option for filtering by audience', async () => {
      const showId = 'show-1';
      await journal.append(
        createEventData(showId, {
          content: 'Public event',
          audienceIds: ['char-1', 'char-2', 'char-3'],
        })
      );
      await journal.append(
        createEventData(showId, {
          content: 'Private to char-1',
          channel: ChannelType.PRIVATE,
          audienceIds: ['char-1'],
        })
      );
      await journal.append(
        createEventData(showId, {
          content: 'Another public',
          audienceIds: ['char-1', 'char-2', 'char-3'],
        })
      );

      const char1Events = await journal.getEvents(showId, { characterId: 'char-1' });
      const char2Events = await journal.getEvents(showId, { characterId: 'char-2' });

      expect(char1Events.length).toBe(3);
      expect(char2Events.length).toBe(2);
    });
  });

  describe('getLatestSequence', () => {
    it('should return 0 for show with no events', async () => {
      const result = await journal.getLatestSequence('show-empty');
      expect(result).toBe(0);
    });

    it('should return latest sequence number', async () => {
      const showId = 'show-1';
      await journal.append(createEventData(showId));
      await journal.append(createEventData(showId));
      await journal.append(createEventData(showId));

      const result = await journal.getLatestSequence(showId);
      expect(result).toBe(3);
    });
  });
});
