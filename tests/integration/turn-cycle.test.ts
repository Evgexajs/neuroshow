/**
 * Integration Test: Full Turn Cycle
 *
 * TASK-064: Tests complete character turn pipeline
 *
 * Verifies:
 * - Full turn: HostModule -> ContextBuilder -> MockAdapter -> EventJournal -> SqliteStore
 * - Prompt is assembled from previous show events
 * - Adapter response is parsed and saved as event
 * - llm_call is recorded in DB with raw_request/raw_response
 * - Multiple turns: second turn sees first turn event in context
 * - Private channel: private response not visible to other characters in next turn
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HostModule } from '../../src/core/host-module.js';
import { ContextBuilder } from '../../src/core/context-builder.js';
import { EventJournal } from '../../src/core/event-journal.js';
import { SqliteStore } from '../../src/storage/sqlite-store.js';
import { MockAdapter } from '../../src/adapters/mock-adapter.js';
import { ShowFormatTemplate } from '../../src/types/template.js';
import { CharacterDefinition } from '../../src/types/character.js';
import { Show } from '../../src/types/runtime.js';
import { EventType, ChannelType, SpeakFrequency, PhaseType } from '../../src/types/enums.js';
import { LlmCallRecord } from '../../src/types/interfaces/store.interface.js';
import { generateId } from '../../src/utils/id.js';
import * as fs from 'fs';

describe('Integration: Full Turn Cycle', () => {
  let store: SqliteStore;
  let eventJournal: EventJournal;
  let hostModule: HostModule;
  let contextBuilder: ContextBuilder;
  let mockAdapter: MockAdapter;
  const testDbPath = './data/test-turn-cycle.db';

  // Test template
  const createTestTemplate = (): ShowFormatTemplate => ({
    id: 'test-format',
    name: 'Test Format',
    description: 'Test format for turn cycle tests',
        minParticipants: 2,
    maxParticipants: 4,
    contextWindowSize: 50,
    phases: [
      {
        id: 'phase-1',
        name: 'Discussion Phase',
        type: PhaseType.discussion,
        durationMode: 'turns',
        durationValue: 10,
        turnOrder: 'sequential',
        allowedChannels: [ChannelType.PUBLIC, ChannelType.PRIVATE],
        triggerTemplate: 'Welcome to the discussion!',
        completionCondition: 'turns_completed',
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
      initiator: 'host_only',
      maxPrivatesPerPhase: 3,
      maxPrivatesPerCharacterPerPhase: 2,
      requestQueueMode: 'fifo',
      requestFormat: 'public_ask',
    },
    channelTypes: [ChannelType.PUBLIC, ChannelType.PRIVATE],
  });

  // Test characters
  const createTestCharacters = (): Array<CharacterDefinition & { modelAdapterId?: string }> => [
    {
      id: 'char-alice',
      name: 'Alice',
      publicCard: 'Alice is a friendly character.',
      personalityPrompt: 'You are Alice, friendly and helpful.',
      motivationPrompt: 'You want to make friends.',
      boundaryRules: ['Be polite'],
      speakFrequency: SpeakFrequency.high,
      responseConstraints: { maxTokens: 100, format: 'structured', language: 'ru' },
      startingPrivateContext: {
        secrets: ['Alice knows the secret code'],
        alliances: [],
        goals: ['Win the game'],
        wildcards: [],
      },
      modelAdapterId: 'mock',
    },
    {
      id: 'char-bob',
      name: 'Bob',
      publicCard: 'Bob is a thoughtful character.',
      personalityPrompt: 'You are Bob, thoughtful and analytical.',
      motivationPrompt: 'You seek truth.',
      boundaryRules: ['Be honest'],
      speakFrequency: SpeakFrequency.medium,
      responseConstraints: { maxTokens: 100, format: 'structured', language: 'ru' },
      startingPrivateContext: {
        secrets: ['Bob has a hidden agenda'],
        alliances: [],
        goals: ['Uncover the truth'],
        wildcards: [],
      },
      modelAdapterId: 'mock',
    },
    {
      id: 'char-carol',
      name: 'Carol',
      publicCard: 'Carol is a quiet observer.',
      personalityPrompt: 'You are Carol, observant and cautious.',
      motivationPrompt: 'You prefer to watch.',
      boundaryRules: ['Stay calm'],
      speakFrequency: SpeakFrequency.low,
      responseConstraints: { maxTokens: 100, format: 'structured', language: 'ru' },
      startingPrivateContext: {
        secrets: ['Carol knows who the traitor is'],
        alliances: [],
        goals: ['Survive'],
        wildcards: [],
      },
      modelAdapterId: 'mock',
    },
  ];

  beforeEach(async () => {
    // Clean up test db
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    // Initialize components
    store = new SqliteStore(testDbPath);
    await store.initSchema();
    eventJournal = new EventJournal(store);
    hostModule = new HostModule(store, eventJournal);
    contextBuilder = new ContextBuilder(eventJournal, store);
    mockAdapter = new MockAdapter(42);
  });

  afterEach(async () => {
    await store.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  /**
   * Helper: Execute a full character turn
   * Returns the created speech event and LLM call record
   */
  async function executeCharacterTurn(
    show: Show,
    characterDef: CharacterDefinition,
    trigger: string,
    channel: ChannelType = ChannelType.PUBLIC,
    audienceIds?: string[]
  ): Promise<{ eventId: string; llmCallId: string }> {
    const phaseId = show.currentPhaseId ?? 'phase-1';

    // 1. Build prompt package using ContextBuilder
    const promptPackage = await contextBuilder.buildPromptPackage(characterDef, show, trigger);

    // 2. Call MockAdapter to get response
    const response = await mockAdapter.call(promptPackage);

    // 3. Log LLM call to database (simulating what OpenAIAdapter does)
    const llmCallId = generateId();
    const tokenEstimate = mockAdapter.estimateTokens(promptPackage);
    const llmCallRecord: LlmCallRecord = {
      id: llmCallId,
      eventId: null, // Will be updated after event is created
      showId: show.id,
      characterId: characterDef.id,
      modelAdapterId: `${mockAdapter.providerId}/${mockAdapter.modelId}`,
      promptTokens: tokenEstimate.prompt,
      completionTokens: tokenEstimate.estimatedCompletion,
      rawRequest: JSON.stringify(promptPackage),
      rawResponse: JSON.stringify(response),
      latencyMs: 50,
      createdAt: Date.now(),
    };
    await store.logLLMCall(llmCallRecord);

    // 4. Create speech event from response and save to EventJournal
    const eventId = generateId();
    const characters = await store.getCharacters(show.id);
    const allCharacterIds = characters.map((c) => c.characterId);
    const eventAudienceIds = audienceIds ?? allCharacterIds;

    await eventJournal.append({
      id: eventId,
      showId: show.id,
      timestamp: Date.now(),
      phaseId,
      type: EventType.speech,
      channel,
      visibility: channel,
      senderId: characterDef.id,
      receiverIds: channel === ChannelType.PRIVATE ? eventAudienceIds : [],
      audienceIds: eventAudienceIds,
      content: response.text,
      metadata: {
        intent: response.intent,
        llmCallId,
      },
      seed: String(show.seed),
    });

    return { eventId, llmCallId };
  }

  describe('Full Turn: HostModule -> ContextBuilder -> MockAdapter -> EventJournal -> SqliteStore', () => {
    it('should complete full turn cycle and save all data to SqliteStore', async () => {
      const template = createTestTemplate();
      const characters = createTestCharacters();

      // Initialize show through HostModule
      const show = await hostModule.initializeShow(template, characters, 42);
      expect(show.id).toBeDefined();

      // Emit initial trigger
      await hostModule.emitTrigger(show.id, 'phase-1', 'Welcome everyone!');

      // Execute full turn for Alice
      const aliceDef = characters[0]!;
      const { eventId, llmCallId } = await executeCharacterTurn(
        show,
        aliceDef,
        'What do you think about the situation?'
      );

      // Verify event was saved to SqliteStore
      const events = await store.getEvents(show.id);
      expect(events.length).toBe(2); // host_trigger + speech
      const speechEvent = events.find((e) => e.type === EventType.speech);
      expect(speechEvent).toBeDefined();
      expect(speechEvent!.id).toBe(eventId);
      expect(speechEvent!.senderId).toBe('char-alice');
      expect(speechEvent!.content).toBeTruthy();

      // Verify LLM call was logged
      const llmCalls = await store.getLLMCalls(show.id);
      expect(llmCalls.length).toBe(1);
      expect(llmCalls[0]!.id).toBe(llmCallId);
      expect(llmCalls[0]!.characterId).toBe('char-alice');
    });
  });

  describe('Prompt Assembly from Previous Events', () => {
    it('should build prompt containing previous show events', async () => {
      const template = createTestTemplate();
      const characters = createTestCharacters();

      const show = await hostModule.initializeShow(template, characters, 42);

      // Create some history events
      await eventJournal.append({
        id: 'event-history-1',
        showId: show.id,
        timestamp: Date.now(),
        phaseId: 'phase-1',
        type: EventType.host_trigger,
        channel: ChannelType.PUBLIC,
        visibility: ChannelType.PUBLIC,
        senderId: '',
        receiverIds: [],
        audienceIds: ['char-alice', 'char-bob', 'char-carol'],
        content: 'Welcome to the show!',
        metadata: {},
        seed: '42',
      });

      await eventJournal.append({
        id: 'event-history-2',
        showId: show.id,
        timestamp: Date.now() + 1,
        phaseId: 'phase-1',
        type: EventType.speech,
        channel: ChannelType.PUBLIC,
        visibility: ChannelType.PUBLIC,
        senderId: 'char-bob',
        receiverIds: [],
        audienceIds: ['char-alice', 'char-bob', 'char-carol'],
        content: 'Hello everyone, I am Bob!',
        metadata: {},
        seed: '42',
      });

      // Build prompt for Alice
      const aliceDef = characters[0]!;
      const promptPackage = await contextBuilder.buildPromptPackage(
        aliceDef,
        show,
        'Your turn to speak'
      );

      // Verify sliding window contains previous events
      expect(promptPackage.contextLayers.slidingWindow.length).toBe(2);
      expect(promptPackage.contextLayers.slidingWindow[0]!.content).toBe('Welcome to the show!');
      expect(promptPackage.contextLayers.slidingWindow[1]!.content).toBe('Hello everyone, I am Bob!');

      // Verify facts list contains Alice's private context
      expect(promptPackage.contextLayers.factsList.some((f) => f.includes('secret code'))).toBe(true);
      expect(promptPackage.contextLayers.factsList.some((f) => f.includes('Win the game'))).toBe(true);
    });
  });

  describe('Adapter Response Parsing and Event Saving', () => {
    it('should parse adapter response and save as event with correct metadata', async () => {
      const template = createTestTemplate();
      const characters = createTestCharacters();

      const show = await hostModule.initializeShow(template, characters, 42);
      const bobDef = characters[1]!;

      // Execute turn for Bob
      const { eventId } = await executeCharacterTurn(show, bobDef, 'What is your opinion?');

      // Verify event was saved correctly
      const events = await store.getEvents(show.id);
      const bobEvent = events.find((e) => e.id === eventId);
      expect(bobEvent).toBeDefined();
      expect(bobEvent!.senderId).toBe('char-bob');
      expect(bobEvent!.type).toBe(EventType.speech);
      expect(bobEvent!.content).toBeTruthy();

      // Verify metadata contains intent from response
      expect(bobEvent!.metadata).toBeDefined();
      expect(bobEvent!.metadata.llmCallId).toBeDefined();
    });
  });

  describe('LLM Call Recording with raw_request/raw_response', () => {
    it('should record llm_call with raw_request containing PromptPackage', async () => {
      const template = createTestTemplate();
      const characters = createTestCharacters();

      const show = await hostModule.initializeShow(template, characters, 42);
      const aliceDef = characters[0]!;

      // Execute turn
      const { llmCallId } = await executeCharacterTurn(show, aliceDef, 'Tell me something');

      // Get LLM call record
      const llmCalls = await store.getLLMCalls(show.id);
      const llmCall = llmCalls.find((c) => c.id === llmCallId);
      expect(llmCall).toBeDefined();

      // Verify raw_request contains PromptPackage structure
      const rawRequest = JSON.parse(llmCall!.rawRequest);
      expect(rawRequest.systemPrompt).toBeDefined();
      expect(rawRequest.contextLayers).toBeDefined();
      expect(rawRequest.contextLayers.factsList).toBeDefined();
      expect(rawRequest.contextLayers.slidingWindow).toBeDefined();
      expect(rawRequest.trigger).toBe('Tell me something');
      expect(rawRequest.responseConstraints).toBeDefined();
    });

    it('should record llm_call with raw_response containing CharacterResponse', async () => {
      const template = createTestTemplate();
      const characters = createTestCharacters();

      const show = await hostModule.initializeShow(template, characters, 42);
      const bobDef = characters[1]!;

      // Execute turn
      const { llmCallId } = await executeCharacterTurn(show, bobDef, 'Share your thoughts');

      // Get LLM call record
      const llmCalls = await store.getLLMCalls(show.id);
      const llmCall = llmCalls.find((c) => c.id === llmCallId);
      expect(llmCall).toBeDefined();

      // Verify raw_response contains CharacterResponse structure
      const rawResponse = JSON.parse(llmCall!.rawResponse);
      expect(rawResponse.text).toBeDefined();
      expect(typeof rawResponse.text).toBe('string');
      // intent is optional but should be present from MockAdapter
      expect(rawResponse.intent).toBeDefined();
    });

    it('should record token counts in llm_call', async () => {
      const template = createTestTemplate();
      const characters = createTestCharacters();

      const show = await hostModule.initializeShow(template, characters, 42);
      const carolDef = characters[2]!;

      // Execute turn
      const { llmCallId } = await executeCharacterTurn(show, carolDef, 'Your turn Carol');

      // Get LLM call record
      const llmCalls = await store.getLLMCalls(show.id);
      const llmCall = llmCalls.find((c) => c.id === llmCallId);
      expect(llmCall).toBeDefined();

      // Verify token counts
      expect(llmCall!.promptTokens).toBeGreaterThan(0);
      expect(llmCall!.completionTokens).toBeGreaterThan(0);
      expect(llmCall!.latencyMs).toBeGreaterThan(0);
    });
  });

  describe('Multiple Turns: Second Turn Sees First Turn Event', () => {
    it('should include first turn event in second turn context', async () => {
      const template = createTestTemplate();
      const characters = createTestCharacters();

      const show = await hostModule.initializeShow(template, characters, 42);

      // First turn: Alice speaks
      const aliceDef = characters[0]!;
      await executeCharacterTurn(show, aliceDef, 'First question for Alice');

      // Get events after first turn
      const eventsAfterFirst = await store.getEvents(show.id);
      const aliceEvent = eventsAfterFirst.find(
        (e) => e.type === EventType.speech && e.senderId === 'char-alice'
      );
      expect(aliceEvent).toBeDefined();

      // Second turn: Bob speaks - should see Alice's event in context
      const bobDef = characters[1]!;
      const promptForBob = await contextBuilder.buildPromptPackage(
        bobDef,
        show,
        'Second question for Bob'
      );

      // Verify Bob's sliding window contains Alice's speech
      const bobSlidingWindow = promptForBob.contextLayers.slidingWindow;
      expect(bobSlidingWindow.some((e) => e.content === aliceEvent!.content)).toBe(true);
      expect(bobSlidingWindow.some((e) => e.senderId === 'char-alice')).toBe(true);

      // Execute Bob's turn
      await executeCharacterTurn(show, bobDef, 'Second question for Bob');

      // Third turn: Carol speaks - should see both Alice's and Bob's events
      const carolDef = characters[2]!;
      const promptForCarol = await contextBuilder.buildPromptPackage(
        carolDef,
        show,
        'Third question for Carol'
      );

      // Verify Carol sees both previous speeches
      const carolSlidingWindow = promptForCarol.contextLayers.slidingWindow;
      expect(carolSlidingWindow.some((e) => e.senderId === 'char-alice')).toBe(true);
      expect(carolSlidingWindow.some((e) => e.senderId === 'char-bob')).toBe(true);
    });

    it('should accumulate events correctly over multiple turns', async () => {
      const template = createTestTemplate();
      const characters = createTestCharacters();

      const show = await hostModule.initializeShow(template, characters, 42);

      // Execute 5 turns alternating between characters
      const turnOrder = ['char-alice', 'char-bob', 'char-carol', 'char-alice', 'char-bob'];

      for (let i = 0; i < turnOrder.length; i++) {
        const charId = turnOrder[i]!;
        const charDef = characters.find((c) => c.id === charId)!;
        await executeCharacterTurn(show, charDef, `Question ${i + 1}`);
      }

      // Verify all 5 events accumulated
      const events = await store.getEvents(show.id);
      const speechEvents = events.filter((e) => e.type === EventType.speech);
      expect(speechEvents.length).toBe(5);

      // Verify all LLM calls recorded
      const llmCalls = await store.getLLMCalls(show.id);
      expect(llmCalls.length).toBe(5);

      // Build prompt for next turn - should see all previous events
      const carolDef = characters[2]!;
      const prompt = await contextBuilder.buildPromptPackage(carolDef, show, 'Final question');
      expect(prompt.contextLayers.slidingWindow.length).toBe(5);
    });
  });

  describe('Private Channel: Response Not Visible to Other Characters', () => {
    it('should not include private channel events in other characters context', async () => {
      const template = createTestTemplate();
      const characters = createTestCharacters();

      const show = await hostModule.initializeShow(template, characters, 42);

      // Alice sends a public message
      const aliceDef = characters[0]!;
      await executeCharacterTurn(show, aliceDef, 'Public message from Alice');

      // Bob sends a PRIVATE message to Alice only
      const bobDef = characters[1]!;
      await executeCharacterTurn(
        show,
        bobDef,
        'Private question for Alice',
        ChannelType.PRIVATE,
        ['char-alice', 'char-bob'] // Only Alice and Bob can see this
      );

      // Build context for Carol (should NOT see Bob's private message)
      const carolDef = characters[2]!;
      const carolPrompt = await contextBuilder.buildPromptPackage(
        carolDef,
        show,
        'Question for Carol'
      );

      // Carol should see Alice's public message
      const carolWindow = carolPrompt.contextLayers.slidingWindow;
      expect(carolWindow.some((e) => e.senderId === 'char-alice')).toBe(true);

      // Carol should NOT see Bob's private message
      const bobPrivateInCarolContext = carolWindow.find(
        (e) => e.senderId === 'char-bob' && e.channel === ChannelType.PRIVATE
      );
      expect(bobPrivateInCarolContext).toBeUndefined();
    });

    it('should include private channel events for participants', async () => {
      const template = createTestTemplate();
      const characters = createTestCharacters();

      const show = await hostModule.initializeShow(template, characters, 42);

      // Alice sends a private message to Bob
      const aliceDef = characters[0]!;
      await executeCharacterTurn(
        show,
        aliceDef,
        'Secret message from Alice to Bob',
        ChannelType.PRIVATE,
        ['char-alice', 'char-bob']
      );

      // Build context for Bob (should see Alice's private message)
      const bobDef = characters[1]!;
      const bobPrompt = await contextBuilder.buildPromptPackage(bobDef, show, 'Question for Bob');

      // Bob should see Alice's private message
      const bobWindow = bobPrompt.contextLayers.slidingWindow;
      expect(bobWindow.some((e) => e.senderId === 'char-alice')).toBe(true);
      expect(bobWindow.length).toBe(1);

      // Build context for Alice (should also see her own private message)
      const alicePrompt = await contextBuilder.buildPromptPackage(
        aliceDef,
        show,
        'Question for Alice'
      );
      const aliceWindow = alicePrompt.contextLayers.slidingWindow;
      expect(aliceWindow.some((e) => e.senderId === 'char-alice')).toBe(true);
    });

    it('should not leak private events to non-participants in next turn', async () => {
      const template = createTestTemplate();
      const characters = createTestCharacters();

      const show = await hostModule.initializeShow(template, characters, 42);

      // Turn 1: Public message
      const aliceDef = characters[0]!;
      await executeCharacterTurn(show, aliceDef, 'Public hello');

      // Turn 2: Private conversation between Alice and Bob
      const bobDef = characters[1]!;
      await executeCharacterTurn(
        show,
        bobDef,
        'Private message to Alice',
        ChannelType.PRIVATE,
        ['char-alice', 'char-bob']
      );

      // Turn 3: Alice replies privately to Bob
      await executeCharacterTurn(
        show,
        aliceDef,
        'Private reply to Bob',
        ChannelType.PRIVATE,
        ['char-alice', 'char-bob']
      );

      // Turn 4: Public message from Carol
      const carolDef = characters[2]!;
      await executeCharacterTurn(show, carolDef, 'Carol joins the conversation');

      // Now check what each character sees
      const allEvents = await store.getEvents(show.id);
      expect(allEvents.length).toBe(4);

      // Carol's next context should only see 2 events (her own + Alice's first public message)
      const carolNextPrompt = await contextBuilder.buildPromptPackage(
        carolDef,
        show,
        'Carol continues'
      );
      const carolVisibleEvents = carolNextPrompt.contextLayers.slidingWindow;

      // Count visible events for Carol
      expect(carolVisibleEvents.length).toBe(2); // Alice's public + Carol's own

      // Verify Carol can't see the private messages
      const privateEventsForCarol = carolVisibleEvents.filter(
        (e) => e.channel === ChannelType.PRIVATE
      );
      expect(privateEventsForCarol.length).toBe(0);

      // Bob should see all 4 events (2 public + 2 private he participated in)
      const bobNextPrompt = await contextBuilder.buildPromptPackage(bobDef, show, 'Bob continues');
      expect(bobNextPrompt.contextLayers.slidingWindow.length).toBe(4);
    });
  });
});
