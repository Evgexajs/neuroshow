import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HostModule, DecisionCallback } from '../../src/core/host-module.js';
import { EventJournal } from '../../src/core/event-journal.js';
import { SqliteStore } from '../../src/storage/sqlite-store.js';
import { ShowFormatTemplate, Phase } from '../../src/types/template.js';
import { CharacterDefinition } from '../../src/types/character.js';
import { PhaseType, ChannelType, SpeakFrequency, ShowStatus, BudgetMode, EventType } from '../../src/types/enums.js';
import { PrivateContext } from '../../src/types/context.js';
import { PrivateChannelRules, DecisionConfig } from '../../src/types/primitives.js';
import { CharacterResponse } from '../../src/types/adapter.js';
import * as fs from 'fs';

describe('HostModule', () => {
  let store: SqliteStore;
  let eventJournal: EventJournal;
  let hostModule: HostModule;
  const testDbPath = './data/test-host-module.db';

  // Helper to create test template
  const createTestTemplate = (): ShowFormatTemplate => ({
    id: 'coalition-v1',
    name: 'Koalition',
    description: 'A negotiation show format',
    minParticipants: 3,
    maxParticipants: 7,
    phases: [
      {
        id: 'phase-discussion-1',
        name: 'Discussion Round 1',
        type: PhaseType.discussion,
        durationMode: 'turns',
        durationValue: 10,
        turnOrder: 'sequential',
        allowedChannels: [ChannelType.PUBLIC],
        triggerTemplate: 'Start discussion',
        completionCondition: 'turns_complete',
      },
      {
        id: 'phase-voting-1',
        name: 'Voting Round 1',
        type: PhaseType.voting,
        durationMode: 'turns',
        durationValue: 1,
        turnOrder: 'sequential',
        allowedChannels: [ChannelType.PUBLIC],
        triggerTemplate: 'Cast your vote',
        completionCondition: 'all_voted',
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
  const createTestCharacter = (id: string, name: string): CharacterDefinition & { modelAdapterId?: string } => {
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
  });

  afterEach(async () => {
    await store.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('initializeShow', () => {
    it('creates show in DB with correct data', async () => {
      const template = createTestTemplate();
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
        createTestCharacter('char-3', 'Charlie'),
      ];

      const show = await hostModule.initializeShow(template, characters);

      // Verify show returned
      expect(show.id).toBeDefined();
      expect(show.formatId).toBe(template.id);
      expect(show.status).toBe(ShowStatus.created);
      expect(show.currentPhaseId).toBe('phase-discussion-1');
      expect(show.startedAt).toBeNull();
      expect(show.completedAt).toBeNull();

      // Verify show in DB
      const dbShow = await store.getShow(show.id);
      expect(dbShow).not.toBeNull();
      expect(dbShow!.formatId).toBe(template.id);
      expect(dbShow!.status).toBe(ShowStatus.created);
    });

    it('creates 5 characters in show_characters', async () => {
      const template = createTestTemplate();
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
        createTestCharacter('char-3', 'Charlie'),
        createTestCharacter('char-4', 'Diana'),
        createTestCharacter('char-5', 'Eve'),
      ];

      const show = await hostModule.initializeShow(template, characters);

      // Verify characters in DB
      const dbCharacters = await store.getCharacters(show.id);
      expect(dbCharacters).toHaveLength(5);

      const charIds = dbCharacters.map((c) => c.characterId);
      expect(charIds).toContain('char-1');
      expect(charIds).toContain('char-2');
      expect(charIds).toContain('char-3');
      expect(charIds).toContain('char-4');
      expect(charIds).toContain('char-5');
    });

    it('creates token_budget for show', async () => {
      const template = createTestTemplate();
      const characters = [createTestCharacter('char-1', 'Alice')];

      const show = await hostModule.initializeShow(template, characters);

      // Verify budget in DB
      const budget = await store.getBudget(show.id);
      expect(budget).not.toBeNull();
      expect(budget!.showId).toBe(show.id);
      expect(budget!.usedPrompt).toBe(0);
      expect(budget!.usedCompletion).toBe(0);
      expect(budget!.mode).toBe(BudgetMode.normal);
      expect(budget!.totalLimit).toBeGreaterThan(0);
    });

    it('uses provided seed when given', async () => {
      const template = createTestTemplate();
      const characters = [createTestCharacter('char-1', 'Alice')];
      const customSeed = 12345;

      const show = await hostModule.initializeShow(template, characters, customSeed);

      expect(show.seed).toBe(customSeed);

      const dbShow = await store.getShow(show.id);
      expect(parseInt(dbShow!.seed, 10)).toBe(customSeed);
    });

    it('generates seed when not provided', async () => {
      const template = createTestTemplate();
      const characters = [createTestCharacter('char-1', 'Alice')];

      const show = await hostModule.initializeShow(template, characters);

      expect(show.seed).toBeDefined();
      expect(typeof show.seed).toBe('number');
      expect(show.seed).toBeGreaterThan(0);
    });

    it('stores config_snapshot with template settings', async () => {
      const template = createTestTemplate();
      const characters = [createTestCharacter('char-1', 'Alice')];

      const show = await hostModule.initializeShow(template, characters);

      expect(show.configSnapshot).toBeDefined();
      expect(show.configSnapshot.templateId).toBe(template.id);
      expect(show.configSnapshot.templateName).toBe(template.name);
      expect(show.configSnapshot.contextWindowSize).toBe(template.contextWindowSize);
      expect(show.configSnapshot.decisionConfig).toEqual(template.decisionConfig);
      expect(show.configSnapshot.privateChannelRules).toEqual(template.privateChannelRules);
    });

    it('stores private context for each character', async () => {
      const template = createTestTemplate();
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
      ];

      const show = await hostModule.initializeShow(template, characters);

      const dbChar1 = await store.getCharacter(show.id, 'char-1');
      expect(dbChar1).not.toBeNull();
      expect(dbChar1!.privateContext.secrets).toContain("Alice's secret");
      expect(dbChar1!.privateContext.goals).toContain("Alice's goal");

      const dbChar2 = await store.getCharacter(show.id, 'char-2');
      expect(dbChar2).not.toBeNull();
      expect(dbChar2!.privateContext.secrets).toContain("Bob's secret");
    });

    it('sets currentPhaseId to first phase', async () => {
      const template = createTestTemplate();
      const characters = [createTestCharacter('char-1', 'Alice')];

      const show = await hostModule.initializeShow(template, characters);

      expect(show.currentPhaseId).toBe(template.phases[0]!.id);
    });

    it('handles template with no phases', async () => {
      const template = createTestTemplate();
      template.phases = [];
      const characters = [createTestCharacter('char-1', 'Alice')];

      const show = await hostModule.initializeShow(template, characters);

      expect(show.currentPhaseId).toBeNull();
    });
  });

  describe('manageTurnQueue', () => {
    it('returns characterIds in order for sequential turnOrder', async () => {
      const template = createTestTemplate();
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
        createTestCharacter('char-3', 'Charlie'),
      ];

      const show = await hostModule.initializeShow(template, characters);
      const phase: Phase = {
        id: 'test-phase',
        name: 'Test Phase',
        type: PhaseType.discussion,
        durationMode: 'turns',
        durationValue: 5,
        turnOrder: 'sequential',
        allowedChannels: [ChannelType.PUBLIC],
        triggerTemplate: 'Start',
        completionCondition: 'turns_complete',
      };

      const queue = await hostModule.manageTurnQueue(show.id, phase);

      expect(queue).toHaveLength(3);
      expect(queue).toEqual(['char-1', 'char-2', 'char-3']);
    });

    it('returns characterIds for host_controlled turnOrder', async () => {
      const template = createTestTemplate();
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
      ];

      const show = await hostModule.initializeShow(template, characters);
      const phase: Phase = {
        id: 'test-phase',
        name: 'Test Phase',
        type: PhaseType.discussion,
        durationMode: 'turns',
        durationValue: 5,
        turnOrder: 'host_controlled',
        allowedChannels: [ChannelType.PUBLIC],
        triggerTemplate: 'Start',
        completionCondition: 'turns_complete',
      };

      const queue = await hostModule.manageTurnQueue(show.id, phase);

      expect(queue).toHaveLength(2);
      expect(queue).toContain('char-1');
      expect(queue).toContain('char-2');
    });

    it('orders by frequency for frequency_weighted turnOrder', async () => {
      const template = createTestTemplate();

      // Create characters with different frequencies
      const highFreqChar = createTestCharacter('char-high', 'HighFreq');
      highFreqChar.speakFrequency = SpeakFrequency.high;

      const mediumFreqChar = createTestCharacter('char-medium', 'MediumFreq');
      mediumFreqChar.speakFrequency = SpeakFrequency.medium;

      const lowFreqChar = createTestCharacter('char-low', 'LowFreq');
      lowFreqChar.speakFrequency = SpeakFrequency.low;

      const characters = [lowFreqChar, mediumFreqChar, highFreqChar];

      const show = await hostModule.initializeShow(template, characters);
      const phase: Phase = {
        id: 'test-phase',
        name: 'Test Phase',
        type: PhaseType.discussion,
        durationMode: 'turns',
        durationValue: 5,
        turnOrder: 'frequency_weighted',
        allowedChannels: [ChannelType.PUBLIC],
        triggerTemplate: 'Start',
        completionCondition: 'turns_complete',
      };

      const queue = await hostModule.manageTurnQueue(show.id, phase);

      expect(queue).toHaveLength(3);
      // High frequency character should be first
      expect(queue[0]).toBe('char-high');
      // Medium frequency character should be second
      expect(queue[1]).toBe('char-medium');
      // Low frequency character should be last
      expect(queue[2]).toBe('char-low');
    });

    it('is deterministic with same seed', async () => {
      const template = createTestTemplate();

      // Multiple high-frequency characters to test shuffle
      const char1 = createTestCharacter('char-1', 'A');
      char1.speakFrequency = SpeakFrequency.high;
      const char2 = createTestCharacter('char-2', 'B');
      char2.speakFrequency = SpeakFrequency.high;
      const char3 = createTestCharacter('char-3', 'C');
      char3.speakFrequency = SpeakFrequency.high;

      const characters = [char1, char2, char3];
      const fixedSeed = 42;

      const show = await hostModule.initializeShow(template, characters, fixedSeed);
      const phase: Phase = {
        id: 'test-phase',
        name: 'Test Phase',
        type: PhaseType.discussion,
        durationMode: 'turns',
        durationValue: 5,
        turnOrder: 'frequency_weighted',
        allowedChannels: [ChannelType.PUBLIC],
        triggerTemplate: 'Start',
        completionCondition: 'turns_complete',
      };

      // Call twice with same show (same seed)
      const queue1 = await hostModule.manageTurnQueue(show.id, phase);
      const queue2 = await hostModule.manageTurnQueue(show.id, phase);

      expect(queue1).toEqual(queue2);
    });

    it('returns empty array for show with no characters', async () => {
      const template = createTestTemplate();
      const show = await hostModule.initializeShow(template, []);
      const phase: Phase = {
        id: 'test-phase',
        name: 'Test Phase',
        type: PhaseType.discussion,
        durationMode: 'turns',
        durationValue: 5,
        turnOrder: 'sequential',
        allowedChannels: [ChannelType.PUBLIC],
        triggerTemplate: 'Start',
        completionCondition: 'turns_complete',
      };

      const queue = await hostModule.manageTurnQueue(show.id, phase);

      expect(queue).toHaveLength(0);
      expect(queue).toEqual([]);
    });

    it('high-frequency characters appear before medium and low', async () => {
      const template = createTestTemplate();

      // Create multiple characters of each frequency
      const high1 = createTestCharacter('high-1', 'H1');
      high1.speakFrequency = SpeakFrequency.high;
      const high2 = createTestCharacter('high-2', 'H2');
      high2.speakFrequency = SpeakFrequency.high;

      const med1 = createTestCharacter('med-1', 'M1');
      med1.speakFrequency = SpeakFrequency.medium;
      const med2 = createTestCharacter('med-2', 'M2');
      med2.speakFrequency = SpeakFrequency.medium;

      const low1 = createTestCharacter('low-1', 'L1');
      low1.speakFrequency = SpeakFrequency.low;

      const characters = [low1, med1, high1, med2, high2];

      const show = await hostModule.initializeShow(template, characters);
      const phase: Phase = {
        id: 'test-phase',
        name: 'Test Phase',
        type: PhaseType.discussion,
        durationMode: 'turns',
        durationValue: 5,
        turnOrder: 'frequency_weighted',
        allowedChannels: [ChannelType.PUBLIC],
        triggerTemplate: 'Start',
        completionCondition: 'turns_complete',
      };

      const queue = await hostModule.manageTurnQueue(show.id, phase);

      expect(queue).toHaveLength(5);

      // First 2 should be high frequency
      expect(['high-1', 'high-2']).toContain(queue[0]);
      expect(['high-1', 'high-2']).toContain(queue[1]);

      // Next 2 should be medium frequency
      expect(['med-1', 'med-2']).toContain(queue[2]);
      expect(['med-1', 'med-2']).toContain(queue[3]);

      // Last should be low frequency
      expect(queue[4]).toBe('low-1');
    });
  });

  describe('emitTrigger', () => {
    it('creates host_trigger event in journal', async () => {
      const template = createTestTemplate();
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
      ];

      const show = await hostModule.initializeShow(template, characters);
      await hostModule.emitTrigger(show.id, 'phase-1', 'Start the discussion');

      const events = await eventJournal.getEvents(show.id);
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe(EventType.host_trigger);
      expect(events[0]!.content).toBe('Start the discussion');
    });

    it('sets audienceIds to all characters when targetCharacterIds is not provided', async () => {
      const template = createTestTemplate();
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
        createTestCharacter('char-3', 'Charlie'),
      ];

      const show = await hostModule.initializeShow(template, characters);
      await hostModule.emitTrigger(show.id, 'phase-1', 'Hello everyone');

      const events = await eventJournal.getEvents(show.id);
      expect(events[0]!.audienceIds).toHaveLength(3);
      expect(events[0]!.audienceIds).toContain('char-1');
      expect(events[0]!.audienceIds).toContain('char-2');
      expect(events[0]!.audienceIds).toContain('char-3');
    });

    it('sets audienceIds to targetCharacterIds when provided', async () => {
      const template = createTestTemplate();
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
        createTestCharacter('char-3', 'Charlie'),
      ];

      const show = await hostModule.initializeShow(template, characters);
      await hostModule.emitTrigger(show.id, 'phase-1', 'Private message', ['char-1', 'char-2']);

      const events = await eventJournal.getEvents(show.id);
      expect(events[0]!.audienceIds).toHaveLength(2);
      expect(events[0]!.audienceIds).toContain('char-1');
      expect(events[0]!.audienceIds).toContain('char-2');
      expect(events[0]!.audienceIds).not.toContain('char-3');
    });

    it('supports template substitution with {{names}}', async () => {
      const template = createTestTemplate();
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
      ];

      const show = await hostModule.initializeShow(template, characters);
      await hostModule.emitTrigger(show.id, 'phase-1', 'Hello {{names}}!');

      const events = await eventJournal.getEvents(show.id);
      expect(events[0]!.content).toBe('Hello char-1, char-2!');
    });

    it('supports template substitution with {{count}}', async () => {
      const template = createTestTemplate();
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
        createTestCharacter('char-3', 'Charlie'),
      ];

      const show = await hostModule.initializeShow(template, characters);
      await hostModule.emitTrigger(show.id, 'phase-1', 'There are {{count}} participants');

      const events = await eventJournal.getEvents(show.id);
      expect(events[0]!.content).toBe('There are 3 participants');
    });

    it('supports template substitution with {{target}}', async () => {
      const template = createTestTemplate();
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
      ];

      const show = await hostModule.initializeShow(template, characters);
      await hostModule.emitTrigger(show.id, 'phase-1', 'Sending to {{target}}', ['char-2']);

      const events = await eventJournal.getEvents(show.id);
      expect(events[0]!.content).toBe('Sending to char-2');
    });

    it('stores originalTemplate in metadata', async () => {
      const template = createTestTemplate();
      const characters = [createTestCharacter('char-1', 'Alice')];

      const show = await hostModule.initializeShow(template, characters);
      const originalTemplate = 'Hello {{names}}!';
      await hostModule.emitTrigger(show.id, 'phase-1', originalTemplate);

      const events = await eventJournal.getEvents(show.id);
      expect(events[0]!.metadata.originalTemplate).toBe(originalTemplate);
    });

    it('sets correct phaseId in event', async () => {
      const template = createTestTemplate();
      const characters = [createTestCharacter('char-1', 'Alice')];

      const show = await hostModule.initializeShow(template, characters);
      await hostModule.emitTrigger(show.id, 'phase-discussion-1', 'Start');

      const events = await eventJournal.getEvents(show.id);
      expect(events[0]!.phaseId).toBe('phase-discussion-1');
    });
  });

  describe('managePrivateChannels', () => {
    describe('openPrivateChannel', () => {
      it('creates channel_change event with PRIVATE channel', async () => {
        const template = createTestTemplate();
        const characters = [
          createTestCharacter('char-1', 'Alice'),
          createTestCharacter('char-2', 'Bob'),
        ];

        const show = await hostModule.initializeShow(template, characters);
        await hostModule.openPrivateChannel(show.id, ['char-1', 'char-2']);

        const events = await eventJournal.getEvents(show.id);
        expect(events).toHaveLength(1);
        expect(events[0]!.type).toBe(EventType.channel_change);
        expect(events[0]!.channel).toBe(ChannelType.PRIVATE);
      });

      it('sets correct audienceIds and receiverIds to participants', async () => {
        const template = createTestTemplate();
        const characters = [
          createTestCharacter('char-1', 'Alice'),
          createTestCharacter('char-2', 'Bob'),
          createTestCharacter('char-3', 'Charlie'),
        ];

        const show = await hostModule.initializeShow(template, characters);
        await hostModule.openPrivateChannel(show.id, ['char-1', 'char-2']);

        const events = await eventJournal.getEvents(show.id);
        expect(events[0]!.audienceIds).toEqual(['char-1', 'char-2']);
        expect(events[0]!.receiverIds).toEqual(['char-1', 'char-2']);
        expect(events[0]!.audienceIds).not.toContain('char-3');
      });

      it('stores action:open and participants in metadata', async () => {
        const template = createTestTemplate();
        const characters = [
          createTestCharacter('char-1', 'Alice'),
          createTestCharacter('char-2', 'Bob'),
        ];

        const show = await hostModule.initializeShow(template, characters);
        await hostModule.openPrivateChannel(show.id, ['char-1', 'char-2']);

        const events = await eventJournal.getEvents(show.id);
        expect(events[0]!.metadata.action).toBe('open');
        expect(events[0]!.metadata.participants).toEqual(['char-1', 'char-2']);
      });
    });

    describe('closePrivateChannel', () => {
      it('creates channel_change event with PUBLIC channel', async () => {
        const template = createTestTemplate();
        const characters = [
          createTestCharacter('char-1', 'Alice'),
          createTestCharacter('char-2', 'Bob'),
        ];

        const show = await hostModule.initializeShow(template, characters);
        await hostModule.openPrivateChannel(show.id, ['char-1', 'char-2']);
        await hostModule.closePrivateChannel(show.id);

        const events = await eventJournal.getEvents(show.id);
        expect(events).toHaveLength(2);
        expect(events[1]!.type).toBe(EventType.channel_change);
        expect(events[1]!.channel).toBe(ChannelType.PUBLIC);
      });

      it('sets audienceIds to all characters', async () => {
        const template = createTestTemplate();
        const characters = [
          createTestCharacter('char-1', 'Alice'),
          createTestCharacter('char-2', 'Bob'),
          createTestCharacter('char-3', 'Charlie'),
        ];

        const show = await hostModule.initializeShow(template, characters);
        await hostModule.openPrivateChannel(show.id, ['char-1', 'char-2']);
        await hostModule.closePrivateChannel(show.id);

        const events = await eventJournal.getEvents(show.id);
        expect(events[1]!.audienceIds).toHaveLength(3);
        expect(events[1]!.audienceIds).toContain('char-1');
        expect(events[1]!.audienceIds).toContain('char-2');
        expect(events[1]!.audienceIds).toContain('char-3');
      });

      it('stores action:close in metadata', async () => {
        const template = createTestTemplate();
        const characters = [createTestCharacter('char-1', 'Alice')];

        const show = await hostModule.initializeShow(template, characters);
        await hostModule.closePrivateChannel(show.id);

        const events = await eventJournal.getEvents(show.id);
        expect(events[0]!.metadata.action).toBe('close');
      });
    });

    describe('validatePrivateRequest', () => {
      it('returns true when under all limits', async () => {
        const template = createTestTemplate();
        const characters = [
          createTestCharacter('char-1', 'Alice'),
          createTestCharacter('char-2', 'Bob'),
        ];

        const show = await hostModule.initializeShow(template, characters);
        const rules: PrivateChannelRules = {
          initiator: 'character_request_host_approves',
          maxPrivatesPerPhase: 3,
          maxPrivatesPerCharacterPerPhase: 2,
          requestQueueMode: 'fifo',
          requestFormat: 'public_ask',
        };

        const isValid = await hostModule.validatePrivateRequest(show.id, 'char-1', 'char-2', rules);
        expect(isValid).toBe(true);
      });

      it('returns false when maxPrivatesPerPhase is reached', async () => {
        const template = createTestTemplate();
        const characters = [
          createTestCharacter('char-1', 'Alice'),
          createTestCharacter('char-2', 'Bob'),
          createTestCharacter('char-3', 'Charlie'),
          createTestCharacter('char-4', 'Diana'),
        ];

        const show = await hostModule.initializeShow(template, characters);
        const rules: PrivateChannelRules = {
          initiator: 'character_request_host_approves',
          maxPrivatesPerPhase: 2,
          maxPrivatesPerCharacterPerPhase: 5,
          requestQueueMode: 'fifo',
          requestFormat: 'public_ask',
        };

        // Open 2 private channels (reaching the limit)
        await hostModule.openPrivateChannel(show.id, ['char-1', 'char-2']);
        await hostModule.closePrivateChannel(show.id);
        await hostModule.openPrivateChannel(show.id, ['char-3', 'char-4']);
        await hostModule.closePrivateChannel(show.id);

        // Third request should fail
        const isValid = await hostModule.validatePrivateRequest(show.id, 'char-1', 'char-3', rules);
        expect(isValid).toBe(false);
      });

      it('returns false when maxPrivatesPerCharacterPerPhase is reached for requester', async () => {
        const template = createTestTemplate();
        const characters = [
          createTestCharacter('char-1', 'Alice'),
          createTestCharacter('char-2', 'Bob'),
          createTestCharacter('char-3', 'Charlie'),
        ];

        const show = await hostModule.initializeShow(template, characters);
        const rules: PrivateChannelRules = {
          initiator: 'character_request_host_approves',
          maxPrivatesPerPhase: 10,
          maxPrivatesPerCharacterPerPhase: 2,
          requestQueueMode: 'fifo',
          requestFormat: 'public_ask',
        };

        // char-1 participates in 2 private channels
        await hostModule.openPrivateChannel(show.id, ['char-1', 'char-2']);
        await hostModule.closePrivateChannel(show.id);
        await hostModule.openPrivateChannel(show.id, ['char-1', 'char-3']);
        await hostModule.closePrivateChannel(show.id);

        // char-1 requesting third private should fail
        const isValid = await hostModule.validatePrivateRequest(show.id, 'char-1', 'char-2', rules);
        expect(isValid).toBe(false);
      });

      it('returns false when maxPrivatesPerCharacterPerPhase is reached for target', async () => {
        const template = createTestTemplate();
        const characters = [
          createTestCharacter('char-1', 'Alice'),
          createTestCharacter('char-2', 'Bob'),
          createTestCharacter('char-3', 'Charlie'),
        ];

        const show = await hostModule.initializeShow(template, characters);
        const rules: PrivateChannelRules = {
          initiator: 'character_request_host_approves',
          maxPrivatesPerPhase: 10,
          maxPrivatesPerCharacterPerPhase: 2,
          requestQueueMode: 'fifo',
          requestFormat: 'public_ask',
        };

        // char-2 participates in 2 private channels (as target)
        await hostModule.openPrivateChannel(show.id, ['char-1', 'char-2']);
        await hostModule.closePrivateChannel(show.id);
        await hostModule.openPrivateChannel(show.id, ['char-3', 'char-2']);
        await hostModule.closePrivateChannel(show.id);

        // char-1 requesting private with char-2 should fail (char-2 at limit)
        const isValid = await hostModule.validatePrivateRequest(show.id, 'char-1', 'char-2', rules);
        expect(isValid).toBe(false);
      });

      it('returns true when characters have remaining quota', async () => {
        const template = createTestTemplate();
        const characters = [
          createTestCharacter('char-1', 'Alice'),
          createTestCharacter('char-2', 'Bob'),
          createTestCharacter('char-3', 'Charlie'),
        ];

        const show = await hostModule.initializeShow(template, characters);
        const rules: PrivateChannelRules = {
          initiator: 'character_request_host_approves',
          maxPrivatesPerPhase: 10,
          maxPrivatesPerCharacterPerPhase: 2,
          requestQueueMode: 'fifo',
          requestFormat: 'public_ask',
        };

        // char-1 participates in 1 private channel (has 1 remaining)
        await hostModule.openPrivateChannel(show.id, ['char-1', 'char-2']);
        await hostModule.closePrivateChannel(show.id);

        // char-1 requesting another private with char-3 should succeed
        const isValid = await hostModule.validatePrivateRequest(show.id, 'char-1', 'char-3', rules);
        expect(isValid).toBe(true);
      });

      it('returns false for non-existent show', async () => {
        const rules: PrivateChannelRules = {
          initiator: 'character_request_host_approves',
          maxPrivatesPerPhase: 3,
          maxPrivatesPerCharacterPerPhase: 2,
          requestQueueMode: 'fifo',
          requestFormat: 'public_ask',
        };

        const isValid = await hostModule.validatePrivateRequest('non-existent-show', 'char-1', 'char-2', rules);
        expect(isValid).toBe(false);
      });
    });
  });

  describe('runDecisionPhase', () => {
    // Helper to create mock decision callback
    const createMockCallback = (responses: Map<string, CharacterResponse>): DecisionCallback => {
      return async (characterId: string, _trigger: string, _previousDecisions: Array<{ characterId: string; decision: string }>) => {
        const response = responses.get(characterId);
        if (!response) {
          return { text: 'default response', decisionValue: 'default' };
        }
        return response;
      };
    };

    it('runs decision phase for 5 characters', async () => {
      const template = createTestTemplate();
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
        createTestCharacter('char-3', 'Charlie'),
        createTestCharacter('char-4', 'Diana'),
        createTestCharacter('char-5', 'Eve'),
      ];

      const show = await hostModule.initializeShow(template, characters);
      const decisionConfig: DecisionConfig = {
        timing: 'simultaneous',
        visibility: 'secret_until_reveal',
        revealMoment: 'after_all',
        format: 'choice',
        options: ['accept', 'reject'],
      };

      // Create mock responses for each character
      const responses = new Map<string, CharacterResponse>();
      responses.set('char-1', { text: 'I accept', decisionValue: 'accept' });
      responses.set('char-2', { text: 'I reject', decisionValue: 'reject' });
      responses.set('char-3', { text: 'I accept', decisionValue: 'accept' });
      responses.set('char-4', { text: 'I accept', decisionValue: 'accept' });
      responses.set('char-5', { text: 'I reject', decisionValue: 'reject' });

      await hostModule.runDecisionPhase(show.id, decisionConfig, createMockCallback(responses));

      // Get all events
      const events = await eventJournal.getEvents(show.id);

      // Should have 5 host_trigger events + 5 decision events = 10 events total
      expect(events.length).toBe(10);

      // Check that each character received a trigger
      const triggerEvents = events.filter(e => e.type === EventType.host_trigger);
      expect(triggerEvents).toHaveLength(5);

      // Check that 5 decision events were recorded
      const decisionEvents = events.filter(e => e.type === EventType.decision);
      expect(decisionEvents).toHaveLength(5);
    });

    it('each character receives a trigger', async () => {
      const template = createTestTemplate();
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
        createTestCharacter('char-3', 'Charlie'),
      ];

      const show = await hostModule.initializeShow(template, characters);
      const decisionConfig: DecisionConfig = {
        timing: 'simultaneous',
        visibility: 'secret_until_reveal',
        revealMoment: 'after_all',
        format: 'choice',
        options: ['yes', 'no'],
      };

      const triggeredCharacters: string[] = [];
      const mockCallback: DecisionCallback = async (characterId, _trigger, _prev) => {
        triggeredCharacters.push(characterId);
        return { text: 'Yes', decisionValue: 'yes' };
      };

      await hostModule.runDecisionPhase(show.id, decisionConfig, mockCallback);

      expect(triggeredCharacters).toHaveLength(3);
      expect(triggeredCharacters).toContain('char-1');
      expect(triggeredCharacters).toContain('char-2');
      expect(triggeredCharacters).toContain('char-3');
    });

    it('creates decision events in journal', async () => {
      const template = createTestTemplate();
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
      ];

      const show = await hostModule.initializeShow(template, characters);
      const decisionConfig: DecisionConfig = {
        timing: 'simultaneous',
        visibility: 'secret_until_reveal',
        revealMoment: 'after_all',
        format: 'choice',
        options: ['accept', 'reject'],
      };

      const responses = new Map<string, CharacterResponse>();
      responses.set('char-1', { text: 'I choose accept', decisionValue: 'accept' });
      responses.set('char-2', { text: 'I choose reject', decisionValue: 'reject' });

      await hostModule.runDecisionPhase(show.id, decisionConfig, createMockCallback(responses));

      const events = await eventJournal.getEvents(show.id);
      const decisionEvents = events.filter(e => e.type === EventType.decision);

      expect(decisionEvents).toHaveLength(2);

      // Check decision values in metadata
      const char1Decision = decisionEvents.find(e => e.senderId === 'char-1');
      expect(char1Decision).toBeDefined();
      expect(char1Decision!.metadata.decisionValue).toBe('accept');

      const char2Decision = decisionEvents.find(e => e.senderId === 'char-2');
      expect(char2Decision).toBeDefined();
      expect(char2Decision!.metadata.decisionValue).toBe('reject');
    });

    it('visibility is PRIVATE for secret_until_reveal', async () => {
      const template = createTestTemplate();
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
      ];

      const show = await hostModule.initializeShow(template, characters);
      const decisionConfig: DecisionConfig = {
        timing: 'simultaneous',
        visibility: 'secret_until_reveal',
        revealMoment: 'after_all',
        format: 'choice',
        options: ['yes', 'no'],
      };

      const mockCallback: DecisionCallback = async () => ({ text: 'yes', decisionValue: 'yes' });
      await hostModule.runDecisionPhase(show.id, decisionConfig, mockCallback);

      const events = await eventJournal.getEvents(show.id);
      const decisionEvents = events.filter(e => e.type === EventType.decision);

      for (const event of decisionEvents) {
        expect(event.visibility).toBe(ChannelType.PRIVATE);
        expect(event.channel).toBe(ChannelType.PRIVATE);
        // For secret_until_reveal, only the deciding character should see their own decision
        expect(event.audienceIds).toHaveLength(1);
        expect(event.audienceIds[0]).toBe(event.senderId);
      }
    });

    it('visibility is PUBLIC for public_immediately', async () => {
      const template = createTestTemplate();
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
        createTestCharacter('char-3', 'Charlie'),
      ];

      const show = await hostModule.initializeShow(template, characters);
      const decisionConfig: DecisionConfig = {
        timing: 'simultaneous',
        visibility: 'public_immediately',
        revealMoment: 'after_each',
        format: 'choice',
        options: ['yes', 'no'],
      };

      const mockCallback: DecisionCallback = async () => ({ text: 'yes', decisionValue: 'yes' });
      await hostModule.runDecisionPhase(show.id, decisionConfig, mockCallback);

      const events = await eventJournal.getEvents(show.id);
      const decisionEvents = events.filter(e => e.type === EventType.decision);

      for (const event of decisionEvents) {
        expect(event.visibility).toBe(ChannelType.PUBLIC);
        expect(event.channel).toBe(ChannelType.PUBLIC);
        // For public_immediately, all characters should see each decision
        expect(event.audienceIds).toHaveLength(3);
      }
    });

    it('simultaneous timing does not show previous decisions', async () => {
      const template = createTestTemplate();
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
        createTestCharacter('char-3', 'Charlie'),
      ];

      const show = await hostModule.initializeShow(template, characters);
      const decisionConfig: DecisionConfig = {
        timing: 'simultaneous',
        visibility: 'secret_until_reveal',
        revealMoment: 'after_all',
        format: 'choice',
        options: ['yes', 'no'],
      };

      const receivedPreviousDecisions: Array<Array<{ characterId: string; decision: string }>> = [];
      const mockCallback: DecisionCallback = async (_charId, _trigger, previousDecisions) => {
        receivedPreviousDecisions.push([...previousDecisions]);
        return { text: 'yes', decisionValue: 'yes' };
      };

      await hostModule.runDecisionPhase(show.id, decisionConfig, mockCallback);

      // In simultaneous mode, all characters should receive empty previousDecisions
      expect(receivedPreviousDecisions).toHaveLength(3);
      for (const prev of receivedPreviousDecisions) {
        expect(prev).toHaveLength(0);
      }
    });

    it('sequential timing shows previous decisions', async () => {
      const template = createTestTemplate();
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
        createTestCharacter('char-3', 'Charlie'),
      ];

      const show = await hostModule.initializeShow(template, characters);
      const decisionConfig: DecisionConfig = {
        timing: 'sequential',
        visibility: 'public_immediately',
        revealMoment: 'after_each',
        format: 'choice',
        options: ['yes', 'no'],
      };

      const receivedPreviousDecisions: Array<Array<{ characterId: string; decision: string }>> = [];
      const responses = new Map<string, CharacterResponse>();
      responses.set('char-1', { text: 'yes', decisionValue: 'yes' });
      responses.set('char-2', { text: 'no', decisionValue: 'no' });
      responses.set('char-3', { text: 'yes', decisionValue: 'yes' });

      const mockCallback: DecisionCallback = async (charId, _trigger, previousDecisions) => {
        receivedPreviousDecisions.push([...previousDecisions]);
        return responses.get(charId) ?? { text: 'default', decisionValue: 'default' };
      };

      await hostModule.runDecisionPhase(show.id, decisionConfig, mockCallback);

      // In sequential mode, each character should see previous decisions
      expect(receivedPreviousDecisions).toHaveLength(3);

      // First character sees no previous decisions
      expect(receivedPreviousDecisions[0]).toHaveLength(0);

      // Second character sees first character's decision
      expect(receivedPreviousDecisions[1]).toHaveLength(1);
      expect(receivedPreviousDecisions[1]![0]!.characterId).toBe('char-1');
      expect(receivedPreviousDecisions[1]![0]!.decision).toBe('yes');

      // Third character sees first two decisions
      expect(receivedPreviousDecisions[2]).toHaveLength(2);
      expect(receivedPreviousDecisions[2]![0]!.characterId).toBe('char-1');
      expect(receivedPreviousDecisions[2]![1]!.characterId).toBe('char-2');
      expect(receivedPreviousDecisions[2]![1]!.decision).toBe('no');
    });

    it('stores decision metadata correctly', async () => {
      const template = createTestTemplate();
      const characters = [createTestCharacter('char-1', 'Alice')];

      const show = await hostModule.initializeShow(template, characters);
      const decisionConfig: DecisionConfig = {
        timing: 'simultaneous',
        visibility: 'secret_until_reveal',
        revealMoment: 'after_all',
        format: 'choice',
        options: ['accept', 'reject', 'abstain'],
      };

      const mockCallback: DecisionCallback = async () => ({ text: 'I accept', decisionValue: 'accept' });
      await hostModule.runDecisionPhase(show.id, decisionConfig, mockCallback);

      const events = await eventJournal.getEvents(show.id);
      const decisionEvent = events.find(e => e.type === EventType.decision);

      expect(decisionEvent).toBeDefined();
      expect(decisionEvent!.metadata.decisionValue).toBe('accept');
      expect(decisionEvent!.metadata.format).toBe('choice');
      expect(decisionEvent!.metadata.options).toEqual(['accept', 'reject', 'abstain']);
      expect(decisionEvent!.metadata.timing).toBe('simultaneous');
    });

    it('uses text as decisionValue if decisionValue not provided', async () => {
      const template = createTestTemplate();
      const characters = [createTestCharacter('char-1', 'Alice')];

      const show = await hostModule.initializeShow(template, characters);
      const decisionConfig: DecisionConfig = {
        timing: 'simultaneous',
        visibility: 'secret_until_reveal',
        revealMoment: 'after_all',
        format: 'free_text',
        options: null,
      };

      // Response without explicit decisionValue
      const mockCallback: DecisionCallback = async () => ({ text: 'I think we should proceed carefully' });
      await hostModule.runDecisionPhase(show.id, decisionConfig, mockCallback);

      const events = await eventJournal.getEvents(show.id);
      const decisionEvent = events.find(e => e.type === EventType.decision);

      expect(decisionEvent).toBeDefined();
      expect(decisionEvent!.metadata.decisionValue).toBe('I think we should proceed carefully');
    });
  });

  describe('runRevelation', () => {
    // Helper to create mock decision callback
    const createMockCallback = (responses: Map<string, CharacterResponse>): DecisionCallback => {
      return async (characterId: string, _trigger: string, _previousDecisions: Array<{ characterId: string; decision: string }>) => {
        const response = responses.get(characterId);
        if (!response) {
          return { text: 'default response', decisionValue: 'default' };
        }
        return response;
      };
    };

    it('creates revelation events for each decision after decision phase', async () => {
      const template = createTestTemplate();
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
        createTestCharacter('char-3', 'Charlie'),
        createTestCharacter('char-4', 'Diana'),
        createTestCharacter('char-5', 'Eve'),
      ];

      const show = await hostModule.initializeShow(template, characters);
      const decisionConfig: DecisionConfig = {
        timing: 'simultaneous',
        visibility: 'secret_until_reveal',
        revealMoment: 'after_all',
        format: 'choice',
        options: ['accept', 'reject'],
      };

      // Run decision phase first
      const responses = new Map<string, CharacterResponse>();
      responses.set('char-1', { text: 'I accept', decisionValue: 'accept' });
      responses.set('char-2', { text: 'I reject', decisionValue: 'reject' });
      responses.set('char-3', { text: 'I accept', decisionValue: 'accept' });
      responses.set('char-4', { text: 'I accept', decisionValue: 'accept' });
      responses.set('char-5', { text: 'I reject', decisionValue: 'reject' });

      await hostModule.runDecisionPhase(show.id, decisionConfig, createMockCallback(responses));

      // Run revelation
      await hostModule.runRevelation(show.id, decisionConfig);

      // Get all events
      const events = await eventJournal.getEvents(show.id);
      const revelationEvents = events.filter(e => e.type === EventType.revelation);

      // With after_all, should have 1 revelation event
      expect(revelationEvents).toHaveLength(1);
    });

    it('creates one revelation event with all decisions for after_all', async () => {
      const template = createTestTemplate();
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
        createTestCharacter('char-3', 'Charlie'),
      ];

      const show = await hostModule.initializeShow(template, characters);
      const decisionConfig: DecisionConfig = {
        timing: 'simultaneous',
        visibility: 'secret_until_reveal',
        revealMoment: 'after_all',
        format: 'choice',
        options: ['yes', 'no'],
      };

      const responses = new Map<string, CharacterResponse>();
      responses.set('char-1', { text: 'Yes', decisionValue: 'yes' });
      responses.set('char-2', { text: 'No', decisionValue: 'no' });
      responses.set('char-3', { text: 'Yes', decisionValue: 'yes' });

      await hostModule.runDecisionPhase(show.id, decisionConfig, createMockCallback(responses));
      await hostModule.runRevelation(show.id, decisionConfig);

      const events = await eventJournal.getEvents(show.id);
      const revelationEvents = events.filter(e => e.type === EventType.revelation);

      expect(revelationEvents).toHaveLength(1);
      const revelation = revelationEvents[0]!;

      // Check content includes all decisions
      expect(revelation.content).toContain('char-1: yes');
      expect(revelation.content).toContain('char-2: no');
      expect(revelation.content).toContain('char-3: yes');

      // Check metadata contains all decisions
      expect(revelation.metadata.decisions).toHaveLength(3);
      expect(revelation.metadata.revealMoment).toBe('after_all');
    });

    it('creates one revelation event per decision for after_each', async () => {
      const template = createTestTemplate();
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
        createTestCharacter('char-3', 'Charlie'),
      ];

      const show = await hostModule.initializeShow(template, characters);
      const decisionConfig: DecisionConfig = {
        timing: 'sequential',
        visibility: 'secret_until_reveal',
        revealMoment: 'after_each',
        format: 'choice',
        options: ['yes', 'no'],
      };

      const responses = new Map<string, CharacterResponse>();
      responses.set('char-1', { text: 'Yes', decisionValue: 'yes' });
      responses.set('char-2', { text: 'No', decisionValue: 'no' });
      responses.set('char-3', { text: 'Yes', decisionValue: 'yes' });

      await hostModule.runDecisionPhase(show.id, decisionConfig, createMockCallback(responses));
      await hostModule.runRevelation(show.id, decisionConfig);

      const events = await eventJournal.getEvents(show.id);
      const revelationEvents = events.filter(e => e.type === EventType.revelation);

      // With after_each, should have 3 revelation events (one per decision)
      expect(revelationEvents).toHaveLength(3);

      // Each revelation should have its own decision
      const char1Revelation = revelationEvents.find(e => e.senderId === 'char-1');
      expect(char1Revelation).toBeDefined();
      expect(char1Revelation!.metadata.decision).toBe('yes');
      expect(char1Revelation!.metadata.revealMoment).toBe('after_each');

      const char2Revelation = revelationEvents.find(e => e.senderId === 'char-2');
      expect(char2Revelation).toBeDefined();
      expect(char2Revelation!.metadata.decision).toBe('no');
    });

    it('all revelation events are PUBLIC with all characters as audience', async () => {
      const template = createTestTemplate();
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
        createTestCharacter('char-3', 'Charlie'),
      ];

      const show = await hostModule.initializeShow(template, characters);
      const decisionConfig: DecisionConfig = {
        timing: 'simultaneous',
        visibility: 'secret_until_reveal',
        revealMoment: 'after_all',
        format: 'choice',
        options: ['yes', 'no'],
      };

      const mockCallback: DecisionCallback = async () => ({ text: 'yes', decisionValue: 'yes' });
      await hostModule.runDecisionPhase(show.id, decisionConfig, mockCallback);
      await hostModule.runRevelation(show.id, decisionConfig);

      const events = await eventJournal.getEvents(show.id);
      const revelationEvents = events.filter(e => e.type === EventType.revelation);

      for (const event of revelationEvents) {
        expect(event.channel).toBe(ChannelType.PUBLIC);
        expect(event.visibility).toBe(ChannelType.PUBLIC);
        expect(event.audienceIds).toHaveLength(3);
        expect(event.audienceIds).toContain('char-1');
        expect(event.audienceIds).toContain('char-2');
        expect(event.audienceIds).toContain('char-3');
      }
    });

    it('does nothing if no decision events exist', async () => {
      const template = createTestTemplate();
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
      ];

      const show = await hostModule.initializeShow(template, characters);
      const decisionConfig: DecisionConfig = {
        timing: 'simultaneous',
        visibility: 'secret_until_reveal',
        revealMoment: 'after_all',
        format: 'choice',
        options: ['yes', 'no'],
      };

      // Run revelation without decision phase
      await hostModule.runRevelation(show.id, decisionConfig);

      const events = await eventJournal.getEvents(show.id);
      const revelationEvents = events.filter(e => e.type === EventType.revelation);

      expect(revelationEvents).toHaveLength(0);
    });

    it('throws error if show not found', async () => {
      const decisionConfig: DecisionConfig = {
        timing: 'simultaneous',
        visibility: 'secret_until_reveal',
        revealMoment: 'after_all',
        format: 'choice',
        options: ['yes', 'no'],
      };

      await expect(hostModule.runRevelation('non-existent-show', decisionConfig)).rejects.toThrow('Show non-existent-show not found');
    });
  });
});
