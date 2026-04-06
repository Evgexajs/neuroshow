/**
 * Tests for MockAdapter
 */

import { describe, it, expect } from 'vitest';
import { MockAdapter } from '../../src/adapters/mock-adapter.js';
import { PromptPackage } from '../../src/types/adapter.js';
import { CharacterIntent } from '../../src/types/enums.js';

/**
 * Helper to create a test PromptPackage
 */
function createTestPrompt(trigger: string): PromptPackage {
  return {
    systemPrompt: 'You are a test character.',
    contextLayers: {
      factsList: ['Fact 1', 'Fact 2'],
      slidingWindow: [
        { senderId: 'char1', channel: 'PUBLIC', content: 'Hello', timestamp: new Date().toISOString() },
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
    it('should return a positive number', () => {
      const adapter = new MockAdapter();
      const prompt = createTestPrompt('Test trigger');

      const tokens = adapter.estimateTokens(prompt);

      expect(tokens).toBeGreaterThan(0);
      expect(Number.isInteger(tokens)).toBe(true);
    });

    it('should return approximately words * 1.3', () => {
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

      const tokens = adapter.estimateTokens(prompt);

      // Total: 10 words * 1.3 = 13 tokens
      expect(tokens).toBe(13);
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

      const tokens = adapter.estimateTokens(prompt);

      // 1 word * 1.3 = 1.3 -> 2 (ceil)
      expect(tokens).toBe(2);
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
        expect(responses1[i].text).toBe(responses2[i].text);
        expect(responses1[i].intent).toBe(responses2[i].intent);
      }
    });
  });
});
