/**
 * Neuroshow Adapter Types
 * Based on PRD.md Appendix A - TypeScript Interfaces
 *
 * PromptPackage: Data sent to LLM adapter
 * CharacterResponse: Structured response from LLM
 * ModelAdapter: Interface for LLM providers
 */

import type { ContextLayers } from './context.js';
import type { ResponseConstraints } from './primitives.js';
import type { CharacterIntent } from './enums.js';

/**
 * Package sent to ModelAdapter for LLM call
 *
 * Contains everything needed to generate a character's response:
 * - systemPrompt: personality + motivation + boundaries + format instruction
 * - contextLayers: character's information prison (what they can see)
 * - trigger: the prompt/question for this turn
 * - responseConstraints: limits on response format and length
 */
export interface PromptPackage {
  /** System prompt with personality, motivation, boundaries, and format instruction */
  systemPrompt: string;

  /** Context layers (facts + sliding window) */
  contextLayers: ContextLayers;

  /** The trigger/prompt for this turn (host question, phase instruction, etc.) */
  trigger: string;

  /** Constraints on the response */
  responseConstraints: ResponseConstraints;
}

/**
 * Structured response from LLM
 *
 * All LLM calls return this structured format so the orchestrator
 * can read machine-readable signals without parsing natural language.
 */
export interface CharacterResponse {
  /** Character's spoken text (visible to others) */
  text: string;

  /** Character's intent signal (optional) */
  intent?: CharacterIntent;

  /** Target character ID for private request or decision (optional) */
  target?: string;

  /** Decision value for voting/decision phases (optional) */
  decisionValue?: string;
}

/**
 * Token estimate result from estimateTokens()
 */
export interface TokenEstimate {
  /** Estimated prompt tokens (system + context + trigger) */
  prompt: number;

  /** Estimated completion tokens (based on responseConstraints.maxTokens or default) */
  estimatedCompletion: number;
}

/**
 * Interface for LLM provider adapters
 *
 * Each adapter (OpenAI, Anthropic, Mock, etc.) implements this interface.
 * The engine interacts with all adapters through this contract.
 */
export interface ModelAdapter {
  /** Provider identifier (e.g., "openai", "anthropic", "mock") */
  providerId: string;

  /** Model identifier (e.g., "gpt-4o", "gpt-4o-mini", "mock") */
  modelId: string;

  /**
   * Call the LLM with a prompt package
   * @param prompt - The prompt package to send
   * @returns Character's structured response
   */
  call(prompt: PromptPackage): Promise<CharacterResponse>;

  /**
   * Estimate token count before making the call (for budget control)
   * @param prompt - The prompt package to estimate
   * @returns Token estimate with prompt and estimatedCompletion counts
   */
  estimateTokens(prompt: PromptPackage): TokenEstimate;
}
