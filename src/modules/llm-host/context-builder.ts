/**
 * HostContextBuilder - builds context for LLM host interventions
 *
 * Constructs the context passed to the LLM when generating interventions:
 * - Show and phase information
 * - Character names (but NOT their privateContext - security boundary)
 * - Recent events (sliding window, configurable size)
 * - Trigger information
 * - Budget state
 */

import type { IStore } from '../../types/interfaces/store.interface.js';
import type { ShowEvent, EventSummary } from '../../types/events.js';
import type { Phase } from '../../types/template.js';
import type {
  LLMHostConfig,
  HostContext,
  EvaluatedTrigger,
  HostBudgetRecord,
} from './types.js';
import { HostBudgetMode } from '../../types/enums.js';

/**
 * Extended config snapshot that includes characterDefinitions
 * (stored in configSnapshot JSON, not in ShowFormatTemplate type)
 */
interface ConfigSnapshotWithCharacters {
  phases: Phase[];
  characterDefinitions?: Array<{ id: string; name: string }>;
}

/**
 * Builds context for LLM host to generate interventions
 */
export class HostContextBuilder {
  constructor(
    private readonly store: IStore,
    private readonly config: LLMHostConfig
  ) {}

  /**
   * Build context for an LLM host intervention
   *
   * @param showId - Show ID
   * @param trigger - Evaluated trigger that caused this intervention
   * @returns HostContext ready for prompt building
   */
  async build(showId: string, trigger: EvaluatedTrigger): Promise<HostContext> {
    // Get show record
    const showRecord = await this.store.getShow(showId);
    if (!showRecord) {
      throw new Error(`Show not found: ${showId}`);
    }

    // Parse config from config snapshot
    const configSnapshot = JSON.parse(showRecord.configSnapshot) as ConfigSnapshotWithCharacters;

    // Get current phase
    const currentPhase = this.findPhase(configSnapshot.phases, showRecord.currentPhaseId);
    if (!currentPhase) {
      throw new Error(`Phase not found: ${showRecord.currentPhaseId}`);
    }

    // Build character name map (id -> name)
    // Uses characterDefinitions from config snapshot, NOT from show_characters table
    // This avoids accessing privateContext
    const nameMap = this.buildNameMap(configSnapshot.characterDefinitions);
    const characterNames = Array.from(nameMap.values());

    // Get recent events
    const recentEvents = await this.buildRecentEvents(
      showId,
      this.config.hostContextWindowSize,
      nameMap
    );

    // Get host budget
    const hostBudget = await this.getHostBudget(showId);

    return {
      showId,
      currentPhase,
      characterNames,
      recentEvents,
      triggerEvent: trigger.triggerEvent,
      triggerType: trigger.type,
      hostBudget,
    };
  }

  /**
   * Find phase by ID in phases array
   *
   * @param phases - Array of phases
   * @param phaseId - Phase ID to find
   * @returns Phase or null if not found
   */
  private findPhase(phases: Phase[], phaseId: string | null): Phase | null {
    if (!phaseId) {
      return null;
    }
    return phases.find((p) => p.id === phaseId) ?? null;
  }

  /**
   * Build a map of character IDs to display names
   * Uses only public information from character definitions
   *
   * @param characterDefinitions - Character definitions from template
   * @returns Map of characterId -> displayName
   */
  private buildNameMap(
    characterDefinitions?: Array<{ id: string; name: string }>
  ): Map<string, string> {
    const nameMap = new Map<string, string>();

    if (!characterDefinitions) {
      return nameMap;
    }

    for (const char of characterDefinitions) {
      nameMap.set(char.id, char.name);
    }

    return nameMap;
  }

  /**
   * Get recent events and convert to EventSummary format
   * Events are ordered by sequence number (oldest first in window)
   *
   * @param showId - Show ID
   * @param limit - Maximum number of events to include
   * @param nameMap - Character ID to name mapping
   * @returns Array of EventSummary
   */
  private async buildRecentEvents(
    showId: string,
    limit: number,
    nameMap: Map<string, string>
  ): Promise<EventSummary[]> {
    // Get all events for the show
    const allEvents = await this.store.getEvents(showId);

    // Take the last N events
    const recentEvents = allEvents.slice(-limit);

    // Convert to EventSummary, substituting character names
    return recentEvents.map((event) => this.toEventSummary(event, nameMap));
  }

  /**
   * Convert ShowEvent to EventSummary
   *
   * @param event - Full show event
   * @param nameMap - Character ID to name mapping
   * @returns EventSummary with resolved names
   */
  private toEventSummary(
    event: ShowEvent,
    nameMap: Map<string, string>
  ): EventSummary {
    return {
      senderId: event.senderId,
      senderName: nameMap.get(event.senderId) ?? event.senderId,
      channel: event.channel,
      content: event.content,
      timestamp: event.timestamp,
    };
  }

  /**
   * Get host budget for show
   * Returns a default budget if not found (for safety)
   *
   * @param showId - Show ID
   * @returns HostBudgetRecord
   */
  private async getHostBudget(showId: string): Promise<HostBudgetRecord> {
    const budget = await this.store.getHostBudget(showId);

    if (budget) {
      return budget;
    }

    // Return default budget if not found
    // This shouldn't happen in normal flow, but provides safety
    return {
      showId,
      totalLimit: this.config.hostBudget,
      usedPrompt: 0,
      usedCompletion: 0,
      mode: HostBudgetMode.normal,
      lastUpdated: Date.now(),
    };
  }
}
