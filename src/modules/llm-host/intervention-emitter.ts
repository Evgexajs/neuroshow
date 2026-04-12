/**
 * InterventionEmitter - Records host interventions as ShowEvents
 * HOST-007: Реализовать InterventionEmitter для записи интервенций
 *
 * Converts LLM host responses into ShowEvents and appends them to the journal.
 */

import type { IStore, ShowRecord } from '../../types/interfaces/store.interface.js';
import type { EventJournal } from '../../core/event-journal.js';
import type { ShowEvent } from '../../types/events.js';
import { EventType, ChannelType } from '../../types/enums.js';
import { generateId } from '../../utils/id.js';
import type { HostInterventionResponse, EvaluatedTrigger, InterventionType } from './types.js';

/**
 * Parsed config snapshot from ShowRecord
 */
interface ConfigSnapshot {
  characterDefinitions?: Array<{ id: string; name: string }>;
}

/**
 * Metadata structure for host_trigger events
 */
export interface HostInterventionMetadata {
  /** Type of intervention */
  interventionType: InterventionType;

  /** Type of trigger that caused this intervention */
  triggeredBy: string;

  /** Target character ID (for question/private_directive) */
  targetCharacterId?: string;

  /** Whether this intervention requires a response from target */
  requiresResponse: boolean;
}

/**
 * InterventionEmitter class
 *
 * Responsible for:
 * - Converting HostInterventionResponse into ShowEvent
 * - Setting correct metadata (interventionType, triggeredBy, targetCharacterId, requiresResponse)
 * - Determining channel (PUBLIC vs PRIVATE) based on intervention type
 * - Appending events to the journal
 */
export class InterventionEmitter {
  constructor(
    private readonly store: IStore,
    private readonly eventJournal: EventJournal
  ) {}

  /**
   * Emit a host intervention as a ShowEvent
   *
   * @param showId - ID of the show
   * @param response - LLM-generated intervention response
   * @param trigger - The evaluated trigger that caused this intervention
   * @returns The emitted ShowEvent with sequenceNumber assigned
   * @throws Error if show not found
   */
  async emit(
    showId: string,
    response: HostInterventionResponse,
    trigger: EvaluatedTrigger
  ): Promise<ShowEvent> {
    // Get show record to determine phaseId and characters
    const show = await this.store.getShow(showId);
    if (!show) {
      throw new Error(`Show not found: ${showId}`);
    }

    // Determine channel and audience based on intervention type
    const { channel, audienceIds } = this.determineChannelAndAudience(
      show,
      response.interventionType,
      response.targetCharacterId
    );

    // Build metadata
    const metadata: Record<string, unknown> = {
      interventionType: response.interventionType,
      triggeredBy: trigger.type,
      requiresResponse: response.interventionType === 'question',
    };

    // Add targetCharacterId if present
    if (response.targetCharacterId) {
      metadata.targetCharacterId = response.targetCharacterId;
    }

    // Create event (without sequenceNumber - assigned by EventJournal)
    const event: Omit<ShowEvent, 'sequenceNumber'> = {
      id: generateId(),
      showId,
      timestamp: Date.now(),
      phaseId: show.currentPhaseId ?? '',
      type: EventType.host_trigger,
      channel,
      visibility: channel, // Visibility matches channel for host events
      senderId: '', // Host events have empty senderId
      receiverIds: audienceIds,
      audienceIds,
      content: response.text,
      metadata,
      seed: generateId(), // Generate unique seed for this intervention
    };

    // Append to journal and return the complete event
    return await this.eventJournal.append(event);
  }

  /**
   * Determine channel and audience based on intervention type
   *
   * @param show - Show record
   * @param interventionType - Type of intervention
   * @param targetCharacterId - Optional target character
   * @returns Channel and audience IDs
   */
  private determineChannelAndAudience(
    show: ShowRecord,
    interventionType: InterventionType,
    targetCharacterId?: string
  ): { channel: ChannelType; audienceIds: string[] } {
    // Get all character IDs from config snapshot
    const allCharacterIds = this.getCharacterIds(show);

    // Private directive goes only to target
    if (interventionType === 'private_directive' && targetCharacterId) {
      return {
        channel: ChannelType.PRIVATE,
        audienceIds: [targetCharacterId],
      };
    }

    // All other interventions are public
    return {
      channel: ChannelType.PUBLIC,
      audienceIds: allCharacterIds,
    };
  }

  /**
   * Extract character IDs from show config snapshot
   *
   * @param show - Show record
   * @returns Array of character IDs
   */
  private getCharacterIds(show: ShowRecord): string[] {
    try {
      const config: ConfigSnapshot = JSON.parse(show.configSnapshot);
      return config.characterDefinitions?.map((c) => c.id) ?? [];
    } catch {
      return [];
    }
  }
}
