/**
 * Tests for MockAdapter
 */

import { describe, it, expect } from 'vitest';
import { MockAdapter } from '../../src/adapters/mock-adapter.js';
import type { PromptPackage } from '../../src/types/adapter.js';
import { CharacterIntent, ChannelType } from '../../src/types/enums.js';

/**
 * Helper to create a test PromptPackage
 */
function createTestPrompt(trigger: string): PromptPackage {
  return {
    systemPrompt: 'You are a test character.',
    contextLayers: {
      factsList: ['Fact 1', 'Fact 2'],
      slidingWindow: [
        { senderId: 'char1', senderName: 'Character 1', channel: ChannelType.PUBLIC, content: 'Hello', timestamp: Date.now() },
      ],
    },
    trigger,
    responseConstraints: {
      maxTokens: 200,
      format: 'free',
      language: 'ru',
    },
  };
}

describe('MockAdapter', () => {
  describe('basic properties', () => {
    it('should have providerId "mock"', () => {
      const adapter = new MockAdapter();
      expect(adapter.providerId).toBe('mock');
    });

    it('should have modelId "mock-v1"', () => {
      const adapter = new MockAdapter();
      expect(adapter.modelId).toBe('mock-v1');
    });
  });

  describe('call()', () => {
    it('should return a valid CharacterResponse', async () => {
      const adapter = new MockAdapter();
      const prompt = createTestPrompt('What do you think about this?');

      const response = await adapter.call(prompt);

      expect(response).toHaveProperty('text');
      expect(response).toHaveProperty('intent');
      expect(typeof response.text).toBe('string');
      expect(response.text.length).toBeGreaterThan(0);
      expect(Object.values(CharacterIntent)).toContain(response.intent);
    });

    it('should return same response for same trigger and seed', async () => {
      const adapter1 = new MockAdapter(12345);
      const adapter2 = new MockAdapter(12345);
      const prompt = createTestPrompt('Tell me about the situation');

      const response1 = await adapter1.call(prompt);
      const response2 = await adapter2.call(prompt);

      expect(response1.text).toBe(response2.text);
      expect(response1.intent).toBe(response2.intent);
    });

    it('should return different responses for different seeds', async () => {
      const adapter1 = new MockAdapter(111);
      const adapter2 = new MockAdapter(222);
      const prompt = createTestPrompt('Tell me about the situation');

      const response1 = await adapter1.call(prompt);
      const response2 = await adapter2.call(prompt);

      // Different seeds should produce different responses
      // Note: there's a small chance they could be the same, but with good hash it's unlikely
      expect(response1.text !== response2.text || response1.intent !== response2.intent).toBe(true);
    });

    it('should return different responses for different triggers', async () => {
      const adapter = new MockAdapter(42);
      const prompt1 = createTestPrompt('Question one');
      const prompt2 = createTestPrompt('Completely different question');

      const response1 = await adapter.call(prompt1);
      const response2 = await adapter.call(prompt2);

      // Different triggers should likely produce different responses
      expect(response1.text !== response2.text || response1.intent !== response2.intent).toBe(true);
    });

    it('should return CharacterResponse with valid intent', async () => {
      const adapter = new MockAdapter();
      const prompt = createTestPrompt('Any question');

      const response = await adapter.call(prompt);

      const validIntents = [
        CharacterIntent.speak,
        CharacterIntent.end_turn,
        CharacterIntent.request_private,
      ];
      expect(validIntents).toContain(response.intent);
    });
  });

  describe('estimateTokens()', () => {
    it('should return TokenEstimate object with prompt and estimatedCompletion', () => {
      const adapter = new MockAdapter();
      const prompt = createTestPrompt('Test trigger');

      const estimate = adapter.estimateTokens(prompt);

      expect(estimate).toHaveProperty('prompt');
      expect(estimate).toHaveProperty('estimatedCompletion');
      expect(estimate.prompt).toBeGreaterThan(0);
      expect(Number.isInteger(estimate.prompt)).toBe(true);
      // Medium response (maxTokens=200) -> estimatedCompletion=55
      expect(estimate.estimatedCompletion).toBe(55);
    });

    it('should return approximately words * 3.5 + overhead for prompt tokens (Russian tokenization)', () => {
      const adapter = new MockAdapter();
      const prompt: PromptPackage = {
        systemPrompt: 'One two three', // 3 words
        contextLayers: {
          factsList: ['four five'], // 2 words
          slidingWindow: [],
        },
        trigger: 'six seven eight nine ten', // 5 words
        responseConstraints: {
          maxTokens: 100,
          format: 'free',
          language: 'en',
        },
      };

      const estimate = adapter.estimateTokens(prompt);

      // Total: 10 words * 3.5 + 10 overhead = 45 tokens
      expect(estimate.prompt).toBe(45);
      // Short response (maxTokens=100) -> estimatedCompletion=25
      expect(estimate.estimatedCompletion).toBe(25);
    });

    it('should handle empty content', () => {
      const adapter = new MockAdapter();
      const prompt: PromptPackage = {
        systemPrompt: '',
        contextLayers: {
          factsList: [],
          slidingWindow: [],
        },
        trigger: 'test',
        responseConstraints: {
          maxTokens: 100,
          format: 'free',
          language: 'en',
        },
      };

      const estimate = adapter.estimateTokens(prompt);

      // 1 word * 3.5 + 10 overhead = 14 (ceil(3.5) + 10)
      expect(estimate.prompt).toBe(14);
      // Short response (maxTokens=100) -> estimatedCompletion=25
      expect(estimate.estimatedCompletion).toBe(25);
    });

    it('should estimate completion based on maxTokens tier', () => {
      const adapter = new MockAdapter();

      // Short response (maxTokens <= 100)
      const shortPrompt: PromptPackage = {
        systemPrompt: 'Test',
        contextLayers: { factsList: [], slidingWindow: [] },
        trigger: 'test',
        responseConstraints: { maxTokens: 50, format: 'free', language: 'ru' },
      };
      expect(adapter.estimateTokens(shortPrompt).estimatedCompletion).toBe(25);

      // Medium response (100 < maxTokens <= 200)
      const mediumPrompt: PromptPackage = {
        systemPrompt: 'Test',
        contextLayers: { factsList: [], slidingWindow: [] },
        trigger: 'test',
        responseConstraints: { maxTokens: 150, format: 'free', language: 'ru' },
      };
      expect(adapter.estimateTokens(mediumPrompt).estimatedCompletion).toBe(55);

      // Long response (maxTokens > 200)
      const longPrompt: PromptPackage = {
        systemPrompt: 'Test',
        contextLayers: { factsList: [], slidingWindow: [] },
        trigger: 'test',
        responseConstraints: { maxTokens: 300, format: 'free', language: 'ru' },
      };
      expect(adapter.estimateTokens(longPrompt).estimatedCompletion).toBe(110);
    });
  });

  describe('seed reproducibility', () => {
    it('should produce consistent results across multiple calls with same seed', async () => {
      const seed = 99999;
      const triggers = [
        'First question',
        'Second question',
        'Third question',
      ];

      // First run
      const adapter1 = new MockAdapter(seed);
      const responses1 = await Promise.all(
        triggers.map(t => adapter1.call(createTestPrompt(t)))
      );

      // Second run with same seed
      const adapter2 = new MockAdapter(seed);
      const responses2 = await Promise.all(
        triggers.map(t => adapter2.call(createTestPrompt(t)))
      );

      // All responses should match
      for (let i = 0; i < triggers.length; i++) {
        expect(responses1[i]!.text).toBe(responses2[i]!.text);
        expect(responses1[i]!.intent).toBe(responses2[i]!.intent);
      }
    });
  });
});
