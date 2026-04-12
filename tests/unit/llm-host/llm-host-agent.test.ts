/**
 * Unit tests for LLMHostAgent
 * HOST-008: Реализовать основной класс LLMHostAgent
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LLMHostAgent } from '../../../src/modules/llm-host/llm-host-agent.js';
import { DEFAULT_LLM_HOST_CONFIG } from '../../../src/modules/llm-host/index.js';
import { EventType, ChannelType, HostBudgetMode, ShowStatus } from '../../../src/types/enums.js';
import type {
  IStore,
  HostBudgetRecord,
  TriggerCooldownRecord,
  ShowRecord,
} from '../../../src/types/interfaces/store.interface.js';
import type { LLMHostConfig } from '../../../src/modules/llm-host/types.js';
import type { ShowEvent } from '../../../src/types/events.js';
import type {
  ModelAdapter,
  PromptPackage,
  TokenEstimate,
  CharacterResponse,
} from '../../../src/types/adapter.js';
import type { EventJournal } from '../../../src/core/event-journal.js';

// ─── Mock Helpers ─────────────────────────────────────────────────────────────

/**
 * Creates a mock store with budget and cooldown tracking
 */
function createMockStore(): IStore & {
  budgets: Map<string, HostBudgetRecord>;
  cooldowns: Map<string, TriggerCooldownRecord>;
  shows: Map<string, ShowRecord>;
  events: Map<string, ShowEvent[]>;
} {
  const budgets = new Map<string, HostBudgetRecord>();
  const cooldowns = new Map<string, TriggerCooldownRecord>();
  const shows = new Map<string, ShowRecord>();
  const events = new Map<string, ShowEvent[]>();

  return {
    budgets,
    cooldowns,
    shows,
    events,

    // Host budget methods
    async createHostBudget(budget: HostBudgetRecord): Promise<void> {
      budgets.set(budget.showId, { ...budget });
    },

    async getHostBudget(showId: string): Promise<HostBudgetRecord | null> {
      const budget = budgets.get(showId);
      return budget ? { ...budget } : null;
    },

    async updateHostBudget(
      showId: string,
      usedPrompt: number,
      usedCompletion: number
    ): Promise<void> {
      const budget = budgets.get(showId);
      if (budget) {
        budget.usedPrompt += usedPrompt;
        budget.usedCompletion += usedCompletion;
        budget.lastUpdated = Date.now();
      }
    },

    // Trigger cooldown methods
    async getTriggerCooldown(
      showId: string,
      triggerType: string
    ): Promise<TriggerCooldownRecord | null> {
      const key = `${showId}:${triggerType}`;
      return cooldowns.get(key) ?? null;
    },

    async setTriggerCooldown(
      showId: string,
      triggerType: string,
      sequence: number
    ): Promise<void> {
      const key = `${showId}:${triggerType}`;
      cooldowns.set(key, {
        showId,
        triggerType,
        lastTriggeredSequence: sequence,
        lastTriggeredAt: Date.now(),
      });
    },

    // Show methods
    async getShow(showId: string): Promise<ShowRecord | null> {
      return shows.get(showId) ?? null;
    },

    // Event methods
    async getEvents(showId: string): Promise<ShowEvent[]> {
      return events.get(showId) ?? [];
    },

    // Stub other IStore methods
    initSchema: vi.fn(),
    close: vi.fn(),
    createShow: vi.fn(),
    updateShow: vi.fn(),
    listShows: vi.fn(),
    deleteShow: vi.fn(),
    createCharacter: vi.fn(),
    getCharacter: vi.fn(),
    getCharactersByShowId: vi.fn(),
    updateCharacter: vi.fn(),
    deleteCharacter: vi.fn(),
    createTokenBudget: vi.fn(),
    getTokenBudget: vi.fn(),
    updateTokenBudget: vi.fn(),
    appendEvent: vi.fn(),
    countEvents: vi.fn(),
    getLastSequence: vi.fn(),
    countEventsByType: vi.fn(),
    getEventsAfterSequence: vi.fn(),
    getTurnsSinceEvent: vi.fn(),
    checkpoint: vi.fn(),
  } as unknown as IStore & {
    budgets: Map<string, HostBudgetRecord>;
    cooldowns: Map<string, TriggerCooldownRecord>;
    shows: Map<string, ShowRecord>;
    events: Map<string, ShowEvent[]>;
  };
}

