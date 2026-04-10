/**
 * MockAdapter - Test implementation of ModelAdapter
 *
 * Provides deterministic responses for testing without API calls.
 * Supports seed-based reproducibility for consistent test results.
 * Generates personality-aware Russian responses with variable length.
 */

import type { ModelAdapter, PromptPackage, CharacterResponse, TokenEstimate } from '../types/adapter.js';
import { CharacterIntent } from '../types/enums.js';
import { logger } from '../utils/logger.js';

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
 * Returns deterministic responses based on:
 * - personalityPrompt (from systemPrompt)
 * - triggerTemplate (from trigger)
 * - speakFrequency (inferred from maxTokens)
 *
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
   * 1. The systemPrompt (personality affects tone)
   * 2. The trigger text (topic affects content)
   * 3. The maxTokens (affects response length)
   * 4. The seed value (for reproducibility)
   *
   * Same inputs + same seed = same response
   */
  async call(prompt: PromptPackage): Promise<CharacterResponse> {
    const { systemPrompt, trigger, responseConstraints } = prompt;
    const maxTokens = responseConstraints.maxTokens ?? 200;

    // Generate hashes from different inputs for varied selection
    const triggerHash = hashString(trigger, this.seed);
    const personalityHash = hashString(systemPrompt, this.seed);
    const combinedHash = hashString(trigger + systemPrompt, this.seed);

    // Build response from parts for uniqueness
    const text = this.buildResponse(triggerHash, personalityHash, combinedHash, maxTokens);

    // Select intent based on combined hash
    const intents: CharacterIntent[] = [
      CharacterIntent.speak,
      CharacterIntent.end_turn,
      CharacterIntent.request_private,
    ];
    const intentIndex = (combinedHash >> 4) % intents.length;

    return {
      text,
      intent: intents[intentIndex],
    };
  }

  /**
   * Build a unique response by combining phrase parts
   * Length varies based on maxTokens (proxy for speakFrequency)
   */
  private buildResponse(
    triggerHash: number,
    personalityHash: number,
    combinedHash: number,
    maxTokens: number
  ): string {
    const openers = this.getOpeners();
    const middles = this.getMiddlePhrases();
    const closers = this.getClosers();
    const extensions = this.getExtensions();

    // Select parts deterministically
    const opener = openers[triggerHash % openers.length]!;
    const middle = middles[personalityHash % middles.length]!;
    const closer = closers[combinedHash % closers.length]!;

    // Determine response length based on maxTokens
    // low speakFrequency ~ maxTokens <= 100 -> short (opener only or opener + middle)
    // medium ~ maxTokens 100-200 -> medium (opener + middle + closer)
    // high ~ maxTokens > 200 -> long (all parts + extensions)

    if (maxTokens <= 100) {
      // Short response for low speakFrequency
      if ((combinedHash >> 2) % 2 === 0) {
        return opener;
      }
      return `${opener} ${middle}`;
    }

    if (maxTokens <= 200) {
      // Medium response
      return `${opener} ${middle} ${closer}`;
    }

    // Long response for high speakFrequency - add extensions
    const ext1 = extensions[(triggerHash >> 3) % extensions.length]!;
    const ext2 = extensions[(personalityHash >> 3) % extensions.length]!;

    // Avoid duplicate extensions
    if (ext1 === ext2) {
      return `${opener} ${middle} ${closer} ${ext1}`;
    }
    return `${opener} ${middle} ${closer} ${ext1} ${ext2}`;
  }

  /**
   * Estimate token count for the prompt
   *
   * Uses word count * 3.5 approximation for Russian text
   * (Cyrillic characters use ~3-4 tokens per word in GPT tokenizers)
   * Returns both prompt and estimated completion tokens.
   */
  estimateTokens(prompt: PromptPackage): TokenEstimate {
    const { systemPrompt, contextLayers, trigger, responseConstraints } = prompt;
    const maxTokens = responseConstraints.maxTokens ?? 200;

    // Combine all text (including summary if present)
    const allText = [
      systemPrompt,
      contextLayers.factsList.join(' '),
      contextLayers.summary ?? '', // TASK-105: Include summary in token count
      contextLayers.slidingWindow.map(e => e.content).join(' '),
      trigger,
    ].join(' ');

    // Count words (split by whitespace)
    const wordCount = allText.split(/\s+/).filter(w => w.length > 0).length;

    // Approximate: 1 Russian word ≈ 3.5 tokens (Cyrillic encoding)
    // Add ~10 tokens for message overhead (similar to OpenAI adapter)
    const promptTokens = Math.ceil(wordCount * 3.5) + 10;

    // Estimated completion based on actual mock response length
    // Mock responses are: short (9-20 tokens), medium (40-60 tokens), long (90-130 tokens)
    // Select based on maxTokens (same logic as buildResponse)
    let estimatedCompletion: number;
    if (maxTokens <= 100) {
      // Short response: opener or opener + middle
      estimatedCompletion = 25; // ~15-35 tokens
    } else if (maxTokens <= 200) {
      // Medium response: opener + middle + closer
      estimatedCompletion = 55; // ~40-70 tokens
    } else {
      // Long response: all parts + extensions
      estimatedCompletion = 110; // ~90-130 tokens
    }

    logger.debug(
      `MockAdapter.estimateTokens: words=${wordCount}, promptTokens=${promptTokens}, estimatedCompletion=${estimatedCompletion} (maxTokens=${maxTokens})`
    );

    return {
      prompt: promptTokens,
      estimatedCompletion,
    };
  }

  /**
   * Opening phrases (reaction to trigger)
   */
  private getOpeners(): string[] {
    return [
      'Интересный вопрос.',
      'Позвольте высказаться.',
      'Хочу добавить кое-что важное.',
      'Это заставляет задуматься.',
      'Не могу промолчать.',
      'У меня есть мнение по этому поводу.',
      'Давайте разберёмся.',
      'Вот что я думаю.',
      'Это сложный вопрос.',
      'Интересная точка зрения.',
      'Позвольте не согласиться.',
      'Хороший момент для обсуждения.',
    ];
  }

  /**
   * Middle phrases (personality-influenced content)
   */
  private getMiddlePhrases(): string[] {
    return [
      'Мне кажется, что нужно подумать об этом глубже.',
      'Я вижу здесь несколько важных аспектов.',
      'С моей точки зрения, ситуация неоднозначная.',
      'Думаю, мы упускаем что-то важное.',
      'Здесь есть над чем поразмыслить.',
      'Моя позиция по этому вопросу однозначна.',
      'Я бы посмотрел на это иначе.',
      'Это напоминает мне о важном принципе.',
      'Не стоит торопиться с выводами.',
      'Факты говорят сами за себя.',
      'Мой опыт подсказывает другое.',
      'Здесь нужен взвешенный подход.',
    ];
  }

  /**
   * Closing phrases (conclusion)
   */
  private getClosers(): string[] {
    return [
      'Впрочем, решать не мне.',
      'Но это лишь моё мнение.',
      'Время покажет, кто прав.',
      'Надеюсь, вы меня понимаете.',
      'Готов обсудить это подробнее.',
      'Пусть каждый сделает свои выводы.',
      'Это то, что я хотел сказать.',
      'Думаю, это важно учитывать.',
      'Вот к чему я веду.',
      'Поживём — увидим.',
      'Остальное — детали.',
      'На этом, пожалуй, всё.',
    ];
  }

  /**
   * Extension phrases (for longer responses)
   */
  private getExtensions(): string[] {
    return [
      'Кстати, есть ещё один момент, который стоит упомянуть.',
      'И ещё хочу добавить — не всё так просто, как кажется на первый взгляд.',
      'Между прочим, я давно хотел поднять этот вопрос.',
      'К слову, у меня есть интересное наблюдение по этой теме.',
      'Более того, я считаю, что мы недооцениваем масштаб проблемы.',
      'Помимо этого, стоит учитывать и другие факторы.',
      'Вдобавок ко всему, есть ещё один важный нюанс.',
      'Между тем, ситуация развивается не так, как многие ожидали.',
    ];
  }
}
