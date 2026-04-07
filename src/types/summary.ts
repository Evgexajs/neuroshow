/**
 * Neuroshow Summary Memory Types
 * Based on TASK-105: Summary-based context memory
 *
 * ConversationSummaryBufferMemory pattern:
 * - Last N messages kept in full (buffer)
 * - Older messages summarized via LLM
 */

/**
 * Context summary stored in database
 */
export interface ContextSummary {
  /** Show ID */
  showId: string;

  /** Character ID (summary is per-character) */
  characterId: string;

  /** LLM-generated summary text */
  summaryText: string;

  /** Last event sequence number included in summary */
  lastSequenceNumber: number;

  /** Total messages that have been summarized */
  messageCount: number;

  /** Unix timestamp of last update */
  updatedAt: number;
}

/**
 * Configuration for summary memory
 */
export interface SummaryConfig {
  /** Number of recent messages to keep in full (default: 20) */
  bufferSize: number;

  /** Trigger summarization when this many new messages since last summary (default: 15) */
  summarizeThreshold: number;

  /** Model to use for summarization (default: gpt-4o-mini) */
  summaryModel: string;
}

/**
 * Default summary configuration
 */
export const DEFAULT_SUMMARY_CONFIG: SummaryConfig = {
  bufferSize: 20,
  summarizeThreshold: 15,
  summaryModel: 'gpt-4o-mini',
};
