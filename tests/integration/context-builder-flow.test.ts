/**
 * Integration Test: ContextBuilder + EventJournal + MockAdapter
 *
 * TASK-063: Tests context building with real components
 *
 * Verifies:
 * - buildPromptPackage uses real events from EventJournal
 * - trimToTokenBudget trims real PromptPackage using MockAdapter.estimateTokens()
 * - Private events (channel='PRIVATE') are correctly filtered in context
 * - Sliding window trims old events when budget exceeded
 * - factsList is NEVER trimmed during budget trimming
 * - No mocks for EventJournal - events are written and read from real DB
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ContextBuilder } from '../../src/core/context-builder.js';
import { EventJournal } from '../../src/core/event-journal.js';
import { SqliteStore } from '../../src/storage/sqlite-store.js';
import { MockAdapter } from '../../src/adapters/mock-adapter.js';
import { CharacterDefinition } from '../../src/types/character.js';
import { Show } from '../../src/types/runtime.js';
import { EventType, ChannelType, ShowStatus, SpeakFrequency } from '../../src/types/enums.js';
import * as fs from 'fs';

describe('Integration: ContextBuilder + EventJournal + MockAdapter', () => {
  let store: SqliteStore;
  let eventJournal: EventJournal;
  let contextBuilder: ContextBuilder;
  let mockAdapter: MockAdapter;
  const testDbPath = './data/test-context-builder-flow.db';

  // Test character with full private context
  const createTestCharacter = (id: string, name: string): CharacterDefinition => ({
    id,
    name,
    publicCard: `${name} is a test character.`,
    personalityPrompt: `You are ${name}, a thoughtful participant.`,
    motivationPrompt: `Your goal is to win the game.`,
    boundaryRules: ['Never lie directly', 'Always be polite'],
    startingPrivateContext: {
      secrets: [`${name}'s secret: knows the truth`],
      alliances: [
        {
          partnerId: id === 'char-alice' ? 'char-bob' : 'char-alice',
          agreement: 'Support each other in votes',
          isActive: true,
        },
      ],
      goals: [`Win the show`, `Form alliances`],
      wildcards: [
        { content: `${name} has a hidden advantage`, isRevealed: false },
      ],
    },
    speakFrequency: SpeakFrequency.medium,
    responseConstraints: {
      maxTokens: 200,
      format: 'structured',
      language: 'ru',
    },
  });

  // Test show with config snapshot
  const createTestShow = (showId: string): Show => ({
    id: showId,
    formatId: 'test-format',
    seed: 42,
    status: ShowStatus.running,
    currentPhaseId: 'phase-1',
    startedAt: new Date(),
    completedAt: null,
    configSnapshot: {
      contextWindowSize: 10,
    } as unknown as Show['configSnapshot'],
  });

  beforeEach(async () => {
    // Clean up test db if exists
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    // Initialize real components (no mocks)
    store = new SqliteStore(testDbPath);
    await store.initSchema();
    eventJournal = new EventJournal(store);
    contextBuilder = new ContextBuilder(eventJournal, store);
    mockAdapter = new MockAdapter(42);
  });

  afterEach(async () => {
    await store.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('buildPromptPackage with real events from EventJournal', () => {
    it('should build PromptPackage using events from real EventJournal', async () => {
      const showId = 'show-1';
      const character = createTestCharacter('char-alice', 'Alice');
      const show = createTestShow(showId);

      // Create show and character in store
      await store.createShow({
        id: showId,
        formatId: 'test-format',
        seed: '42',
        status: ShowStatus.running,
        currentPhaseId: 'phase-1',
        startedAt: Date.now(),
        completedAt: null,
        configSnapshot: JSON.stringify(show.configSnapshot),
        replayAvailable: false,
      });

      await store.createCharacter({
        showId,
        characterId: 'char-alice',
        modelAdapterId: 'mock',
        privateContext: character.startingPrivateContext,
        speakFrequency: 'medium',
      });

      // Write real events through EventJournal
      await eventJournal.append({
        id: 'event-1',
        showId,
        timestamp: Date.now(),
        phaseId: 'phase-1',
        type: EventType.speech,
        channel: ChannelType.PUBLIC,
        visibility: ChannelType.PUBLIC,
        senderId: 'char-bob',
        receiverIds: [],
        audienceIds: ['char-alice', 'char-bob', 'char-carol'],
        content: 'Hello everyone!',
        metadata: {},
        seed: '42',
      });

      await eventJournal.append({
        id: 'event-2',
        showId,
        timestamp: Date.now(),
        phaseId: 'phase-1',
        type: EventType.speech,
        channel: ChannelType.PUBLIC,
        visibility: ChannelType.PUBLIC,
        senderId: 'char-carol',
        receiverIds: [],
        audienceIds: ['char-alice', 'char-bob', 'char-carol'],
        content: 'Nice to meet you all!',
        metadata: {},
        seed: '42',
      });

      // Build prompt package
      const pkg = await contextBuilder.buildPromptPackage(
        character,
        show,
        'What do you think about the situation?'
      );

      // Verify system prompt contains personality
      expect(pkg.systemPrompt).toContain('Alice');
      expect(pkg.systemPrompt).toContain('thoughtful participant');
      expect(pkg.systemPrompt).toContain('Personality');
      expect(pkg.systemPrompt).toContain('Motivation');

      // Verify factsList contains private context
      expect(pkg.contextLayers.factsList.length).toBeGreaterThan(0);
      expect(pkg.contextLayers.factsList.some((f) => f.includes('[Secret]'))).toBe(true);
      expect(pkg.contextLayers.factsList.some((f) => f.includes('[Goal]'))).toBe(true);
      expect(pkg.contextLayers.factsList.some((f) => f.includes('[Alliance]'))).toBe(true);
      expect(pkg.contextLayers.factsList.some((f) => f.includes('[Wildcard]'))).toBe(true);

      // Verify sliding window contains events from journal
      expect(pkg.contextLayers.slidingWindow.length).toBe(2);
      expect(pkg.contextLayers.slidingWindow[0]!.content).toBe('Hello everyone!');
      expect(pkg.contextLayers.slidingWindow[1]!.content).toBe('Nice to meet you all!');

      // Verify trigger
      expect(pkg.trigger).toBe('What do you think about the situation?');

      // Verify response constraints from character definition
      expect(pkg.responseConstraints.maxTokens).toBe(200);
      expect(pkg.responseConstraints.format).toBe('structured');
    });

    it('should include revealed wildcards from journal events', async () => {
      const showId = 'show-reveal';
      const character = createTestCharacter('char-alice', 'Alice');
      const show = createTestShow(showId);

      await store.createShow({
        id: showId,
        formatId: 'test-format',
        seed: '42',
        status: ShowStatus.running,
        currentPhaseId: 'phase-1',
        startedAt: Date.now(),
        completedAt: null,
        configSnapshot: JSON.stringify(show.configSnapshot),
        replayAvailable: false,
      });

      await store.createCharacter({
        showId,
        characterId: 'char-alice',
        modelAdapterId: 'mock',
        privateContext: character.startingPrivateContext,
        speakFrequency: 'medium',
      });

      // Write a revelation event from another character
      await eventJournal.append({
        id: 'event-reveal',
        showId,
        timestamp: Date.now(),
        phaseId: 'phase-1',
        type: EventType.revelation,
        channel: ChannelType.PUBLIC,
        visibility: ChannelType.PUBLIC,
        senderId: 'char-bob',
        receiverIds: [],
        audienceIds: ['char-alice', 'char-bob', 'char-carol'],
        content: 'I reveal my secret power!',
        metadata: {},
        seed: '42',
      });

      const pkg = await contextBuilder.buildPromptPackage(
        character,
        show,
        'React to the revelation'
      );

      // Verify revealed wildcard appears in facts
      expect(pkg.contextLayers.factsList.some((f) => f.includes('[Revealed by char-bob]'))).toBe(
        true
      );
      expect(pkg.contextLayers.factsList.some((f) => f.includes('secret power'))).toBe(true);
    });
  });

  describe('trimToTokenBudget with MockAdapter.estimateTokens()', () => {
    it('should trim slidingWindow when exceeding token budget', async () => {
      const showId = 'show-trim';
      const character = createTestCharacter('char-alice', 'Alice');
      const show = createTestShow(showId);

      await store.createShow({
        id: showId,
        formatId: 'test-format',
        seed: '42',
        status: ShowStatus.running,
        currentPhaseId: 'phase-1',
        startedAt: Date.now(),
        completedAt: null,
        configSnapshot: JSON.stringify(show.configSnapshot),
        replayAvailable: false,
      });

      await store.createCharacter({
        showId,
        characterId: 'char-alice',
        modelAdapterId: 'mock',
        privateContext: character.startingPrivateContext,
        speakFrequency: 'medium',
      });

      // Add many events to create a large sliding window
      for (let i = 1; i <= 20; i++) {
        await eventJournal.append({
          id: `event-${i}`,
          showId,
          timestamp: Date.now() + i,
          phaseId: 'phase-1',
          type: EventType.speech,
          channel: ChannelType.PUBLIC,
          visibility: ChannelType.PUBLIC,
          senderId: i % 2 === 0 ? 'char-bob' : 'char-carol',
          receiverIds: [],
          audienceIds: ['char-alice', 'char-bob', 'char-carol'],
          content: `This is message number ${i} with some additional text to increase token count significantly.`,
          metadata: {},
          seed: '42',
        });
      }

      // Build prompt package (will have 10 events due to contextWindowSize)
      const pkg = await contextBuilder.buildPromptPackage(
        character,
        show,
        'What do you think?'
      );

      expect(pkg.contextLayers.slidingWindow.length).toBe(10);

      // Get initial estimate
      const initialEstimate = mockAdapter.estimateTokens(pkg);
      const initialTotal = initialEstimate.prompt + initialEstimate.estimatedCompletion;

      // Calculate base tokens (without sliding window) to ensure budget allows some trimming
      const emptyWindowPkg = {
        ...pkg,
        contextLayers: {
          ...pkg.contextLayers,
          slidingWindow: [],
        },
      };
      const baseEstimate = mockAdapter.estimateTokens(emptyWindowPkg);
      const baseTotal = baseEstimate.prompt + baseEstimate.estimatedCompletion;

      // Set budget between base and initial to allow partial trimming
      const maxTokens = Math.floor((baseTotal + initialTotal) / 2);
      const trimmedPkg = contextBuilder.trimToTokenBudget(pkg, maxTokens, mockAdapter);

      // Verify sliding window was trimmed but not empty
      expect(trimmedPkg.contextLayers.slidingWindow.length).toBeLessThan(10);
      expect(trimmedPkg.contextLayers.slidingWindow.length).toBeGreaterThan(0);

      // Verify trimmed package fits within budget
      const trimmedEstimate = mockAdapter.estimateTokens(trimmedPkg);
      const trimmedTotal = trimmedEstimate.prompt + trimmedEstimate.estimatedCompletion;
      expect(trimmedTotal).toBeLessThanOrEqual(maxTokens);
    });

    it('should NEVER trim factsList when trimming to budget', async () => {
      const showId = 'show-facts';
      const character = createTestCharacter('char-alice', 'Alice');
      const show = createTestShow(showId);

      await store.createShow({
        id: showId,
        formatId: 'test-format',
        seed: '42',
        status: ShowStatus.running,
        currentPhaseId: 'phase-1',
        startedAt: Date.now(),
        completedAt: null,
        configSnapshot: JSON.stringify(show.configSnapshot),
        replayAvailable: false,
      });

      await store.createCharacter({
        showId,
        characterId: 'char-alice',
        modelAdapterId: 'mock',
        privateContext: character.startingPrivateContext,
        speakFrequency: 'medium',
      });

      // Add events
      for (let i = 1; i <= 5; i++) {
        await eventJournal.append({
          id: `event-${i}`,
          showId,
          timestamp: Date.now() + i,
          phaseId: 'phase-1',
          type: EventType.speech,
          channel: ChannelType.PUBLIC,
          visibility: ChannelType.PUBLIC,
          senderId: 'char-bob',
          receiverIds: [],
          audienceIds: ['char-alice', 'char-bob', 'char-carol'],
          content: `Message ${i}`,
          metadata: {},
          seed: '42',
        });
      }

      const pkg = await contextBuilder.buildPromptPackage(
        character,
        show,
        'What do you think?'
      );

      const originalFactsLength = pkg.contextLayers.factsList.length;
      expect(originalFactsLength).toBeGreaterThan(0);

      // Trim to very tight budget
      const trimmedPkg = contextBuilder.trimToTokenBudget(pkg, 100, mockAdapter);

      // Facts list must remain intact
      expect(trimmedPkg.contextLayers.factsList.length).toBe(originalFactsLength);
      expect(trimmedPkg.contextLayers.factsList).toEqual(pkg.contextLayers.factsList);
    });

    it('should not modify package if already within budget', async () => {
      const showId = 'show-ok';
      const character = createTestCharacter('char-alice', 'Alice');
      const show = createTestShow(showId);

      await store.createShow({
        id: showId,
        formatId: 'test-format',
        seed: '42',
        status: ShowStatus.running,
        currentPhaseId: 'phase-1',
        startedAt: Date.now(),
        completedAt: null,
        configSnapshot: JSON.stringify(show.configSnapshot),
        replayAvailable: false,
      });

      await store.createCharacter({
        showId,
        characterId: 'char-alice',
        modelAdapterId: 'mock',
        privateContext: character.startingPrivateContext,
        speakFrequency: 'medium',
      });

      await eventJournal.append({
        id: 'event-1',
        showId,
        timestamp: Date.now(),
        phaseId: 'phase-1',
        type: EventType.speech,
        channel: ChannelType.PUBLIC,
        visibility: ChannelType.PUBLIC,
        senderId: 'char-bob',
        receiverIds: [],
        audienceIds: ['char-alice', 'char-bob', 'char-carol'],
        content: 'Short message',
        metadata: {},
        seed: '42',
      });

      const pkg = await contextBuilder.buildPromptPackage(
        character,
        show,
        'Quick question?'
      );

      // Use a very large budget
      const trimmedPkg = contextBuilder.trimToTokenBudget(pkg, 10000, mockAdapter);

      // Should remain unchanged
      expect(trimmedPkg.contextLayers.slidingWindow.length).toBe(
        pkg.contextLayers.slidingWindow.length
      );
      expect(trimmedPkg.contextLayers.factsList.length).toBe(pkg.contextLayers.factsList.length);
    });
  });

  describe('Privacy: events with channel=PRIVATE filtered correctly', () => {
    it('should exclude private events not visible to character from context', async () => {
      const showId = 'show-private';
      const character = createTestCharacter('char-alice', 'Alice');
      const show = createTestShow(showId);

      await store.createShow({
        id: showId,
        formatId: 'test-format',
        seed: '42',
        status: ShowStatus.running,
        currentPhaseId: 'phase-1',
        startedAt: Date.now(),
        completedAt: null,
        configSnapshot: JSON.stringify(show.configSnapshot),
        replayAvailable: false,
      });

      await store.createCharacter({
        showId,
        characterId: 'char-alice',
        modelAdapterId: 'mock',
        privateContext: character.startingPrivateContext,
        speakFrequency: 'medium',
      });

      // Public event - visible to all
      await eventJournal.append({
        id: 'event-public',
        showId,
        timestamp: Date.now(),
        phaseId: 'phase-1',
        type: EventType.speech,
        channel: ChannelType.PUBLIC,
        visibility: ChannelType.PUBLIC,
        senderId: 'char-bob',
        receiverIds: [],
        audienceIds: ['char-alice', 'char-bob', 'char-carol'],
        content: 'Public message visible to all',
        metadata: {},
        seed: '42',
      });

      // Private event between Bob and Carol - NOT visible to Alice
      await eventJournal.append({
        id: 'event-private-bc',
        showId,
        timestamp: Date.now() + 1,
        phaseId: 'phase-1',
        type: EventType.speech,
        channel: ChannelType.PRIVATE,
        visibility: ChannelType.PRIVATE,
        senderId: 'char-bob',
        receiverIds: ['char-carol'],
        audienceIds: ['char-bob', 'char-carol'], // Alice NOT in audience
        content: 'Secret between Bob and Carol',
        metadata: {},
        seed: '42',
      });

      // Private event with Alice - visible to Alice
      await eventJournal.append({
        id: 'event-private-ab',
        showId,
        timestamp: Date.now() + 2,
        phaseId: 'phase-1',
        type: EventType.speech,
        channel: ChannelType.PRIVATE,
        visibility: ChannelType.PRIVATE,
        senderId: 'char-bob',
        receiverIds: ['char-alice'],
        audienceIds: ['char-alice', 'char-bob'], // Alice IS in audience
        content: 'Private message to Alice',
        metadata: {},
        seed: '42',
      });

      const pkg = await contextBuilder.buildPromptPackage(
        character,
        show,
        'What do you know?'
      );

      // Should have 2 events: public + private with Alice
      expect(pkg.contextLayers.slidingWindow.length).toBe(2);

      // Verify content
      const contents = pkg.contextLayers.slidingWindow.map((e) => e.content);
      expect(contents).toContain('Public message visible to all');
      expect(contents).toContain('Private message to Alice');
      expect(contents).not.toContain('Secret between Bob and Carol');
    });

    it('should include own private messages in context', async () => {
      const showId = 'show-own-private';
      const character = createTestCharacter('char-alice', 'Alice');
      const show = createTestShow(showId);

      await store.createShow({
        id: showId,
        formatId: 'test-format',
        seed: '42',
        status: ShowStatus.running,
        currentPhaseId: 'phase-1',
        startedAt: Date.now(),
        completedAt: null,
        configSnapshot: JSON.stringify(show.configSnapshot),
        replayAvailable: false,
      });

      await store.createCharacter({
        showId,
        characterId: 'char-alice',
        modelAdapterId: 'mock',
        privateContext: character.startingPrivateContext,
        speakFrequency: 'medium',
      });

      // Alice sends private message to Bob
      await eventJournal.append({
        id: 'event-alice-private',
        showId,
        timestamp: Date.now(),
        phaseId: 'phase-1',
        type: EventType.speech,
        channel: ChannelType.PRIVATE,
        visibility: ChannelType.PRIVATE,
        senderId: 'char-alice',
        receiverIds: ['char-bob'],
        audienceIds: ['char-alice', 'char-bob'],
        content: 'Alice whispers to Bob',
        metadata: {},
        seed: '42',
      });

      const pkg = await contextBuilder.buildPromptPackage(
        character,
        show,
        'Continue?'
      );

      expect(pkg.contextLayers.slidingWindow.length).toBe(1);
      expect(pkg.contextLayers.slidingWindow[0]!.content).toBe('Alice whispers to Bob');
      expect(pkg.contextLayers.slidingWindow[0]!.channel).toBe(ChannelType.PRIVATE);
    });
  });

  describe('Sliding window: old events trimmed when budget exceeded', () => {
    it('should keep most recent events when sliding window is trimmed', async () => {
      const showId = 'show-window';
      const character = createTestCharacter('char-alice', 'Alice');
      const show = createTestShow(showId);

      await store.createShow({
        id: showId,
        formatId: 'test-format',
        seed: '42',
        status: ShowStatus.running,
        currentPhaseId: 'phase-1',
        startedAt: Date.now(),
        completedAt: null,
        configSnapshot: JSON.stringify(show.configSnapshot),
        replayAvailable: false,
      });

      await store.createCharacter({
        showId,
        characterId: 'char-alice',
        modelAdapterId: 'mock',
        privateContext: character.startingPrivateContext,
        speakFrequency: 'medium',
      });

      // Create events with distinct content
      const eventContents = ['First message', 'Second message', 'Third message', 'Fourth message', 'Fifth message'];
      for (let i = 0; i < eventContents.length; i++) {
        await eventJournal.append({
          id: `event-${i + 1}`,
          showId,
          timestamp: Date.now() + i,
          phaseId: 'phase-1',
          type: EventType.speech,
          channel: ChannelType.PUBLIC,
          visibility: ChannelType.PUBLIC,
          senderId: 'char-bob',
          receiverIds: [],
          audienceIds: ['char-alice', 'char-bob', 'char-carol'],
          content: eventContents[i]!,
          metadata: {},
          seed: '42',
        });
      }

      const pkg = await contextBuilder.buildPromptPackage(
        character,
        show,
        'What do you think?'
      );

      expect(pkg.contextLayers.slidingWindow.length).toBe(5);

      // Calculate base tokens (without sliding window)
      const emptyWindowPkg = {
        ...pkg,
        contextLayers: {
          ...pkg.contextLayers,
          slidingWindow: [],
        },
      };
      const baseEstimate = mockAdapter.estimateTokens(emptyWindowPkg);
      const baseTotal = baseEstimate.prompt + baseEstimate.estimatedCompletion;

      const fullEstimate = mockAdapter.estimateTokens(pkg);
      const fullTotal = fullEstimate.prompt + fullEstimate.estimatedCompletion;

      // Set budget to allow only 2-3 events (between base and full)
      const tightBudget = baseTotal + Math.floor((fullTotal - baseTotal) * 0.5);
      const trimmedPkg = contextBuilder.trimToTokenBudget(pkg, tightBudget, mockAdapter);

      // Verify oldest events were removed (trimmed from beginning)
      const trimmedContents = trimmedPkg.contextLayers.slidingWindow.map((e) => e.content);

      // Some events should remain
      expect(trimmedPkg.contextLayers.slidingWindow.length).toBeGreaterThan(0);
      expect(trimmedPkg.contextLayers.slidingWindow.length).toBeLessThan(5);

      // Most recent events should be kept (trimming happens from beginning)
      expect(trimmedContents).toContain('Fifth message');

      // Old events should be gone
      expect(trimmedContents).not.toContain('First message');
    });

    it('should respect contextWindowSize from show config', async () => {
      const showId = 'show-config-window';
      const character = createTestCharacter('char-alice', 'Alice');
      // Create show with small window size
      const show: Show = {
        id: showId,
        formatId: 'test-format',
        seed: 42,
        status: ShowStatus.running,
        currentPhaseId: 'phase-1',
        startedAt: new Date(),
        completedAt: null,
        configSnapshot: {
          contextWindowSize: 3, // Only 3 events
        } as unknown as Show['configSnapshot'],
      };

      await store.createShow({
        id: showId,
        formatId: 'test-format',
        seed: '42',
        status: ShowStatus.running,
        currentPhaseId: 'phase-1',
        startedAt: Date.now(),
        completedAt: null,
        configSnapshot: JSON.stringify(show.configSnapshot),
        replayAvailable: false,
      });

      await store.createCharacter({
        showId,
        characterId: 'char-alice',
        modelAdapterId: 'mock',
        privateContext: character.startingPrivateContext,
        speakFrequency: 'medium',
      });

      // Add more events than window allows
      for (let i = 1; i <= 10; i++) {
        await eventJournal.append({
          id: `event-${i}`,
          showId,
          timestamp: Date.now() + i,
          phaseId: 'phase-1',
          type: EventType.speech,
          channel: ChannelType.PUBLIC,
          visibility: ChannelType.PUBLIC,
          senderId: 'char-bob',
          receiverIds: [],
          audienceIds: ['char-alice', 'char-bob', 'char-carol'],
          content: `Message ${i}`,
          metadata: {},
          seed: '42',
        });
      }

      const pkg = await contextBuilder.buildPromptPackage(
        character,
        show,
        'What do you think?'
      );

      // Should only have 3 events (contextWindowSize)
      expect(pkg.contextLayers.slidingWindow.length).toBe(3);

      // Should be the most recent ones
      const contents = pkg.contextLayers.slidingWindow.map((e) => e.content);
      expect(contents).toContain('Message 10');
      expect(contents).toContain('Message 9');
      expect(contents).toContain('Message 8');
    });
  });
});
