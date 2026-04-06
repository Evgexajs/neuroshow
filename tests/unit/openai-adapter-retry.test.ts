/**
 * Tests for OpenAIAdapter retry logic and fallback
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import OpenAI from 'openai';
import { OpenAIAdapter } from '../../src/adapters/openai-adapter.js';
import { PromptPackage } from '../../src/types/adapter.js';
import { CharacterIntent } from '../../src/types/enums.js';
import { IStore, LlmCallRecord } from '../../src/types/interfaces/store.interface.js';

/**
 * Helper to create a test PromptPackage
 */
function createTestPrompt(trigger: string = 'Test question'): PromptPackage {
  return {
    systemPrompt: 'You are a test character.',
    contextLayers: {
      factsList: ['Fact 1'],
      slidingWindow: [],
    },
    trigger,
    responseConstraints: {
      maxTokens: 200,
      format: 'free',
      language: 'ru',
    },
  };
}

/**
 * Mock store that captures logged calls
 */
function createMockStore(): IStore & { logs: LlmCallRecord[] } {
  const logs: LlmCallRecord[] = [];
  return {
    logs,
    logLLMCall: vi.fn(async (call: LlmCallRecord) => {
      logs.push(call);
    }),
    // Stubs for other methods (not used in these tests)
    createShow: vi.fn(),
    getShow: vi.fn(),
    updateShow: vi.fn(),
    listShows: vi.fn(),
    createCharacter: vi.fn(),
    getCharacter: vi.fn(),
    getCharacters: vi.fn(),
    updateShowCharacterContext: vi.fn(),
    appendEvent: vi.fn(),
    getEvents: vi.fn(),
    getEventsForCharacter: vi.fn(),
    deleteEventsAfter: vi.fn(),
    getLatestSequence: vi.fn(),
    getLLMCalls: vi.fn(),
    getLLMCallByEventId: vi.fn(),
    createBudget: vi.fn(),
    getBudget: vi.fn(),
    updateBudget: vi.fn(),
    setBudgetMode: vi.fn(),
    initSchema: vi.fn(),
    close: vi.fn(),
  } as unknown as IStore & { logs: LlmCallRecord[] };
}

/**
 * Create a mock response
 */
function createMockResponse(text: string = 'Test response') {
  return {
    id: 'chatcmpl-123',
    object: 'chat.completion',
    created: Date.now(),
    model: 'gpt-4o-mini',
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: JSON.stringify({ text, intent: 'speak' }),
      },
      finish_reason: 'stop',
    }],
    usage: {
      prompt_tokens: 50,
      completion_tokens: 20,
      total_tokens: 70,
    },
  };
}

