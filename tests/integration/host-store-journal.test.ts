/**
 * Integration Test: HostModule + SqliteStore + EventJournal
 *
 * TASK-062: Tests real component integration without mocks
 *
 * Verifies:
 * - Show initialization through HostModule creates records in SqliteStore
 * - EventJournal writes events that are readable from SqliteStore
 * - manageTurnQueue returns characters created through SqliteStore
 * - emitTrigger saves host_trigger events to DB
 * - Uses temporary in-memory SQLite database
 * - No mocks - all components are real
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HostModule } from '../../src/core/host-module.js';
import { EventJournal } from '../../src/core/event-journal.js';
import { SqliteStore } from '../../src/storage/sqlite-store.js';
import { ShowFormatTemplate, Phase } from '../../src/types/template.js';
import { CharacterDefinition } from '../../src/types/character.js';
import { EventType, ShowStatus, ChannelType, PhaseType, SpeakFrequency } from '../../src/types/enums.js';
import * as fs from 'fs';

describe('Integration: HostModule + SqliteStore + EventJournal', () => {
  let store: SqliteStore;
  let eventJournal: EventJournal;
  let hostModule: HostModule;
  const testDbPath = './data/test-host-store-journal.db';

  // Minimal template for testing
  const createTestTemplate = (): ShowFormatTemplate => ({
    id: 'test-format',
    name: 'Test Format',
    description: 'Test format for integration tests',
        minParticipants: 2,
    maxParticipants: 4,
    contextWindowSize: 8000,
    phases: [
      {
        id: 'phase-1',
        name: 'Phase One',
        type: PhaseType.discussion,
        durationMode: 'turns',
        durationValue: 2,
        turnOrder: 'sequential',
        allowedChannels: [ChannelType.PUBLIC],
        triggerTemplate: 'Welcome to {{names}}!',
        completionCondition: 'turns_completed',
      },
      {
        id: 'phase-2',
        name: 'Phase Two',
        type: PhaseType.discussion,
        durationMode: 'turns',
        durationValue: 1,
        turnOrder: 'frequency_weighted',
        allowedChannels: [ChannelType.PUBLIC],
        triggerTemplate: 'Time for discussion!',
        completionCondition: 'turns_completed',
      },
    ],
    decisionConfig: {
      format: 'choice',
      timing: 'simultaneous',
      visibility: 'secret_until_reveal',
      revealMoment: 'after_all',
      options: ['Option A', 'Option B'],
    },
    privateChannelRules: {
      initiator: 'host_only',
      maxPrivatesPerPhase: 2,
      maxPrivatesPerCharacterPerPhase: 1,
      requestQueueMode: 'fifo',
      requestFormat: 'public_ask',
    },
    channelTypes: [ChannelType.PUBLIC, ChannelType.PRIVATE],
  });

  // Test characters
  const createTestCharacters = (): Array<CharacterDefinition & { modelAdapterId?: string }> => [
    {
      id: 'char-alice',
      name: 'Alice',
      publicCard: 'Alice is a friendly character.',
      personalityPrompt: 'You are Alice, friendly and helpful.',
      motivationPrompt: 'You want to make friends.',
      boundaryRules: ['Be polite.'],
      speakFrequency: SpeakFrequency.high,
      responseConstraints: { maxTokens: 100, format: 'free', language: 'en' },
      startingPrivateContext: {
        secrets: [],
        alliances: [],
        goals: [],
        wildcards: [],
      },
      modelAdapterId: 'mock',
    },
    {
      id: 'char-bob',
      name: 'Bob',
      publicCard: 'Bob is a thoughtful character.',
      personalityPrompt: 'You are Bob, thoughtful and analytical.',
      motivationPrompt: 'You seek truth.',
      boundaryRules: ['Be honest.'],
      speakFrequency: SpeakFrequency.medium,
      responseConstraints: { maxTokens: 100, format: 'free', language: 'en' },
      startingPrivateContext: {
        secrets: [],
        alliances: [],
        goals: [],
        wildcards: [],
      },
      modelAdapterId: 'mock',
    },
    {
      id: 'char-carol',
      name: 'Carol',
      publicCard: 'Carol is a quiet observer.',
      personalityPrompt: 'You are Carol, observant and cautious.',
      motivationPrompt: 'You prefer to watch.',
      boundaryRules: ['Stay calm.'],
      speakFrequency: SpeakFrequency.low,
      responseConstraints: { maxTokens: 100, format: 'free', language: 'en' },
      startingPrivateContext: {
        secrets: [],
        alliances: [],
        goals: [],
        wildcards: [],
      },
      modelAdapterId: 'mock',
    },
  ];

  beforeEach(async () => {
    // Clean up test db if exists
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    // Initialize real components (no mocks)
    store = new SqliteStore(testDbPath);
    await store.initSchema();
    eventJournal = new EventJournal(store);
    hostModule = new HostModule(store, eventJournal);
  });

  afterEach(async () => {
    await store.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('Show Initialization', () => {
    it('should create show record in SqliteStore through HostModule.initializeShow', async () => {
      const template = createTestTemplate();
      const characters = createTestCharacters();

      // Initialize show through HostModule
      const show = await hostModule.initializeShow(template, characters, 42);

      // Verify show was created in store
      const storedShow = await store.getShow(show.id);
      expect(storedShow).not.toBeNull();
      expect(storedShow!.id).toBe(show.id);
      expect(storedShow!.formatId).toBe('test-format');
      expect(storedShow!.seed).toBe('42');
      expect(storedShow!.status).toBe(ShowStatus.created);
      expect(storedShow!.currentPhaseId).toBe('phase-1');
    });

    it('should create show_characters records in SqliteStore', async () => {
      const template = createTestTemplate();
      const characters = createTestCharacters();

      const show = await hostModule.initializeShow(template, characters, 42);

      // Verify characters were created in store
      const storedCharacters = await store.getCharacters(show.id);
      expect(storedCharacters.length).toBe(3);

      const charIds = storedCharacters.map((c) => c.characterId);
      expect(charIds).toContain('char-alice');
      expect(charIds).toContain('char-bob');
      expect(charIds).toContain('char-carol');

      // Verify speak frequencies are preserved
      const alice = storedCharacters.find((c) => c.characterId === 'char-alice');
      expect(alice!.speakFrequency).toBe('high');

      const bob = storedCharacters.find((c) => c.characterId === 'char-bob');
      expect(bob!.speakFrequency).toBe('medium');

      const carol = storedCharacters.find((c) => c.characterId === 'char-carol');
      expect(carol!.speakFrequency).toBe('low');
    });

    it('should create token_budget record in SqliteStore', async () => {
      const template = createTestTemplate();
      const characters = createTestCharacters();

      const show = await hostModule.initializeShow(template, characters, 42);

      // Verify budget was created
      const budget = await store.getBudget(show.id);
      expect(budget).not.toBeNull();
      expect(budget!.showId).toBe(show.id);
      expect(budget!.usedPrompt).toBe(0);
      expect(budget!.usedCompletion).toBe(0);
    });
  });

  describe('Event Writing and Reading', () => {
    it('should write events through EventJournal and read from SqliteStore', async () => {
      const template = createTestTemplate();
      const characters = createTestCharacters();

      const show = await hostModule.initializeShow(template, characters, 42);

      // Write event through EventJournal
      const event = await eventJournal.append({
        id: 'test-event-1',
        showId: show.id,
        timestamp: Date.now(),
        phaseId: 'phase-1',
        type: EventType.speech,
        channel: ChannelType.PUBLIC,
        visibility: ChannelType.PUBLIC,
        senderId: 'char-alice',
        receiverIds: ['char-bob', 'char-carol'],
        audienceIds: ['char-alice', 'char-bob', 'char-carol'],
        content: 'Hello everyone!',
        metadata: {},
        seed: '42',
      });

      expect(event.sequenceNumber).toBe(1);

      // Read events directly from SqliteStore
      const events = await store.getEvents(show.id);
      expect(events.length).toBe(1);
      expect(events[0]!.id).toBe('test-event-1');
      expect(events[0]!.content).toBe('Hello everyone!');
      expect(events[0]!.senderId).toBe('char-alice');
    });

    it('should maintain correct sequence numbers for multiple events', async () => {
      const template = createTestTemplate();
      const characters = createTestCharacters();

      const show = await hostModule.initializeShow(template, characters, 42);

      // Write multiple events
      const event1 = await eventJournal.append({
        id: 'event-1',
        showId: show.id,
        timestamp: Date.now(),
        phaseId: 'phase-1',
        type: EventType.speech,
        channel: ChannelType.PUBLIC,
        visibility: ChannelType.PUBLIC,
        senderId: 'char-alice',
        receiverIds: [],
        audienceIds: ['char-alice', 'char-bob', 'char-carol'],
        content: 'First message',
        metadata: {},
        seed: '42',
      });

      const event2 = await eventJournal.append({
        id: 'event-2',
        showId: show.id,
        timestamp: Date.now(),
        phaseId: 'phase-1',
        type: EventType.speech,
        channel: ChannelType.PUBLIC,
        visibility: ChannelType.PUBLIC,
        senderId: 'char-bob',
        receiverIds: [],
        audienceIds: ['char-alice', 'char-bob', 'char-carol'],
        content: 'Second message',
        metadata: {},
        seed: '42',
      });

      const event3 = await eventJournal.append({
        id: 'event-3',
        showId: show.id,
        timestamp: Date.now(),
        phaseId: 'phase-1',
        type: EventType.speech,
        channel: ChannelType.PUBLIC,
        visibility: ChannelType.PUBLIC,
        senderId: 'char-carol',
        receiverIds: [],
        audienceIds: ['char-alice', 'char-bob', 'char-carol'],
        content: 'Third message',
        metadata: {},
        seed: '42',
      });

      expect(event1.sequenceNumber).toBe(1);
      expect(event2.sequenceNumber).toBe(2);
      expect(event3.sequenceNumber).toBe(3);

      // Verify order in store
      const events = await store.getEvents(show.id);
      expect(events.length).toBe(3);
      expect(events[0]!.sequenceNumber).toBe(1);
      expect(events[1]!.sequenceNumber).toBe(2);
      expect(events[2]!.sequenceNumber).toBe(3);
    });

    it('should read events through EventJournal.getEvents', async () => {
      const template = createTestTemplate();
      const characters = createTestCharacters();

      const show = await hostModule.initializeShow(template, characters, 42);

      // Write events
      await eventJournal.append({
        id: 'event-a',
        showId: show.id,
        timestamp: Date.now(),
        phaseId: 'phase-1',
        type: EventType.speech,
        channel: ChannelType.PUBLIC,
        visibility: ChannelType.PUBLIC,
        senderId: 'char-alice',
        receiverIds: [],
        audienceIds: ['char-alice', 'char-bob', 'char-carol'],
        content: 'Message A',
        metadata: {},
        seed: '42',
      });

      await eventJournal.append({
        id: 'event-b',
        showId: show.id,
        timestamp: Date.now(),
        phaseId: 'phase-1',
        type: EventType.speech,
        channel: ChannelType.PUBLIC,
        visibility: ChannelType.PUBLIC,
        senderId: 'char-bob',
        receiverIds: [],
        audienceIds: ['char-alice', 'char-bob', 'char-carol'],
        content: 'Message B',
        metadata: {},
        seed: '42',
      });

      // Read through EventJournal
      const events = await eventJournal.getEvents(show.id);
      expect(events.length).toBe(2);
      expect(events[0]!.content).toBe('Message A');
      expect(events[1]!.content).toBe('Message B');
    });
  });

  describe('manageTurnQueue', () => {
    it('should return characters created through SqliteStore in sequential order', async () => {
      const template = createTestTemplate();
      const characters = createTestCharacters();

      const show = await hostModule.initializeShow(template, characters, 42);

      // Get turn queue for sequential phase
      const phase: Phase = {
        id: 'phase-1',
        name: 'Test Phase',
        type: PhaseType.discussion,
        durationMode: 'turns',
        durationValue: 3,
        turnOrder: 'sequential',
        allowedChannels: [ChannelType.PUBLIC],
        triggerTemplate: 'Test',
        completionCondition: 'turns_completed',
      };

      const turnQueue = await hostModule.manageTurnQueue(show.id, phase);

      expect(turnQueue.length).toBe(3);
      expect(turnQueue).toContain('char-alice');
      expect(turnQueue).toContain('char-bob');
      expect(turnQueue).toContain('char-carol');
    });

    it('should return characters ordered by frequency for frequency_weighted turnOrder', async () => {
      const template = createTestTemplate();
      const characters = createTestCharacters();

      const show = await hostModule.initializeShow(template, characters, 42);

      // Get turn queue for frequency_weighted phase
      const phase: Phase = {
        id: 'phase-2',
        name: 'Weighted Phase',
        type: PhaseType.discussion,
        durationMode: 'turns',
        durationValue: 3,
        turnOrder: 'frequency_weighted',
        allowedChannels: [ChannelType.PUBLIC],
        triggerTemplate: 'Test',
        completionCondition: 'turns_completed',
      };

      const turnQueue = await hostModule.manageTurnQueue(show.id, phase);

      expect(turnQueue.length).toBe(3);

      // High frequency should come first (alice)
      // Then medium (bob)
      // Then low (carol)
      expect(turnQueue[0]).toBe('char-alice'); // high
      expect(turnQueue[1]).toBe('char-bob'); // medium
      expect(turnQueue[2]).toBe('char-carol'); // low
    });

    it('should return empty array when no characters exist', async () => {
      const template = createTestTemplate();

      // Create show with no characters
      const show = await hostModule.initializeShow(template, [], 42);

      const phase: Phase = {
        id: 'phase-1',
        name: 'Test Phase',
        type: PhaseType.discussion,
        durationMode: 'turns',
        durationValue: 3,
        turnOrder: 'sequential',
        allowedChannels: [ChannelType.PUBLIC],
        triggerTemplate: 'Test',
        completionCondition: 'turns_completed',
      };

      const turnQueue = await hostModule.manageTurnQueue(show.id, phase);

      expect(turnQueue.length).toBe(0);
    });
  });

  describe('emitTrigger', () => {
    it('should save host_trigger event to DB and read through getEvents', async () => {
      const template = createTestTemplate();
      const characters = createTestCharacters();

      const show = await hostModule.initializeShow(template, characters, 42);

      // Emit trigger through HostModule
      await hostModule.emitTrigger(show.id, 'phase-1', 'Hello {{names}}!');

      // Read events from store
      const events = await store.getEvents(show.id);
      expect(events.length).toBe(1);

      const triggerEvent = events[0]!;
      expect(triggerEvent.type).toBe(EventType.host_trigger);
      expect(triggerEvent.phaseId).toBe('phase-1');
      expect(triggerEvent.content).toBe('Hello char-alice, char-bob, char-carol!');
      expect(triggerEvent.audienceIds).toEqual(['char-alice', 'char-bob', 'char-carol']);
    });

    it('should emit trigger to specific target characters', async () => {
      const template = createTestTemplate();
      const characters = createTestCharacters();

      const show = await hostModule.initializeShow(template, characters, 42);

      // Emit trigger to specific characters
      await hostModule.emitTrigger(show.id, 'phase-1', 'Private message to {{target}}', [
        'char-alice',
        'char-bob',
      ]);

      const events = await store.getEvents(show.id);
      expect(events.length).toBe(1);

      const triggerEvent = events[0]!;
      expect(triggerEvent.type).toBe(EventType.host_trigger);
      expect(triggerEvent.audienceIds).toEqual(['char-alice', 'char-bob']);
      expect(triggerEvent.content).toBe('Private message to char-alice');
    });

    it('should read host_trigger through EventJournal.getEvents', async () => {
      const template = createTestTemplate();
      const characters = createTestCharacters();

      const show = await hostModule.initializeShow(template, characters, 42);

      await hostModule.emitTrigger(show.id, 'phase-1', 'Trigger message');

      // Read through EventJournal
      const events = await eventJournal.getEvents(show.id);
      expect(events.length).toBe(1);
      expect(events[0]!.type).toBe(EventType.host_trigger);
      expect(events[0]!.content).toBe('Trigger message');
    });
  });

  describe('Full Cycle: init -> characters -> events -> read', () => {
    it('should complete full cycle: initialize show, create characters, emit events, read all', async () => {
      const template = createTestTemplate();
      const characters = createTestCharacters();

      // Step 1: Initialize show
      const show = await hostModule.initializeShow(template, characters, 12345);
      expect(show.id).toBeDefined();

      // Step 2: Verify characters in store
      const storedCharacters = await store.getCharacters(show.id);
      expect(storedCharacters.length).toBe(3);

      // Step 3: Emit trigger
      await hostModule.emitTrigger(show.id, 'phase-1', 'Welcome to the show!');

      // Step 4: Write speech events
      await eventJournal.append({
        id: 'speech-1',
        showId: show.id,
        timestamp: Date.now(),
        phaseId: 'phase-1',
        type: EventType.speech,
        channel: ChannelType.PUBLIC,
        visibility: ChannelType.PUBLIC,
        senderId: 'char-alice',
        receiverIds: [],
        audienceIds: ['char-alice', 'char-bob', 'char-carol'],
        content: 'Hello from Alice!',
        metadata: {},
        seed: '12345',
      });

      await eventJournal.append({
        id: 'speech-2',
        showId: show.id,
        timestamp: Date.now(),
        phaseId: 'phase-1',
        type: EventType.speech,
        channel: ChannelType.PUBLIC,
        visibility: ChannelType.PUBLIC,
        senderId: 'char-bob',
        receiverIds: [],
        audienceIds: ['char-alice', 'char-bob', 'char-carol'],
        content: 'Hello from Bob!',
        metadata: {},
        seed: '12345',
      });

      // Step 5: Read all events
      const allEvents = await eventJournal.getEvents(show.id);
      expect(allEvents.length).toBe(3);

      // Verify event types in order
      expect(allEvents[0]!.type).toBe(EventType.host_trigger);
      expect(allEvents[1]!.type).toBe(EventType.speech);
      expect(allEvents[2]!.type).toBe(EventType.speech);

      // Verify sequence numbers
      expect(allEvents[0]!.sequenceNumber).toBe(1);
      expect(allEvents[1]!.sequenceNumber).toBe(2);
      expect(allEvents[2]!.sequenceNumber).toBe(3);

      // Step 6: Verify show record
      const finalShow = await store.getShow(show.id);
      expect(finalShow).not.toBeNull();
      expect(finalShow!.status).toBe(ShowStatus.created);

      // Step 7: Verify budget
      const budget = await store.getBudget(show.id);
      expect(budget).not.toBeNull();
    });
  });
});
