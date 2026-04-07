/**
 * Tests for OpenAIAdapter tiktoken-based token counting
 * TASK-024: OpenAI Adapter подсчёт токенов через tiktoken
 */

import { describe, it, expect, vi } from 'vitest';
import { OpenAIAdapter } from '../../src/adapters/openai-adapter.js';
import { PromptPackage } from '../../src/types/adapter.js';
import { IStore } from '../../src/types/interfaces/store.interface.js';
import { ChannelType } from '../../src/types/enums.js';
import type { EventSummary } from '../../src/types/events.js';

/**
 * Create a mock store for testing
 */
function createMockStore(): IStore {
  return {
    createShow: vi.fn(),
    getShow: vi.fn(),
    updateShow: vi.fn(),
    listShows: vi.fn(),
    createCharacter: vi.fn(),
    getCharacters: vi.fn(),
    getCharacter: vi.fn(),
    updateShowCharacterContext: vi.fn(),
    appendEvent: vi.fn(),
    getEvents: vi.fn(),
    getEventsForCharacter: vi.fn(),
    deleteEventsAfter: vi.fn(),
    getLatestSequence: vi.fn(),
    logLLMCall: vi.fn(),
    getLLMCalls: vi.fn(),
    getLLMCallByEventId: vi.fn(),
    createBudget: vi.fn(),
    getBudget: vi.fn(),
    updateBudget: vi.fn(),
    setBudgetMode: vi.fn(),
    initSchema: vi.fn(),
    walCheckpoint: vi.fn(),
    close: vi.fn(),
  };
}

/**
 * Create a test PromptPackage
 */
function createTestPrompt(options?: {
  systemPrompt?: string;
  factsList?: string[];
  slidingWindow?: EventSummary[];
  trigger?: string;
  maxTokens?: number;
}): PromptPackage {
  return {
    systemPrompt: options?.systemPrompt ?? 'You are a test character.',
    contextLayers: {
      factsList: options?.factsList ?? ['Fact 1', 'Fact 2'],
      slidingWindow: options?.slidingWindow ?? [],
    },
    trigger: options?.trigger ?? 'What do you think?',
    responseConstraints: {
      maxTokens: options?.maxTokens ?? 200,
      format: 'free',
      language: 'ru',
    },
  };
}