describe('OpenAIAdapter retry logic', () => {
  let store: IStore & { logs: LlmCallRecord[] };

  beforeEach(() => {
    store = createMockStore();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('retry on API errors', () => {
    it('should retry on 503 error and succeed on second attempt', async () => {
      const adapter = new OpenAIAdapter({
        apiKey: 'test-key',
        store,
        showId: 'show1',
        characterId: 'char1',
      });

      let callCount = 0;
      vi.spyOn(adapter['client'].chat.completions, 'create').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          const error = new OpenAI.APIError(503, { message: 'Service Unavailable' }, 'Service Unavailable', {});
          throw error;
        }
        return createMockResponse() as unknown as OpenAI.Chat.ChatCompletion;
      });

      const result = await adapter.call(createTestPrompt());

      expect(callCount).toBe(2);
      expect(result.text).toBe('Test response');
      expect(result.intent).toBe(CharacterIntent.speak);
    });

    it('should retry on 429 error (rate limit)', async () => {
      const adapter = new OpenAIAdapter({
        apiKey: 'test-key',
        store,
        showId: 'show1',
        characterId: 'char1',
      });

      let callCount = 0;
      vi.spyOn(adapter['client'].chat.completions, 'create').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          const error = new OpenAI.APIError(429, { message: 'Rate limit' }, 'Rate limit', {});
          throw error;
        }
        return createMockResponse() as unknown as OpenAI.Chat.ChatCompletion;
      });

      const result = await adapter.call(createTestPrompt());

      expect(callCount).toBe(2);
      expect(result.text).toBe('Test response');
    });

    it('should retry on 500 error', async () => {
      const adapter = new OpenAIAdapter({
        apiKey: 'test-key',
        store,
        showId: 'show1',
        characterId: 'char1',
      });

      let callCount = 0;
      vi.spyOn(adapter['client'].chat.completions, 'create').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          const error = new OpenAI.APIError(500, { message: 'Internal Server Error' }, 'Internal Server Error', {});
          throw error;
        }
        return createMockResponse() as unknown as OpenAI.Chat.ChatCompletion;
      });

      const result = await adapter.call(createTestPrompt());

      expect(callCount).toBe(2);
      expect(result.text).toBe('Test response');
    });

    it('should retry on 502 error', async () => {
      const adapter = new OpenAIAdapter({
        apiKey: 'test-key',
        store,
        showId: 'show1',
        characterId: 'char1',
      });

      let callCount = 0;
      vi.spyOn(adapter['client'].chat.completions, 'create').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          const error = new OpenAI.APIError(502, { message: 'Bad Gateway' }, 'Bad Gateway', {});
          throw error;
        }
        return createMockResponse() as unknown as OpenAI.Chat.ChatCompletion;
      });

      const result = await adapter.call(createTestPrompt());

      expect(callCount).toBe(2);
      expect(result.text).toBe('Test response');
    });
  });

  describe('maximum retries', () => {
    it('should perform maximum 2 retries and then return fallback', async () => {
      const adapter = new OpenAIAdapter({
        apiKey: 'test-key',
        store,
        showId: 'show1',
        characterId: 'char1',
      });

      let callCount = 0;
      vi.spyOn(adapter['client'].chat.completions, 'create').mockImplementation(async () => {
        callCount++;
        const error = new OpenAI.APIError(503, { message: 'Service Unavailable' }, 'Service Unavailable', {});
        throw error;
      });

      const result = await adapter.call(createTestPrompt());

      // 1 initial + 2 retries = 3 calls
      expect(callCount).toBe(3);
      expect(result.text).toBe('[молчит]');
      expect(result.intent).toBe(CharacterIntent.end_turn);
    });
  });

  describe('retry on invalid JSON', () => {
    it('should retry on invalid JSON response', async () => {
      const adapter = new OpenAIAdapter({
        apiKey: 'test-key',
        store,
        showId: 'show1',
        characterId: 'char1',
      });

      let callCount = 0;
      vi.spyOn(adapter['client'].chat.completions, 'create').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            id: 'chatcmpl-123',
            object: 'chat.completion',
            created: Date.now(),
            model: 'gpt-4o-mini',
            choices: [{
              index: 0,
              message: {
                role: 'assistant',
                content: 'not valid json {{{',
              },
              finish_reason: 'stop',
            }],
            usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
          } as unknown as OpenAI.Chat.ChatCompletion;
        }
        return createMockResponse() as unknown as OpenAI.Chat.ChatCompletion;
      });

      const result = await adapter.call(createTestPrompt());

      expect(callCount).toBe(2);
      expect(result.text).toBe('Test response');
    });

    it('should return fallback after max JSON parse retries', async () => {
      const adapter = new OpenAIAdapter({
        apiKey: 'test-key',
        store,
        showId: 'show1',
        characterId: 'char1',
      });

      let callCount = 0;
      vi.spyOn(adapter['client'].chat.completions, 'create').mockImplementation(async () => {
        callCount++;
        return {
          id: 'chatcmpl-123',
          object: 'chat.completion',
          created: Date.now(),
          model: 'gpt-4o-mini',
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: 'always invalid json {{{',
            },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
        } as unknown as OpenAI.Chat.ChatCompletion;
      });

      const result = await adapter.call(createTestPrompt());

      // 1 initial + 2 retries = 3 calls
      expect(callCount).toBe(3);
      expect(result.text).toBe('[молчит]');
      expect(result.intent).toBe(CharacterIntent.end_turn);
    });
  });

  describe('fallback response', () => {
    it('should return fallback { text: "[молчит]", intent: "end_turn" }', async () => {
      const adapter = new OpenAIAdapter({
        apiKey: 'test-key',
        store,
        showId: 'show1',
        characterId: 'char1',
      });

      vi.spyOn(adapter['client'].chat.completions, 'create').mockImplementation(async () => {
        const error = new OpenAI.APIError(503, { message: 'Service Unavailable' }, 'Service Unavailable', {});
        throw error;
      });

      const result = await adapter.call(createTestPrompt());

      expect(result.text).toBe('[молчит]');
      expect(result.intent).toBe(CharacterIntent.end_turn);
    });

    it('should log fallback with metadata.fallback: true', async () => {
      const adapter = new OpenAIAdapter({
        apiKey: 'test-key',
        store,
        showId: 'show1',
        characterId: 'char1',
      });

      vi.spyOn(adapter['client'].chat.completions, 'create').mockImplementation(async () => {
        const error = new OpenAI.APIError(503, { message: 'Service Unavailable' }, 'Service Unavailable', {});
        throw error;
      });

      await adapter.call(createTestPrompt());

      expect(store.logs.length).toBe(1);
      const loggedResponse = JSON.parse(store.logs[0].rawResponse);
      expect(loggedResponse.metadata).toBeDefined();
      expect(loggedResponse.metadata.fallback).toBe(true);
    });
  });

  describe('non-retryable errors', () => {
    it('should not retry on 400 error (bad request)', async () => {
      const adapter = new OpenAIAdapter({
        apiKey: 'test-key',
        store,
        showId: 'show1',
        characterId: 'char1',
      });

      let callCount = 0;
      vi.spyOn(adapter['client'].chat.completions, 'create').mockImplementation(async () => {
        callCount++;
        const error = new OpenAI.APIError(400, { message: 'Bad Request' }, 'Bad Request', {});
        throw error;
      });

      const result = await adapter.call(createTestPrompt());

      // Should not retry, only 1 call
      expect(callCount).toBe(1);
      expect(result.text).toBe('[молчит]');
    });

    it('should not retry on 401 error (unauthorized)', async () => {
      const adapter = new OpenAIAdapter({
        apiKey: 'test-key',
        store,
        showId: 'show1',
        characterId: 'char1',
      });

      let callCount = 0;
      vi.spyOn(adapter['client'].chat.completions, 'create').mockImplementation(async () => {
        callCount++;
        const error = new OpenAI.APIError(401, { message: 'Unauthorized' }, 'Unauthorized', {});
        throw error;
      });

      const result = await adapter.call(createTestPrompt());

      expect(callCount).toBe(1);
      expect(result.text).toBe('[молчит]');
    });
  });
});
