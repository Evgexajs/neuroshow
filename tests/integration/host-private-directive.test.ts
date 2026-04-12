/**
 * Integration Test: Host Private Directive
 *
 * HOST-013: Реализовать private_directive интервенции
 *
 * Verifies:
 * - private_directive is recorded with channel: PRIVATE and audienceIds: [targetCharacterId]
 * - Directive is only visible to the target character in their context
 * - maxDirectivesPerPhase limit is respected
 * - maxDirectivesPerCharacter limit is respected
 * - allowHostDirectives: false blocks all directives
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

import { EventJournal } from '../../src/core/event-journal.js';
import { SqliteStore } from '../../src/storage/sqlite-store.js';
import { InterventionEmitter } from '../../src/modules/llm-host/intervention-emitter.js';
import { LLMHostAgent } from '../../src/modules/llm-host/llm-host-agent.js';
import { DEFAULT_LLM_HOST_CONFIG } from '../../src/modules/llm-host/index.js';
import type { LLMHostConfig, EvaluatedTrigger, HostInterventionResponse } from '../../src/modules/llm-host/types.js';
import type { ShowRecord } from '../../src/types/interfaces/store.interface.js';
import type { ShowEvent } from '../../src/types/events.js';
import type { ModelAdapter, PromptPackage, CharacterResponse, TokenEstimate } from '../../src/types/adapter.js';
import { PhaseType, ChannelType, ShowStatus, EventType, CharacterIntent, HostBudgetMode } from '../../src/types/enums.js';
import { generateId } from '../../src/utils/id.js';
import * as fs from 'fs';

describe('Integration: Host Private Directive (HOST-013)', { timeout: 30000 }, () => {
  let store: SqliteStore;
  let eventJournal: EventJournal;
  const testDbPath = './data/test-host-private-directive.db';

  // Mock adapter that generates directive responses
  const createMockAdapter = (targetCharacterId?: string): ModelAdapter => ({
    providerId: 'mock',
    modelId: 'mock-model',
    call: async (_pkg: PromptPackage): Promise<CharacterResponse> => {
      return {
        text: 'This is a private directive for you.',
        intent: CharacterIntent.speak,
        target: targetCharacterId,
      };
    },
    estimateTokens: (_pkg: PromptPackage): TokenEstimate => ({
      prompt: 100,
      estimatedCompletion: 50,
    }),
  });

  // Create test show record
  const createTestShowRecord = (
    showId: string = 'show-001',
    currentPhaseId: string = 'phase-001'
  ): ShowRecord => {
    const characterDefinitions = [
      { id: 'char-alice', name: 'Alice' },
      { id: 'char-bob', name: 'Bob' },
      { id: 'char-charlie', name: 'Charlie' },
    ];

    const configSnapshot = {
      templateId: 'template-001',
      templateName: 'Test Template',
      phases: [
        {
          id: 'phase-001',
          name: 'Discussion',
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
  };

  // Create test trigger for private_directive
  const createDirectiveTrigger = (
    targetCharacterId?: string,
    phaseId: string = 'phase-001'
  ): EvaluatedTrigger => {
    const triggerEvent: ShowEvent = {
      id: generateId(),
      showId: 'show-001',
      timestamp: Date.now(),
      sequenceNumber: 1,
      phaseId,
      type: EventType.speech,
      channel: ChannelType.PUBLIC,
      visibility: ChannelType.PUBLIC,
      senderId: targetCharacterId ?? 'char-alice',
      receiverIds: [],
      audienceIds: ['char-alice', 'char-bob', 'char-charlie'],
      content: 'Some speech',
      metadata: {},
      seed: 'test-seed',
    };

    return {
      type: 'silence_detected',
      rule: {
        trigger: 'silence_detected',
        enabled: true,
        priority: 6,
        cooldownTurns: 5,
        interventionType: 'private_directive',
        maxTokens: 80,
      },
      triggerEvent,
      priority: 6,
      conditionalContext: targetCharacterId
        ? { silentCharacterId: targetCharacterId }
        : undefined,
    };
  };

  // Create LLMHostConfig with directives enabled
  const createDirectiveEnabledConfig = (overrides?: Partial<LLMHostConfig>): LLMHostConfig => ({
    ...DEFAULT_LLM_HOST_CONFIG,
    hostEnabled: true,
    allowHostDirectives: true,
    maxDirectivesPerPhase: 2,
    maxDirectivesPerCharacter: 1,
    hostModelAdapter: 'mock',
    verboseLogging: false,
    ...overrides,
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

    // Create show record
    const show = createTestShowRecord();
    await store.createShow(show);
  });

  afterEach(async () => {
    await store.close();

    // Clean up test DB
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('private_directive channel and audience', () => {
    it('should record private_directive with channel: PRIVATE', async () => {
      const emitter = new InterventionEmitter(store, eventJournal);

      const response: HostInterventionResponse = {
        text: 'Secret directive for Bob',
        interventionType: 'private_directive',
        targetCharacterId: 'char-bob',
      };

      const trigger = createDirectiveTrigger('char-bob');
      const event = await emitter.emit('show-001', response, trigger);

      expect(event.channel).toBe(ChannelType.PRIVATE);
      expect(event.visibility).toBe(ChannelType.PRIVATE);
    });

    it('should record private_directive with audienceIds containing only target', async () => {
      const emitter = new InterventionEmitter(store, eventJournal);

      const response: HostInterventionResponse = {
        text: 'Secret directive for Bob',
        interventionType: 'private_directive',
        targetCharacterId: 'char-bob',
      };

      const trigger = createDirectiveTrigger('char-bob');
      const event = await emitter.emit('show-001', response, trigger);

      expect(event.audienceIds).toEqual(['char-bob']);
      expect(event.receiverIds).toEqual(['char-bob']);
    });

    it('should include targetCharacterId in metadata', async () => {
      const emitter = new InterventionEmitter(store, eventJournal);

      const response: HostInterventionResponse = {
        text: 'Secret directive for Charlie',
        interventionType: 'private_directive',
        targetCharacterId: 'char-charlie',
      };

      const trigger = createDirectiveTrigger('char-charlie');
      const event = await emitter.emit('show-001', response, trigger);

      expect(event.metadata).toHaveProperty('interventionType', 'private_directive');
      expect(event.metadata).toHaveProperty('targetCharacterId', 'char-charlie');
    });
  });

  describe('directive visibility in context', () => {
    it('should make directive visible only to target character', async () => {
      const emitter = new InterventionEmitter(store, eventJournal);

      // Emit a private directive to Bob
      const response: HostInterventionResponse = {
        text: 'Secret mission for Bob only',
        interventionType: 'private_directive',
        targetCharacterId: 'char-bob',
      };

      const trigger = createDirectiveTrigger('char-bob');
      await emitter.emit('show-001', response, trigger);

      // Check visibility via getEventsForCharacter
      const bobEvents = await store.getEventsForCharacter('show-001', 'char-bob');
      const aliceEvents = await store.getEventsForCharacter('show-001', 'char-alice');
      const charlieEvents = await store.getEventsForCharacter('show-001', 'char-charlie');

      // Bob should see the directive
      const bobDirective = bobEvents.find(
        (e) => e.type === EventType.host_trigger && e.metadata?.interventionType === 'private_directive'
      );
      expect(bobDirective).toBeDefined();
      expect(bobDirective?.content).toBe('Secret mission for Bob only');

      // Alice and Charlie should NOT see the directive
      const aliceDirective = aliceEvents.find(
        (e) => e.type === EventType.host_trigger && e.metadata?.interventionType === 'private_directive'
      );
      const charlieDirective = charlieEvents.find(
        (e) => e.type === EventType.host_trigger && e.metadata?.interventionType === 'private_directive'
      );

      expect(aliceDirective).toBeUndefined();
      expect(charlieDirective).toBeUndefined();
    });
  });

  describe('allowHostDirectives: false blocks directives', () => {
    it('should block directive generation when allowHostDirectives is false', async () => {
      // Config with directives disabled
      const config = createDirectiveEnabledConfig({
        allowHostDirectives: false,
      });

      // Create budget for the show
      await store.createHostBudget({
        showId: 'show-001',
        totalLimit: 10000,
        usedPrompt: 0,
        usedCompletion: 0,
        mode: HostBudgetMode.normal,
        lastUpdated: Date.now(),
      });

      const mockAdapter = createMockAdapter('char-bob');
      const agent = new LLMHostAgent(store, eventJournal, config, mockAdapter);

      const trigger = createDirectiveTrigger('char-bob');
      const response = await agent.generateIntervention('show-001', trigger);

      // Should return fallback (not a directive) because directives are disabled
      // Fallback does not have a target
      expect(response.targetCharacterId).toBeUndefined();
    });
  });

  describe('maxDirectivesPerPhase limit', () => {
    it('should block directive when maxDirectivesPerPhase is exceeded', async () => {
      const config = createDirectiveEnabledConfig({
        maxDirectivesPerPhase: 1,
      });

      // Create budget for the show
      await store.createHostBudget({
        showId: 'show-001',
        totalLimit: 10000,
        usedPrompt: 0,
        usedCompletion: 0,
        mode: HostBudgetMode.normal,
        lastUpdated: Date.now(),
      });

      const emitter = new InterventionEmitter(store, eventJournal);
      const mockAdapter = createMockAdapter('char-bob');
      const agent = new LLMHostAgent(store, eventJournal, config, mockAdapter);

      // First directive should succeed - emit it directly
      const firstDirectiveResponse: HostInterventionResponse = {
        text: 'First directive',
        interventionType: 'private_directive',
        targetCharacterId: 'char-alice',
      };
      const firstTrigger = createDirectiveTrigger('char-alice');
      await emitter.emit('show-001', firstDirectiveResponse, firstTrigger);

      // Second directive should be blocked by the agent
      const secondTrigger = createDirectiveTrigger('char-bob');
      const secondResponse = await agent.generateIntervention('show-001', secondTrigger);

      // Should return fallback because limit is exceeded
      expect(secondResponse.targetCharacterId).toBeUndefined();
    });

    it('should allow directive when within maxDirectivesPerPhase limit', async () => {
      const config = createDirectiveEnabledConfig({
        maxDirectivesPerPhase: 2,
      });

      // Create budget for the show
      await store.createHostBudget({
        showId: 'show-001',
        totalLimit: 10000,
        usedPrompt: 0,
        usedCompletion: 0,
        mode: HostBudgetMode.normal,
        lastUpdated: Date.now(),
      });

      const mockAdapter = createMockAdapter('char-bob');
      const agent = new LLMHostAgent(store, eventJournal, config, mockAdapter);

      // First directive should succeed
      const trigger = createDirectiveTrigger('char-bob');
      const response = await agent.generateIntervention('show-001', trigger);

      // Should generate a directive (via mock adapter)
      expect(response.text).toBe('This is a private directive for you.');
    });
  });

  describe('maxDirectivesPerCharacter limit', () => {
    it('should block directive when maxDirectivesPerCharacter is exceeded for target', async () => {
      const config = createDirectiveEnabledConfig({
        maxDirectivesPerPhase: 10, // High limit
        maxDirectivesPerCharacter: 1,
      });

      // Create budget for the show
      await store.createHostBudget({
        showId: 'show-001',
        totalLimit: 10000,
        usedPrompt: 0,
        usedCompletion: 0,
        mode: HostBudgetMode.normal,
        lastUpdated: Date.now(),
      });

      const emitter = new InterventionEmitter(store, eventJournal);
      const mockAdapter = createMockAdapter('char-bob');
      const agent = new LLMHostAgent(store, eventJournal, config, mockAdapter);

      // First directive to Bob - emit directly
      const firstDirectiveResponse: HostInterventionResponse = {
        text: 'First directive to Bob',
        interventionType: 'private_directive',
        targetCharacterId: 'char-bob',
      };
      const firstTrigger = createDirectiveTrigger('char-bob');
      await emitter.emit('show-001', firstDirectiveResponse, firstTrigger);

      // Second directive to Bob should be blocked
      const secondTrigger = createDirectiveTrigger('char-bob');
      const secondResponse = await agent.generateIntervention('show-001', secondTrigger);

      // Should return fallback because Bob already received maxDirectivesPerCharacter
      expect(secondResponse.targetCharacterId).toBeUndefined();
    });

    it('should allow directive to different character even when one has reached limit', async () => {
      const config = createDirectiveEnabledConfig({
        maxDirectivesPerPhase: 10,
        maxDirectivesPerCharacter: 1,
      });

      // Create budget for the show
      await store.createHostBudget({
        showId: 'show-001',
        totalLimit: 10000,
        usedPrompt: 0,
        usedCompletion: 0,
        mode: HostBudgetMode.normal,
        lastUpdated: Date.now(),
      });

      const emitter = new InterventionEmitter(store, eventJournal);
      const mockAdapter = createMockAdapter('char-charlie');
      const agent = new LLMHostAgent(store, eventJournal, config, mockAdapter);

      // First directive to Bob - emit directly
      const firstDirectiveResponse: HostInterventionResponse = {
        text: 'Directive to Bob',
        interventionType: 'private_directive',
        targetCharacterId: 'char-bob',
      };
      const firstTrigger = createDirectiveTrigger('char-bob');
      await emitter.emit('show-001', firstDirectiveResponse, firstTrigger);

      // Directive to Charlie should still work
      const charlieTrigger = createDirectiveTrigger('char-charlie');
      const charlieResponse = await agent.generateIntervention('show-001', charlieTrigger);

      // Should generate a directive for Charlie
      expect(charlieResponse.text).toBe('This is a private directive for you.');
    });
  });

  describe('directive metadata structure', () => {
    it('should set requiresResponse: false for private_directive', async () => {
      const emitter = new InterventionEmitter(store, eventJournal);

      const response: HostInterventionResponse = {
        text: 'Do something secretly',
        interventionType: 'private_directive',
        targetCharacterId: 'char-alice',
      };

      const trigger = createDirectiveTrigger('char-alice');
      const event = await emitter.emit('show-001', response, trigger);

      expect(event.metadata).toHaveProperty('requiresResponse', false);
    });

    it('should include triggeredBy in metadata', async () => {
      const emitter = new InterventionEmitter(store, eventJournal);

      const response: HostInterventionResponse = {
        text: 'Secret directive',
        interventionType: 'private_directive',
        targetCharacterId: 'char-bob',
      };

      const trigger = createDirectiveTrigger('char-bob');
      const event = await emitter.emit('show-001', response, trigger);

      expect(event.metadata).toHaveProperty('triggeredBy', 'silence_detected');
    });
  });
});