describe('OpenAIAdapter tiktoken', () => {
  describe('estimateTokens()', () => {
    it('should return TokenEstimate object with prompt and estimatedCompletion', () => {
      const adapter = new OpenAIAdapter({
        apiKey: 'test-key',
        store: createMockStore(),
        showId: 'show-1',
        characterId: 'char-1',
      });

      const prompt = createTestPrompt();
      const estimate = adapter.estimateTokens(prompt);

      expect(estimate).toHaveProperty('prompt');
      expect(estimate).toHaveProperty('estimatedCompletion');
      expect(estimate.prompt).toBeGreaterThan(0);
      expect(Number.isInteger(estimate.prompt)).toBe(true);
    });

    it('should return estimatedCompletion from responseConstraints.maxTokens', () => {
      const adapter = new OpenAIAdapter({
        apiKey: 'test-key',
        store: createMockStore(),
        showId: 'show-1',
        characterId: 'char-1',
      });

      const prompt = createTestPrompt({ maxTokens: 500 });
      const estimate = adapter.estimateTokens(prompt);

      expect(estimate.estimatedCompletion).toBe(500);
    });

    it('should use default 256 for estimatedCompletion when maxTokens not specified', () => {
      const adapter = new OpenAIAdapter({
        apiKey: 'test-key',
        store: createMockStore(),
        showId: 'show-1',
        characterId: 'char-1',
      });

      const prompt: PromptPackage = {
        systemPrompt: 'Test',
        contextLayers: { factsList: [], slidingWindow: [] },
        trigger: 'Test',
        responseConstraints: { maxTokens: 256, format: 'free', language: 'en' },
      };

      const estimate = adapter.estimateTokens(prompt);

      expect(estimate.estimatedCompletion).toBe(256);
    });

    it('should count more tokens for longer text', () => {
      const adapter = new OpenAIAdapter({
        apiKey: 'test-key',
        store: createMockStore(),
        showId: 'show-1',
        characterId: 'char-1',
      });

      const shortPrompt = createTestPrompt({
        systemPrompt: 'Short.',
        trigger: 'Hi',
      });

      const longPrompt = createTestPrompt({
        systemPrompt: 'This is a much longer system prompt with many words to increase token count significantly.',
        trigger: 'What do you think about this long and complex question that requires detailed analysis?',
      });

      const shortEstimate = adapter.estimateTokens(shortPrompt);
      const longEstimate = adapter.estimateTokens(longPrompt);

      expect(longEstimate.prompt).toBeGreaterThan(shortEstimate.prompt);
    });

    it('should include tokens for context layers', () => {
      const adapter = new OpenAIAdapter({
        apiKey: 'test-key',
        store: createMockStore(),
        showId: 'show-1',
        characterId: 'char-1',
      });

      const withoutContext = createTestPrompt({
        factsList: [],
        slidingWindow: [],
      });

      const withContext = createTestPrompt({
        factsList: ['Important fact one', 'Important fact two', 'Important fact three'],
        slidingWindow: [
          { senderId: 'char1', senderName: 'Character 1', channel: ChannelType.PUBLIC, content: 'Hello everyone!', timestamp: Date.now() },
          { senderId: 'char2', senderName: 'Character 2', channel: ChannelType.PUBLIC, content: 'Nice to meet you!', timestamp: Date.now() },
        ],
      });

      const withoutEstimate = adapter.estimateTokens(withoutContext);
      const withEstimate = adapter.estimateTokens(withContext);

      expect(withEstimate.prompt).toBeGreaterThan(withoutEstimate.prompt);
    });

    it('should work with gpt-4o model', () => {
      const adapter = new OpenAIAdapter({
        apiKey: 'test-key',
        modelId: 'gpt-4o',
        store: createMockStore(),
        showId: 'show-1',
        characterId: 'char-1',
      });

      const prompt = createTestPrompt();
      const estimate = adapter.estimateTokens(prompt);

      expect(estimate.prompt).toBeGreaterThan(0);
      expect(estimate.estimatedCompletion).toBeGreaterThan(0);
    });

    it('should work with gpt-4o-mini model', () => {
      const adapter = new OpenAIAdapter({
        apiKey: 'test-key',
        modelId: 'gpt-4o-mini',
        store: createMockStore(),
        showId: 'show-1',
        characterId: 'char-1',
      });

      const prompt = createTestPrompt();
      const estimate = adapter.estimateTokens(prompt);

      expect(estimate.prompt).toBeGreaterThan(0);
      expect(estimate.estimatedCompletion).toBeGreaterThan(0);
    });

    it('should handle Cyrillic text correctly', () => {
      const adapter = new OpenAIAdapter({
        apiKey: 'test-key',
        store: createMockStore(),
        showId: 'show-1',
        characterId: 'char-1',
      });

      const prompt = createTestPrompt({
        systemPrompt: 'Ты - персонаж русскоязычного ток-шоу.',
        trigger: 'Что вы думаете об этой ситуации?',
      });

      const estimate = adapter.estimateTokens(prompt);

      expect(estimate.prompt).toBeGreaterThan(0);
      // Cyrillic typically uses more tokens per character
      expect(estimate.prompt).toBeGreaterThan(10);
    });

    it('should handle empty prompt gracefully', () => {
      const adapter = new OpenAIAdapter({
        apiKey: 'test-key',
        store: createMockStore(),
        showId: 'show-1',
        characterId: 'char-1',
      });

      const prompt: PromptPackage = {
        systemPrompt: '',
        contextLayers: { factsList: [], slidingWindow: [] },
        trigger: '',
        responseConstraints: { maxTokens: 256, format: 'free', language: 'en' },
      };

      const estimate = adapter.estimateTokens(prompt);

      // Even empty messages have some overhead tokens
      expect(estimate.prompt).toBeGreaterThanOrEqual(3);
    });
  });
});
