/**
 * ReplayAdapter - Replays stored LLM responses from a previous show run
 *
 * Used for replay mechanism: re-runs a show using saved raw_response
 * from llm_calls table instead of making new LLM API calls.
 * Results in identical output to the original show run.
 */

import { ModelAdapter, PromptPackage, CharacterResponse, TokenEstimate } from '../types/adapter.js';
import { IStore, LlmCallRecord } from '../types/interfaces/store.interface.js';

/**
 * Replay adapter that returns stored LLM responses
 *
 * Loads all llm_calls for a show and returns them in order.
 * Each call() invocation returns the next stored response.
 */
export class ReplayAdapter implements ModelAdapter {
  readonly providerId = 'replay';
  readonly modelId = 'replay-v1';

  private llmCalls: LlmCallRecord[] = [];
  private callIndex: number = 0;
  private initialized: boolean = false;

  /**
   * Create a ReplayAdapter
   * @param store - Storage interface to load llm_calls from
   * @param showId - Show ID to load llm_calls for
   */
  constructor(
    private readonly store: IStore,
    private readonly showId: string
  ) {}

  /**
   * Initialize the adapter by loading llm_calls from store
   * Must be called before using call()
   */
  async initialize(): Promise<void> {
    this.llmCalls = await this.store.getLLMCalls(this.showId);
    this.callIndex = 0;
    this.initialized = true;
  }

  /**
   * Return the next stored response from llm_calls
   *
   * @param _prompt - Ignored (responses are pre-recorded)
   * @returns Stored CharacterResponse from raw_response
   * @throws Error if no more calls available or not initialized
   */
  async call(_prompt: PromptPackage): Promise<CharacterResponse> {
    if (!this.initialized) {
      throw new Error('ReplayAdapter not initialized. Call initialize() first.');
    }

    if (this.callIndex >= this.llmCalls.length) {
      throw new Error(
        `ReplayAdapter exhausted: no more stored responses (requested call ${this.callIndex + 1}, have ${this.llmCalls.length})`
      );
    }

    const llmCall = this.llmCalls[this.callIndex]!;
    this.callIndex++;

    // Parse the stored raw_response as CharacterResponse
    const response = JSON.parse(llmCall.rawResponse) as CharacterResponse;
    return response;
  }

  /**
   * Estimate token count (returns stored values if available)
   */
  estimateTokens(_prompt: PromptPackage): TokenEstimate {
    // During replay, we can return the actual token counts if we have them
    if (this.initialized && this.callIndex < this.llmCalls.length) {
      const llmCall = this.llmCalls[this.callIndex]!;
      return {
        prompt: llmCall.promptTokens ?? 0,
        estimatedCompletion: llmCall.completionTokens ?? 256,
      };
    }

    // Default estimate if no calls available
    return {
      prompt: 0,
      estimatedCompletion: 256,
    };
  }

  /**
   * Get the number of stored LLM calls
   */
  getTotalCalls(): number {
    return this.llmCalls.length;
  }

  /**
   * Get the current call index (how many calls have been made)
   */
  getCurrentIndex(): number {
    return this.callIndex;
  }

  /**
   * Reset the call index to replay from the beginning
   */
  reset(): void {
    this.callIndex = 0;
  }
}
