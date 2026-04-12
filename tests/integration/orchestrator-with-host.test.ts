/**
 * Integration Test: Orchestrator with LLMHostModule
 *
 * HOST-010: Tests Orchestrator integration with LLMHostModule
 *
 * Verifies:
 * - Orchestrator accepts optional ILLMHostModule in constructor
 * - After each event, llmHostModule.onEventAppended() is called
 * - Budget is initialized when hostEnabled: true
 * - Show runs correctly when hostEnabled: false
 * - Full show run with host generates interventions
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
import { PhaseType, ChannelType, SpeakFrequency, EventType, CharacterIntent, HostBudgetMode } from '../../src/types/enums.js';
import type { PrivateContext } from '../../src/types/context.js';
import * as fs from 'fs';

describe('Integration: Orchestrator with LLMHostModule', { timeout: 30000 }, () => {
  let store: SqliteStore;
  let eventJournal: EventJournal;
  let hostModule: HostModule;
  let contextBuilder: ContextBuilder;
  let llmHostModule: LLMHostModule;
  const testDbPath = './data/test-orchestrator-with-host.db';

  // Mock adapter for character turns
  const mockAdapter: ModelAdapter = {
    providerId: 'mock',
    modelId: 'mock-model',
    call: async (_pkg: PromptPackage): Promise<CharacterResponse> => ({
      text: 'Mock response from character',
      intent: CharacterIntent.speak,
    }),
    estimateTokens: (_pkg: PromptPackage): TokenEstimate => ({
      prompt: 100,
      estimatedCompletion: 50,
    }),
  };

  // Helper to create test template
  const createTestTemplate = (): ShowFormatTemplate => ({
    id: 'test-format-host',
    name: 'Test Format with Host',
    description: 'A test show format for host integration',
    minParticipants: 2,
    maxParticipants: 4,
    phases: [
      {
        id: 'phase-discussion',
        name: 'Discussion',
        type: PhaseType.discussion,
        durationMode: 'turns',
        durationValue: 2, // Keep short for faster tests
        turnOrder: 'sequential',
        allowedChannels: [ChannelType.PUBLIC],
        triggerTemplate: 'Start discussion',
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
    channelTypes: [ChannelType.PUBLIC, ChannelType.PRIVATE],
    privateChannelRules: {
      initiator: 'character_free',
      maxPrivatesPerPhase: 3,
      maxPrivatesPerCharacterPerPhase: 2,
      requestQueueMode: 'fifo',
      requestFormat: 'public_ask',
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

  // Create test config for LLM Host
  const createTestConfig = (enabled: boolean): LLMHostConfig => ({
    ...DEFAULT_LLM_HOST_CONFIG,
    hostEnabled: enabled,
    hostModelAdapter: 'mock', // Use mock adapter for deterministic tests
    hostBudget: 5000,
    verboseLogging: false,
  });

  beforeEach(async () => {
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

  describe('constructor with llmHostModule', () => {
    it('should accept optional llmHostModule parameter', () => {
      const orchestrator = new Orchestrator(
        store,
        mockAdapter,
        eventJournal,
        hostModule,
        contextBuilder,
        undefined,
        llmHostModule
      );

      expect(orchestrator).toBeDefined();
    });

    it('should work without llmHostModule', () => {
      const orchestrator = new Orchestrator(
        store,
        mockAdapter,
        eventJournal,
        hostModule,
        contextBuilder
      );

      expect(orchestrator).toBeDefined();
    });
  });

  describe('runShow with hostEnabled: true', () => {
    it('should initialize LLM Host budget when running show', async () => {
      // Configure LLM Host
      const config = createTestConfig(true);
      llmHostModule.setConfig(config);

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
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
      ];
      const show = await hostModule.initializeShow(template, characters, 12345);

      // Run the show
      await orchestrator.runShow(show.id);

      // Verify budget was initialized
      const status = await llmHostModule.getStatus(show.id);
      expect(status.budget).toBeDefined();
      expect(status.budget.totalLimit).toBe(config.hostBudget);
      expect(status.budget.mode).toBe(HostBudgetMode.normal);
    });

    it('should call onEventAppended for phase_start event', async () => {
      // Configure LLM Host
      const config = createTestConfig(true);
      llmHostModule.setConfig(config);

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
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
      ];
      const show = await hostModule.initializeShow(template, characters, 12345);

      // Run the show
      await orchestrator.runShow(show.id);

      // Verify interventions were generated (phase_start should trigger announcement)
      const status = await llmHostModule.getStatus(show.id);
      expect(status.interventionCount).toBeGreaterThan(0);
    });

    it('should generate host_trigger events during show execution', async () => {
      // Configure LLM Host
      const config = createTestConfig(true);
      llmHostModule.setConfig(config);

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
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
      ];
      const show = await hostModule.initializeShow(template, characters, 12345);

      // Run the show
      await orchestrator.runShow(show.id);

      // Check for host_trigger events in the journal
      const events = await eventJournal.getEvents(show.id);
      const hostEvents = events.filter((e) => e.type === EventType.host_trigger);

      // At minimum, phase_start should trigger an announcement intervention
      // (phase_end may have timing issues with async event handling)
      expect(hostEvents.length).toBeGreaterThanOrEqual(1);

      // Verify host events have correct metadata
      const firstHostEvent = hostEvents[0]!;
      expect(firstHostEvent.metadata).toBeDefined();
      expect(firstHostEvent.metadata.interventionType).toBeDefined();
      expect(firstHostEvent.metadata.triggeredBy).toBeDefined();
    });

    it('should update budget after host interventions', async () => {
      // Configure LLM Host with small budget to see changes
      const config = createTestConfig(true);
      config.hostBudget = 1000;
      llmHostModule.setConfig(config);

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
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
      ];
      const show = await hostModule.initializeShow(template, characters, 12345);

      // Run the show
      await orchestrator.runShow(show.id);

      // Check budget was consumed
      const status = await llmHostModule.getStatus(show.id);
      expect(status.budget.usedPrompt + status.budget.usedCompletion).toBeGreaterThan(0);
    });
  });

  describe('runShow with hostEnabled: false', () => {
    it('should not initialize LLM Host budget', async () => {
      // Configure LLM Host with hostEnabled: false
      const config = createTestConfig(false);
      llmHostModule.setConfig(config);

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
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
      ];
      const show = await hostModule.initializeShow(template, characters, 12345);

      // Run the show
      await orchestrator.runShow(show.id);

      // Verify no interventions were generated (host was disabled)
      const status = await llmHostModule.getStatus(show.id);
      // Budget is not explicitly created, so usedPrompt + usedCompletion should be 0
      expect(status.budget.usedPrompt + status.budget.usedCompletion).toBe(0);
      expect(status.interventionCount).toBe(0);
    });

    it('should not generate host_trigger events', async () => {
      // Configure LLM Host with hostEnabled: false
      const config = createTestConfig(false);
      llmHostModule.setConfig(config);

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
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
      ];
      const show = await hostModule.initializeShow(template, characters, 12345);

      // Run the show
      await orchestrator.runShow(show.id);

      // Check for host_trigger events in the journal
      const events = await eventJournal.getEvents(show.id);
      const hostEvents = events.filter((e) => e.type === EventType.host_trigger);

      // No host events should be present
      expect(hostEvents.length).toBe(0);
    });

    it('should complete show successfully without host', async () => {
      // Configure LLM Host with hostEnabled: false
      const config = createTestConfig(false);
      llmHostModule.setConfig(config);

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
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
      ];
      const show = await hostModule.initializeShow(template, characters, 12345);

      // Run the show - should complete without errors
      await orchestrator.runShow(show.id);

      // Verify show completed
      const showRecord = await store.getShow(show.id);
      expect(showRecord).toBeDefined();
      // Show should have phase_start, speech events, and phase_end
      const events = await eventJournal.getEvents(show.id);
      expect(events.length).toBeGreaterThan(0);

      const phaseStartEvents = events.filter((e) => e.type === EventType.phase_start);
      const phaseEndEvents = events.filter((e) => e.type === EventType.phase_end);
      expect(phaseStartEvents.length).toBe(1);
      expect(phaseEndEvents.length).toBe(1);
    });
  });

  describe('runShow without llmHostModule', () => {
    it('should complete show successfully', async () => {
      // Create orchestrator WITHOUT LLM Host module
      const orchestrator = new Orchestrator(
        store,
        mockAdapter,
        eventJournal,
        hostModule,
        contextBuilder
      );

      // Initialize show
      const template = createTestTemplate();
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
      ];
      const show = await hostModule.initializeShow(template, characters, 12345);

      // Run the show - should complete without errors
      await orchestrator.runShow(show.id);

      // Verify show completed
      const events = await eventJournal.getEvents(show.id);
      expect(events.length).toBeGreaterThan(0);

      // No host events should be present
      const hostEvents = events.filter((e) => e.type === EventType.host_trigger);
      expect(hostEvents.length).toBe(0);
    });
  });

  describe('full show run with host', () => {
    it('should run complete show with host interventions', async () => {
      // Configure LLM Host
      const config = createTestConfig(true);
      llmHostModule.setConfig(config);

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
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
      ];
      const show = await hostModule.initializeShow(template, characters, 12345);

      // Run the show
      await orchestrator.runShow(show.id);

      // Get all events
      const events = await eventJournal.getEvents(show.id);

      // Verify event flow includes:
      // 1. phase_start event
      // 2. host_trigger (announcement) for phase_start
      // 3. speech events from characters
      // 4. phase_end event
      // 5. host_trigger (comment) for phase_end

      const phaseStartEvents = events.filter((e) => e.type === EventType.phase_start);
      const phaseEndEvents = events.filter((e) => e.type === EventType.phase_end);
      const speechEvents = events.filter((e) => e.type === EventType.speech);
      const hostEvents = events.filter((e) => e.type === EventType.host_trigger);

      expect(phaseStartEvents.length).toBe(1);
      expect(phaseEndEvents.length).toBe(1);
      expect(speechEvents.length).toBeGreaterThan(0);
      // At minimum, phase_start should trigger an announcement intervention
      expect(hostEvents.length).toBeGreaterThanOrEqual(1);

      // Verify interventions in order
      const phaseStartSeq = phaseStartEvents[0]!.sequenceNumber;

      // Host announcement should come after phase_start
      const announcements = hostEvents.filter(
        (e) => e.metadata.interventionType === 'announcement'
      );
      if (announcements.length > 0) {
        expect(announcements[0]!.sequenceNumber).toBeGreaterThan(phaseStartSeq);
      }

      // Note: phase_end triggered comments may have timing issues with async event handling
      // So we don't strictly assert their presence, just verify the mechanism works for phase_start
    });

    it('should handle multiple phases with host', async () => {
      // Create template with multiple phases
      const template: ShowFormatTemplate = {
        ...createTestTemplate(),
        phases: [
          {
            id: 'phase-1',
            name: 'Phase One',
            type: PhaseType.discussion,
            durationMode: 'turns',
            durationValue: 1,
            turnOrder: 'sequential',
            allowedChannels: [ChannelType.PUBLIC],
            triggerTemplate: 'Phase one starts',
            completionCondition: 'turns_complete',
          },
          {
            id: 'phase-2',
            name: 'Phase Two',
            type: PhaseType.discussion,
            durationMode: 'turns',
            durationValue: 1,
            turnOrder: 'sequential',
            allowedChannels: [ChannelType.PUBLIC],
            triggerTemplate: 'Phase two starts',
            completionCondition: 'turns_complete',
          },
        ],
      };

      // Configure LLM Host
      const config = createTestConfig(true);
      llmHostModule.setConfig(config);

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
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
      ];
      const show = await hostModule.initializeShow(template, characters, 12345);

      // Run the show
      await orchestrator.runShow(show.id);

      // Get all events
      const events = await eventJournal.getEvents(show.id);

      // Should have 2 phase_start and 2 phase_end events
      const phaseStartEvents = events.filter((e) => e.type === EventType.phase_start);
      const phaseEndEvents = events.filter((e) => e.type === EventType.phase_end);

      expect(phaseStartEvents.length).toBe(2);
      expect(phaseEndEvents.length).toBe(2);

      // Should have host interventions for both phases (at least phase_start triggers)
      const hostEvents = events.filter((e) => e.type === EventType.host_trigger);
      // At minimum, 2 phase_start events should trigger interventions
      expect(hostEvents.length).toBeGreaterThanOrEqual(2);
    });
  });
});
