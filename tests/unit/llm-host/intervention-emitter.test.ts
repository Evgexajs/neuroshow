/**
 * Unit tests for InterventionEmitter
 * HOST-007: Реализовать InterventionEmitter для записи интервенций
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InterventionEmitter } from '../../../src/modules/llm-host/intervention-emitter.js';
import { EventType, ChannelType, PhaseType, ShowStatus } from '../../../src/types/enums.js';
import type {
  IStore,
  ShowRecord,
} from '../../../src/types/interfaces/store.interface.js';
import type {
  HostInterventionResponse,
  EvaluatedTrigger,
} from '../../../src/modules/llm-host/types.js';
import type { EventJournal } from '../../../src/core/event-journal.js';
import type { ShowEvent } from '../../../src/types/events.js';

/**
 * Creates a mock store with configurable data
 */
function createMockStore(options: {
  show?: ShowRecord | null;
}): IStore {
  return {
    async getShow(_id: string): Promise<ShowRecord | null> {
      return options.show ?? null;
    },

    // Stub other IStore methods
    initSchema: vi.fn(),
    close: vi.fn(),
    createShow: vi.fn(),
    updateShow: vi.fn(),
    listShows: vi.fn(),
    createCharacter: vi.fn(),
    getCharacter: vi.fn(),
    getCharacters: vi.fn(),
    updateShowCharacterContext: vi.fn(),
    appendEvent: vi.fn(),
    getEvents: vi.fn(),
    getEventsForCharacter: vi.fn(),
    deleteEventsAfter: vi.fn(),
    getLatestSequence: vi.fn(),
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
    walCheckpoint: vi.fn(),
  } as unknown as IStore;
}

/**
 * Creates a mock EventJournal
 */
function createMockEventJournal(): EventJournal {
  let sequenceCounter = 0;

  return {
    async append(event: Omit<ShowEvent, 'sequenceNumber'>): Promise<ShowEvent> {
      sequenceCounter++;
      return {
        ...event,
        sequenceNumber: sequenceCounter,
      };
    },
    on: vi.fn(),
    emit: vi.fn(),
    getEvents: vi.fn(),
    getLatestSequence: vi.fn(),
  } as unknown as EventJournal;
}

/**
 * Creates a test ShowRecord with configSnapshot
 */
function createTestShowRecord(
  showId: string = 'show-001',
  currentPhaseId: string = 'phase-001'
): ShowRecord {
  const characterDefinitions = [
    { id: 'char-001', name: 'Alice' },
    { id: 'char-002', name: 'Bob' },
    { id: 'char-003', name: 'Charlie' },
  ];

  const configSnapshot = {
    templateId: 'template-001',
    templateName: 'Test Template',
    phases: [
      {
        id: 'phase-001',
        name: 'Introduction',
        type: PhaseType.discussion,
      },
    ],
    characterDefinitions,
  };

  return {
    id: showId,
    formatId: 'template-001',
    seed: '12345',
    status: ShowStatus.running,
    currentPhaseId,
    startedAt: Date.now(),
    completedAt: null,
    configSnapshot: JSON.stringify(configSnapshot),
    replayAvailable: false,
  };
}

/**
 * Creates a test HostInterventionResponse
 */
function createTestResponse(
  interventionType: 'comment' | 'question' | 'announcement' | 'private_directive' = 'comment',
  targetCharacterId?: string
): HostInterventionResponse {
  return {
    text: `Test ${interventionType} text`,
    interventionType,
    targetCharacterId,
  };
}

/**
 * Creates a test EvaluatedTrigger
 */
function createTestTrigger(
  type: string = 'phase_start',
  interventionType: 'comment' | 'question' | 'announcement' | 'private_directive' = 'announcement'
): EvaluatedTrigger {
  return {
    type: type as EvaluatedTrigger['type'],
    rule: {
      trigger: type as EvaluatedTrigger['type'],
      enabled: true,
      priority: 10,
      cooldownTurns: 0,
      interventionType,
      maxTokens: 150,
    },
    priority: 10,
  };
}

