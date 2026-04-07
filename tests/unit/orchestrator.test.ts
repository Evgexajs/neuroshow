import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Orchestrator } from '../../src/core/orchestrator.js';
import { HostModule } from '../../src/core/host-module.js';
import { EventJournal } from '../../src/core/event-journal.js';
import { ContextBuilder } from '../../src/core/context-builder.js';
import { SqliteStore } from '../../src/storage/sqlite-store.js';
import { ShowFormatTemplate, Phase } from '../../src/types/template.js';
import { CharacterDefinition } from '../../src/types/character.js';
import { PhaseType, ChannelType, SpeakFrequency, EventType } from '../../src/types/enums.js';
import { PrivateContext } from '../../src/types/context.js';
import { ModelAdapter, PromptPackage, CharacterResponse } from '../../src/types/adapter.js';
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
    call: async (_pkg: PromptPackage): Promise<CharacterResponse> => ({
      text: 'Mock response',
      intent: 'speak',
      mentions: [],
      tokensUsed: { prompt: 100, completion: 50 },
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
    contextBuilder = new ContextBuilder(store, eventJournal);
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
});
