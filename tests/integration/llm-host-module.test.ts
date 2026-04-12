/**
 * Integration Test: LLMHostModule
 *
 * HOST-009: Tests LLMHostModule end-to-end functionality
 *
 * Verifies:
 * - onEventAppended() evaluates triggers and generates interventions
 * - initializeBudget() creates budget record in store
 * - getStatus() returns correct budget and intervention counts
 * - phase_start event triggers an announcement intervention
 * - Uses real SqliteStore and EventJournal (no mocks for core components)
 * - Uses MockAdapter for LLM calls (deterministic responses)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LLMHostModule, DEFAULT_LLM_HOST_CONFIG } from '../../src/modules/llm-host/index.js';
import type { LLMHostConfig } from '../../src/modules/llm-host/types.js';
import { EventJournal } from '../../src/core/event-journal.js';
import { SqliteStore } from '../../src/storage/sqlite-store.js';
import type { ShowEvent } from '../../src/types/events.js';
import type { ShowFormatTemplate } from '../../src/types/template.js';
import type { ShowRecord, ShowCharacterRecord } from '../../src/types/interfaces/store.interface.js';
import { EventType, ShowStatus, ChannelType, PhaseType, HostBudgetMode } from '../../src/types/enums.js';
import { generateId } from '../../src/utils/id.js';
import * as fs from 'fs';

describe('Integration: LLMHostModule', () => {
  let store: SqliteStore;
  let eventJournal: EventJournal;
  let llmHostModule: LLMHostModule;
  const testDbPath = './data/test-llm-host-module.db';

  // Test template
  const createTestTemplate = (): ShowFormatTemplate => ({
    id: 'test-format',
    name: 'Test Format',
    description: 'Test format for LLM host integration tests',
    minParticipants: 2,
    maxParticipants: 4,
    contextWindowSize: 8000,
    phases: [
      {
        id: 'phase-1',
        name: 'Phase One',
        type: PhaseType.discussion,
        durationMode: 'turns',
        durationValue: 4,
        turnOrder: 'sequential',
        allowedChannels: [ChannelType.PUBLIC],
        triggerTemplate: 'Welcome to the discussion!',
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

  // Create test config with mock adapter
  const createTestConfig = (): LLMHostConfig => ({
    ...DEFAULT_LLM_HOST_CONFIG,
    hostEnabled: true,
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

  /**
   * Helper to create a test event
   */
  function createTestEvent(
    showId: string,
    type: EventType,
    content: string,
    options: Partial<Omit<ShowEvent, 'sequenceNumber'>> = {}
  ): Omit<ShowEvent, 'sequenceNumber'> {
    return {
      id: generateId(),
      showId,
      type,
      timestamp: Date.now(),
      phaseId: 'phase-1',
      channel: ChannelType.PUBLIC,
      visibility: ChannelType.PUBLIC,
      senderId: '',
      receiverIds: [],
      audienceIds: ['char-1', 'char-2'],
      content,
      metadata: {},
      seed: generateId(),
      ...options,
    };
  }

  /**
   * Helper to create a show in the store
   */
  async function createTestShow(): Promise<string> {
    const showId = generateId();
    const template = createTestTemplate();

    // ConfigSnapshot must have phases and characterDefinitions at top level
    // (this is the format expected by HostContextBuilder)
    const configSnapshot = {
      phases: template.phases,
      characterDefinitions: [
        { id: 'char-1', name: 'Алексей' },
        { id: 'char-2', name: 'Мария' },
      ],
      tokenBudget: 10000,
      contextWindowSize: 10,
    };

    // Create show record
    const showRecord: ShowRecord = {
      id: showId,
      formatId: template.id,
      seed: '42',
      status: ShowStatus.running,
      currentPhaseId: 'phase-1',
      startedAt: Date.now(),
      completedAt: null,
      configSnapshot: JSON.stringify(configSnapshot),
      replayAvailable: false,
    };

    await store.createShow(showRecord);

    // Create character records
    const characters: ShowCharacterRecord[] = [
      {
        showId,
        characterId: 'char-1',
        modelAdapterId: 'mock',
        privateContext: { secrets: [], alliances: [], goals: [], wildcards: [] },
        speakFrequency: 'medium',
      },
      {
        showId,
        characterId: 'char-2',
        modelAdapterId: 'mock',
        privateContext: { secrets: [], alliances: [], goals: [], wildcards: [] },
        speakFrequency: 'high',
      },
    ];

    for (const char of characters) {
      await store.createCharacter(char);
    }

    return showId;
  }

  describe('initializeBudget()', () => {
    it('should create budget record in store', async () => {
      const showId = await createTestShow();
      const config = createTestConfig();

      await llmHostModule.initializeBudget(showId, config);

      // Verify budget was created
      const budget = await store.getHostBudget(showId);
      expect(budget).not.toBeNull();
      expect(budget!.showId).toBe(showId);
      expect(budget!.totalLimit).toBe(5000);
      expect(budget!.usedPrompt).toBe(0);
      expect(budget!.usedCompletion).toBe(0);
      expect(budget!.mode).toBe(HostBudgetMode.normal);
    });

    it('should set config on the module', async () => {
      const showId = await createTestShow();
      const config = createTestConfig();

      await llmHostModule.initializeBudget(showId, config);

      expect(llmHostModule.getConfig()).toEqual(config);
    });
  });

  describe('getStatus()', () => {
    it('should return default status when no budget exists', async () => {
      const showId = await createTestShow();

      const status = await llmHostModule.getStatus(showId);

      expect(status.budget.showId).toBe(showId);
      expect(status.interventionCount).toBe(0);
      expect(status.lastInterventionSequence).toBeNull();
    });

    it('should return correct status after budget initialization', async () => {
      const showId = await createTestShow();
      const config = createTestConfig();

      await llmHostModule.initializeBudget(showId, config);

      const status = await llmHostModule.getStatus(showId);

      expect(status.budget.totalLimit).toBe(5000);
      expect(status.budget.mode).toBe(HostBudgetMode.normal);
      expect(status.interventionCount).toBe(0);
      expect(status.lastInterventionSequence).toBeNull();
    });
  });

  describe('onEventAppended()', () => {
    it('should not process events when host is disabled', async () => {
      const showId = await createTestShow();
      const config = { ...createTestConfig(), hostEnabled: false };

      await llmHostModule.initializeBudget(showId, config);

      // Create a phase_start event
      const event = createTestEvent(showId, EventType.phase_start, 'Phase 1 started');
      const appendedEvent = await eventJournal.append(event);
      await llmHostModule.onEventAppended(appendedEvent);

      // No intervention should be generated
      const status = await llmHostModule.getStatus(showId);
      expect(status.interventionCount).toBe(0);
    });

    it('should generate announcement on phase_start event', async () => {
      const showId = await createTestShow();
      const config = createTestConfig();

      await llmHostModule.initializeBudget(showId, config);

      // Create a phase_start event
      const event = createTestEvent(showId, EventType.phase_start, 'Phase 1 started');
      const appendedEvent = await eventJournal.append(event);
      await llmHostModule.onEventAppended(appendedEvent);

      // Verify intervention was generated
      const status = await llmHostModule.getStatus(showId);
      expect(status.interventionCount).toBe(1);
      expect(status.lastInterventionSequence).toBe(2); // After phase_start (seq 1)

      // Verify the event content
      const events = await eventJournal.getEvents(showId);
      const hostEvent = events.find(
        (e) => e.type === EventType.host_trigger && e.metadata?.interventionType
      );
      expect(hostEvent).toBeDefined();
      expect(hostEvent!.metadata!.interventionType).toBe('announcement');
      expect(hostEvent!.metadata!.triggeredBy).toBe('phase_start');
    });

    it('should generate comment on phase_end event', async () => {
      const showId = await createTestShow();
      const config = createTestConfig();

      await llmHostModule.initializeBudget(showId, config);

      // Create a phase_end event
      const event = createTestEvent(showId, EventType.phase_end, 'Phase 1 ended');
      const appendedEvent = await eventJournal.append(event);
      await llmHostModule.onEventAppended(appendedEvent);

      // Verify intervention was generated
      const status = await llmHostModule.getStatus(showId);
      expect(status.interventionCount).toBe(1);

      // Verify the event content
      const events = await eventJournal.getEvents(showId);
      const hostEvent = events.find(
        (e) => e.type === EventType.host_trigger && e.metadata?.interventionType
      );
      expect(hostEvent).toBeDefined();
      expect(hostEvent!.metadata!.interventionType).toBe('comment');
      expect(hostEvent!.metadata!.triggeredBy).toBe('phase_end');
    });

    it('should generate comment on revelation event', async () => {
      const showId = await createTestShow();
      const config = createTestConfig();

      await llmHostModule.initializeBudget(showId, config);

      // Create a revelation event
      const event = createTestEvent(
        showId,
        EventType.revelation,
        'I reveal my secret!',
        { senderId: 'char-1' }
      );
      const appendedEvent = await eventJournal.append(event);
      await llmHostModule.onEventAppended(appendedEvent);

      // Verify intervention was generated
      const status = await llmHostModule.getStatus(showId);
      expect(status.interventionCount).toBe(1);

      // Verify the event content
      const events = await eventJournal.getEvents(showId);
      const hostEvent = events.find(
        (e) => e.type === EventType.host_trigger && e.metadata?.interventionType
      );
      expect(hostEvent).toBeDefined();
      expect(hostEvent!.metadata!.interventionType).toBe('comment');
      expect(hostEvent!.metadata!.triggeredBy).toBe('revelation');
    });

    it('should not process its own events (prevent infinite loop)', async () => {
      const showId = await createTestShow();
      const config = createTestConfig();

      await llmHostModule.initializeBudget(showId, config);

      // First, trigger an intervention via phase_start
      const phaseStartEvent = createTestEvent(showId, EventType.phase_start, 'Phase started');
      const appendedPhaseStart = await eventJournal.append(phaseStartEvent);
      await llmHostModule.onEventAppended(appendedPhaseStart);

      // Now get the host event and try to process it
      const events = await eventJournal.getEvents(showId);
      const hostEvent = events.find(
        (e) => e.type === EventType.host_trigger && e.metadata?.interventionType
      );
      expect(hostEvent).toBeDefined();

      // Process the host event - should NOT create another intervention
      await llmHostModule.onEventAppended(hostEvent!);

      // Still only 1 intervention
      const status = await llmHostModule.getStatus(showId);
      expect(status.interventionCount).toBe(1);
    });

    it('should update budget after generating intervention', async () => {
      const showId = await createTestShow();
      const config = createTestConfig();

      await llmHostModule.initializeBudget(showId, config);

      // Create a phase_start event
      const event = createTestEvent(showId, EventType.phase_start, 'Phase started');
      const appendedEvent = await eventJournal.append(event);
      await llmHostModule.onEventAppended(appendedEvent);

      // Check budget was updated (tokens consumed)
      const status = await llmHostModule.getStatus(showId);
      expect(status.budget.usedPrompt).toBeGreaterThan(0);
      // MockAdapter estimates completion tokens based on maxTokens
      expect(status.budget.usedCompletion).toBeGreaterThan(0);
    });
  });

  describe('full intervention flow', () => {
    it('should handle multiple interventions in sequence', async () => {
      const showId = await createTestShow();
      const config = createTestConfig();

      await llmHostModule.initializeBudget(showId, config);

      // 1. Phase start
      const phaseStart = createTestEvent(showId, EventType.phase_start, 'Phase 1 started');
      await llmHostModule.onEventAppended(await eventJournal.append(phaseStart));

      // 2. Revelation
      const revelation = createTestEvent(
        showId,
        EventType.revelation,
        'I reveal my secret!',
        { senderId: 'char-1' }
      );
      await llmHostModule.onEventAppended(await eventJournal.append(revelation));

      // 3. Phase end
      const phaseEnd = createTestEvent(showId, EventType.phase_end, 'Phase 1 ended');
      await llmHostModule.onEventAppended(await eventJournal.append(phaseEnd));

      // Verify 3 interventions were generated
      const status = await llmHostModule.getStatus(showId);
      expect(status.interventionCount).toBe(3);

      // Verify all events are in the journal
      const events = await eventJournal.getEvents(showId);
      const hostEvents = events.filter(
        (e) => e.type === EventType.host_trigger && e.metadata?.interventionType
      );
      expect(hostEvents.length).toBe(3);

      // Verify intervention types
      const interventionTypes = hostEvents.map((e) => e.metadata!.interventionType);
      expect(interventionTypes).toContain('announcement');
      expect(interventionTypes).toContain('comment');
    });
  });
});
