/**
 * OpenAIAdapter - OpenAI API implementation of ModelAdapter
 *
 * Integrates with OpenAI's chat completion API.
 * Logs all requests/responses to storage for debugging and replay.
 */

import OpenAI from 'openai';
import { ModelAdapter, PromptPackage, CharacterResponse } from '../types/adapter.js';
import { CharacterIntent } from '../types/enums.js';
import { IStore, LlmCallRecord } from '../types/interfaces/store.interface.js';
import { generateId } from '../utils/id.js';

/** Error codes that trigger retry */
const RETRYABLE_STATUS_CODES = [429, 500, 502, 503];

/** Maximum number of retries */
const MAX_RETRIES = 2;

/** Base delay for exponential backoff (ms) */
const BASE_DELAY_MS = 1000;

/** Fallback response when all retries exhausted */
const FALLBACK_RESPONSE: CharacterResponse = {
  text: '[молчит]',
  intent: CharacterIntent.end_turn,
};

/**
 * Configuration for OpenAIAdapter
 */
export interface OpenAIAdapterConfig {
  /** OpenAI API key */
  apiKey: string;
  /** Model ID (e.g., "gpt-4o", "gpt-4o-mini") */
  modelId?: string;
  /** Store for logging LLM calls */
  store: IStore;
  /** Show ID for logging */
  showId: string;
  /** Character ID for logging */
  characterId: string;
}

/**
 * OpenAI adapter implementing ModelAdapter interface
 *
 * Uses official OpenAI SDK for API calls.
 * Logs raw request/response in llm_calls table.
 */
export class OpenAIAdapter implements ModelAdapter {
  readonly providerId = 'openai';
  readonly modelId: string;

  private client: OpenAI;
  private store: IStore;
  private showId: string;
  private characterId: string;

  constructor(config: OpenAIAdapterConfig) {
    this.modelId = config.modelId ?? 'gpt-4o-mini';
    this.client = new OpenAI({ apiKey: config.apiKey });
    this.store = config.store;
    this.showId = config.showId;
    this.characterId = config.characterId;
  }

  /**
   * Call OpenAI API with prompt package
   *
   * Builds messages from prompt, calls API, parses JSON response,
   * and logs the call to storage.
   *
   * Implements retry with exponential backoff for 429, 500, 502, 503 errors.
   * Returns fallback response if all retries exhausted.
   */
  async call(prompt: PromptPackage): Promise<CharacterResponse> {
    const startTime = Date.now();

    // Build messages for OpenAI
    const messages = this.buildMessages(prompt);
    const rawRequest = {
      model: this.modelId,
      messages,
      response_format: { type: 'json_object' },
    };

    let rawResponse: unknown;
    let promptTokens: number | null = null;
    let completionTokens: number | null = null;
    let responseContent: string | null = null;
    let lastError: Error | null = null;

    // Retry loop for API calls
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        // Exponential backoff delay (skip on first attempt)
        if (attempt > 0) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
          await this.sleep(delay);
        }

        const response = await this.client.chat.completions.create({
          model: this.modelId,
          messages,
          response_format: { type: 'json_object' },
        });

        rawResponse = response;
        promptTokens = response.usage?.prompt_tokens ?? null;
        completionTokens = response.usage?.completion_tokens ?? null;
        responseContent = response.choices[0]?.message?.content ?? '{}';

