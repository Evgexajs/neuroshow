/**
 * Unit tests for HostContextBuilder
 * HOST-005: Реализовать HostContextBuilder для построения контекста LLM
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HostContextBuilder } from '../../../src/modules/llm-host/context-builder.js';
import { DEFAULT_LLM_HOST_CONFIG } from '../../../src/modules/llm-host/index.js';
import { EventType, ChannelType, HostBudgetMode, PhaseType, ShowStatus } from '../../../src/types/enums.js';
import type {
  IStore,
  ShowRecord,
  HostBudgetRecord,
} from '../../../src/types/interfaces/store.interface.js';
import type { LLMHostConfig, EvaluatedTrigger } from '../../../src/modules/llm-host/types.js';
import type { ShowEvent } from '../../../src/types/events.js';
import type { Phase } from '../../../src/types/template.js';

/**
 * Creates a mock store with configurable data
 */
function createMockStore(options: {
  show?: ShowRecord | null;
  events?: ShowEvent[];
  hostBudget?: HostBudgetRecord | null;
}): IStore {
  return {
    async getShow(_id: string): Promise<ShowRecord | null> {
      return options.show ?? null;
    },

    async getEvents(_showId: string, _fromSequence?: number): Promise<ShowEvent[]> {
      return options.events ?? [];
    },

    async getHostBudget(_showId: string): Promise<HostBudgetRecord | null> {
      return options.hostBudget ?? null;
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
    updateHostBudget: vi.fn(),
    getTriggerCooldown: vi.fn(),
    setTriggerCooldown: vi.fn(),
    walCheckpoint: vi.fn(),
  } as unknown as IStore;
}

/**
 * Creates a test ShowRecord with configSnapshot
 */
function createTestShowRecord(
  showId: string = 'show-001',
  currentPhaseId: string = 'phase-001'
): ShowRecord {
  const phases: Phase[] = [
    {
      id: 'phase-001',
      name: 'Introduction',
      type: PhaseType.discussion,
      durationMode: 'turns',
      durationValue: 5,
      turnOrder: 'sequential',
      allowedChannels: [ChannelType.PUBLIC],
      triggerTemplate: 'Introduce yourself.',
      completionCondition: 'turns_complete',
    },
    {
      id: 'phase-002',
      name: 'Discussion',
      type: PhaseType.private_talks,
      durationMode: 'turns',
      durationValue: 10,
      turnOrder: 'sequential',
      allowedChannels: [ChannelType.PUBLIC, ChannelType.PRIVATE],
      triggerTemplate: null,
      completionCondition: 'turns_complete',
    },
  ];

  const characterDefinitions = [
    {
      id: 'char-001',
      name: 'Alice',
      publicCard: 'A mysterious figure',
      personalityPrompt: 'Curious and intelligent',
      motivationPrompt: 'Seeking truth',
      boundaryRules: [],
      speakFrequency: 'medium',
      responseConstraints: { language: 'en' },
    },
    {
      id: 'char-002',
      name: 'Bob',
      publicCard: 'A friendly neighbor',
      personalityPrompt: 'Warm and approachable',
      motivationPrompt: 'Building connections',
      boundaryRules: [],
      speakFrequency: 'high',
      responseConstraints: { language: 'en' },
    },
    {
      id: 'char-003',
      name: 'Charlie',
      publicCard: 'A quiet observer',
      personalityPrompt: 'Thoughtful and reserved',
      motivationPrompt: 'Understanding others',
      boundaryRules: [],
      speakFrequency: 'low',
      responseConstraints: { language: 'en' },
    },
  ];

  const configSnapshot = {
    templateId: 'template-001',
    templateName: 'Test Template',
    templateDescription: 'A test show template',
    contextWindowSize: 10,
    decisionConfig: { type: 'majority' },
    privateChannelRules: { maxParticipants: 2 },
    allowCharacterInitiative: false,
    phases,
    characterDefinitions,
    backstory: null,
    relationships: [],
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
 * Creates a test ShowEvent
 */
function createTestEvent(
  showId: string,
  sequenceNumber: number,
  senderId: string,
  content: string
): ShowEvent {
  return {
    id: `event-${sequenceNumber}`,
    showId,
    timestamp: Date.now() + sequenceNumber * 1000,
    sequenceNumber,
    phaseId: 'phase-001',
    type: EventType.speech,
    channel: ChannelType.PUBLIC,
    visibility: ChannelType.PUBLIC,
    senderId,
    receiverIds: [],
    audienceIds: ['char-001', 'char-002', 'char-003'],
    content,
    metadata: {},
    seed: 'test-seed',
  };
}

/**
 * Creates a test EvaluatedTrigger
 */
function createTestTrigger(triggerEvent?: ShowEvent): EvaluatedTrigger {
  return {
    type: 'phase_start',
    rule: {
      trigger: 'phase_start',
      enabled: true,
      priority: 10,
      cooldownTurns: 0,
      interventionType: 'announcement',
      maxTokens: 150,
    },
    triggerEvent,
    priority: 10,
  };
}

/**
 * Creates a test HostBudgetRecord
 */
function createTestBudget(showId: string = 'show-001'): HostBudgetRecord {
  return {
    showId,
    totalLimit: 10000,
    usedPrompt: 500,
    usedCompletion: 300,
    mode: HostBudgetMode.normal,
    lastUpdated: Date.now(),
  };
}

describe('HostContextBuilder', () => {
  let config: LLMHostConfig;
  let builder: HostContextBuilder;

  beforeEach(() => {
    config = { ...DEFAULT_LLM_HOST_CONFIG, hostContextWindowSize: 10 };
  });

  describe('build() - basic functionality', () => {
    it('should return correct HostContext structure', async () => {
      const showRecord = createTestShowRecord();
      const events = [
        createTestEvent('show-001', 1, 'char-001', 'Hello everyone'),
        createTestEvent('show-001', 2, 'char-002', 'Nice to meet you'),
      ];
      const budget = createTestBudget();
      const trigger = createTestTrigger();

      const store = createMockStore({ show: showRecord, events, hostBudget: budget });
      builder = new HostContextBuilder(store, config);

      const result = await builder.build('show-001', trigger);

      expect(result).toHaveProperty('showId', 'show-001');
      expect(result).toHaveProperty('currentPhase');
      expect(result).toHaveProperty('characterNames');
      expect(result).toHaveProperty('recentEvents');
      expect(result).toHaveProperty('triggerType', 'phase_start');
      expect(result).toHaveProperty('hostBudget');
    });

    it('should include trigger event in context', async () => {
      const showRecord = createTestShowRecord();
      const triggerEvent = createTestEvent('show-001', 1, 'char-001', 'Trigger');
      const trigger = createTestTrigger(triggerEvent);

      const store = createMockStore({ show: showRecord, events: [triggerEvent], hostBudget: createTestBudget() });
      builder = new HostContextBuilder(store, config);

      const result = await builder.build('show-001', trigger);

      expect(result.triggerEvent).toBe(triggerEvent);
    });

    it('should include current phase information', async () => {
      const showRecord = createTestShowRecord('show-001', 'phase-001');
      const trigger = createTestTrigger();

      const store = createMockStore({ show: showRecord, events: [], hostBudget: createTestBudget() });
      builder = new HostContextBuilder(store, config);

      const result = await builder.build('show-001', trigger);

      expect(result.currentPhase).toBeDefined();
      expect(result.currentPhase.id).toBe('phase-001');
      expect(result.currentPhase.name).toBe('Introduction');
      expect(result.currentPhase.type).toBe(PhaseType.discussion);
    });
  });

  describe('build() - character names', () => {
    it('should include all character names', async () => {
      const showRecord = createTestShowRecord();
      const trigger = createTestTrigger();

      const store = createMockStore({ show: showRecord, events: [], hostBudget: createTestBudget() });
      builder = new HostContextBuilder(store, config);

      const result = await builder.build('show-001', trigger);

      expect(result.characterNames).toHaveLength(3);
      expect(result.characterNames).toContain('Alice');
      expect(result.characterNames).toContain('Bob');
      expect(result.characterNames).toContain('Charlie');
    });

    it('should correctly substitute character names in events', async () => {
      const showRecord = createTestShowRecord();
      const events = [
        createTestEvent('show-001', 1, 'char-001', 'Hello'),
        createTestEvent('show-001', 2, 'char-002', 'Hi Alice'),
      ];
      const trigger = createTestTrigger();

      const store = createMockStore({ show: showRecord, events, hostBudget: createTestBudget() });
      builder = new HostContextBuilder(store, config);

      const result = await builder.build('show-001', trigger);

      expect(result.recentEvents[0]!.senderName).toBe('Alice');
      expect(result.recentEvents[1]!.senderName).toBe('Bob');
    });

    it('should fallback to senderId when character name not found', async () => {
      const showRecord = createTestShowRecord();
      const events = [
        createTestEvent('show-001', 1, 'unknown-char', 'Hello'),
      ];
      const trigger = createTestTrigger();

      const store = createMockStore({ show: showRecord, events, hostBudget: createTestBudget() });
      builder = new HostContextBuilder(store, config);

      const result = await builder.build('show-001', trigger);

      expect(result.recentEvents[0]!.senderId).toBe('unknown-char');
      expect(result.recentEvents[0]!.senderName).toBe('unknown-char');
    });
  });

  describe('build() - recent events (sliding window)', () => {
    it('should include last N events based on hostContextWindowSize', async () => {
      config.hostContextWindowSize = 5;
      const showRecord = createTestShowRecord();
      const events = Array.from({ length: 10 }, (_, i) =>
        createTestEvent('show-001', i + 1, 'char-001', `Message ${i + 1}`)
      );
      const trigger = createTestTrigger();

      const store = createMockStore({ show: showRecord, events, hostBudget: createTestBudget() });
      builder = new HostContextBuilder(store, config);

      const result = await builder.build('show-001', trigger);

      expect(result.recentEvents).toHaveLength(5);
      expect(result.recentEvents[0]!.content).toBe('Message 6');
      expect(result.recentEvents[4]!.content).toBe('Message 10');
    });

    it('should return all events when fewer than window size', async () => {
      config.hostContextWindowSize = 10;
      const showRecord = createTestShowRecord();
      const events = [
        createTestEvent('show-001', 1, 'char-001', 'First'),
        createTestEvent('show-001', 2, 'char-002', 'Second'),
      ];
      const trigger = createTestTrigger();

      const store = createMockStore({ show: showRecord, events, hostBudget: createTestBudget() });
      builder = new HostContextBuilder(store, config);

      const result = await builder.build('show-001', trigger);

      expect(result.recentEvents).toHaveLength(2);
    });

    it('should handle empty events array', async () => {
      const showRecord = createTestShowRecord();
      const trigger = createTestTrigger();

      const store = createMockStore({ show: showRecord, events: [], hostBudget: createTestBudget() });
      builder = new HostContextBuilder(store, config);

      const result = await builder.build('show-001', trigger);

      expect(result.recentEvents).toHaveLength(0);
    });

    it('should convert events to EventSummary format', async () => {
      const showRecord = createTestShowRecord();
      const events = [createTestEvent('show-001', 1, 'char-001', 'Hello world')];
      const trigger = createTestTrigger();

      const store = createMockStore({ show: showRecord, events, hostBudget: createTestBudget() });
      builder = new HostContextBuilder(store, config);

      const result = await builder.build('show-001', trigger);

      const summary = result.recentEvents[0]!;
      expect(summary).toHaveProperty('senderId', 'char-001');
      expect(summary).toHaveProperty('senderName', 'Alice');
      expect(summary).toHaveProperty('channel', ChannelType.PUBLIC);
      expect(summary).toHaveProperty('content', 'Hello world');
      expect(summary).toHaveProperty('timestamp');
    });
  });

  describe('build() - security (no privateContext)', () => {
    it('should NOT include privateContext in HostContext', async () => {
      const showRecord = createTestShowRecord();
      const trigger = createTestTrigger();

      const store = createMockStore({ show: showRecord, events: [], hostBudget: createTestBudget() });
      builder = new HostContextBuilder(store, config);

      const result = await builder.build('show-001', trigger);

      // HostContext should not have any privateContext-related fields
      expect(result).not.toHaveProperty('privateContext');
      expect(result).not.toHaveProperty('secrets');
      expect(result).not.toHaveProperty('alliances');
      expect(result).not.toHaveProperty('goals');
      expect(result).not.toHaveProperty('wildcards');
    });

    it('should only include public character info (names)', async () => {
      const showRecord = createTestShowRecord();
      const trigger = createTestTrigger();

      const store = createMockStore({ show: showRecord, events: [], hostBudget: createTestBudget() });
      builder = new HostContextBuilder(store, config);

      const result = await builder.build('show-001', trigger);

      // characterNames should be a simple string array, not full character objects
      expect(Array.isArray(result.characterNames)).toBe(true);
      expect(typeof result.characterNames[0]).toBe('string');
    });
  });

  describe('build() - host budget', () => {
    it('should include host budget from store', async () => {
      const showRecord = createTestShowRecord();
      const budget = createTestBudget();
      const trigger = createTestTrigger();

      const store = createMockStore({ show: showRecord, events: [], hostBudget: budget });
      builder = new HostContextBuilder(store, config);

      const result = await builder.build('show-001', trigger);

      expect(result.hostBudget).toEqual(budget);
    });

    it('should return default budget when not found in store', async () => {
      const showRecord = createTestShowRecord();
      const trigger = createTestTrigger();

      const store = createMockStore({ show: showRecord, events: [], hostBudget: null });
      builder = new HostContextBuilder(store, config);

      const result = await builder.build('show-001', trigger);

      expect(result.hostBudget.showId).toBe('show-001');
      expect(result.hostBudget.totalLimit).toBe(config.hostBudget);
      expect(result.hostBudget.usedPrompt).toBe(0);
      expect(result.hostBudget.usedCompletion).toBe(0);
      expect(result.hostBudget.mode).toBe(HostBudgetMode.normal);
    });
  });

  describe('build() - error handling', () => {
    it('should throw error when show not found', async () => {
      const trigger = createTestTrigger();

      const store = createMockStore({ show: null, events: [] });
      builder = new HostContextBuilder(store, config);

      await expect(builder.build('nonexistent', trigger)).rejects.toThrow(
        'Show not found: nonexistent'
      );
    });

    it('should throw error when current phase not found', async () => {
      const showRecord = createTestShowRecord('show-001', 'nonexistent-phase');
      const trigger = createTestTrigger();

      const store = createMockStore({ show: showRecord, events: [] });
      builder = new HostContextBuilder(store, config);

      await expect(builder.build('show-001', trigger)).rejects.toThrow(
        'Phase not found: nonexistent-phase'
      );
    });
  });

  describe('build() - different trigger types', () => {
    it('should handle phase_start trigger', async () => {
      const showRecord = createTestShowRecord();
      const trigger: EvaluatedTrigger = {
        type: 'phase_start',
        rule: {
          trigger: 'phase_start',
          enabled: true,
          priority: 10,
          cooldownTurns: 0,
          interventionType: 'announcement',
          maxTokens: 150,
        },
        priority: 10,
      };

      const store = createMockStore({ show: showRecord, events: [], hostBudget: createTestBudget() });
      builder = new HostContextBuilder(store, config);

      const result = await builder.build('show-001', trigger);

      expect(result.triggerType).toBe('phase_start');
    });

    it('should handle revelation trigger', async () => {
      const showRecord = createTestShowRecord();
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
        priority: 10,
      };

      const store = createMockStore({ show: showRecord, events: [], hostBudget: createTestBudget() });
      builder = new HostContextBuilder(store, config);

      const result = await builder.build('show-001', trigger);

      expect(result.triggerType).toBe('revelation');
    });
  });

  describe('build() - empty characterDefinitions', () => {
    it('should handle missing characterDefinitions gracefully', async () => {
      // Create a show record without characterDefinitions
      const configSnapshot = {
        templateId: 'template-001',
        templateName: 'Test Template',
        templateDescription: 'A test show template',
        contextWindowSize: 10,
        decisionConfig: { type: 'majority' },
        privateChannelRules: { maxParticipants: 2 },
        allowCharacterInitiative: false,
        phases: [
          {
            id: 'phase-001',
            name: 'Introduction',
            type: PhaseType.discussion,
            durationMode: 'turns',
            durationValue: 5,
            turnOrder: 'sequential',
            allowedChannels: [ChannelType.PUBLIC],
            triggerTemplate: 'Introduce yourself.',
            completionCondition: 'turns_complete',
          },
        ],
        // No characterDefinitions
      };

      const showRecord: ShowRecord = {
        id: 'show-001',
        formatId: 'template-001',
        seed: '12345',
        status: ShowStatus.running,
        currentPhaseId: 'phase-001',
        startedAt: Date.now(),
        completedAt: null,
        configSnapshot: JSON.stringify(configSnapshot),
        replayAvailable: false,
      };

      const trigger = createTestTrigger();

      const store = createMockStore({ show: showRecord, events: [], hostBudget: createTestBudget() });
      builder = new HostContextBuilder(store, config);

      const result = await builder.build('show-001', trigger);

      expect(result.characterNames).toHaveLength(0);
    });
  });
});