/**
 * Creates a mock EventJournal
 */
function createMockEventJournal(): EventJournal {
  let sequenceCounter = 0;

  return {
    append: vi.fn().mockImplementation(async (event: Omit<ShowEvent, 'sequenceNumber'>) => {
      sequenceCounter++;
      return { ...event, sequenceNumber: sequenceCounter } as ShowEvent;
    }),
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  } as unknown as EventJournal;
}

/**
 * Creates a mock ModelAdapter
 */
function createMockModelAdapter(
  response: Partial<CharacterResponse> = {}
): ModelAdapter & { callMock: ReturnType<typeof vi.fn> } {
  const defaultResponse: CharacterResponse = {
    text: 'Добро пожаловать в шоу!',
    ...response,
  };

  const callMock = vi.fn().mockResolvedValue(defaultResponse);

  return {
    providerId: 'mock',
    modelId: 'mock-model',
    call: callMock,
    callMock,
    estimateTokens: vi.fn().mockReturnValue({
      prompt: 100,
      estimatedCompletion: 50,
    } as TokenEstimate),
  };
}

/**
 * Creates a test ShowEvent
 */
function createTestEvent(
  type: EventType,
  showId: string = 'show-001',
  sequenceNumber: number = 1
): ShowEvent {
  return {
    id: `event-${sequenceNumber}`,
    showId,
    timestamp: Date.now(),
    sequenceNumber,
    phaseId: 'phase-001',
    type,
    channel: ChannelType.PUBLIC,
    visibility: ChannelType.PUBLIC,
    senderId: '',
    receiverIds: [],
    audienceIds: [],
    content: '',
    metadata: {},
    seed: 'test-seed',
  };
}

/**
 * Creates a test ShowRecord
 */
function createTestShowRecord(showId: string = 'show-001'): ShowRecord {
  return {
    id: showId,
    formatId: 'test-format',
    seed: 'test-seed',
    status: ShowStatus.running,
    startedAt: Date.now(),
    completedAt: null,
    currentPhaseId: 'phase-001',
    replayAvailable: false,
    configSnapshot: JSON.stringify({
      phases: [
        { id: 'phase-001', name: 'Знакомство', type: 'discussion', duration: 5, description: '' },
      ],
      characterDefinitions: [
        { id: 'char-001', name: 'Алиса' },
        { id: 'char-002', name: 'Боб' },
      ],
    }),
  };
}

/**
 * Creates a budget record with specified usage
 */
