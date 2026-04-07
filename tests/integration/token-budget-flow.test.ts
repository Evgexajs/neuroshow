/**
 * Integration Test: Token Budget Flow
 *
 * TASK-065: Tests token budget tracking through the full system flow
 *
 * Verifies:
 * - Budget creation during initializeShow
 * - Budget decrease after each LLM call (via updateBudget)
 * - budget_saving mode triggered at 80% usage
 * - graceful_finish mode triggered at 100% usage
 * - Integration with Orchestrator.checkBudget() and real SqliteStore
 * - promptTokens and completionTokens are summed correctly
 * - Uses temporary SQLite database
 * - No mocks for storage - all components are real
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HostModule } from '../../src/core/host-module.js';
import { EventJournal } from '../../src/core/event-journal.js';
import { SqliteStore } from '../../src/storage/sqlite-store.js';
import { ContextBuilder } from '../../src/core/context-builder.js';
import { Orchestrator } from '../../src/core/orchestrator.js';
import { MockAdapter } from '../../src/adapters/mock-adapter.js';
import { ShowFormatTemplate } from '../../src/types/template.js';
import { CharacterDefinition } from '../../src/types/character.js';
import { BudgetMode, EventType } from '../../src/types/enums.js';
import * as fs from 'fs';

describe('Integration: Token Budget Flow', () => {
  let store: SqliteStore;
  let eventJournal: EventJournal;
  let hostModule: HostModule;
  let contextBuilder: ContextBuilder;
  let orchestrator: Orchestrator;
  let mockAdapter: MockAdapter;
  const testDbPath = './data/test-token-budget-flow.db';

  // Minimal template for testing
  const createTestTemplate = (): ShowFormatTemplate => ({
    id: 'test-format',
    name: 'Test Format',
    description: 'Test format for token budget tests',
    version: '1.0.0',
    minParticipants: 2,
    maxParticipants: 4,
    contextWindowSize: 8000,
    phases: [
      {
        id: 'phase-1',
        name: 'Phase One',
        type: 'discussion',
        turnOrder: 'sequential',
        triggerTemplate: 'Welcome!',
        maxTurns: 2,
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
      maxPrivatesPerPhase: 2,
      maxPrivatesPerCharacterPerPhase: 1,
      minDurationTurns: 1,
      maxDurationTurns: 3,
    },
  });

  // Test characters
  const createTestCharacters = (): Array<CharacterDefinition & { modelAdapterId?: string }> => [
    {
      id: 'char-alice',
      name: 'Alice',
      publicCard: 'Alice is a friendly character.',
      personalityPrompt: 'You are Alice.',
      motivationPrompt: 'Be friendly.',
      boundaryRules: 'Be polite.',
      speakFrequency: 'medium',
      responseConstraints: { maxWords: 100 },
      startingPrivateContext: {
        alliances: [],
        wildcards: [],
        hiddenObjectives: [],
      },
      modelAdapterId: 'mock',
    },
    {
      id: 'char-bob',
      name: 'Bob',
      publicCard: 'Bob is thoughtful.',
      personalityPrompt: 'You are Bob.',
      motivationPrompt: 'Seek truth.',
      boundaryRules: 'Be honest.',
      speakFrequency: 'medium',
      responseConstraints: { maxWords: 100 },
      startingPrivateContext: {
        alliances: [],
        wildcards: [],
        hiddenObjectives: [],
      },
      modelAdapterId: 'mock',
    },
  ];

  beforeEach(async () => {
    // Clean up test db if exists
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    // Initialize real components
    store = new SqliteStore(testDbPath);
    await store.initSchema();
    eventJournal = new EventJournal(store);
    hostModule = new HostModule(store, eventJournal);
    contextBuilder = new ContextBuilder(eventJournal, store);
    mockAdapter = new MockAdapter(42);
    orchestrator = new Orchestrator(store, mockAdapter, eventJournal, hostModule, contextBuilder);
  });

  afterEach(async () => {
    await store.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('Budget Creation during initializeShow', () => {
    it('should create token_budget record when show is initialized', async () => {
      const template = createTestTemplate();
      const characters = createTestCharacters();

      const show = await hostModule.initializeShow(template, characters, 42);

      // Verify budget was created
      const budget = await store.getBudget(show.id);
      expect(budget).not.toBeNull();
      expect(budget!.showId).toBe(show.id);
      expect(budget!.totalLimit).toBeGreaterThan(0);
      expect(budget!.usedPrompt).toBe(0);
      expect(budget!.usedCompletion).toBe(0);
      expect(budget!.mode).toBe(BudgetMode.normal);
    });

    it('should set initial budget mode to normal', async () => {
      const template = createTestTemplate();
      const characters = createTestCharacters();

      const show = await hostModule.initializeShow(template, characters, 42);

      const budget = await store.getBudget(show.id);
      expect(budget!.mode).toBe(BudgetMode.normal);
    });
  });

  describe('Budget Decrease after LLM Calls', () => {
    it('should decrease budget after updateBudget call', async () => {
      const template = createTestTemplate();
      const characters = createTestCharacters();

      const show = await hostModule.initializeShow(template, characters, 42);

      // Simulate LLM call by updating budget
      await store.updateBudget(show.id, 100, 50);

      const budget = await store.getBudget(show.id);
      expect(budget!.usedPrompt).toBe(100);
      expect(budget!.usedCompletion).toBe(50);
    });

    it('should accumulate tokens correctly over multiple LLM calls', async () => {
      const template = createTestTemplate();
      const characters = createTestCharacters();

      const show = await hostModule.initializeShow(template, characters, 42);

      // Simulate multiple LLM calls
      await store.updateBudget(show.id, 100, 50); // First call
      await store.updateBudget(show.id, 200, 100); // Second call
      await store.updateBudget(show.id, 150, 75); // Third call

      const budget = await store.getBudget(show.id);
      expect(budget!.usedPrompt).toBe(450); // 100 + 200 + 150
      expect(budget!.usedCompletion).toBe(225); // 50 + 100 + 75
    });

    it('should update lastUpdated timestamp on each budget update', async () => {
      const template = createTestTemplate();
      const characters = createTestCharacters();

      const show = await hostModule.initializeShow(template, characters, 42);

      const initialBudget = await store.getBudget(show.id);
      const initialTimestamp = initialBudget!.lastUpdated;

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      await store.updateBudget(show.id, 100, 50);

      const updatedBudget = await store.getBudget(show.id);
      expect(updatedBudget!.lastUpdated).toBeGreaterThan(initialTimestamp);
    });
  });

  describe('Budget Saving Mode at 80%', () => {
    it('should return budget_saving mode when usage reaches 80%', async () => {
      const template = createTestTemplate();
      const characters = createTestCharacters();

      const show = await hostModule.initializeShow(template, characters, 42);

      // Get the total limit to calculate 80%
      const initialBudget = await store.getBudget(show.id);
      const totalLimit = initialBudget!.totalLimit;
      const eightyPercent = Math.floor(totalLimit * 0.8);

      // Update budget to reach exactly 80%
      await store.updateBudget(show.id, eightyPercent, 0);

      // Check budget mode through orchestrator
      const mode = await orchestrator.checkBudget(show.id);
      expect(mode).toBe(BudgetMode.budget_saving);
    });

    it('should return budget_saving mode when usage is between 80% and 100%', async () => {
      const template = createTestTemplate();
      const characters = createTestCharacters();

      const show = await hostModule.initializeShow(template, characters, 42);

      const initialBudget = await store.getBudget(show.id);
      const totalLimit = initialBudget!.totalLimit;
      const ninetyPercent = Math.floor(totalLimit * 0.9);

      // Update budget to 90%
      await store.updateBudget(show.id, ninetyPercent, 0);

      const mode = await orchestrator.checkBudget(show.id);
      expect(mode).toBe(BudgetMode.budget_saving);
    });

    it('should create system event when switching to budget_saving mode', async () => {
      const template = createTestTemplate();
      const characters = createTestCharacters();

      const show = await hostModule.initializeShow(template, characters, 42);

      const initialBudget = await store.getBudget(show.id);
      const totalLimit = initialBudget!.totalLimit;
      const eightyPercent = Math.floor(totalLimit * 0.8);

      // Update budget to trigger mode change
      await store.updateBudget(show.id, eightyPercent, 0);

      // Call checkBudget to trigger mode change event
      await orchestrator.checkBudget(show.id);

      // Verify system event was created
      const events = await store.getEvents(show.id);
      const systemEvent = events.find(
        (e) => e.type === EventType.system && e.metadata?.budgetModeChange === true
      );

      expect(systemEvent).toBeDefined();
      expect(systemEvent!.metadata?.newMode).toBe(BudgetMode.budget_saving);
      expect(systemEvent!.metadata?.oldMode).toBe(BudgetMode.normal);
    });

    it('should persist budget_saving mode in database', async () => {
      const template = createTestTemplate();
      const characters = createTestCharacters();

      const show = await hostModule.initializeShow(template, characters, 42);

      const initialBudget = await store.getBudget(show.id);
      const totalLimit = initialBudget!.totalLimit;
      const eightyPercent = Math.floor(totalLimit * 0.8);

      await store.updateBudget(show.id, eightyPercent, 0);
      await orchestrator.checkBudget(show.id);

      // Verify mode is persisted in database
      const budget = await store.getBudget(show.id);
      expect(budget!.mode).toBe(BudgetMode.budget_saving);
    });
  });

  describe('Graceful Finish Mode at 100%', () => {
    it('should return graceful_finish mode when usage reaches 100%', async () => {
      const template = createTestTemplate();
      const characters = createTestCharacters();

      const show = await hostModule.initializeShow(template, characters, 42);

      const initialBudget = await store.getBudget(show.id);
      const totalLimit = initialBudget!.totalLimit;

      // Update budget to reach 100%
      await store.updateBudget(show.id, totalLimit, 0);

      const mode = await orchestrator.checkBudget(show.id);
      expect(mode).toBe(BudgetMode.graceful_finish);
    });

    it('should return graceful_finish mode when usage exceeds 100%', async () => {
      const template = createTestTemplate();
      const characters = createTestCharacters();

      const show = await hostModule.initializeShow(template, characters, 42);

      const initialBudget = await store.getBudget(show.id);
      const totalLimit = initialBudget!.totalLimit;

      // Update budget to exceed 100%
      await store.updateBudget(show.id, totalLimit + 1000, 0);

      const mode = await orchestrator.checkBudget(show.id);
      expect(mode).toBe(BudgetMode.graceful_finish);
    });

    it('should create system event when switching to graceful_finish mode', async () => {
      const template = createTestTemplate();
      const characters = createTestCharacters();

      const show = await hostModule.initializeShow(template, characters, 42);

      const initialBudget = await store.getBudget(show.id);
      const totalLimit = initialBudget!.totalLimit;

      // Update budget to trigger mode change
      await store.updateBudget(show.id, totalLimit, 0);

      // Call checkBudget to trigger mode change event
      await orchestrator.checkBudget(show.id);

      // Verify system event was created
      const events = await store.getEvents(show.id);
      const systemEvent = events.find(
        (e) => e.type === EventType.system && e.metadata?.newMode === BudgetMode.graceful_finish
      );

      expect(systemEvent).toBeDefined();
    });

    it('should persist graceful_finish mode in database', async () => {
      const template = createTestTemplate();
      const characters = createTestCharacters();

      const show = await hostModule.initializeShow(template, characters, 42);

      const initialBudget = await store.getBudget(show.id);
      const totalLimit = initialBudget!.totalLimit;

      await store.updateBudget(show.id, totalLimit, 0);
      await orchestrator.checkBudget(show.id);

      const budget = await store.getBudget(show.id);
      expect(budget!.mode).toBe(BudgetMode.graceful_finish);
    });
  });

  describe('Normal Mode below 80%', () => {
    it('should return normal mode when usage is below 80%', async () => {
      const template = createTestTemplate();
      const characters = createTestCharacters();

      const show = await hostModule.initializeShow(template, characters, 42);

      const initialBudget = await store.getBudget(show.id);
      const totalLimit = initialBudget!.totalLimit;
      const fiftyPercent = Math.floor(totalLimit * 0.5);

      // Update budget to 50%
      await store.updateBudget(show.id, fiftyPercent, 0);

      const mode = await orchestrator.checkBudget(show.id);
      expect(mode).toBe(BudgetMode.normal);
    });

    it('should not create system event when staying in normal mode', async () => {
      const template = createTestTemplate();
      const characters = createTestCharacters();

      const show = await hostModule.initializeShow(template, characters, 42);

      const initialBudget = await store.getBudget(show.id);
      const totalLimit = initialBudget!.totalLimit;
      const tenPercent = Math.floor(totalLimit * 0.1);

      // Update budget to 10%
      await store.updateBudget(show.id, tenPercent, 0);

      // Call checkBudget
      await orchestrator.checkBudget(show.id);

      // Verify no system event was created
      const events = await store.getEvents(show.id);
      const systemEvents = events.filter((e) => e.type === EventType.system);
      expect(systemEvents.length).toBe(0);
    });
  });

  describe('Token Summation', () => {
    it('should correctly sum promptTokens and completionTokens for budget calculation', async () => {
      const template = createTestTemplate();
      const characters = createTestCharacters();

      const show = await hostModule.initializeShow(template, characters, 42);

      const initialBudget = await store.getBudget(show.id);
      const totalLimit = initialBudget!.totalLimit;

      // Calculate tokens to reach exactly 80% using both prompt and completion
      const promptTokens = Math.floor(totalLimit * 0.5);
      const completionTokens = Math.floor(totalLimit * 0.3);

      await store.updateBudget(show.id, promptTokens, completionTokens);

      // Total usage should be 80%, triggering budget_saving mode
      const mode = await orchestrator.checkBudget(show.id);
      expect(mode).toBe(BudgetMode.budget_saving);

      // Verify the summed values in budget
      const budget = await store.getBudget(show.id);
      expect(budget!.usedPrompt).toBe(promptTokens);
      expect(budget!.usedCompletion).toBe(completionTokens);
      expect(budget!.usedPrompt + budget!.usedCompletion).toBe(promptTokens + completionTokens);
    });

    it('should correctly report usage percentage in system event metadata', async () => {
      const template = createTestTemplate();
      const characters = createTestCharacters();

      const show = await hostModule.initializeShow(template, characters, 42);

      const initialBudget = await store.getBudget(show.id);
      const totalLimit = initialBudget!.totalLimit;

      // Set usage to exactly 85%
      const promptTokens = Math.floor(totalLimit * 0.5);
      const completionTokens = Math.floor(totalLimit * 0.35);

      await store.updateBudget(show.id, promptTokens, completionTokens);
      await orchestrator.checkBudget(show.id);

      // Find the system event and check usage percentage
      const events = await store.getEvents(show.id);
      const systemEvent = events.find((e) => e.type === EventType.system);

      expect(systemEvent).toBeDefined();
      expect(systemEvent!.metadata?.usagePercent).toBeGreaterThanOrEqual(80);
      expect(systemEvent!.metadata?.usagePercent).toBeLessThan(100);
    });
  });

  describe('Full Budget Flow with Small Budget', () => {
    it('should progress through all budget modes as tokens accumulate', async () => {
      const template = createTestTemplate();
      const characters = createTestCharacters();

      const show = await hostModule.initializeShow(template, characters, 42);

      // Reset mode to normal for testing (in case initialization changed it)
      await store.setBudgetMode(show.id, BudgetMode.normal);

      // Work with the existing total limit from config
      const initialBudget = await store.getBudget(show.id);
      const totalLimit = initialBudget!.totalLimit;

      // Phase 1: Normal mode (< 80%)
      const normalTokens = Math.floor(totalLimit * 0.5);
      await store.updateBudget(show.id, normalTokens, 0);
      let mode = await orchestrator.checkBudget(show.id);
      expect(mode).toBe(BudgetMode.normal);

      // Phase 2: Budget saving mode (>= 80%, < 100%)
      const savingTokens = Math.floor(totalLimit * 0.35);
      await store.updateBudget(show.id, savingTokens, 0);
      mode = await orchestrator.checkBudget(show.id);
      expect(mode).toBe(BudgetMode.budget_saving);

      // Phase 3: Graceful finish mode (>= 100%)
      const finishTokens = Math.floor(totalLimit * 0.2);
      await store.updateBudget(show.id, finishTokens, 0);
      mode = await orchestrator.checkBudget(show.id);
      expect(mode).toBe(BudgetMode.graceful_finish);

      // Verify final budget state
      const finalBudget = await store.getBudget(show.id);
      expect(finalBudget!.usedPrompt).toBe(normalTokens + savingTokens + finishTokens);
      expect(finalBudget!.mode).toBe(BudgetMode.graceful_finish);
    });

    it('should create system events for each mode transition', async () => {
      const template = createTestTemplate();
      const characters = createTestCharacters();

      const show = await hostModule.initializeShow(template, characters, 42);

      const initialBudget = await store.getBudget(show.id);
      const totalLimit = initialBudget!.totalLimit;

      // Transition to budget_saving
      const savingTokens = Math.floor(totalLimit * 0.85);
      await store.updateBudget(show.id, savingTokens, 0);
      await orchestrator.checkBudget(show.id);

      // Transition to graceful_finish
      const finishTokens = Math.floor(totalLimit * 0.2);
      await store.updateBudget(show.id, finishTokens, 0);
      await orchestrator.checkBudget(show.id);

      // Verify two system events were created
      const events = await store.getEvents(show.id);
      const systemEvents = events.filter((e) => e.type === EventType.system);
      expect(systemEvents.length).toBe(2);

      // Verify transitions
      expect(systemEvents[0]!.metadata?.oldMode).toBe(BudgetMode.normal);
      expect(systemEvents[0]!.metadata?.newMode).toBe(BudgetMode.budget_saving);

      expect(systemEvents[1]!.metadata?.oldMode).toBe(BudgetMode.budget_saving);
      expect(systemEvents[1]!.metadata?.newMode).toBe(BudgetMode.graceful_finish);
    });
  });

  describe('Edge Cases', () => {
    it('should return normal mode when budget does not exist', async () => {
      // Don't create a show, just check budget for non-existent show
      const mode = await orchestrator.checkBudget('non-existent-show');
      expect(mode).toBe(BudgetMode.normal);
    });

    it('should not create duplicate system events for same mode', async () => {
      const template = createTestTemplate();
      const characters = createTestCharacters();

      const show = await hostModule.initializeShow(template, characters, 42);

      const initialBudget = await store.getBudget(show.id);
      const totalLimit = initialBudget!.totalLimit;

      // Reach budget_saving mode
      const savingTokens = Math.floor(totalLimit * 0.85);
      await store.updateBudget(show.id, savingTokens, 0);
      await orchestrator.checkBudget(show.id);

      // Add more tokens (still in budget_saving range)
      await store.updateBudget(show.id, Math.floor(totalLimit * 0.05), 0);
      await orchestrator.checkBudget(show.id);

      // Should still have only 1 system event (no duplicate for same mode)
      const events = await store.getEvents(show.id);
      const systemEvents = events.filter((e) => e.type === EventType.system);
      expect(systemEvents.length).toBe(1);
    });
  });
});