describe('InterventionEmitter', () => {
  let emitter: InterventionEmitter;
  let mockStore: IStore;
  let mockJournal: EventJournal;

  beforeEach(() => {
    mockStore = createMockStore({ show: createTestShowRecord() });
    mockJournal = createMockEventJournal();
    emitter = new InterventionEmitter(mockStore, mockJournal);
  });

  describe('emit() - basic functionality', () => {
    it('should return ShowEvent with correct structure', async () => {
      const response = createTestResponse('comment');
      const trigger = createTestTrigger('phase_start', 'comment');

      const result = await emitter.emit('show-001', response, trigger);

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('showId', 'show-001');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('sequenceNumber');
      expect(result).toHaveProperty('phaseId', 'phase-001');
      expect(result).toHaveProperty('type');
      expect(result).toHaveProperty('channel');
      expect(result).toHaveProperty('visibility');
      expect(result).toHaveProperty('senderId');
      expect(result).toHaveProperty('receiverIds');
      expect(result).toHaveProperty('audienceIds');
      expect(result).toHaveProperty('content');
      expect(result).toHaveProperty('metadata');
      expect(result).toHaveProperty('seed');
    });

    it('should assign sequenceNumber via EventJournal.append()', async () => {
      const response = createTestResponse('comment');
      const trigger = createTestTrigger();

      const result = await emitter.emit('show-001', response, trigger);

      expect(result.sequenceNumber).toBe(1);

      // Second emit should increment
      const result2 = await emitter.emit('show-001', response, trigger);
      expect(result2.sequenceNumber).toBe(2);
    });

    it('should set content from response.text', async () => {
      const response: HostInterventionResponse = {
        text: 'Welcome to the show!',
        interventionType: 'announcement',
      };
      const trigger = createTestTrigger();

      const result = await emitter.emit('show-001', response, trigger);

      expect(result.content).toBe('Welcome to the show!');
    });

    it('should have empty senderId for host events', async () => {
      const response = createTestResponse('comment');
      const trigger = createTestTrigger();

      const result = await emitter.emit('show-001', response, trigger);

      expect(result.senderId).toBe('');
    });
  });

  describe('emit() - event type', () => {
    it('should set type to EventType.host_trigger', async () => {
      const response = createTestResponse('comment');
      const trigger = createTestTrigger();

      const result = await emitter.emit('show-001', response, trigger);

      expect(result.type).toBe(EventType.host_trigger);
    });

    it('should always use host_trigger regardless of intervention type', async () => {
      const interventionTypes: Array<'comment' | 'question' | 'announcement' | 'private_directive'> = [
        'comment',
        'question',
        'announcement',
        'private_directive',
      ];

      for (const interventionType of interventionTypes) {
        const response = createTestResponse(interventionType, 'char-001');
        const trigger = createTestTrigger('phase_start', interventionType);

        const result = await emitter.emit('show-001', response, trigger);

        expect(result.type).toBe(EventType.host_trigger);
      }
    });
  });

  describe('emit() - metadata structure', () => {
    it('should include interventionType in metadata', async () => {
      const response = createTestResponse('announcement');
      const trigger = createTestTrigger();

      const result = await emitter.emit('show-001', response, trigger);

      expect(result.metadata).toHaveProperty('interventionType', 'announcement');
    });

    it('should include triggeredBy from trigger.type', async () => {
      const response = createTestResponse('comment');
      const trigger = createTestTrigger('revelation');

      const result = await emitter.emit('show-001', response, trigger);

      expect(result.metadata).toHaveProperty('triggeredBy', 'revelation');
    });

    it('should include targetCharacterId when provided', async () => {
      const response = createTestResponse('question', 'char-002');
      const trigger = createTestTrigger('conflict_detected', 'question');

      const result = await emitter.emit('show-001', response, trigger);

      expect(result.metadata).toHaveProperty('targetCharacterId', 'char-002');
    });

    it('should NOT include targetCharacterId when not provided', async () => {
      const response = createTestResponse('comment');
      const trigger = createTestTrigger();

      const result = await emitter.emit('show-001', response, trigger);

      expect(result.metadata).not.toHaveProperty('targetCharacterId');
    });

    it('should include requiresResponse in metadata', async () => {
      const response = createTestResponse('comment');
      const trigger = createTestTrigger();

      const result = await emitter.emit('show-001', response, trigger);

      expect(result.metadata).toHaveProperty('requiresResponse');
    });
  });

  describe('emit() - requiresResponse for question', () => {
    it('should set requiresResponse: true for question interventions', async () => {
      const response = createTestResponse('question', 'char-001');
      const trigger = createTestTrigger('conflict_detected', 'question');

      const result = await emitter.emit('show-001', response, trigger);

      expect(result.metadata).toHaveProperty('requiresResponse', true);
    });

    it('should set requiresResponse: false for comment interventions', async () => {
      const response = createTestResponse('comment');
      const trigger = createTestTrigger('periodic_commentary', 'comment');

      const result = await emitter.emit('show-001', response, trigger);

      expect(result.metadata).toHaveProperty('requiresResponse', false);
    });

    it('should set requiresResponse: false for announcement interventions', async () => {
      const response = createTestResponse('announcement');
      const trigger = createTestTrigger('phase_start', 'announcement');

      const result = await emitter.emit('show-001', response, trigger);

      expect(result.metadata).toHaveProperty('requiresResponse', false);
    });

    it('should set requiresResponse: false for private_directive interventions', async () => {
      const response = createTestResponse('private_directive', 'char-001');
      const trigger = createTestTrigger('periodic_commentary', 'private_directive');

      const result = await emitter.emit('show-001', response, trigger);

      expect(result.metadata).toHaveProperty('requiresResponse', false);
    });
  });

  describe('emit() - channel and audience', () => {
    it('should use PUBLIC channel for comment interventions', async () => {
      const response = createTestResponse('comment');
      const trigger = createTestTrigger();

      const result = await emitter.emit('show-001', response, trigger);

      expect(result.channel).toBe(ChannelType.PUBLIC);
      expect(result.visibility).toBe(ChannelType.PUBLIC);
    });

    it('should use PUBLIC channel for announcement interventions', async () => {
      const response = createTestResponse('announcement');
      const trigger = createTestTrigger();

      const result = await emitter.emit('show-001', response, trigger);

      expect(result.channel).toBe(ChannelType.PUBLIC);
    });

    it('should use PUBLIC channel for question interventions', async () => {
      const response = createTestResponse('question', 'char-001');
      const trigger = createTestTrigger('conflict_detected', 'question');

      const result = await emitter.emit('show-001', response, trigger);

      expect(result.channel).toBe(ChannelType.PUBLIC);
    });

    it('should use PRIVATE channel for private_directive interventions', async () => {
      const response = createTestResponse('private_directive', 'char-002');
      const trigger = createTestTrigger('periodic_commentary', 'private_directive');

      const result = await emitter.emit('show-001', response, trigger);

      expect(result.channel).toBe(ChannelType.PRIVATE);
      expect(result.visibility).toBe(ChannelType.PRIVATE);
    });

    it('should include all characters in audienceIds for PUBLIC interventions', async () => {
      const response = createTestResponse('comment');
      const trigger = createTestTrigger();

      const result = await emitter.emit('show-001', response, trigger);

      expect(result.audienceIds).toContain('char-001');
      expect(result.audienceIds).toContain('char-002');
      expect(result.audienceIds).toContain('char-003');
      expect(result.audienceIds).toHaveLength(3);
    });

    it('should only include target in audienceIds for private_directive', async () => {
      const response = createTestResponse('private_directive', 'char-002');
      const trigger = createTestTrigger('periodic_commentary', 'private_directive');

      const result = await emitter.emit('show-001', response, trigger);

      expect(result.audienceIds).toEqual(['char-002']);
    });

    it('should set receiverIds equal to audienceIds', async () => {
      const response = createTestResponse('comment');
      const trigger = createTestTrigger();

      const result = await emitter.emit('show-001', response, trigger);

      expect(result.receiverIds).toEqual(result.audienceIds);
    });
  });

  describe('emit() - trigger types', () => {
    it('should handle phase_start trigger', async () => {
      const response = createTestResponse('announcement');
      const trigger = createTestTrigger('phase_start', 'announcement');

      const result = await emitter.emit('show-001', response, trigger);

      expect(result.metadata).toHaveProperty('triggeredBy', 'phase_start');
    });

    it('should handle phase_end trigger', async () => {
      const response = createTestResponse('comment');
      const trigger = createTestTrigger('phase_end', 'comment');

      const result = await emitter.emit('show-001', response, trigger);

      expect(result.metadata).toHaveProperty('triggeredBy', 'phase_end');
    });

    it('should handle revelation trigger', async () => {
      const response = createTestResponse('comment');
      const trigger = createTestTrigger('revelation', 'comment');

      const result = await emitter.emit('show-001', response, trigger);

      expect(result.metadata).toHaveProperty('triggeredBy', 'revelation');
    });

    it('should handle conflict_detected trigger', async () => {
      const response = createTestResponse('question', 'char-001');
      const trigger = createTestTrigger('conflict_detected', 'question');

      const result = await emitter.emit('show-001', response, trigger);

      expect(result.metadata).toHaveProperty('triggeredBy', 'conflict_detected');
    });

    it('should handle silence_detected trigger', async () => {
      const response = createTestResponse('question', 'char-001');
      const trigger = createTestTrigger('silence_detected', 'question');

      const result = await emitter.emit('show-001', response, trigger);

      expect(result.metadata).toHaveProperty('triggeredBy', 'silence_detected');
    });
  });

  describe('emit() - error handling', () => {
    it('should throw error when show not found', async () => {
      mockStore = createMockStore({ show: null });
      emitter = new InterventionEmitter(mockStore, mockJournal);

      const response = createTestResponse('comment');
      const trigger = createTestTrigger();

      await expect(emitter.emit('nonexistent', response, trigger)).rejects.toThrow(
        'Show not found: nonexistent'
      );
    });

    it('should handle missing characterDefinitions gracefully', async () => {
      const showWithoutChars: ShowRecord = {
        id: 'show-001',
        formatId: 'template-001',
        seed: '12345',
        status: ShowStatus.running,
        currentPhaseId: 'phase-001',
        startedAt: Date.now(),
        completedAt: null,
        configSnapshot: JSON.stringify({ templateId: 'test' }), // No characterDefinitions
        replayAvailable: false,
      };

      mockStore = createMockStore({ show: showWithoutChars });
      emitter = new InterventionEmitter(mockStore, mockJournal);

      const response = createTestResponse('comment');
      const trigger = createTestTrigger();

      const result = await emitter.emit('show-001', response, trigger);

      expect(result.audienceIds).toEqual([]);
    });

    it('should handle invalid JSON in configSnapshot', async () => {
      const showWithBadConfig: ShowRecord = {
        id: 'show-001',
        formatId: 'template-001',
        seed: '12345',
        status: ShowStatus.running,
        currentPhaseId: 'phase-001',
        startedAt: Date.now(),
        completedAt: null,
        configSnapshot: 'invalid json{',
        replayAvailable: false,
      };

      mockStore = createMockStore({ show: showWithBadConfig });
      emitter = new InterventionEmitter(mockStore, mockJournal);

      const response = createTestResponse('comment');
      const trigger = createTestTrigger();

      const result = await emitter.emit('show-001', response, trigger);

      expect(result.audienceIds).toEqual([]);
    });

    it('should handle null currentPhaseId', async () => {
      const showWithNullPhase: ShowRecord = {
        ...createTestShowRecord(),
        currentPhaseId: null,
      };

      mockStore = createMockStore({ show: showWithNullPhase });
      emitter = new InterventionEmitter(mockStore, mockJournal);

      const response = createTestResponse('comment');
      const trigger = createTestTrigger();

      const result = await emitter.emit('show-001', response, trigger);

      expect(result.phaseId).toBe('');
    });
  });

  describe('emit() - unique IDs', () => {
    it('should generate unique event ID', async () => {
      const response = createTestResponse('comment');
      const trigger = createTestTrigger();

      const result1 = await emitter.emit('show-001', response, trigger);
      const result2 = await emitter.emit('show-001', response, trigger);

      expect(result1.id).not.toBe(result2.id);
    });

    it('should generate unique seed for each event', async () => {
      const response = createTestResponse('comment');
      const trigger = createTestTrigger();

      const result1 = await emitter.emit('show-001', response, trigger);
      const result2 = await emitter.emit('show-001', response, trigger);

      expect(result1.seed).not.toBe(result2.seed);
    });
  });

  describe('emit() - with trigger event', () => {
    it('should work correctly when trigger has triggerEvent', async () => {
      const triggerEvent: ShowEvent = {
        id: 'trigger-event-001',
        showId: 'show-001',
        timestamp: Date.now(),
        sequenceNumber: 5,
        phaseId: 'phase-001',
        type: EventType.revelation,
        channel: ChannelType.PUBLIC,
        visibility: ChannelType.PUBLIC,
        senderId: 'char-001',
        receiverIds: [],
        audienceIds: ['char-001', 'char-002', 'char-003'],
        content: 'I reveal my secret!',
        metadata: {},
        seed: 'test-seed',
      };

      const response = createTestResponse('comment');
      const trigger: EvaluatedTrigger = {
        type: 'revelation',
        rule: {
          trigger: 'revelation',
          enabled: true,
          priority: 10,
          cooldownTurns: 0,
          interventionType: 'comment',
          maxTokens: 100,
        },
        triggerEvent,
        priority: 10,
      };

      const result = await emitter.emit('show-001', response, trigger);

      expect(result.metadata).toHaveProperty('triggeredBy', 'revelation');
      expect(result.type).toBe(EventType.host_trigger);
    });
  });
});
