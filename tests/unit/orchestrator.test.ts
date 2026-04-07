import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Orchestrator } from '../../src/core/orchestrator.js';
import { HostModule } from '../../src/core/host-module.js';
import { EventJournal } from '../../src/core/event-journal.js';
import { ContextBuilder } from '../../src/core/context-builder.js';
import { SqliteStore } from '../../src/storage/sqlite-store.js';
import { ShowFormatTemplate, Phase } from '../../src/types/template.js';
import { CharacterDefinition } from '../../src/types/character.js';
import { PhaseType, ChannelType, SpeakFrequency, EventType, CharacterIntent } from '../../src/types/enums.js';
import { PrivateContext } from '../../src/types/context.js';
import { ModelAdapter, PromptPackage, CharacterResponse, TokenEstimate } from '../../src/types/adapter.js';
import * as fs from 'fs';

describe('Orchestrator', () => {
  let store: SqliteStore;
  let eventJournal: EventJournal;
  let hostModule: HostModule;
  let contextBuilder: ContextBuilder;
  let orchestrator: Orchestrator;
  const testDbPath = './data/test-orchestrator.db';

  // Mock adapter for tests
  const mockAdapter: ModelAdapter = {
    providerId: 'mock',
    modelId: 'mock-model',
    call: async (_pkg: PromptPackage): Promise<CharacterResponse> => ({
      text: 'Mock response',
      intent: CharacterIntent.speak,
    }),
    estimateTokens: (_pkg: PromptPackage): TokenEstimate => ({
      prompt: 100,
      estimatedCompletion: 50,
    }),
  };

  // Helper to create test template
  const createTestTemplate = (): ShowFormatTemplate => ({
    id: 'test-format-v1',
    name: 'Test Format',
    description: 'A test show format',
    minParticipants: 2,
    maxParticipants: 5,
    phases: [
      {
        id: 'phase-discussion-1',
        name: 'Discussion Round 1',
        type: PhaseType.discussion,
        durationMode: 'turns',
        durationValue: 3,
        turnOrder: 'sequential',
        allowedChannels: [ChannelType.PUBLIC],
        triggerTemplate: 'Start discussion',
        completionCondition: 'turns_complete',
      },
    ],
    decisionConfig: {
      timing: 'simultaneous',
      visibility: 'hidden_until_reveal',
      revealMoment: 'after_all',
      format: 'choice',
      options: ['accept', 'reject'],
    },
    channelTypes: [ChannelType.PUBLIC, ChannelType.PRIVATE],
    privateChannelRules: {
      initiator: 'any',
      maxPrivatesPerPhase: 3,
      maxPrivatesPerCharacterPerPhase: 2,
      requestQueueMode: 'fifo',
      requestFormat: 'Requesting private talk with {{target}}',
    },
    contextWindowSize: 50,
    allowCharacterInitiative: true,
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

  beforeEach(async () => {
    // Clean up test db if exists
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    store = new SqliteStore(testDbPath);
    await store.initSchema();
    eventJournal = new EventJournal(store);
    hostModule = new HostModule(store, eventJournal);
    contextBuilder = new ContextBuilder(eventJournal, store);
    orchestrator = new Orchestrator(store, mockAdapter, eventJournal, hostModule, contextBuilder);
  });

  afterEach(async () => {
    await store.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('getState', () => {
    it('should return initial state with null showId', () => {
      const state = orchestrator.getState();
      expect(state.showId).toBeNull();
      expect(state.currentPhaseIndex).toBe(0);
      expect(state.turnIndex).toBe(0);
      expect(state.mode).toBe('AUTO');
    });
  });

  describe('runPhase', () => {
    it('should create phase_start event', async () => {
      const template = createTestTemplate();
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
        createTestCharacter('char-3', 'Carol'),
      ];

      // Initialize show
      const show = await hostModule.initializeShow(template, characters, 12345);
      const phase = template.phases[0]!;

      // Run the phase
      await orchestrator.runPhase(show.id, phase);

      // Check events
      const events = await eventJournal.getEvents(show.id);
      const phaseStartEvents = events.filter((e) => e.type === EventType.phase_start);

      expect(phaseStartEvents.length).toBe(1);
      expect(phaseStartEvents[0]!.phaseId).toBe(phase.id);
      expect(phaseStartEvents[0]!.content).toContain(phase.name);
    });

    it('should create phase_end event', async () => {
      const template = createTestTemplate();
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
      ];

      // Initialize show
      const show = await hostModule.initializeShow(template, characters, 12345);
      const phase = template.phases[0]!;

      // Run the phase
      await orchestrator.runPhase(show.id, phase);

      // Check events
      const events = await eventJournal.getEvents(show.id);
      const phaseEndEvents = events.filter((e) => e.type === EventType.phase_end);

      expect(phaseEndEvents.length).toBe(1);
      expect(phaseEndEvents[0]!.phaseId).toBe(phase.id);
      expect(phaseEndEvents[0]!.content).toContain(phase.name);
    });

    it('should execute all turns based on durationValue', async () => {
      const template = createTestTemplate();
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
        createTestCharacter('char-3', 'Carol'),
      ];

      // Initialize show
      const show = await hostModule.initializeShow(template, characters, 12345);
      const phase = template.phases[0]!; // durationValue = 3 turns per character

      // Run the phase
      await orchestrator.runPhase(show.id, phase);

      // Verify state after phase
      const state = orchestrator.getState();
      expect(state.showId).toBe(show.id);
      // 3 characters x 3 turns = 9 total turns
      expect(state.turnIndex).toBe(9);
    });

    it('should have phase_start before phase_end', async () => {
      const template = createTestTemplate();
      const characters = [createTestCharacter('char-1', 'Alice')];

      const show = await hostModule.initializeShow(template, characters, 12345);
      const phase = template.phases[0]!;

      await orchestrator.runPhase(show.id, phase);

      const events = await eventJournal.getEvents(show.id);
      const phaseStart = events.find((e) => e.type === EventType.phase_start);
      const phaseEnd = events.find((e) => e.type === EventType.phase_end);

      expect(phaseStart).toBeDefined();
      expect(phaseEnd).toBeDefined();
      expect(phaseStart!.sequenceNumber).toBeLessThan(phaseEnd!.sequenceNumber);
    });

    it('should set correct audienceIds on phase events', async () => {
      const template = createTestTemplate();
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
      ];

      const show = await hostModule.initializeShow(template, characters, 12345);
      const phase = template.phases[0]!;

      await orchestrator.runPhase(show.id, phase);

      const events = await eventJournal.getEvents(show.id);
      const phaseStart = events.find((e) => e.type === EventType.phase_start);

      expect(phaseStart!.audienceIds).toContain('char-1');
      expect(phaseStart!.audienceIds).toContain('char-2');
      expect(phaseStart!.audienceIds.length).toBe(2);
    });
  });

  describe('processCharacterTurn', () => {
    it('should return CharacterResponse from adapter.call()', async () => {
      const template = createTestTemplate();
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
      ];

      const show = await hostModule.initializeShow(template, characters, 12345);

      const response = await orchestrator.processCharacterTurn(
        show.id,
        'char-1',
        'What do you think?'
      );

      expect(response).toBeDefined();
      expect(response.text).toBe('Mock response');
      expect(response.intent).toBe(CharacterIntent.speak);
    });

    it('should record speech event with content from response.text', async () => {
      const template = createTestTemplate();
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
      ];

      const show = await hostModule.initializeShow(template, characters, 12345);

      await orchestrator.processCharacterTurn(show.id, 'char-1', 'What do you think?');

      const events = await eventJournal.getEvents(show.id);
      const speechEvents = events.filter((e) => e.type === EventType.speech);

      expect(speechEvents.length).toBe(1);
      expect(speechEvents[0]!.content).toBe('Mock response');
      expect(speechEvents[0]!.senderId).toBe('char-1');
    });

    it('should update token budget after processing turn', async () => {
      const template = createTestTemplate();
      const characters = [createTestCharacter('char-1', 'Alice')];

      const show = await hostModule.initializeShow(template, characters, 12345);

      // Budget should start at 0
      const budgetBefore = await store.getBudget(show.id);
      expect(budgetBefore!.usedPrompt).toBe(0);
      expect(budgetBefore!.usedCompletion).toBe(0);

      await orchestrator.processCharacterTurn(show.id, 'char-1', 'Test trigger');

      // Budget should be updated after the turn
      const budgetAfter = await store.getBudget(show.id);
      expect(budgetAfter!.usedPrompt).toBe(100);
      expect(budgetAfter!.usedCompletion).toBe(50);
    });

    it('should throw error if show not found', async () => {
      await expect(
        orchestrator.processCharacterTurn('non-existent-show', 'char-1', 'Test')
      ).rejects.toThrow('Show non-existent-show not found');
    });

    it('should throw error if character not found', async () => {
      const template = createTestTemplate();
      const characters = [createTestCharacter('char-1', 'Alice')];

      const show = await hostModule.initializeShow(template, characters, 12345);

      await expect(
        orchestrator.processCharacterTurn(show.id, 'non-existent-char', 'Test')
      ).rejects.toThrow('Character definition for non-existent-char not found');
    });

    it('should set correct audienceIds on speech event', async () => {
      const template = createTestTemplate();
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
        createTestCharacter('char-3', 'Carol'),
      ];

      const show = await hostModule.initializeShow(template, characters, 12345);

      await orchestrator.processCharacterTurn(show.id, 'char-1', 'Hello everyone');

      const events = await eventJournal.getEvents(show.id);
      const speechEvent = events.find((e) => e.type === EventType.speech);

      expect(speechEvent!.audienceIds).toContain('char-1');
      expect(speechEvent!.audienceIds).toContain('char-2');
      expect(speechEvent!.audienceIds).toContain('char-3');
      expect(speechEvent!.audienceIds.length).toBe(3);
    });

    it('should call adapter with PromptPackage from ContextBuilder', async () => {
      // Create a spy adapter to verify the call
      let capturedPrompt: PromptPackage | null = null;
      const spyAdapter: ModelAdapter = {
        providerId: 'spy',
        modelId: 'spy-model',
        call: async (pkg: PromptPackage): Promise<CharacterResponse> => {
          capturedPrompt = pkg;
          return { text: 'Spy response', intent: CharacterIntent.speak };
        },
        estimateTokens: (_pkg: PromptPackage): TokenEstimate => ({
          prompt: 50,
          estimatedCompletion: 25,
        }),
      };

      const spyOrchestrator = new Orchestrator(
        store,
        spyAdapter,
        eventJournal,
        hostModule,
        contextBuilder
      );

      const template = createTestTemplate();
      const characters = [createTestCharacter('char-1', 'Alice')];

      const show = await hostModule.initializeShow(template, characters, 12345);

      await spyOrchestrator.processCharacterTurn(show.id, 'char-1', 'Custom trigger');

      expect(capturedPrompt).not.toBeNull();
      expect(capturedPrompt!.trigger).toBe('Custom trigger');
      expect(capturedPrompt!.systemPrompt).toContain('Alice');
      expect(capturedPrompt!.contextLayers).toBeDefined();
      expect(capturedPrompt!.responseConstraints).toBeDefined();
    });
  });

  describe('handleIntent', () => {
    it('should do nothing for "speak" intent', async () => {
      const template = createTestTemplate();
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
      ];

      const show = await hostModule.initializeShow(template, characters, 12345);

      const response: CharacterResponse = {
        text: 'Hello everyone!',
        intent: CharacterIntent.speak,
      };

      // Get events before handling intent
      const eventsBefore = await eventJournal.getEvents(show.id);
      const countBefore = eventsBefore.length;

      // Handle intent
      await orchestrator.handleIntent(show.id, response, 'char-1');

      // No additional events should be created for 'speak' intent
      const eventsAfter = await eventJournal.getEvents(show.id);
      expect(eventsAfter.length).toBe(countBefore);
    });

    it('should do nothing when no intent is provided', async () => {
      const template = createTestTemplate();
      const characters = [createTestCharacter('char-1', 'Alice')];

      const show = await hostModule.initializeShow(template, characters, 12345);

      const response: CharacterResponse = {
        text: 'Hello!',
        // No intent
      };

      const eventsBefore = await eventJournal.getEvents(show.id);
      const countBefore = eventsBefore.length;

      await orchestrator.handleIntent(show.id, response, 'char-1');

      const eventsAfter = await eventJournal.getEvents(show.id);
      expect(eventsAfter.length).toBe(countBefore);
    });

    it('should call validatePrivateRequest for "request_private" intent', async () => {
      const template = createTestTemplate();
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
      ];

      const show = await hostModule.initializeShow(template, characters, 12345);

      // Spy on validatePrivateRequest
      const validateSpy = vi.spyOn(hostModule, 'validatePrivateRequest');

      const response: CharacterResponse = {
        text: 'I want to talk to Bob privately',
        intent: CharacterIntent.request_private,
        target: 'char-2',
      };

      await orchestrator.handleIntent(show.id, response, 'char-1');

      expect(validateSpy).toHaveBeenCalledWith(
        show.id,
        'char-1',
        'char-2',
        expect.objectContaining({
          maxPrivatesPerPhase: 3,
          maxPrivatesPerCharacterPerPhase: 2,
        })
      );

      validateSpy.mockRestore();
    });

    it('should open private channel if request_private is validated', async () => {
      const template = createTestTemplate();
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
      ];

      const show = await hostModule.initializeShow(template, characters, 12345);

      const response: CharacterResponse = {
        text: 'I want to talk to Bob privately',
        intent: CharacterIntent.request_private,
        target: 'char-2',
      };

      await orchestrator.handleIntent(show.id, response, 'char-1');

      // Check that channel_change event was created
      const events = await eventJournal.getEvents(show.id);
      const channelChangeEvents = events.filter(
        (e) => e.type === EventType.channel_change && e.channel === ChannelType.PRIVATE
      );

      expect(channelChangeEvents.length).toBe(1);
      expect(channelChangeEvents[0]!.metadata?.participants).toContain('char-1');
      expect(channelChangeEvents[0]!.metadata?.participants).toContain('char-2');
    });

    it('should not open private channel if no target provided', async () => {
      const template = createTestTemplate();
      const characters = [createTestCharacter('char-1', 'Alice')];

      const show = await hostModule.initializeShow(template, characters, 12345);

      const response: CharacterResponse = {
        text: 'I want a private talk',
        intent: CharacterIntent.request_private,
        // No target!
      };

      await orchestrator.handleIntent(show.id, response, 'char-1');

      // No channel_change event should be created
      const events = await eventJournal.getEvents(show.id);
      const channelChangeEvents = events.filter((e) => e.type === EventType.channel_change);

      expect(channelChangeEvents.length).toBe(0);
    });

    it('should create revelation event for "reveal_wildcard" intent', async () => {
      const template = createTestTemplate();
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
      ];

      const show = await hostModule.initializeShow(template, characters, 12345);

      const response: CharacterResponse = {
        text: 'I have a secret weapon!',
        intent: CharacterIntent.reveal_wildcard,
      };

      await orchestrator.handleIntent(show.id, response, 'char-1');

      // Check that revelation event was created
      const events = await eventJournal.getEvents(show.id);
      const revelationEvents = events.filter((e) => e.type === EventType.revelation);

      expect(revelationEvents.length).toBe(1);
      expect(revelationEvents[0]!.content).toBe('I have a secret weapon!');
      expect(revelationEvents[0]!.senderId).toBe('char-1');
      expect(revelationEvents[0]!.metadata?.isWildcard).toBe(true);
      expect(revelationEvents[0]!.channel).toBe(ChannelType.PUBLIC);
    });

    it('should set all characters as audience for wildcard revelation', async () => {
      const template = createTestTemplate();
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
        createTestCharacter('char-3', 'Carol'),
      ];

      const show = await hostModule.initializeShow(template, characters, 12345);

      const response: CharacterResponse = {
        text: 'My wildcard!',
        intent: CharacterIntent.reveal_wildcard,
      };

      await orchestrator.handleIntent(show.id, response, 'char-1');

      const events = await eventJournal.getEvents(show.id);
      const revelationEvent = events.find((e) => e.type === EventType.revelation);

      expect(revelationEvent!.audienceIds).toContain('char-1');
      expect(revelationEvent!.audienceIds).toContain('char-2');
      expect(revelationEvent!.audienceIds).toContain('char-3');
      expect(revelationEvent!.audienceIds.length).toBe(3);
    });

    it('should log for "end_turn" intent without creating events', async () => {
      const template = createTestTemplate();
      const characters = [createTestCharacter('char-1', 'Alice')];

      const show = await hostModule.initializeShow(template, characters, 12345);

      const response: CharacterResponse = {
        text: 'I pass',
        intent: CharacterIntent.end_turn,
      };

      const eventsBefore = await eventJournal.getEvents(show.id);
      const countBefore = eventsBefore.length;

      // Handle intent - should just log
      await orchestrator.handleIntent(show.id, response, 'char-1');

      // No additional events should be created
      const eventsAfter = await eventJournal.getEvents(show.id);
      expect(eventsAfter.length).toBe(countBefore);
    });
  });
});
