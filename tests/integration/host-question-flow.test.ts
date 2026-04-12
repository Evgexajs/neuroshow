/**
 * Integration Test: Host Question Flow
 *
 * HOST-011: Обработка вопросов ведущего (модификация turnQueue)
 *
 * Verifies:
 * - When host asks a question, targetCharacterId is inserted at the beginning of turnQueue
 * - Next turn goes to the target character
 * - Target receives the host's question in the context
 * - Character's response is marked with metadata.respondingTo
 * - Normal turn order continues after response
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the config module to always use 'mock' adapter
vi.mock('../../src/config.js', () => ({
  config: {
    adapterMode: 'mock',
    openaiApiKey: '',
    openaiDefaultModel: 'gpt-4.1-mini',
    tokenBudgetPerShow: 100000,
    port: 3000,
    dbPath: './data/test.db',
    nodeEnv: 'test',
  },
}));

import { Orchestrator } from '../../src/core/orchestrator.js';
import { HostModule } from '../../src/core/host-module.js';
import { EventJournal } from '../../src/core/event-journal.js';
import { ContextBuilder } from '../../src/core/context-builder.js';
import { SqliteStore } from '../../src/storage/sqlite-store.js';
import { LLMHostModule, DEFAULT_LLM_HOST_CONFIG } from '../../src/modules/llm-host/index.js';
import type { LLMHostConfig } from '../../src/modules/llm-host/types.js';
import type { ShowFormatTemplate } from '../../src/types/template.js';
import type { CharacterDefinition } from '../../src/types/character.js';
import type { ModelAdapter, PromptPackage, CharacterResponse, TokenEstimate } from '../../src/types/adapter.js';
import type { ShowEvent } from '../../src/types/events.js';
import { PhaseType, ChannelType, SpeakFrequency, EventType, CharacterIntent } from '../../src/types/enums.js';
import type { PrivateContext } from '../../src/types/context.js';
import { generateId } from '../../src/utils/id.js';
import * as fs from 'fs';

describe('Integration: Host Question Flow (HOST-011)', { timeout: 30000 }, () => {
  let store: SqliteStore;
  let eventJournal: EventJournal;
  let hostModule: HostModule;
  let contextBuilder: ContextBuilder;
  let llmHostModule: LLMHostModule;
  const testDbPath = './data/test-host-question-flow.db';

  // Track triggers received by each character (for question context verification)
  let triggersByCharacter: Map<string, string[]> = new Map();

  // Mock adapter that tracks triggers received by each character
  const createMockAdapter = (): ModelAdapter => ({
    providerId: 'mock',
    modelId: 'mock-model',
    call: async (pkg: PromptPackage): Promise<CharacterResponse> => {
      // Extract character name from personality prompt (e.g., "You are Alice")
      const nameMatch = pkg.systemPrompt.match(/You are (\w+)/);
      const characterName = nameMatch?.[1] ?? 'unknown';

      // Track what trigger this character received
      const triggers = triggersByCharacter.get(characterName) ?? [];
      triggers.push(pkg.trigger);
      triggersByCharacter.set(characterName, triggers);

      return {
        text: `Response from ${characterName}`,
        intent: CharacterIntent.speak,
      };
    },
    estimateTokens: (_pkg: PromptPackage): TokenEstimate => ({
      prompt: 100,
      estimatedCompletion: 50,
    }),
  });

  // Helper to create test template with longer duration
  const createTestTemplate = (): ShowFormatTemplate => ({
    id: 'test-format-question-flow',
    name: 'Test Format for Question Flow',
    description: 'A test show format for host question flow',
    minParticipants: 2,
    maxParticipants: 4,
    phases: [
      {
        id: 'phase-discussion',
        name: 'Discussion',
        type: PhaseType.discussion,
        durationMode: 'turns',
        durationValue: 3, // 3 rounds to test turn order
        turnOrder: 'sequential',
        allowedChannels: [ChannelType.PUBLIC],
        triggerTemplate: 'Continue the discussion',
        completionCondition: 'turns_complete',
      },
    ],
    decisionConfig: {
      timing: 'simultaneous',
      visibility: 'secret_until_reveal',
      revealMoment: 'after_all',
      format: 'choice',
      options: ['accept', 'reject'],
    },
    channelTypes: [ChannelType.PUBLIC],
    privateChannelRules: {
      initiator: 'character_free',
      maxPrivatesPerPhase: 0,
      maxPrivatesPerCharacterPerPhase: 0,
      requestQueueMode: 'fifo',
      requestFormat: 'public_ask',
    },
    contextWindowSize: 50,
    allowCharacterInitiative: false,
  });

  // Helper to create test character
  const createTestCharacter = (
    id: string,
    name: string
  ): CharacterDefinition & { modelAdapterId?: string } => {
    const privateContext: PrivateContext = {
      secrets: [`${name}'s secret`],
      alliances: [],
      goals: [`${name}'s goal`],
      wildcards: [],
    };

    return {
      id,
      name,
      publicCard: `${name} is a participant`,
      personalityPrompt: `You are ${name}`,
      motivationPrompt: `${name} wants to win`,
      boundaryRules: ['No violence'],
      startingPrivateContext: privateContext,
      speakFrequency: SpeakFrequency.medium,
      responseConstraints: {
        maxTokens: 200,
        format: 'free',
        language: 'ru',
      },
      modelAdapterId: 'mock',
    };
  };

  // Create test config for LLM Host (disabled to manually control questions)
  const createTestConfig = (): LLMHostConfig => ({
    ...DEFAULT_LLM_HOST_CONFIG,
    hostEnabled: false, // Disabled - we'll inject questions manually
    hostModelAdapter: 'mock',
    hostBudget: 5000,
    verboseLogging: false,
  });

  beforeEach(async () => {
    // Reset tracking
    triggersByCharacter = new Map();

    // Ensure test DB directory exists
    if (!fs.existsSync('./data')) {
      fs.mkdirSync('./data', { recursive: true });
    }

    // Clean up any existing test DB
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    // Create real components
    store = new SqliteStore(testDbPath);
    await store.initSchema();
    eventJournal = new EventJournal(store);
    hostModule = new HostModule(store, eventJournal);
    contextBuilder = new ContextBuilder(eventJournal, store);
    llmHostModule = new LLMHostModule(store, eventJournal);
    await llmHostModule.init();
  });

  afterEach(async () => {
    await llmHostModule.dispose();
    await store.close();

    // Clean up test DB
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('question triggers immediate target response', () => {
    it('should give target character next turn after host question', async () => {
      // Configure LLM Host (disabled - we inject questions manually)
      const config = createTestConfig();
      llmHostModule.setConfig(config);

      // Create mock adapter
      const mockAdapter = createMockAdapter();

      // Create orchestrator with LLM Host module
      const orchestrator = new Orchestrator(
        store,
        mockAdapter,
        eventJournal,
        hostModule,
        contextBuilder,
        undefined,
        llmHostModule
      );

      // Initialize show with 2 characters
      const template = createTestTemplate();
      const characters = [
        createTestCharacter('char-alice', 'Alice'),
        createTestCharacter('char-bob', 'Bob'),
      ];
      const show = await hostModule.initializeShow(template, characters, 12345);

      // After first character speaks, inject a host question targeting Bob
      let questionInjected = false;
      const originalAppend = eventJournal.append.bind(eventJournal);
      eventJournal.append = async (event: Omit<ShowEvent, 'sequenceNumber'>): Promise<ShowEvent> => {
        const result = await originalAppend(event);

        // After first speech event from Alice, inject a question targeting Bob
        if (
          event.type === EventType.speech &&
          !questionInjected &&
          event.senderId === 'char-alice'
        ) {
          questionInjected = true;

          // Inject host question targeting Bob
          const questionEvent: Omit<ShowEvent, 'sequenceNumber'> = {
            id: generateId(),
            showId: show.id,
            timestamp: Date.now(),
            phaseId: 'phase-discussion',
            type: EventType.host_trigger,
            channel: ChannelType.PUBLIC,
            visibility: ChannelType.PUBLIC,
            senderId: '',
            receiverIds: ['char-alice', 'char-bob'],
            audienceIds: ['char-alice', 'char-bob'],
            content: 'Bob, what is your secret goal in this discussion?',
            metadata: {
              interventionType: 'question',
              triggeredBy: 'manual_test',
              requiresResponse: true,
              targetCharacterId: 'char-bob',
            },
            seed: 'test-seed',
          };

          await originalAppend(questionEvent);
        }

        return result;
      };

      // Run the show
      await orchestrator.runShow(show.id);

      // Get all events
      const events = await eventJournal.getEvents(show.id);

      // Find the host question event
      const hostQuestion = events.find(
        (e) =>
          e.type === EventType.host_trigger &&
          e.metadata?.requiresResponse === true
      );
      expect(hostQuestion).toBeDefined();

      // Find the speech event immediately after the host question
      const questionIndex = events.indexOf(hostQuestion!);
      const responseAfterQuestion = events
        .slice(questionIndex + 1)
        .find((e) => e.type === EventType.speech);

      // The immediate response should be from Bob (the target)
      expect(responseAfterQuestion).toBeDefined();
      expect(responseAfterQuestion!.senderId).toBe('char-bob');
    });

    it('should include question in target character trigger', async () => {
      // Configure LLM Host
      const config = createTestConfig();
      llmHostModule.setConfig(config);

      // Create mock adapter
      const mockAdapter = createMockAdapter();

      // Create orchestrator with LLM Host module
      const orchestrator = new Orchestrator(
        store,
        mockAdapter,
        eventJournal,
        hostModule,
        contextBuilder,
        undefined,
        llmHostModule
      );

      // Initialize show
      const template = createTestTemplate();
      const characters = [
        createTestCharacter('char-alice', 'Alice'),
        createTestCharacter('char-bob', 'Bob'),
      ];
      const show = await hostModule.initializeShow(template, characters, 12345);

      // Inject question after first event
      let questionInjected = false;
      const questionText = 'Bob, tell us about your secret alliance!';
      const originalAppend = eventJournal.append.bind(eventJournal);
      eventJournal.append = async (event: Omit<ShowEvent, 'sequenceNumber'>): Promise<ShowEvent> => {
        const result = await originalAppend(event);

        if (
          event.type === EventType.speech &&
          !questionInjected &&
          event.senderId === 'char-alice'
        ) {
          questionInjected = true;

          const questionEvent: Omit<ShowEvent, 'sequenceNumber'> = {
            id: generateId(),
            showId: show.id,
            timestamp: Date.now(),
            phaseId: 'phase-discussion',
            type: EventType.host_trigger,
            channel: ChannelType.PUBLIC,
            visibility: ChannelType.PUBLIC,
            senderId: '',
            receiverIds: ['char-alice', 'char-bob'],
            audienceIds: ['char-alice', 'char-bob'],
            content: questionText,
            metadata: {
              interventionType: 'question',
              triggeredBy: 'manual_test',
              requiresResponse: true,
              targetCharacterId: 'char-bob',
            },
            seed: 'test-seed',
          };

          await originalAppend(questionEvent);
        }

        return result;
      };

      // Run the show
      await orchestrator.runShow(show.id);

      // Verify that Bob received the question in their trigger
      const bobTriggers = triggersByCharacter.get('Bob') ?? [];
      expect(bobTriggers.length).toBeGreaterThan(0);

      // At least one of Bob's triggers should contain the question
      const hasQuestionTrigger = bobTriggers.some(
        (trigger) =>
          trigger.includes('Ведущий') && trigger.includes(questionText)
      );
      expect(hasQuestionTrigger).toBe(true);
    });

    it('should mark character response with respondingTo metadata', async () => {
      // Configure LLM Host
      const config = createTestConfig();
      llmHostModule.setConfig(config);

      // Create mock adapter
      const mockAdapter = createMockAdapter();

      // Create orchestrator with LLM Host module
      const orchestrator = new Orchestrator(
        store,
        mockAdapter,
        eventJournal,
        hostModule,
        contextBuilder,
        undefined,
        llmHostModule
      );

      // Initialize show
      const template = createTestTemplate();
      const characters = [
        createTestCharacter('char-alice', 'Alice'),
        createTestCharacter('char-bob', 'Bob'),
      ];
      const show = await hostModule.initializeShow(template, characters, 12345);

      // Inject question and track its ID
      let questionInjected = false;
      let questionEventId: string | null = null;
      const originalAppend = eventJournal.append.bind(eventJournal);
      eventJournal.append = async (event: Omit<ShowEvent, 'sequenceNumber'>): Promise<ShowEvent> => {
        const result = await originalAppend(event);

        if (
          event.type === EventType.speech &&
          !questionInjected &&
          event.senderId === 'char-alice'
        ) {
          questionInjected = true;

          const questionEvent: Omit<ShowEvent, 'sequenceNumber'> = {
            id: generateId(),
            showId: show.id,
            timestamp: Date.now(),
            phaseId: 'phase-discussion',
            type: EventType.host_trigger,
            channel: ChannelType.PUBLIC,
            visibility: ChannelType.PUBLIC,
            senderId: '',
            receiverIds: ['char-alice', 'char-bob'],
            audienceIds: ['char-alice', 'char-bob'],
            content: 'Bob, what do you think about Alice?',
            metadata: {
              interventionType: 'question',
              triggeredBy: 'manual_test',
              requiresResponse: true,
              targetCharacterId: 'char-bob',
            },
            seed: 'test-seed',
          };

          const injectedQuestion = await originalAppend(questionEvent);
          questionEventId = injectedQuestion.id;
        }

        return result;
      };

      // Run the show
      await orchestrator.runShow(show.id);

      // Get all events
      const events = await eventJournal.getEvents(show.id);

      // Find speech events from Bob
      const bobSpeechEvents = events.filter(
        (e) => e.type === EventType.speech && e.senderId === 'char-bob'
      );

      // At least one of Bob's responses should have respondingTo metadata
      const responseToQuestion = bobSpeechEvents.find(
        (e) => e.metadata?.respondingTo === questionEventId
      );

      expect(responseToQuestion).toBeDefined();
      expect(responseToQuestion?.metadata?.respondingTo).toBe(questionEventId);
    });

    it('should continue normal turn order after question response', async () => {
      // Configure LLM Host
      const config = createTestConfig();
      llmHostModule.setConfig(config);

      // Create mock adapter
      const mockAdapter = createMockAdapter();

      // Create orchestrator with LLM Host module
      const orchestrator = new Orchestrator(
        store,
        mockAdapter,
        eventJournal,
        hostModule,
        contextBuilder,
        undefined,
        llmHostModule
      );

      // Initialize show with 2 characters
      const template = createTestTemplate();
      const characters = [
        createTestCharacter('char-alice', 'Alice'),
        createTestCharacter('char-bob', 'Bob'),
      ];
      const show = await hostModule.initializeShow(template, characters, 12345);

      // Inject question targeting Bob after first speaker
      let questionInjected = false;
      const originalAppend = eventJournal.append.bind(eventJournal);
      eventJournal.append = async (event: Omit<ShowEvent, 'sequenceNumber'>): Promise<ShowEvent> => {
        const result = await originalAppend(event);

        if (
          event.type === EventType.speech &&
          !questionInjected &&
          event.senderId === 'char-alice'
        ) {
          questionInjected = true;

          const questionEvent: Omit<ShowEvent, 'sequenceNumber'> = {
            id: generateId(),
            showId: show.id,
            timestamp: Date.now(),
            phaseId: 'phase-discussion',
            type: EventType.host_trigger,
            channel: ChannelType.PUBLIC,
            visibility: ChannelType.PUBLIC,
            senderId: '',
            receiverIds: ['char-alice', 'char-bob'],
            audienceIds: ['char-alice', 'char-bob'],
            content: 'Bob, what is your strategy?',
            metadata: {
              interventionType: 'question',
              triggeredBy: 'manual_test',
              requiresResponse: true,
              targetCharacterId: 'char-bob',
            },
            seed: 'test-seed',
          };

          await originalAppend(questionEvent);
        }

        return result;
      };

      // Run the show
      await orchestrator.runShow(show.id);

      // Get all events and verify turn order
      const events = await eventJournal.getEvents(show.id);
      const speechEvents = events.filter((e) => e.type === EventType.speech);

      // Count speeches by each character
      const aliceCount = speechEvents.filter((e) => e.senderId === 'char-alice').length;
      const bobCount = speechEvents.filter((e) => e.senderId === 'char-bob').length;

      // Both characters should have spoken multiple times
      // Template has 6 total turns (durationValue: 3 rounds * 2 characters)
      // The question response counts as one of these turns, so:
      // - Alice: should have 3 turns (normal order)
      // - Bob: 3 turns (1 question response + 2 normal, or depends on when question was injected)
      expect(aliceCount).toBeGreaterThanOrEqual(2);
      expect(bobCount).toBeGreaterThanOrEqual(2);

      // Verify that the total number of speech events is reasonable
      // (6 turns as per template, all should be speeches)
      expect(speechEvents.length).toBeGreaterThanOrEqual(6);
    });
  });
});
