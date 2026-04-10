/**
 * SummaryMemory - ConversationSummaryBufferMemory implementation
 * Based on TASK-105: Summary-based context memory
 *
 * Hybrid approach:
 * - Last N messages kept in full (buffer)
 * - Older messages summarized via LLM (summary)
 *
 * Format: "РАНЕЕ: [summary]\nНЕДАВНО:\n[полные сообщения]"
 */

import OpenAI from 'openai';
import type { IStore } from '../types/interfaces/store.interface.js';
import type { EventJournal } from './event-journal.js';
import type { EventSummary, ShowEvent } from '../types/events.js';
import type { SummaryConfig, ContextSummary} from '../types/summary.js';
import { DEFAULT_SUMMARY_CONFIG } from '../types/summary.js';
import { EventType } from '../types/enums.js';

/**
 * Summarization prompt template (from TASK-105)
 */
const SUMMARIZATION_PROMPT = `Сожми следующий диалог в 2-3 ключевых предложения. Сохрани: кто что предложил, союзы/конфликты, важные решения. Не добавляй своих оценок.

Диалог:
{messages}

Краткое содержание:`;

/**
 * Result of getContext call
 */
export interface SummaryContext {
  /** LLM-generated summary of older events (null if no summary yet) */
  summary: string | null;

  /** Recent events kept in full */
  buffer: EventSummary[];
}

/**
 * SummaryMemory implements ConversationSummaryBufferMemory pattern
 *
 * Usage:
 * 1. Call getContext() to get summary + recent messages for prompt
 * 2. Call checkAndSummarize() after each turn to trigger summarization if needed
 */
export class SummaryMemory {
  private config: SummaryConfig;
  private openaiClient: OpenAI | null = null;

  constructor(
    private readonly store: IStore,
    private readonly journal: EventJournal,
    config?: Partial<SummaryConfig>,
    openaiApiKey?: string
  ) {
    this.config = { ...DEFAULT_SUMMARY_CONFIG, ...config };

    if (openaiApiKey) {
      this.openaiClient = new OpenAI({ apiKey: openaiApiKey });
    }
  }

  /**
   * Get context for a character: summary + buffer of recent messages
   *
   * @param showId - Show ID
   * @param characterId - Character ID
   * @param nameMap - Map of character IDs to display names
   * @returns Summary text (or null) and buffer of recent events
   */
  async getContext(
    showId: string,
    characterId: string,
    nameMap: Map<string, string>
  ): Promise<SummaryContext> {
    // Get stored summary
    const storedSummary = await this.store.getContextSummary(showId, characterId);
    const summary = storedSummary?.summaryText || null;

    // Get recent events for buffer (last N)
    const allEvents = await this.journal.getVisibleEvents(showId, characterId);
    const bufferEvents = allEvents.slice(-this.config.bufferSize);

    // Convert to EventSummary format
    const buffer = bufferEvents.map((event) => ({
      senderId: event.senderId,
      senderName: nameMap.get(event.senderId) ?? event.senderId,
      channel: event.channel,
      content: event.content,
      timestamp: event.timestamp,
    }));

    return { summary, buffer };
  }

  /**
   * Check if summarization is needed and trigger if threshold reached
   *
   * Called after each turn or on phase change.
   * Summarizes messages that are older than the buffer window.
   *
   * @param showId - Show ID
   * @param characterId - Character ID
   * @param nameMap - Map of character IDs to display names
   * @param force - Force summarization (e.g., on phase change)
   */
  async checkAndSummarize(
    showId: string,
    characterId: string,
    nameMap: Map<string, string>,
    force: boolean = false
  ): Promise<void> {
    if (!this.openaiClient) {
      // Summarization disabled (no API key)
      return;
    }

    // Get all visible events
    const allEvents = await this.journal.getVisibleEvents(showId, characterId);
    const totalMessages = allEvents.filter((e) => this.isMessageEvent(e)).length;

    // Get current summary state
    const storedSummary = await this.store.getContextSummary(showId, characterId);
    const summarizedCount = storedSummary?.messageCount ?? 0;

    // Calculate how many new messages since last summarization
    const newMessagesSinceSummary = totalMessages - summarizedCount;

    // Check if we need to summarize
    // Trigger when: new messages exceed threshold OR forced (phase change)
    const shouldSummarize =
      force || newMessagesSinceSummary >= this.config.summarizeThreshold;

    if (!shouldSummarize) {
      return;
    }

    // Get messages to summarize (everything except the buffer)
    const bufferStart = Math.max(0, allEvents.length - this.config.bufferSize);
    const eventsToSummarize = allEvents.slice(0, bufferStart);

    if (eventsToSummarize.length === 0) {
      return;
    }

    // Get the last sequence number from events to summarize
    const lastSeqNumber =
      eventsToSummarize[eventsToSummarize.length - 1]?.sequenceNumber ?? 0;

    // Build messages text for summarization
    const messagesText = eventsToSummarize
      .filter((e) => this.isMessageEvent(e))
      .map((e) => `[${nameMap.get(e.senderId) ?? e.senderId}]: ${e.content}`)
      .join('\n');

    if (!messagesText.trim()) {
      return;
    }

    // Get existing summary to extend
    const existingSummary = storedSummary?.summaryText || '';

    // Generate new summary via LLM
    const newSummary = await this.summarize(messagesText, existingSummary);

    // Store the summary
    const contextSummary: ContextSummary = {
      showId,
      characterId,
      summaryText: newSummary,
      lastSequenceNumber: lastSeqNumber,
      messageCount: eventsToSummarize.filter((e) => this.isMessageEvent(e)).length,
      updatedAt: Date.now(),
    };

    await this.store.upsertContextSummary(contextSummary);
  }

  /**
   * Generate summary via LLM
   *
   * If there's an existing summary, it will be extended with new information.
   *
   * @param messages - Formatted message text to summarize
   * @param existingSummary - Previous summary to extend (if any)
   * @returns New summary text
   */
  private async summarize(
    messages: string,
    existingSummary: string
  ): Promise<string> {
    if (!this.openaiClient) {
      return existingSummary;
    }

    // Build prompt
    let promptContent: string;
    if (existingSummary) {
      // Extend existing summary
      promptContent = `Существующее резюме:\n${existingSummary}\n\nНовые сообщения:\n${messages}\n\nОбнови резюме, включив ключевую информацию из новых сообщений. Сохрани: кто что предложил, союзы/конфликты, важные решения. Не добавляй своих оценок. Ответь 2-3 предложениями.`;
    } else {
      // Initial summary
      promptContent = SUMMARIZATION_PROMPT.replace('{messages}', messages);
    }

    try {
      const response = await this.openaiClient.chat.completions.create({
        model: this.config.summaryModel,
        messages: [{ role: 'user', content: promptContent }],
        max_tokens: 300,
        temperature: 0.3, // Lower temperature for more consistent summaries
      });

      return response.choices[0]?.message?.content?.trim() ?? existingSummary;
    } catch (error) {
      console.error('[SummaryMemory] Summarization failed:', error);
      return existingSummary;
    }
  }

  /**
   * Check if event is a message event (speech, decision, revelation)
   * These are the events we want to include in summaries
   */
  private isMessageEvent(event: ShowEvent): boolean {
    return (
      event.type === EventType.speech ||
      event.type === EventType.decision ||
      event.type === EventType.revelation
    );
  }

  /**
   * Get the current configuration
   */
  getConfig(): SummaryConfig {
    return { ...this.config };
  }
}
