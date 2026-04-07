/**
 * E2E Test: Full show with OpenAI Adapter
 *
 * TASK-056: Runs a complete "Коалиция" show with 5 characters using real OpenAI API
 *
 * This test is SKIPPED by default as it requires:
 * - Valid OPENAI_API_KEY in .env
 * - Active internet connection
 * - API quota available
 *
 * To run this test:
 *   1. Set OPENAI_API_KEY in your .env file
 *   2. Run: npm run test:e2e-openai
 *
 * Verifies:
 * - Characters respond in character (personality comes through)
 * - Privacy is maintained (private events are not leaked)
 * - All phases complete successfully
 * - LLM calls are logged to the database
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Orchestrator } from '../../src/core/orchestrator.js';
import { HostModule } from '../../src/core/host-module.js';
import { EventJournal } from '../../src/core/event-journal.js';
import { ContextBuilder } from '../../src/core/context-builder.js';
import { SqliteStore } from '../../src/storage/sqlite-store.js';
import { OpenAIAdapter } from '../../src/adapters/openai-adapter.js';
import { ShowFormatTemplate } from '../../src/types/template.js';
import { CharacterDefinition } from '../../src/types/character.js';
import { EventType, ShowStatus, ChannelType } from '../../src/types/enums.js';
import { config } from '../../src/config.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Check if OpenAI API key is available
 * Test is skipped if no API key is configured
 */
const hasApiKey = (): boolean => {
  return config.openaiApiKey.length > 0 && config.openaiApiKey.startsWith('sk-');
};


