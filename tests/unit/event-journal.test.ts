/**
 * Unit tests for EventJournal
 * TASK-018: Event Journal with append and query methods
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventJournal } from '../../src/core/event-journal.js';
import type { IStore } from '../../src/types/interfaces/store.interface.js';
import type { ShowEvent } from '../../src/types/events.js';
import { EventType, ChannelType } from '../../src/types/enums.js';

// Create a mock store implementing IStore
function createMockStore(): IStore & { _events: ShowEvent[] } {
  const events: ShowEvent[] = [];

  return {
    _events: events, // Expose for test verification

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
    deleteEventsAfter: vi.fn(async (showId: string, afterSequence: number) => {
      // Actually delete events from the array for realistic testing
      const toRemove = events.filter(
        (e) => e.showId === showId && e.sequenceNumber > afterSequence
      );
      toRemove.forEach((e) => {
        const idx = events.indexOf(e);
        if (idx >= 0) events.splice(idx, 1);
      });
    }),
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
    getContextSummary: vi.fn(),
    upsertContextSummary: vi.fn(),
    createHostBudget: vi.fn(),
    getHostBudget: vi.fn(),
    updateHostBudget: vi.fn(),
    getTriggerCooldown: vi.fn(),
    setTriggerCooldown: vi.fn(),
    initSchema: vi.fn(),
    walCheckpoint: vi.fn(),
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
      expect(events[0]!.sequenceNumber).toBe(1);
      expect(events[1]!.sequenceNumber).toBe(2);
      expect(events[2]!.sequenceNumber).toBe(3);
    });

    it('should support cursor option for pagination', async () => {
      const showId = 'show-1';
      await journal.append(createEventData(showId, { content: 'Event 1' }));
      await journal.append(createEventData(showId, { content: 'Event 2' }));
      await journal.append(createEventData(showId, { content: 'Event 3' }));

      const events = await journal.getEvents(showId, { cursor: 2 });

      expect(events.length).toBe(2);
      expect(events[0]!.sequenceNumber).toBe(2);
      expect(events[1]!.sequenceNumber).toBe(3);
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

  describe('getVisibleEvents (TASK-019)', () => {
    it('should filter events by characterId in audienceIds', async () => {
      const showId = 'show-1';

      // 3 PUBLIC events (all characters see)
      await journal.append(
        createEventData(showId, {
          content: 'Public 1',
          channel: ChannelType.PUBLIC,
          audienceIds: ['charA', 'charB', 'charC'],
        })
      );
      await journal.append(
        createEventData(showId, {
          content: 'Public 2',
          channel: ChannelType.PUBLIC,
          audienceIds: ['charA', 'charB', 'charC'],
        })
      );
      await journal.append(
        createEventData(showId, {
          content: 'Public 3',
          channel: ChannelType.PUBLIC,
          audienceIds: ['charA', 'charB', 'charC'],
        })
      );

      // 2 PRIVATE events (only charA and charB)
      await journal.append(
        createEventData(showId, {
          content: 'Private for charA',
          channel: ChannelType.PRIVATE,
          audienceIds: ['charA'],
        })
      );
      await journal.append(
        createEventData(showId, {
          content: 'Private for charA and charB',
          channel: ChannelType.PRIVATE,
          audienceIds: ['charA', 'charB'],
        })
      );

      // charA sees 3 PUBLIC + 2 PRIVATE = 5 events
      const charAEvents = await journal.getVisibleEvents(showId, 'charA');
      expect(charAEvents.length).toBe(5);

      // charB sees 3 PUBLIC + 1 PRIVATE = 4 events
      const charBEvents = await journal.getVisibleEvents(showId, 'charB');
      expect(charBEvents.length).toBe(4);

      // charC sees only 3 PUBLIC events
      const charCEvents = await journal.getVisibleEvents(showId, 'charC');
      expect(charCEvents.length).toBe(3);
    });

    it('should return events in chronological order', async () => {
      const showId = 'show-1';

      await journal.append(createEventData(showId, { content: 'Event 1', audienceIds: ['charA'] }));
      await journal.append(createEventData(showId, { content: 'Event 2', audienceIds: ['charA'] }));
      await journal.append(createEventData(showId, { content: 'Event 3', audienceIds: ['charA'] }));

      const events = await journal.getVisibleEvents(showId, 'charA');

      expect(events[0]!.sequenceNumber).toBe(1);
      expect(events[1]!.sequenceNumber).toBe(2);
      expect(events[2]!.sequenceNumber).toBe(3);
      expect(events[0]!.content).toBe('Event 1');
      expect(events[1]!.content).toBe('Event 2');
      expect(events[2]!.content).toBe('Event 3');
    });

    it('should support limit for sliding window', async () => {
      const showId = 'show-1';

      // Add 5 events
      await journal.append(createEventData(showId, { content: 'Event 1', audienceIds: ['charA'] }));
      await journal.append(createEventData(showId, { content: 'Event 2', audienceIds: ['charA'] }));
      await journal.append(createEventData(showId, { content: 'Event 3', audienceIds: ['charA'] }));
      await journal.append(createEventData(showId, { content: 'Event 4', audienceIds: ['charA'] }));
      await journal.append(createEventData(showId, { content: 'Event 5', audienceIds: ['charA'] }));

      // Get last 3 events (sliding window)
      const events = await journal.getVisibleEvents(showId, 'charA', 3);

      expect(events.length).toBe(3);
      // Should return the last 3 events (most recent)
      expect(events[0]!.sequenceNumber).toBe(3);
      expect(events[1]!.sequenceNumber).toBe(4);
      expect(events[2]!.sequenceNumber).toBe(5);
    });

    it('should return all events if limit is undefined', async () => {
      const showId = 'show-1';

      await journal.append(createEventData(showId, { content: 'Event 1', audienceIds: ['charA'] }));
      await journal.append(createEventData(showId, { content: 'Event 2', audienceIds: ['charA'] }));
      await journal.append(createEventData(showId, { content: 'Event 3', audienceIds: ['charA'] }));

      const events = await journal.getVisibleEvents(showId, 'charA');

      expect(events.length).toBe(3);
    });

    it('should return empty array if character has no visible events', async () => {
      const showId = 'show-1';

      await journal.append(
        createEventData(showId, { content: 'Private', audienceIds: ['charA', 'charB'] })
      );

      const events = await journal.getVisibleEvents(showId, 'charC');

      expect(events.length).toBe(0);
    });
  });

  describe('rollbackToSequence (TASK-020)', () => {
    it('should delete events after specified sequence number', async () => {
      const showId = 'show-1';

      // Add 5 events
      await journal.append(createEventData(showId, { content: 'Event 1' }));
      await journal.append(createEventData(showId, { content: 'Event 2' }));
      await journal.append(createEventData(showId, { content: 'Event 3' }));
      await journal.append(createEventData(showId, { content: 'Event 4' }));
      await journal.append(createEventData(showId, { content: 'Event 5' }));

      // Rollback to sequence 3 (delete events 4 and 5)
      const deletedCount = await journal.rollbackToSequence(showId, 3);

      expect(deletedCount).toBe(2);
      const events = await journal.getEvents(showId);
      expect(events.length).toBe(3);
      expect(events[2]!.sequenceNumber).toBe(3);
    });

    it('should return 0 if sequence is >= latest', async () => {
      const showId = 'show-1';

      await journal.append(createEventData(showId, { content: 'Event 1' }));
      await journal.append(createEventData(showId, { content: 'Event 2' }));

      const deletedCount = await journal.rollbackToSequence(showId, 5);

      expect(deletedCount).toBe(0);
      const events = await journal.getEvents(showId);
      expect(events.length).toBe(2);
    });

    it('should keep journal consistent after rollback', async () => {
      const showId = 'show-1';

      await journal.append(createEventData(showId, { content: 'Event 1' }));
      await journal.append(createEventData(showId, { content: 'Event 2' }));
      await journal.append(createEventData(showId, { content: 'Event 3' }));

      await journal.rollbackToSequence(showId, 1);

      // Should be able to continue appending from sequence 2
      const newEvent = await journal.append(createEventData(showId, { content: 'New Event 2' }));
      expect(newEvent.sequenceNumber).toBe(2);

      const events = await journal.getEvents(showId);
      expect(events.length).toBe(2);
    });
  });

  describe('rollbackToPhase (TASK-020)', () => {
    it('should delete events from specified phase onwards', async () => {
      const showId = 'show-1';

      // Add 5 events in phase-1
      for (let i = 1; i <= 5; i++) {
        await journal.append(createEventData(showId, { content: `Phase1 Event ${i}`, phaseId: 'phase-1' }));
      }

      // Add 5 events in phase-2
      for (let i = 1; i <= 5; i++) {
        await journal.append(createEventData(showId, { content: `Phase2 Event ${i}`, phaseId: 'phase-2' }));
      }

      // Rollback to phase-2 (should delete all phase-2 events, keep phase-1)
      const deletedCount = await journal.rollbackToPhase(showId, 'phase-2');

      expect(deletedCount).toBe(5);
      const events = await journal.getEvents(showId);
      expect(events.length).toBe(5);
      expect(events.every((e) => e.phaseId === 'phase-1')).toBe(true);
    });

    it('should return 0 if phase not found', async () => {
      const showId = 'show-1';

      await journal.append(createEventData(showId, { content: 'Event 1', phaseId: 'phase-1' }));

      const deletedCount = await journal.rollbackToPhase(showId, 'non-existent-phase');

      expect(deletedCount).toBe(0);
      const events = await journal.getEvents(showId);
      expect(events.length).toBe(1);
    });

    it('should delete all events if rollback to first phase', async () => {
      const showId = 'show-1';

      // Add events in phase-1
      await journal.append(createEventData(showId, { content: 'Event 1', phaseId: 'phase-1' }));
      await journal.append(createEventData(showId, { content: 'Event 2', phaseId: 'phase-1' }));
      await journal.append(createEventData(showId, { content: 'Event 3', phaseId: 'phase-2' }));

      // Rollback to phase-1 (should delete all events including phase-1)
      const deletedCount = await journal.rollbackToPhase(showId, 'phase-1');

      expect(deletedCount).toBe(3);
      const events = await journal.getEvents(showId);
      expect(events.length).toBe(0);
    });

    it('should keep journal consistent after phase rollback', async () => {
      const showId = 'show-1';

      // Add 5 events in phase-1
      for (let i = 1; i <= 5; i++) {
        await journal.append(createEventData(showId, { content: `P1 Event ${i}`, phaseId: 'phase-1' }));
      }

      // Add 5 events in phase-2
      for (let i = 1; i <= 5; i++) {
        await journal.append(createEventData(showId, { content: `P2 Event ${i}`, phaseId: 'phase-2' }));
      }

      // Rollback to phase-2
      await journal.rollbackToPhase(showId, 'phase-2');

      // Latest sequence should be 5
      const latestSeq = await journal.getLatestSequence(showId);
      expect(latestSeq).toBe(5);

      // Should be able to continue appending from sequence 6
      const newEvent = await journal.append(createEventData(showId, { content: 'New Event', phaseId: 'phase-2' }));
      expect(newEvent.sequenceNumber).toBe(6);
    });
  });
});
