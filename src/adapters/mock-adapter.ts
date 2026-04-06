/**
 * MockAdapter - Test implementation of ModelAdapter
 *
 * Provides deterministic responses for testing without API calls.
 * Supports seed-based reproducibility for consistent test results.
 */

import { ModelAdapter, PromptPackage, CharacterResponse, TokenEstimate } from '../types/adapter.js';
import { CharacterIntent } from '../types/enums.js';

/**
 * Simple hash function for seed-based determinism
 */
function hashString(str: string, seed: number): number {
  let hash = seed;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * Mock LLM adapter for testing
 *
 * Returns deterministic responses based on trigger content and optional seed.
 * Useful for unit tests and development without API costs.
 */
export class MockAdapter implements ModelAdapter {
  readonly providerId = 'mock';
  readonly modelId = 'mock-v1';

  private seed: number;

  /**
   * Create a MockAdapter
   * @param seed - Optional seed for reproducible responses (default: 42)
   */
  constructor(seed: number = 42) {
    this.seed = seed;
  }

  /**
   * Generate a deterministic response based on the prompt
   *
   * The response is determined by:
   * 1. The trigger text (hashed with seed)
   * 2. The seed value
   *
   * Same trigger + same seed = same response
   */
  async call(prompt: PromptPackage): Promise<CharacterResponse> {
    const { trigger } = prompt;

    // Generate hash from trigger and seed for determinism
    const hash = hashString(trigger, this.seed);

    // Select response template based on hash
    const responses = this.getResponseTemplates();
    const index = hash % responses.length;
    const template = responses[index]!;

    // Select intent based on hash
    const intents: CharacterIntent[] = [
      CharacterIntent.speak,
      CharacterIntent.end_turn,
      CharacterIntent.request_private,
    ];
    const intentIndex = (hash >> 4) % intents.length;

    return {
      text: template.replace('{trigger}', trigger.slice(0, 50)),
      intent: intents[intentIndex],
    };
  }

  /**
   * Estimate token count for the prompt
   *
   * Uses simple word count * 1.3 approximation
   * (average English word is about 1.3 tokens)
   * Returns both prompt and estimated completion tokens.
   */
  estimateTokens(prompt: PromptPackage): TokenEstimate {
    const { systemPrompt, contextLayers, trigger } = prompt;

    // Combine all text
    const allText = [
      systemPrompt,
      contextLayers.factsList.join(' '),
      contextLayers.slidingWindow.map(e => e.content).join(' '),
      trigger,
    ].join(' ');

    // Count words (split by whitespace)
    const wordCount = allText.split(/\s+/).filter(w => w.length > 0).length;

    // Approximate: 1 word ≈ 1.3 tokens
    const promptTokens = Math.ceil(wordCount * 1.3);

    // Estimated completion based on responseConstraints or default
    const estimatedCompletion = prompt.responseConstraints.maxTokens ?? 256;

    return {
      prompt: promptTokens,
      estimatedCompletion,
    };
  }

  /**
   * Get response templates for deterministic generation
   */
  private getResponseTemplates(): string[] {
    return [
      'Интересный вопрос. Мне кажется, что нужно подумать об этом глубже.',
      'Я полностью согласен с предыдущим оратором. Это важная тема.',
      'Позвольте мне высказать альтернативную точку зрения на этот вопрос.',
      'Я не уверен в правильности такого подхода. Может, стоит рассмотреть другие варианты?',
      'Это напоминает мне о важном принципе, который мы часто забываем.',
      'Хороший момент. Я хотел бы добавить несколько мыслей к этому.',
      'Мне нужно время, чтобы обдумать это. Пока воздержусь от комментариев.',
      'Абсолютно верно! Это именно то, о чем я думал.',
    ];
  }
}
