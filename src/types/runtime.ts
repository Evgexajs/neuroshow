/**
 * Neuroshow Runtime Types
 * Based on PRD.md Appendix A - TypeScript Interfaces
 *
 * Show: Runtime state of a show instance
 * TokenBudgetState: Token budget tracking for a show
 * ShowCharacter: Character instance within a show
 */

import { ShowStatus, BudgetMode } from './enums.js';
import { PrivateContext } from './context.js';

/**
 * Runtime state of a show instance
 *
 * Represents the current state of a running show including:
 * - Identification and seeding for reproducibility
 * - Current status and phase tracking
 * - Timestamps for timing analysis
 * - Configuration snapshot for consistency
 */
export interface Show {
  /** Unique identifier for this show instance */
  id: string;

  /** Reference to the ShowFormatTemplate this show is based on */
  formatId: string;

  /** Random seed for reproducibility of AI responses */
  seed: number;

  /** Current status of the show */
  status: ShowStatus;

  /** ID of the currently active phase */
  currentPhaseId: string | null;

  /** Timestamp when the show started (null if not yet started) */
  startedAt: Date | null;

  /** Timestamp when the show completed (null if still running) */
  completedAt: Date | null;

  /** Snapshot of the configuration at show start for consistency */
  configSnapshot: Record<string, unknown>;
}

/**
 * Token budget state for a show
 *
 * Tracks token usage and budget mode to ensure the show
 * stays within allocated token limits:
 * - Monitors prompt and completion tokens separately
 * - Transitions to budget_saving/graceful_finish when limits approach
 */
export interface TokenBudgetState {
  /** Show this budget belongs to */
  showId: string;

  /** Total token limit for the entire show */
  totalLimit: number;

  /** Tokens used for prompts (input) */
  usedPrompt: number;

  /** Tokens used for completions (output) */
  usedCompletion: number;

  /** Current budget mode */
  mode: BudgetMode;

  /** Last update timestamp */
  lastUpdated: Date;
}

/**
 * Character instance within a show
 *
 * Represents a character participating in a specific show:
 * - Links character to their assigned model adapter
 * - Maintains evolving private context throughout the show
 */
export interface ShowCharacter {
  /** Show this character instance belongs to */
  showId: string;

  /** Reference to the CharacterDefinition */
  characterId: string;

  /** ID of the model adapter assigned to this character */
  modelAdapterId: string;

  /** Character's current private context (evolves during show) */
  privateContext: PrivateContext;
}
