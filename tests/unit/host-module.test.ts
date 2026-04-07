import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HostModule } from '../../src/core/host-module.js';
import { EventJournal } from '../../src/core/event-journal.js';
import { SqliteStore } from '../../src/storage/sqlite-store.js';
import { ShowFormatTemplate, Phase } from '../../src/types/template.js';
import { CharacterDefinition } from '../../src/types/character.js';
import { PhaseType, ChannelType, SpeakFrequency, ShowStatus, BudgetMode } from '../../src/types/enums.js';
import { PrivateContext } from '../../src/types/context.js';
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
      expect(show.status).toBe(ShowStatus.running);
      expect(show.currentPhaseId).toBe('phase-discussion-1');
      expect(show.startedAt).toBeInstanceOf(Date);
      expect(show.completedAt).toBeNull();

      // Verify show in DB
      const dbShow = await store.getShow(show.id);
      expect(dbShow).not.toBeNull();
      expect(dbShow!.formatId).toBe(template.id);
      expect(dbShow!.status).toBe(ShowStatus.running);
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

      expect(show.currentPhaseId).toBe(template.phases[0].id);
    });

    it('handles template with no phases', async () => {
      const template = createTestTemplate();
      template.phases = [];
      const characters = [createTestCharacter('char-1', 'Alice')];

      const show = await hostModule.initializeShow(template, characters);

      expect(show.currentPhaseId).toBeNull();
    });
  });
});
