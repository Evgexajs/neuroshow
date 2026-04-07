import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Orchestrator } from '../../src/core/orchestrator.js';
import { HostModule } from '../../src/core/host-module.js';
import { EventJournal } from '../../src/core/event-journal.js';
import { ContextBuilder } from '../../src/core/context-builder.js';
import { SqliteStore } from '../../src/storage/sqlite-store.js';
import { ShowFormatTemplate, Phase } from '../../src/types/template.js';
import { CharacterDefinition } from '../../src/types/character.js';
import { PhaseType, ChannelType, SpeakFrequency, EventType, CharacterIntent, BudgetMode } from '../../src/types/enums.js';
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

  describe('checkBudget', () => {
    it('should return "normal" mode when usage is below 80%', async () => {
      const template = createTestTemplate();
      const characters = [createTestCharacter('char-1', 'Alice')];

      const show = await hostModule.initializeShow(template, characters, 12345);

      // Budget starts at 0, so it should be in normal mode
      const mode = await orchestrator.checkBudget(show.id);
      expect(mode).toBe(BudgetMode.normal);
    });

    it('should return "budget_saving" mode at 80% usage', async () => {
      const template = createTestTemplate();
      const characters = [createTestCharacter('char-1', 'Alice')];

      const show = await hostModule.initializeShow(template, characters, 12345);

      // Get current budget to know the total limit
      const budget = await store.getBudget(show.id);
      expect(budget).not.toBeNull();

      // Update budget to 80% usage
      const tokensToUse = Math.floor(budget!.totalLimit * 0.8);
      await store.updateBudget(show.id, tokensToUse, 0);

      const mode = await orchestrator.checkBudget(show.id);
      expect(mode).toBe(BudgetMode.budget_saving);
    });

    it('should return "graceful_finish" mode at 100% usage', async () => {
      const template = createTestTemplate();
      const characters = [createTestCharacter('char-1', 'Alice')];

      const show = await hostModule.initializeShow(template, characters, 12345);

      const budget = await store.getBudget(show.id);
      expect(budget).not.toBeNull();

      // Update budget to 100% usage
      await store.updateBudget(show.id, budget!.totalLimit, 0);

      const mode = await orchestrator.checkBudget(show.id);
      expect(mode).toBe(BudgetMode.graceful_finish);
    });

    it('should create "system" event when mode changes', async () => {
      const template = createTestTemplate();
      const characters = [createTestCharacter('char-1', 'Alice')];

      const show = await hostModule.initializeShow(template, characters, 12345);

      const budget = await store.getBudget(show.id);
      expect(budget).not.toBeNull();

      // Get events before budget change
      const eventsBefore = await eventJournal.getEvents(show.id);
      const countBefore = eventsBefore.length;

      // Update budget to 80% to trigger mode change
      const tokensToUse = Math.floor(budget!.totalLimit * 0.8);
      await store.updateBudget(show.id, tokensToUse, 0);

      // Check budget (triggers mode change)
      await orchestrator.checkBudget(show.id);

      // Verify system event was created
      const eventsAfter = await eventJournal.getEvents(show.id);
      expect(eventsAfter.length).toBe(countBefore + 1);

      const systemEvent = eventsAfter.find((e) => e.type === EventType.system);
      expect(systemEvent).toBeDefined();
      expect(systemEvent!.metadata?.budgetModeChange).toBe(true);
      expect(systemEvent!.metadata?.oldMode).toBe(BudgetMode.normal);
      expect(systemEvent!.metadata?.newMode).toBe(BudgetMode.budget_saving);
    });

    it('should not create event if mode does not change', async () => {
      const template = createTestTemplate();
      const characters = [createTestCharacter('char-1', 'Alice')];

      const show = await hostModule.initializeShow(template, characters, 12345);

      // Check budget twice while in normal mode
      await orchestrator.checkBudget(show.id);
      const eventsAfterFirst = await eventJournal.getEvents(show.id);

      await orchestrator.checkBudget(show.id);
      const eventsAfterSecond = await eventJournal.getEvents(show.id);

      // No new events should be created
      expect(eventsAfterSecond.length).toBe(eventsAfterFirst.length);
    });

    it('should return "normal" mode if no budget exists', async () => {
      // Call checkBudget with a non-existent show
      const mode = await orchestrator.checkBudget('non-existent-show');
      expect(mode).toBe(BudgetMode.normal);
    });

    it('should persist mode change to store', async () => {
      const template = createTestTemplate();
      const characters = [createTestCharacter('char-1', 'Alice')];

      const show = await hostModule.initializeShow(template, characters, 12345);

      const budget = await store.getBudget(show.id);
      expect(budget!.mode).toBe(BudgetMode.normal);

      // Update budget to 80%
      const tokensToUse = Math.floor(budget!.totalLimit * 0.8);
      await store.updateBudget(show.id, tokensToUse, 0);

      // Check budget (triggers mode change)
      await orchestrator.checkBudget(show.id);

      // Verify mode was persisted
      const updatedBudget = await store.getBudget(show.id);
      expect(updatedBudget!.mode).toBe(BudgetMode.budget_saving);
    });

    it('should transition from budget_saving to graceful_finish', async () => {
      const template = createTestTemplate();
      const characters = [createTestCharacter('char-1', 'Alice')];

      const show = await hostModule.initializeShow(template, characters, 12345);

      const budget = await store.getBudget(show.id);

      // First, go to budget_saving mode (80%)
      const tokensFor80 = Math.floor(budget!.totalLimit * 0.8);
      await store.updateBudget(show.id, tokensFor80, 0);
      let mode = await orchestrator.checkBudget(show.id);
      expect(mode).toBe(BudgetMode.budget_saving);

      // Then, go to graceful_finish mode (100%)
      const remaining = budget!.totalLimit - tokensFor80;
      await store.updateBudget(show.id, remaining, 0);
      mode = await orchestrator.checkBudget(show.id);
      expect(mode).toBe(BudgetMode.graceful_finish);

      // Verify system event for the second transition
      const events = await eventJournal.getEvents(show.id);
      const systemEvents = events.filter((e) => e.type === EventType.system);
      expect(systemEvents.length).toBe(2);

      const lastSystemEvent = systemEvents[systemEvents.length - 1];
      expect(lastSystemEvent!.metadata?.oldMode).toBe(BudgetMode.budget_saving);
      expect(lastSystemEvent!.metadata?.newMode).toBe(BudgetMode.graceful_finish);
    });
  });

  describe('getAdjustedConstraints', () => {
    it('should return original constraints in normal mode', async () => {
      const template = createTestTemplate();
      const characters = [createTestCharacter('char-1', 'Alice')];

      const show = await hostModule.initializeShow(template, characters, 12345);

      const originalConstraints = { maxTokens: 200, format: 'free', language: 'ru' };
      const adjusted = await orchestrator.getAdjustedConstraints(show.id, originalConstraints);

      expect(adjusted.maxTokens).toBe(200);
      expect(adjusted.format).toBe('free');
      expect(adjusted.language).toBe('ru');
    });

    it('should reduce maxTokens by 50% in budget_saving mode', async () => {
      const template = createTestTemplate();
      const characters = [createTestCharacter('char-1', 'Alice')];

      const show = await hostModule.initializeShow(template, characters, 12345);

      const budget = await store.getBudget(show.id);
      const tokensToUse = Math.floor(budget!.totalLimit * 0.8);
      await store.updateBudget(show.id, tokensToUse, 0);

      const originalConstraints = { maxTokens: 200, format: 'free', language: 'ru' };
      const adjusted = await orchestrator.getAdjustedConstraints(show.id, originalConstraints);

      expect(adjusted.maxTokens).toBe(100); // 50% of 200
      expect(adjusted.format).toBe('free');
      expect(adjusted.language).toBe('ru');
    });
  });

  describe('shouldLimitPrivates', () => {
    it('should return false in normal mode', async () => {
      const template = createTestTemplate();
      const characters = [createTestCharacter('char-1', 'Alice')];

      const show = await hostModule.initializeShow(template, characters, 12345);

      const shouldLimit = await orchestrator.shouldLimitPrivates(show.id);
      expect(shouldLimit).toBe(false);
    });

    it('should return true in budget_saving mode', async () => {
      const template = createTestTemplate();
      const characters = [createTestCharacter('char-1', 'Alice')];

      const show = await hostModule.initializeShow(template, characters, 12345);

      const budget = await store.getBudget(show.id);
      const tokensToUse = Math.floor(budget!.totalLimit * 0.8);
      await store.updateBudget(show.id, tokensToUse, 0);

      const shouldLimit = await orchestrator.shouldLimitPrivates(show.id);
      expect(shouldLimit).toBe(true);
    });

    it('should return true in graceful_finish mode', async () => {
      const template = createTestTemplate();
      const characters = [createTestCharacter('char-1', 'Alice')];

      const show = await hostModule.initializeShow(template, characters, 12345);

      const budget = await store.getBudget(show.id);
      await store.updateBudget(show.id, budget!.totalLimit, 0);

      const shouldLimit = await orchestrator.shouldLimitPrivates(show.id);
      expect(shouldLimit).toBe(true);
    });
  });

  describe('runShow', () => {
    it('should run all phases sequentially and complete the show', async () => {
      // Create template with 3 phases
      const template: ShowFormatTemplate = {
        ...createTestTemplate(),
        phases: [
          {
            id: 'phase-1',
            name: 'Discussion 1',
            type: PhaseType.discussion,
            durationMode: 'turns',
            durationValue: 1,
            turnOrder: 'sequential',
            allowedChannels: [ChannelType.PUBLIC],
            triggerTemplate: 'Start discussion 1',
            completionCondition: 'turns_complete',
          },
          {
            id: 'phase-2',
            name: 'Discussion 2',
            type: PhaseType.discussion,
            durationMode: 'turns',
            durationValue: 1,
            turnOrder: 'sequential',
            allowedChannels: [ChannelType.PUBLIC],
            triggerTemplate: 'Start discussion 2',
            completionCondition: 'turns_complete',
          },
          {
            id: 'phase-3',
            name: 'Discussion 3',
            type: PhaseType.discussion,
            durationMode: 'turns',
            durationValue: 1,
            turnOrder: 'sequential',
            allowedChannels: [ChannelType.PUBLIC],
            triggerTemplate: 'Start discussion 3',
            completionCondition: 'turns_complete',
          },
        ],
      };

      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
      ];

      const show = await hostModule.initializeShow(template, characters, 12345);

      // Run the show
      await orchestrator.runShow(show.id);

      // Check that all phases ran (phase_start and phase_end for each)
      const events = await eventJournal.getEvents(show.id);
      const phaseStartEvents = events.filter((e) => e.type === EventType.phase_start);
      const phaseEndEvents = events.filter((e) => e.type === EventType.phase_end);

      expect(phaseStartEvents.length).toBe(3);
      expect(phaseEndEvents.length).toBe(3);

      // Check show status is completed
      const showRecord = await store.getShow(show.id);
      expect(showRecord?.status).toBe('completed');
    });

    it('should update show status to running at start', async () => {
      const template = createTestTemplate();
      const characters = [createTestCharacter('char-1', 'Alice')];

      const show = await hostModule.initializeShow(template, characters, 12345);

      // Mock runPhase to check status mid-run
      let statusDuringRun: string | undefined;
      const originalRunPhase = orchestrator.runPhase.bind(orchestrator);
      vi.spyOn(orchestrator, 'runPhase').mockImplementation(async (showId, phase) => {
        const record = await store.getShow(showId);
        statusDuringRun = record?.status;
        return originalRunPhase(showId, phase);
      });

      await orchestrator.runShow(show.id);

      expect(statusDuringRun).toBe('running');
    });

    it('should check budget before each phase', async () => {
      const template = createTestTemplate();
      const characters = [createTestCharacter('char-1', 'Alice')];

      const show = await hostModule.initializeShow(template, characters, 12345);

      const checkBudgetSpy = vi.spyOn(orchestrator, 'checkBudget');

      await orchestrator.runShow(show.id);

      // checkBudget should be called at least once per phase
      expect(checkBudgetSpy).toHaveBeenCalled();
      expect(checkBudgetSpy).toHaveBeenCalledWith(show.id);
    });

    it('should trigger gracefulFinish when budget is exhausted', async () => {
      const template = createTestTemplate();
      const characters = [createTestCharacter('char-1', 'Alice')];

      const show = await hostModule.initializeShow(template, characters, 12345);

      // Exhaust budget before running
      const budget = await store.getBudget(show.id);
      await store.updateBudget(show.id, budget!.totalLimit, 0);

      const gracefulFinishSpy = vi.spyOn(orchestrator, 'gracefulFinish');

      await orchestrator.runShow(show.id);

      expect(gracefulFinishSpy).toHaveBeenCalledWith(show.id);
    });

    it('should throw error if show not found', async () => {
      await expect(orchestrator.runShow('non-existent-show')).rejects.toThrow(
        'Show non-existent-show not found'
      );
    });

    it('should run decision phase for type "decision"', async () => {
      const template: ShowFormatTemplate = {
        ...createTestTemplate(),
        phases: [
          {
            id: 'phase-decision',
            name: 'Decision Phase',
            type: PhaseType.decision,
            durationMode: 'turns',
            durationValue: 1,
            turnOrder: 'sequential',
            allowedChannels: [ChannelType.PUBLIC],
            triggerTemplate: null,
            completionCondition: 'turns_complete',
          },
        ],
      };

      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
      ];

      const show = await hostModule.initializeShow(template, characters, 12345);

      const runDecisionPhaseSpy = vi.spyOn(hostModule, 'runDecisionPhase');

      await orchestrator.runShow(show.id);

      expect(runDecisionPhaseSpy).toHaveBeenCalled();
    });

    it('should run revelation at the end', async () => {
      const template = createTestTemplate();
      const characters = [createTestCharacter('char-1', 'Alice')];

      const show = await hostModule.initializeShow(template, characters, 12345);

      const runRevelationSpy = vi.spyOn(hostModule, 'runRevelation');

      await orchestrator.runShow(show.id);

      expect(runRevelationSpy).toHaveBeenCalledWith(show.id, template.decisionConfig);
    });
  });
});
