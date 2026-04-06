/**
 * EventJournal - Append-only event log for show events
 * Based on PRD.md - Event Journal pattern
 */

import { ShowEvent } from '../types/events.js';
import { IStore } from '../types/interfaces/store.interface.js';

export interface GetEventsOptions {
  cursor?: number;
  limit?: number;
  characterId?: string;
}

/**
 * EventJournal wraps IStore to provide event logging functionality
 * with automatic sequence number assignment and filtering
 */
export class EventJournal {
  constructor(private readonly store: IStore) {}

  /**
   * Append an event to the journal
   * Automatically assigns sequenceNumber based on store's getLatestSequence
   * @returns The complete event with sequenceNumber assigned
   */
  async append(event: Omit<ShowEvent, 'sequenceNumber'>): Promise<ShowEvent> {
    const latestSeq = await this.store.getLatestSequence(event.showId);
    const sequenceNumber = latestSeq + 1;

    const fullEvent: ShowEvent = {
      ...event,
      sequenceNumber,
    };

    await this.store.appendEvent(fullEvent);
    return fullEvent;
  }

  /**
   * Get events from the journal with optional filtering
   * @param showId - Show ID to get events for
   * @param options - Optional filtering: cursor (fromSequence), limit, characterId
   */
  async getEvents(showId: string, options?: GetEventsOptions): Promise<ShowEvent[]> {
    const { cursor, limit, characterId } = options ?? {};

    let events: ShowEvent[];

    if (characterId) {
      events = await this.store.getEventsForCharacter(showId, characterId, cursor);
    } else {
      events = await this.store.getEvents(showId, cursor);
    }

    if (limit !== undefined && limit > 0) {
      return events.slice(0, limit);
    }

    return events;
  }

  /**
   * Get the latest sequence number for a show
   * Returns 0 if no events exist
   */
  async getLatestSequence(showId: string): Promise<number> {
    return this.store.getLatestSequence(showId);
  }

  /**
   * Get events visible to a specific character
   * Filters events where characterId is present in audienceIds
   * Returns events in chronological order (by sequenceNumber)
   * Supports limit for sliding window in Context Builder
   *
   * @param showId - Show ID to get events for
   * @param characterId - Character ID to filter visibility
   * @param limit - Optional limit for sliding window
   */
  async getVisibleEvents(showId: string, characterId: string, limit?: number): Promise<ShowEvent[]> {
    const events = await this.store.getEventsForCharacter(showId, characterId);

    if (limit !== undefined && limit > 0) {
      // Return last N events (most recent) for sliding window
      return events.slice(-limit);
    }

    return events;
  }
}