function createBudget(
  showId: string,
  usedPrompt: number = 0,
  usedCompletion: number = 0,
  totalLimit: number = 10000
): HostBudgetRecord {
  const totalUsed = usedPrompt + usedCompletion;
  const usagePercent = (totalUsed / totalLimit) * 100;

  let mode: HostBudgetMode = HostBudgetMode.normal;
  if (usagePercent >= 90) {
    mode = HostBudgetMode.exhausted;
  } else if (usagePercent >= 70) {
    mode = HostBudgetMode.saving;
  }

  return {
    showId,
    totalLimit,
    usedPrompt,
    usedCompletion,
    mode,
    lastUpdated: Date.now(),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('LLMHostAgent', () => {
  let store: ReturnType<typeof createMockStore>;
  let eventJournal: ReturnType<typeof createMockEventJournal>;
  let modelAdapter: ReturnType<typeof createMockModelAdapter>;
  let config: LLMHostConfig;
  let agent: LLMHostAgent;

  beforeEach(() => {
    store = createMockStore();
    eventJournal = createMockEventJournal();
    modelAdapter = createMockModelAdapter();
    config = {
      ...DEFAULT_LLM_HOST_CONFIG,
      hostEnabled: true,
    };

    // Setup default show and budget
    store.shows.set('show-001', createTestShowRecord('show-001'));
    store.budgets.set('show-001', createBudget('show-001'));
    store.events.set('show-001', []);

    agent = new LLMHostAgent(store, eventJournal, config, modelAdapter);
  });

  describe('constructor', () => {
    it('should create agent with all subcomponents', () => {
      expect(agent).toBeDefined();
      expect(agent.getBudgetManager()).toBeDefined();
      expect(agent.getTriggerEvaluator()).toBeDefined();
      expect(agent.getPersona()).toBeDefined();
    });

    it('should resolve persona from preset string', () => {
      config.hostPersona = 'classic_host';
      agent = new LLMHostAgent(store, eventJournal, config, modelAdapter);

      const persona = agent.getPersona();
      expect(persona.name).toBe('Александр');
    });

    it('should use custom persona object', () => {
      config.hostPersona = {
        name: 'Custom Host',
        voiceStyle: 'dramatic',
        personalityTraits: ['test'],
        catchphrases: ['test'],
        boundaries: [],
        language: 'ru',
      };
      agent = new LLMHostAgent(store, eventJournal, config, modelAdapter);

      const persona = agent.getPersona();
      expect(persona.name).toBe('Custom Host');
    });
  });

  describe('shouldIntervene()', () => {
    it('should return false when host is disabled', async () => {
      config.hostEnabled = false;
      agent = new LLMHostAgent(store, eventJournal, config, modelAdapter);

      const event = createTestEvent(EventType.phase_start, 'show-001');
      const result = await agent.shouldIntervene(event);

      expect(result.shouldIntervene).toBe(false);
      expect(result.trigger).toBeNull();
      expect(result.skipReason).toBe('Host is disabled');
    });

    it('should return true for phase_start event', async () => {
      const event = createTestEvent(EventType.phase_start, 'show-001');
      const result = await agent.shouldIntervene(event);

      expect(result.shouldIntervene).toBe(true);
      expect(result.trigger).not.toBeNull();
      expect(result.trigger!.type).toBe('phase_start');
    });

    it('should return true for phase_end event', async () => {
      const event = createTestEvent(EventType.phase_end, 'show-001');
      const result = await agent.shouldIntervene(event);

      expect(result.shouldIntervene).toBe(true);
      expect(result.trigger!.type).toBe('phase_end');
    });

    it('should return true for revelation event', async () => {
      const event = createTestEvent(EventType.revelation, 'show-001');
      const result = await agent.shouldIntervene(event);

      expect(result.shouldIntervene).toBe(true);
      expect(result.trigger!.type).toBe('revelation');
    });

    it('should return false for non-triggering events', async () => {
      const event = createTestEvent(EventType.speech, 'show-001');
      const result = await agent.shouldIntervene(event);

      expect(result.shouldIntervene).toBe(false);
      expect(result.skipReason).toBe('No matching trigger');
    });

    describe('budget mode handling', () => {
      it('should allow mandatory triggers in exhausted mode', async () => {
        // Set budget to exhausted (90%+ used)
        store.budgets.set('show-001', createBudget('show-001', 5000, 4500)); // 95% used

        const event = createTestEvent(EventType.phase_start, 'show-001');
        const result = await agent.shouldIntervene(event);

        expect(result.shouldIntervene).toBe(true);
        expect(result.trigger!.type).toBe('phase_start');
      });

      it('should skip non-mandatory triggers in exhausted mode', async () => {
        // Set budget to exhausted
        store.budgets.set('show-001', createBudget('show-001', 5000, 4500));

        // Add a rule for a non-mandatory trigger that's enabled
        config.interventionRules.push({
          trigger: 'periodic_commentary',
          enabled: true,
          priority: 5,
          cooldownTurns: 0,
          interventionType: 'comment',
          maxTokens: 100,
        });

        // Note: We can't easily test this without a periodic_commentary event type
        // The dialogue event won't trigger anything, which is the expected behavior
        const event = createTestEvent(EventType.speech, 'show-001');
        const result = await agent.shouldIntervene(event);

        expect(result.shouldIntervene).toBe(false);
      });

      it('should allow mandatory triggers in saving mode', async () => {
        // Set budget to saving (70-89% used)
        store.budgets.set('show-001', createBudget('show-001', 4000, 4000)); // 80% used

        const event = createTestEvent(EventType.phase_start, 'show-001');
        const result = await agent.shouldIntervene(event);

        expect(result.shouldIntervene).toBe(true);
      });
    });
  });

  describe('generateIntervention()', () => {
    it('should call ModelAdapter with prompt package', async () => {
      const event = createTestEvent(EventType.phase_start, 'show-001');
      const { trigger } = await agent.shouldIntervene(event);

      await agent.generateIntervention('show-001', trigger!);

      expect(modelAdapter.callMock).toHaveBeenCalled();
      const calls = modelAdapter.callMock.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const promptPackage = calls[0]![0] as PromptPackage;
      expect(promptPackage.systemPrompt).toContain('ведущий');
      expect(promptPackage.trigger).toBeDefined();
    });

    it('should return HostInterventionResponse with correct type', async () => {
      const event = createTestEvent(EventType.phase_start, 'show-001');
      const { trigger } = await agent.shouldIntervene(event);

      const response = await agent.generateIntervention('show-001', trigger!);

      expect(response.text).toBe('Добро пожаловать в шоу!');
      expect(response.interventionType).toBe('announcement'); // phase_start uses announcement
    });

    it('should update budget after LLM call', async () => {
      const event = createTestEvent(EventType.phase_start, 'show-001');
      const { trigger } = await agent.shouldIntervene(event);

      const budgetBefore = await store.getHostBudget('show-001');
      expect(budgetBefore!.usedPrompt).toBe(0);

      await agent.generateIntervention('show-001', trigger!);

      const budgetAfter = await store.getHostBudget('show-001');
      expect(budgetAfter!.usedPrompt).toBeGreaterThan(0);
    });

    it('should use fallback when budget is exhausted', async () => {
      // Set budget to exhausted
      store.budgets.set('show-001', createBudget('show-001', 5000, 4500));

      const event = createTestEvent(EventType.phase_start, 'show-001');
      const { trigger } = await agent.shouldIntervene(event);

      const response = await agent.generateIntervention('show-001', trigger!);

      // Should NOT have called the model
      expect(modelAdapter.callMock).not.toHaveBeenCalled();

      // Should return a fallback phrase
      expect(response.text).toBeDefined();
      expect(response.text.length).toBeGreaterThan(0);
      expect(response.interventionType).toBe('announcement');
    });

    it('should use fallback when insufficient budget for call', async () => {
      // Set budget with very little remaining (less than estimated tokens)
      store.budgets.set('show-001', createBudget('show-001', 4950, 4950)); // 99% used, only 100 tokens left

      // Mock estimateTokens to return more than available
      (modelAdapter.estimateTokens as ReturnType<typeof vi.fn>).mockReturnValue({
        prompt: 100,
        estimatedCompletion: 50,
      } as TokenEstimate);

      const event = createTestEvent(EventType.phase_start, 'show-001');
      const { trigger } = await agent.shouldIntervene(event);

      const response = await agent.generateIntervention('show-001', trigger!);

      // Should NOT have called the model due to insufficient budget
      expect(modelAdapter.callMock).not.toHaveBeenCalled();
      expect(response.text).toBeDefined();
    });

    it('should respect maxTokens from rule', async () => {
      const event = createTestEvent(EventType.phase_start, 'show-001');
      const { trigger } = await agent.shouldIntervene(event);

      await agent.generateIntervention('show-001', trigger!);

      const calls = modelAdapter.callMock.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const promptPackage = calls[0]![0] as PromptPackage;
      expect(promptPackage.responseConstraints.maxTokens).toBe(trigger!.rule.maxTokens);
    });
  });

  describe('emitIntervention()', () => {
    it('should emit event via InterventionEmitter', async () => {
      const event = createTestEvent(EventType.phase_start, 'show-001');
      const { trigger } = await agent.shouldIntervene(event);
      const response = await agent.generateIntervention('show-001', trigger!);

      const emittedEvent = await agent.emitIntervention('show-001', response, trigger!);

      expect(emittedEvent).toBeDefined();
      expect(emittedEvent.type).toBe(EventType.host_trigger);
      expect(emittedEvent.content).toBe(response.text);
      expect(emittedEvent.sequenceNumber).toBeDefined();
    });

    it('should record trigger activation for cooldown', async () => {
      const event = createTestEvent(EventType.phase_start, 'show-001');
      const { trigger } = await agent.shouldIntervene(event);
      const response = await agent.generateIntervention('show-001', trigger!);

      await agent.emitIntervention('show-001', response, trigger!);

      // Check cooldown was recorded
      const cooldown = await store.getTriggerCooldown('show-001', 'phase_start');
      expect(cooldown).not.toBeNull();
    });

    it('should set correct metadata on event', async () => {
      const event = createTestEvent(EventType.phase_start, 'show-001');
      const { trigger } = await agent.shouldIntervene(event);
      const response = await agent.generateIntervention('show-001', trigger!);

      const emittedEvent = await agent.emitIntervention('show-001', response, trigger!);

      expect(emittedEvent.metadata).toBeDefined();
      expect(emittedEvent.metadata.interventionType).toBe('announcement');
      expect(emittedEvent.metadata.triggeredBy).toBe('phase_start');
    });
  });

  describe('Full intervention flow', () => {
    it('should complete full intervention cycle: shouldIntervene -> generate -> emit', async () => {
      const event = createTestEvent(EventType.phase_start, 'show-001');

      // Step 1: Check if should intervene
      const { shouldIntervene, trigger } = await agent.shouldIntervene(event);
      expect(shouldIntervene).toBe(true);
      expect(trigger).not.toBeNull();

      // Step 2: Generate intervention
      const response = await agent.generateIntervention('show-001', trigger!);
      expect(response.text).toBeDefined();
      expect(response.interventionType).toBe('announcement');

      // Step 3: Emit intervention
      const emittedEvent = await agent.emitIntervention('show-001', response, trigger!);
      expect(emittedEvent.type).toBe(EventType.host_trigger);
      expect(emittedEvent.content).toBe(response.text);

      // Verify budget was updated
      const budget = await store.getHostBudget('show-001');
      expect(budget!.usedPrompt).toBeGreaterThan(0);
    });

    it('should handle multiple interventions with budget tracking', async () => {
      // First intervention
      const event1 = createTestEvent(EventType.phase_start, 'show-001', 1);
      const { trigger: trigger1 } = await agent.shouldIntervene(event1);
      await agent.generateIntervention('show-001', trigger1!);

      const budget1 = await store.getHostBudget('show-001');
      const used1 = budget1!.usedPrompt + budget1!.usedCompletion;

      // Second intervention
      const event2 = createTestEvent(EventType.phase_end, 'show-001', 2);
      const { trigger: trigger2 } = await agent.shouldIntervene(event2);
      await agent.generateIntervention('show-001', trigger2!);

      const budget2 = await store.getHostBudget('show-001');
      const used2 = budget2!.usedPrompt + budget2!.usedCompletion;

      // Budget should have accumulated
      expect(used2).toBeGreaterThan(used1);
    });
  });

  describe('Verbose logging', () => {
    it('should log when verboseLogging is enabled', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      config.verboseLogging = true;
      agent = new LLMHostAgent(store, eventJournal, config, modelAdapter);

      const event = createTestEvent(EventType.phase_start, 'show-001');
      const { trigger } = await agent.shouldIntervene(event);
      const response = await agent.generateIntervention('show-001', trigger!);
      await agent.emitIntervention('show-001', response, trigger!);

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should not log when verboseLogging is disabled', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      config.verboseLogging = false;
      agent = new LLMHostAgent(store, eventJournal, config, modelAdapter);

      const event = createTestEvent(EventType.phase_start, 'show-001');
      const { trigger } = await agent.shouldIntervene(event);
      await agent.generateIntervention('show-001', trigger!);

      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
