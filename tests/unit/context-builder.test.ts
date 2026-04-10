/**
 * Tests for ContextBuilder
 * TASK-025: Context Builder: метод buildFactsList()
 * TASK-026: Context Builder: метод buildSlidingWindow()
 * TASK-027: Context Builder: метод buildPromptPackage()
 */

import { describe, it, expect, vi } from 'vitest';
import { ContextBuilder } from '../../src/core/context-builder.js';
import { EventJournal } from '../../src/core/event-journal.js';
import type { IStore, ShowCharacterRecord } from '../../src/types/interfaces/store.interface.js';
import type { ShowEvent } from '../../src/types/events.js';
import { EventType, ChannelType, SpeakFrequency, ShowStatus } from '../../src/types/enums.js';
import type { PrivateContext } from '../../src/types/context.js';
import type { CharacterDefinition } from '../../src/types/character.js';
import type { Show } from '../../src/types/runtime.js';
import type { ShowFormatTemplate } from '../../src/types/template.js';
import type { PromptPackage, ModelAdapter, TokenEstimate } from '../../src/types/adapter.js';

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

    it('should include backstory as the first fact when present', async () => {
      const privateContext = createTestPrivateContext();
      const character = createTestCharacter('char-1', privateContext);
      const backstory = 'Вы находитесь на острове. На кону миллион долларов.';

      const store = createMockStore({
        getCharacter: vi.fn().mockResolvedValue(character),
        getShow: vi.fn().mockResolvedValue({
          id: 'show-1',
          configSnapshot: JSON.stringify({ backstory }),
          status: ShowStatus.running,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }),
      });
      const journal = new EventJournal(store);
      const builder = new ContextBuilder(journal, store);

      const facts = await builder.buildFactsList('char-1', 'show-1');

      // Backstory should be the first fact
      expect(facts[0]).toBe(`[Предыстория шоу] ${backstory}`);

      // Secrets should come after backstory
      expect(facts.indexOf(`[Предыстория шоу] ${backstory}`)).toBeLessThan(
        facts.findIndex((f) => f.startsWith('[Secret]'))
      );
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
        senderName: 'char-1', // Falls back to senderId when no nameMap
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

      expect(window[0]!.content).toBe('First');
      expect(window[1]!.content).toBe('Second');
      expect(window[2]!.content).toBe('Third');
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

  describe('buildPromptPackage', () => {
    function createTestCharacterDefinition(): CharacterDefinition {
      return {
        id: 'char-1',
        name: 'Detective Alex',
        publicCard: 'A seasoned detective with sharp instincts',
        personalityPrompt: 'You are analytical and observant. You speak precisely and ask probing questions.',
        motivationPrompt: 'You want to find the truth and bring justice. You are suspicious of everyone.',
        boundaryRules: [
          'Never reveal your true identity',
          'Never trust anyone completely',
        ],
        startingPrivateContext: createTestPrivateContext(),
        speakFrequency: SpeakFrequency.medium,
        responseConstraints: {
          maxTokens: 200,
          format: 'structured',
          language: 'en',
        },
      };
    }

    function createTestShow(): Show {
      const configSnapshot: Partial<ShowFormatTemplate> = {
        contextWindowSize: 25,
      };
      return {
        id: 'show-1',
        formatId: 'coalition-format',
        seed: 12345,
        status: ShowStatus.running,
        currentPhaseId: 'phase-1',
        startedAt: new Date(),
        completedAt: null,
        configSnapshot: configSnapshot as Record<string, unknown>,
      };
    }

    it('should build PromptPackage with all required fields', async () => {
      const character = createTestCharacterDefinition();
      const show = createTestShow();
      const showCharacter = createTestCharacter(character.id, character.startingPrivateContext);

      const store = createMockStore({
        getCharacter: vi.fn().mockResolvedValue(showCharacter),
        getEventsForCharacter: vi.fn().mockResolvedValue([]),
      });
      const journal = new EventJournal(store);
      const builder = new ContextBuilder(journal, store);

      const pkg = await builder.buildPromptPackage(character, show, 'What do you think?');

      expect(pkg).toHaveProperty('systemPrompt');
      expect(pkg).toHaveProperty('contextLayers');
      expect(pkg).toHaveProperty('trigger');
      expect(pkg).toHaveProperty('responseConstraints');
    });

    it('should include personality in systemPrompt', async () => {
      const character = createTestCharacterDefinition();
      const show = createTestShow();
      const showCharacter = createTestCharacter(character.id, character.startingPrivateContext);

      const store = createMockStore({
        getCharacter: vi.fn().mockResolvedValue(showCharacter),
        getEventsForCharacter: vi.fn().mockResolvedValue([]),
      });
      const journal = new EventJournal(store);
      const builder = new ContextBuilder(journal, store);

      const pkg = await builder.buildPromptPackage(character, show, 'What do you think?');

      expect(pkg.systemPrompt).toContain('Detective Alex');
      expect(pkg.systemPrompt).toContain(character.personalityPrompt);
    });

    it('should include motivation in systemPrompt', async () => {
      const character = createTestCharacterDefinition();
      const show = createTestShow();
      const showCharacter = createTestCharacter(character.id, character.startingPrivateContext);

      const store = createMockStore({
        getCharacter: vi.fn().mockResolvedValue(showCharacter),
        getEventsForCharacter: vi.fn().mockResolvedValue([]),
      });
      const journal = new EventJournal(store);
      const builder = new ContextBuilder(journal, store);

      const pkg = await builder.buildPromptPackage(character, show, 'What do you think?');

      expect(pkg.systemPrompt).toContain(character.motivationPrompt);
    });

    it('should include boundary rules in systemPrompt', async () => {
      const character = createTestCharacterDefinition();
      const show = createTestShow();
      const showCharacter = createTestCharacter(character.id, character.startingPrivateContext);

      const store = createMockStore({
        getCharacter: vi.fn().mockResolvedValue(showCharacter),
        getEventsForCharacter: vi.fn().mockResolvedValue([]),
      });
      const journal = new EventJournal(store);
      const builder = new ContextBuilder(journal, store);

      const pkg = await builder.buildPromptPackage(character, show, 'What do you think?');

      expect(pkg.systemPrompt).toContain('Never reveal your true identity');
      expect(pkg.systemPrompt).toContain('Never trust anyone completely');
    });

    it('should include format instruction in systemPrompt', async () => {
      const character = createTestCharacterDefinition();
      const show = createTestShow();
      const showCharacter = createTestCharacter(character.id, character.startingPrivateContext);

      const store = createMockStore({
        getCharacter: vi.fn().mockResolvedValue(showCharacter),
        getEventsForCharacter: vi.fn().mockResolvedValue([]),
      });
      const journal = new EventJournal(store);
      const builder = new ContextBuilder(journal, store);

      const pkg = await builder.buildPromptPackage(character, show, 'What do you think?');

      expect(pkg.systemPrompt).toContain('Response Format');
      expect(pkg.systemPrompt).toContain('JSON');
      expect(pkg.systemPrompt).toContain('"text"');
      expect(pkg.systemPrompt).toContain('"intent"');
    });

    it('should have non-empty factsList in contextLayers', async () => {
      const character = createTestCharacterDefinition();
      const show = createTestShow();
      const showCharacter = createTestCharacter(character.id, character.startingPrivateContext);

      const store = createMockStore({
        getCharacter: vi.fn().mockResolvedValue(showCharacter),
        getEventsForCharacter: vi.fn().mockResolvedValue([]),
      });
      const journal = new EventJournal(store);
      const builder = new ContextBuilder(journal, store);

      const pkg = await builder.buildPromptPackage(character, show, 'What do you think?');

      expect(pkg.contextLayers.factsList.length).toBeGreaterThan(0);
      expect(pkg.contextLayers.factsList).toContainEqual(expect.stringContaining('[Secret]'));
    });

    it('should use trigger as provided', async () => {
      const character = createTestCharacterDefinition();
      const show = createTestShow();
      const showCharacter = createTestCharacter(character.id, character.startingPrivateContext);

      const store = createMockStore({
        getCharacter: vi.fn().mockResolvedValue(showCharacter),
        getEventsForCharacter: vi.fn().mockResolvedValue([]),
      });
      const journal = new EventJournal(store);
      const builder = new ContextBuilder(journal, store);

      const trigger = 'The host asks: Who do you suspect?';
      const pkg = await builder.buildPromptPackage(character, show, trigger);

      expect(pkg.trigger).toBe(trigger);
    });

    it('should use responseConstraints from CharacterDefinition', async () => {
      const character = createTestCharacterDefinition();
      const show = createTestShow();
      const showCharacter = createTestCharacter(character.id, character.startingPrivateContext);

      const store = createMockStore({
        getCharacter: vi.fn().mockResolvedValue(showCharacter),
        getEventsForCharacter: vi.fn().mockResolvedValue([]),
      });
      const journal = new EventJournal(store);
      const builder = new ContextBuilder(journal, store);

      const pkg = await builder.buildPromptPackage(character, show, 'What do you think?');

      expect(pkg.responseConstraints).toEqual(character.responseConstraints);
      expect(pkg.responseConstraints.maxTokens).toBe(200);
    });

    it('should use contextWindowSize from show configSnapshot', async () => {
      const character = createTestCharacterDefinition();
      const show = createTestShow();
      const showCharacter = createTestCharacter(character.id, character.startingPrivateContext);

      const store = createMockStore({
        getCharacter: vi.fn().mockResolvedValue(showCharacter),
        getEventsForCharacter: vi.fn().mockResolvedValue([]),
      });
      const journal = new EventJournal(store);
      vi.spyOn(journal, 'getVisibleEvents');
      const builder = new ContextBuilder(journal, store);

      await builder.buildPromptPackage(character, show, 'What do you think?');

      // The contextWindowSize from configSnapshot is 25
      expect(journal.getVisibleEvents).toHaveBeenCalledWith('show-1', 'char-1', 25);
    });

    it('should use default contextWindowSize (50) if not in configSnapshot', async () => {
      const character = createTestCharacterDefinition();
      const show: Show = {
        id: 'show-1',
        formatId: 'coalition-format',
        seed: 12345,
        status: ShowStatus.running,
        currentPhaseId: 'phase-1',
        startedAt: new Date(),
        completedAt: null,
        configSnapshot: {}, // Empty configSnapshot
      };
      const showCharacter = createTestCharacter(character.id, character.startingPrivateContext);

      const store = createMockStore({
        getCharacter: vi.fn().mockResolvedValue(showCharacter),
        getEventsForCharacter: vi.fn().mockResolvedValue([]),
      });
      const journal = new EventJournal(store);
      vi.spyOn(journal, 'getVisibleEvents');
      const builder = new ContextBuilder(journal, store);

      await builder.buildPromptPackage(character, show, 'What do you think?');

      // Default contextWindowSize is 50
      expect(journal.getVisibleEvents).toHaveBeenCalledWith('show-1', 'char-1', 50);
    });
  });

  describe('trimToTokenBudget', () => {
    // Helper: create a mock adapter that returns configurable token counts
    function createMockAdapter(tokenCountFn: (pkg: PromptPackage) => number): ModelAdapter {
      return {
        providerId: 'mock',
        modelId: 'mock-v1',
        call: vi.fn().mockResolvedValue({ text: 'response' }),
        estimateTokens: (pkg: PromptPackage): TokenEstimate => ({
          prompt: tokenCountFn(pkg),
          estimatedCompletion: 100, // Fixed completion estimate
        }),
      };
    }

    function createTestPromptPackage(slidingWindowSize: number, factsListSize: number): PromptPackage {
      return {
        systemPrompt: 'You are a test character.',
        contextLayers: {
          factsList: Array.from({ length: factsListSize }, (_, i) => `[Fact] Fact number ${i + 1}`),
          slidingWindow: Array.from({ length: slidingWindowSize }, (_, i) => ({
            senderId: `char-${i % 3 + 1}`,
            senderName: `Character ${i % 3 + 1}`,
            channel: ChannelType.PUBLIC,
            content: `Message ${i + 1}: This is a test message with some content.`,
            timestamp: 1000 + i * 100,
          })),
        },
        trigger: 'What do you think?',
        responseConstraints: {
          maxTokens: 200,
          format: 'structured',
          language: 'en',
        },
      };
    }

    it('should return package unchanged if within budget', () => {
      const store = createMockStore();
      const journal = new EventJournal(store);
      const builder = new ContextBuilder(journal, store);

      // Create a small package
      const pkg = createTestPromptPackage(5, 3);

      // Adapter that counts 50 tokens per sliding window entry + 100 base
      const adapter = createMockAdapter((p) => 100 + p.contextLayers.slidingWindow.length * 50);

      // 100 base + 5 * 50 = 350 prompt + 100 completion = 450 total
      // Budget is 500, so it should fit
      const result = builder.trimToTokenBudget(pkg, 500, adapter);

      expect(result.contextLayers.slidingWindow.length).toBe(5);
      expect(result.contextLayers.factsList.length).toBe(3);
    });

    it('should trim slidingWindow when over budget', () => {
      const store = createMockStore();
      const journal = new EventJournal(store);
      const builder = new ContextBuilder(journal, store);

      // Create a package with 10 events in sliding window
      const pkg = createTestPromptPackage(10, 3);

      // Adapter that counts 50 tokens per sliding window entry + 100 base
      const adapter = createMockAdapter((p) => 100 + p.contextLayers.slidingWindow.length * 50);

      // 100 base + 10 * 50 = 600 prompt + 100 completion = 700 total
      // Budget is 500, need to remove at least 4 events to get to 400 prompt + 100 = 500
      const result = builder.trimToTokenBudget(pkg, 500, adapter);

      expect(result.contextLayers.slidingWindow.length).toBeLessThan(10);
      expect(result.contextLayers.slidingWindow.length).toBe(6); // 100 + 6*50 = 400 + 100 = 500
    });

    it('should NEVER trim factsList', () => {
      const store = createMockStore();
      const journal = new EventJournal(store);
      const builder = new ContextBuilder(journal, store);

      // Create a package with large facts list
      const pkg = createTestPromptPackage(5, 10);

      // Adapter that counts based on slidingWindow only (facts are "free")
      const adapter = createMockAdapter((p) => 100 + p.contextLayers.slidingWindow.length * 100);

      // Even with tight budget, factsList should remain intact
      const result = builder.trimToTokenBudget(pkg, 300, adapter);

      // All 10 facts should remain
      expect(result.contextLayers.factsList.length).toBe(10);
      expect(result.contextLayers.factsList).toEqual(pkg.contextLayers.factsList);
    });

    it('should remove oldest events first (from beginning)', () => {
      const store = createMockStore();
      const journal = new EventJournal(store);
      const builder = new ContextBuilder(journal, store);

      const pkg = createTestPromptPackage(5, 2);

      // Adapter: 50 tokens per event + 100 base
      const adapter = createMockAdapter((p) => 100 + p.contextLayers.slidingWindow.length * 50);

      // 100 + 5*50 = 350 prompt + 100 = 450 total
      // Budget 350 means we need 250 prompt, i.e., 3 events max
      const result = builder.trimToTokenBudget(pkg, 350, adapter);

      expect(result.contextLayers.slidingWindow.length).toBe(3);

      // Should keep newest events (index 2, 3, 4 from original)
      expect(result.contextLayers.slidingWindow[0]!.content).toBe('Message 3: This is a test message with some content.');
      expect(result.contextLayers.slidingWindow[1]!.content).toBe('Message 4: This is a test message with some content.');
      expect(result.contextLayers.slidingWindow[2]!.content).toBe('Message 5: This is a test message with some content.');
    });

    it('should handle empty slidingWindow', () => {
      const store = createMockStore();
      const journal = new EventJournal(store);
      const builder = new ContextBuilder(journal, store);

      const pkg = createTestPromptPackage(0, 3);

      // Even with very low budget, should not error
      const adapter = createMockAdapter(() => 500); // Always 500 tokens

      const result = builder.trimToTokenBudget(pkg, 100, adapter);

      expect(result.contextLayers.slidingWindow.length).toBe(0);
      expect(result.contextLayers.factsList.length).toBe(3);
    });

    it('should return package fitting within budget', () => {
      const store = createMockStore();
      const journal = new EventJournal(store);
      const builder = new ContextBuilder(journal, store);

      const pkg = createTestPromptPackage(20, 5);

      // Adapter: realistic token counting
      const adapter = createMockAdapter((p) => {
        const base = 200; // System prompt + trigger
        const perEvent = 30;
        return base + p.contextLayers.slidingWindow.length * perEvent;
      });

      const maxTokens = 500;
      const result = builder.trimToTokenBudget(pkg, maxTokens, adapter);

      // Verify result fits within budget
      const estimate = adapter.estimateTokens(result);
      const total = estimate.prompt + estimate.estimatedCompletion;
      expect(total).toBeLessThanOrEqual(maxTokens);
    });

    it('should use adapter.estimateTokens() for estimation', () => {
      const store = createMockStore();
      const journal = new EventJournal(store);
      const builder = new ContextBuilder(journal, store);

      const pkg = createTestPromptPackage(5, 2);

      const estimateTokensSpy = vi.fn().mockReturnValue({ prompt: 100, estimatedCompletion: 50 });
      const adapter: ModelAdapter = {
        providerId: 'mock',
        modelId: 'mock-v1',
        call: vi.fn().mockResolvedValue({ text: 'response' }),
        estimateTokens: estimateTokensSpy,
      };

      builder.trimToTokenBudget(pkg, 200, adapter);

      // Should have called estimateTokens at least once
      expect(estimateTokensSpy).toHaveBeenCalled();
    });
  });
});