        // Try to parse JSON - retry on invalid JSON
        try {
          const parsed = this.parseResponse(responseContent);
          const latencyMs = Date.now() - startTime;

          // Log successful call
          await this.logCall(rawRequest, rawResponse, promptTokens, completionTokens, latencyMs, false);

          return parsed;
        } catch (parseError) {
          lastError = parseError as Error;
          // Continue to retry on JSON parse error
          if (attempt === MAX_RETRIES) {
            break; // Will fall through to fallback
          }
          continue;
        }
      } catch (error) {
        lastError = error as Error;

        // Check if error is retryable
        if (!this.isRetryableError(error)) {
          break; // Non-retryable error, go to fallback
        }

        // Continue to next retry attempt
        if (attempt === MAX_RETRIES) {
          break; // Will fall through to fallback
        }
      }
    }

    // All retries exhausted - return fallback
    const latencyMs = Date.now() - startTime;

    // Log fallback with metadata
    await this.logCall(
      rawRequest,
      { fallback: true, error: lastError?.message ?? 'Unknown error' },
      promptTokens,
      completionTokens,
      latencyMs,
      true
    );

    return { ...FALLBACK_RESPONSE };
  }

  /**
   * Log LLM call to storage
   */
  private async logCall(
    rawRequest: unknown,
    rawResponse: unknown,
    promptTokens: number | null,
    completionTokens: number | null,
    latencyMs: number,
    isFallback: boolean
  ): Promise<void> {
    const responseWithMetadata = isFallback
      ? { ...rawResponse as object, metadata: { fallback: true } }
      : rawResponse;

    const logRecord: LlmCallRecord = {
      id: generateId(),
      eventId: null,
      showId: this.showId,
      characterId: this.characterId,
      modelAdapterId: `${this.providerId}/${this.modelId}`,
      promptTokens,
      completionTokens,
      rawRequest: JSON.stringify(rawRequest),
      rawResponse: JSON.stringify(responseWithMetadata),
      latencyMs,
      createdAt: Date.now(),
    };

    await this.store.logLLMCall(logRecord);
  }

  /**
   * Check if error is retryable (429, 500, 502, 503)
   */
  private isRetryableError(error: unknown): boolean {
    if (error instanceof OpenAI.APIError) {
      return RETRYABLE_STATUS_CODES.includes(error.status);
    }
    return false;
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Estimate token count for prompt
   *
   * Simple estimation: words * 1.3
   * TASK-024 will add tiktoken-based accurate counting
   */
  estimateTokens(prompt: PromptPackage): number {
    const { systemPrompt, contextLayers, trigger } = prompt;

    const allText = [
      systemPrompt,
      contextLayers.factsList.join(' '),
      contextLayers.slidingWindow.map(e => e.content).join(' '),
      trigger,
    ].join(' ');

    const wordCount = allText.split(/\s+/).filter(w => w.length > 0).length;
    return Math.ceil(wordCount * 1.3);
  }

  /**
   * Build OpenAI messages from PromptPackage
   */
  private buildMessages(prompt: PromptPackage): OpenAI.Chat.ChatCompletionMessageParam[] {
    const { systemPrompt, contextLayers, trigger } = prompt;

    // Build context section
    const contextParts: string[] = [];

    if (contextLayers.factsList.length > 0) {
      contextParts.push('FACTS:\n' + contextLayers.factsList.map(f => `- ${f}`).join('\n'));
    }

    if (contextLayers.slidingWindow.length > 0) {
      const history = contextLayers.slidingWindow
        .map(e => `[${e.senderId}]: ${e.content}`)
        .join('\n');
      contextParts.push('RECENT EVENTS:\n' + history);
    }

    const contextMessage = contextParts.length > 0 ? contextParts.join('\n\n') : '';

    // Response format instruction
    const formatInstruction = `
Respond with a JSON object containing:
- "text": your spoken response (required)
- "intent": one of "speak", "request_private", "reveal_wildcard", "end_turn", "request_to_speak", "request_interrupt" (optional)
- "target": character ID for private request (optional)
- "decisionValue": your decision/vote value (optional)
`;

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: systemPrompt + '\n\n' + formatInstruction,
      },
    ];

    if (contextMessage) {
      messages.push({
        role: 'user',
        content: contextMessage,
      });
    }

    messages.push({
      role: 'user',
      content: trigger,
    });

    return messages;
  }

  /**
   * Parse JSON response from LLM
   */
  private parseResponse(content: string): CharacterResponse {
    const data = JSON.parse(content);

    const response: CharacterResponse = {
      text: typeof data.text === 'string' ? data.text : '',
    };

    // Parse intent if valid
    if (data.intent && Object.values(CharacterIntent).includes(data.intent)) {
      response.intent = data.intent as CharacterIntent;
    }

    // Copy optional fields
    if (typeof data.target === 'string') {
      response.target = data.target;
    }
    if (typeof data.decisionValue === 'string') {
      response.decisionValue = data.decisionValue;
    }

    return response;
  }
}