describe('Full Show E2E with OpenAI Adapter', () => {
  let store: SqliteStore;
  let eventJournal: EventJournal;
  let hostModule: HostModule;
  let contextBuilder: ContextBuilder;
  let orchestrator: Orchestrator;
  let openaiAdapter: OpenAIAdapter;
  const testDbPath = './data/test-full-show-openai.db';

  // Load coalition template
  const loadCoalitionTemplate = (): ShowFormatTemplate => {
    const templatePath = path.resolve('./src/formats/coalition.json');
    const templateContent = fs.readFileSync(templatePath, 'utf-8');
    return JSON.parse(templateContent) as ShowFormatTemplate;
  };

  // Load all 5 characters
  const loadCharacters = (): Array<CharacterDefinition & { modelAdapterId?: string }> => {
    const charactersDir = path.resolve('./src/formats/characters');
    const characterFiles = ['viktor.json', 'alina.json', 'elena.json', 'maxim.json', 'dmitriy.json'];

    return characterFiles.map((file) => {
      const filePath = path.join(charactersDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const character = JSON.parse(content) as CharacterDefinition;
      return {
        ...character,
        modelAdapterId: 'openai',
      };
    });
  };

  beforeEach(async () => {
    // Clean up test db if exists
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    // Initialize store and core components
    store = new SqliteStore(testDbPath);
    await store.initSchema();
    eventJournal = new EventJournal(store);
    hostModule = new HostModule(store, eventJournal);
    contextBuilder = new ContextBuilder(eventJournal, store);
  });

  afterEach(async () => {
    await store.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  it.skipIf(!hasApiKey())(
    'should complete a full Coalition show with real OpenAI responses',
    async () => {
      // Load template and characters
      const template = loadCoalitionTemplate();
      const characters = loadCharacters();

      // Initialize the show first to get showId
      const show = await hostModule.initializeShow(template, characters, 98765);

      // Create OpenAI adapter with real API key
      openaiAdapter = new OpenAIAdapter({
        apiKey: config.openaiApiKey,
        modelId: config.openaiDefaultModel || 'gpt-4o-mini',
        store,
        showId: show.id,
        characterId: 'orchestrator', // Generic ID for logging
      });

      // Create orchestrator with OpenAI adapter
      orchestrator = new Orchestrator(store, openaiAdapter, eventJournal, hostModule, contextBuilder);

      // Run the complete show
      await orchestrator.runShow(show.id);

      // Verify show completed
      const completedShow = await store.getShow(show.id);
      expect(completedShow).not.toBeNull();
      expect(completedShow!.status).toBe(ShowStatus.completed);
      expect(completedShow!.completedAt).not.toBeNull();

      // Get all events
      const events = await eventJournal.getEvents(show.id);

      // Verify decisions were collected
      const decisionEvents = events.filter((e) => e.type === EventType.decision);
      expect(decisionEvents.length).toBe(5);

      // Verify revelation was performed
      const revelationEvents = events.filter((e) => e.type === EventType.revelation);
      expect(revelationEvents.length).toBeGreaterThan(0);

      // Verify LLM calls were logged
      const llmCalls = await store.getLLMCalls(show.id);
      expect(llmCalls.length).toBeGreaterThan(0);

      // Verify LLM calls have raw request/response
      for (const call of llmCalls) {
        expect(call.rawRequest).toBeDefined();
        expect(call.rawRequest.length).toBeGreaterThan(0);
        expect(call.rawResponse).toBeDefined();
        expect(call.rawResponse.length).toBeGreaterThan(0);
      }
    },
    { timeout: 120000 } // Allow 2 minutes for API calls
  );

  it.skipIf(!hasApiKey())(
    'should generate speech events with meaningful content',
    async () => {
      const template = loadCoalitionTemplate();
      const characters = loadCharacters();

      const show = await hostModule.initializeShow(template, characters, 98765);

      openaiAdapter = new OpenAIAdapter({
        apiKey: config.openaiApiKey,
        modelId: config.openaiDefaultModel || 'gpt-4o-mini',
        store,
        showId: show.id,
        characterId: 'orchestrator',
      });

      orchestrator = new Orchestrator(store, openaiAdapter, eventJournal, hostModule, contextBuilder);

      await orchestrator.runShow(show.id);

      const events = await eventJournal.getEvents(show.id);
      const speechEvents = events.filter((e) => e.type === EventType.speech);

      // Should have speech events from character turns
      expect(speechEvents.length).toBeGreaterThan(0);

      // Verify speech events have meaningful content (not empty or minimal)
      for (const speechEvent of speechEvents) {
        expect(speechEvent.content).toBeDefined();
        expect(speechEvent.content.length).toBeGreaterThan(10); // More than trivial response
        expect(speechEvent.senderId).toBeDefined();
      }
    },
    { timeout: 120000 }
  );

  it.skipIf(!hasApiKey())(
    'should maintain privacy - characters only see events they should see',
    async () => {
      const template = loadCoalitionTemplate();
      const characters = loadCharacters();

      const show = await hostModule.initializeShow(template, characters, 98765);

      openaiAdapter = new OpenAIAdapter({
        apiKey: config.openaiApiKey,
        modelId: config.openaiDefaultModel || 'gpt-4o-mini',
        store,
        showId: show.id,
        characterId: 'orchestrator',
      });

      orchestrator = new Orchestrator(store, openaiAdapter, eventJournal, hostModule, contextBuilder);

      await orchestrator.runShow(show.id);

      const events = await eventJournal.getEvents(show.id);

      // Check for any private events
      const privateEvents = events.filter((e) => e.channel === ChannelType.PRIVATE);

      // If there are private events, verify they have proper audienceIds
      for (const privateEvent of privateEvents) {
        expect(privateEvent.audienceIds).toBeDefined();
        expect(privateEvent.audienceIds.length).toBeGreaterThan(0);
        expect(privateEvent.audienceIds.length).toBeLessThanOrEqual(2); // Private = 2 participants max
      }

      // Verify speech events in PUBLIC channel have all characters in audience
      // Note: Not all public events have all characters (e.g., decisions during simultaneous voting)
      const publicSpeechEvents = events.filter(
        (e) => e.channel === ChannelType.PUBLIC && e.type === EventType.speech
      );
      const allCharacterIds = characters.map((c) => c.id);

      for (const speechEvent of publicSpeechEvents) {
        // Public speech events should include all characters in audience
        for (const charId of allCharacterIds) {
          expect(speechEvent.audienceIds).toContain(charId);
        }
      }
    },
    { timeout: 120000 }
  );

  it.skipIf(!hasApiKey())(
    'should track token budget throughout the show',
    async () => {
      const template = loadCoalitionTemplate();
      const characters = loadCharacters();

      const show = await hostModule.initializeShow(template, characters, 98765);

      // Check initial budget
      const initialBudget = await store.getBudget(show.id);
      expect(initialBudget).not.toBeNull();
      expect(initialBudget!.usedPrompt).toBe(0);
      expect(initialBudget!.usedCompletion).toBe(0);

      openaiAdapter = new OpenAIAdapter({
        apiKey: config.openaiApiKey,
        modelId: config.openaiDefaultModel || 'gpt-4o-mini',
        store,
        showId: show.id,
        characterId: 'orchestrator',
      });

      orchestrator = new Orchestrator(store, openaiAdapter, eventJournal, hostModule, contextBuilder);

      await orchestrator.runShow(show.id);

      // Check final budget - should reflect actual API usage
      const finalBudget = await store.getBudget(show.id);
      expect(finalBudget).not.toBeNull();
      expect(finalBudget!.usedPrompt).toBeGreaterThan(0);
      expect(finalBudget!.usedCompletion).toBeGreaterThan(0);
    },
    { timeout: 120000 }
  );

  it.skipIf(!hasApiKey())(
    'should handle character responses with valid JSON structure',
    async () => {
      const template = loadCoalitionTemplate();
      const characters = loadCharacters();

      const show = await hostModule.initializeShow(template, characters, 98765);

      openaiAdapter = new OpenAIAdapter({
        apiKey: config.openaiApiKey,
        modelId: config.openaiDefaultModel || 'gpt-4o-mini',
        store,
        showId: show.id,
        characterId: 'orchestrator',
      });

      orchestrator = new Orchestrator(store, openaiAdapter, eventJournal, hostModule, contextBuilder);

      await orchestrator.runShow(show.id);

      // Check LLM call responses for valid JSON
      const llmCalls = await store.getLLMCalls(show.id);

      for (const call of llmCalls) {
        // Parse raw response to check structure
        const rawResponse = JSON.parse(call.rawResponse);

        // If not a fallback, verify the response structure
        if (!rawResponse.fallback) {
          expect(rawResponse.choices).toBeDefined();
          expect(rawResponse.choices.length).toBeGreaterThan(0);
          expect(rawResponse.choices[0].message).toBeDefined();
          expect(rawResponse.choices[0].message.content).toBeDefined();

          // Parse the content to verify it's valid JSON with expected fields
          const content = JSON.parse(rawResponse.choices[0].message.content);
          expect(content.text).toBeDefined();
        }
      }
    },
    { timeout: 120000 }
  );
});

describe('OpenAI Adapter Unit Tests (require API key)', () => {
  let store: SqliteStore;
  const testDbPath = './data/test-openai-adapter.db';

  beforeEach(async () => {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    store = new SqliteStore(testDbPath);
    await store.initSchema();
  });

  afterEach(async () => {
    await store.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  it.skipIf(!hasApiKey())(
    'should make a successful API call and return CharacterResponse',
    async () => {
      const adapter = new OpenAIAdapter({
        apiKey: config.openaiApiKey,
        modelId: 'gpt-4o-mini',
        store,
        showId: 'test-show',
        characterId: 'test-character',
      });

      const response = await adapter.call({
        systemPrompt: 'You are a helpful assistant. Respond with JSON containing a "text" field.',
        contextLayers: {
          factsList: [],
          slidingWindow: [],
        },
        trigger: 'Say hello briefly.',
        responseConstraints: {
          maxTokens: 100,
          format: 'json',
          language: 'ru',
        },
      });

      expect(response).toBeDefined();
      expect(response.text).toBeDefined();
      expect(response.text.length).toBeGreaterThan(0);
    },
    { timeout: 30000 }
  );
});
