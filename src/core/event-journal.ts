/**
 * EventJournal - Append-only event log for show events
 * Based on PRD.md - Event Journal pattern
 */

import { EventEmitter } from 'events';
import type { ShowEvent } from '../types/events.js';
import type { IStore, ShowRecord, ShowCharacterRecord } from '../types/interfaces/store.interface.js';

/**
 * Export format for show journal
 * Designed to be self-contained and suitable for future import
 */
export interface JournalExport {
  version: '1.0';
  exportedAt: number;
  show: ShowRecord;
  characters: ShowCharacterRecord[];
  events: ShowEvent[];
}

export interface GetEventsOptions {
  cursor?: number;
  limit?: number;
  characterId?: string;
}

/**
 * EventJournal wraps IStore to provide event logging functionality
 * with automatic sequence number assignment and filtering.
 * Extends EventEmitter to notify subscribers of new events in real-time.
 */
export class EventJournal extends EventEmitter {
  constructor(private readonly store: IStore) {
    super();
  }

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

    // Emit event for real-time subscribers (SSE)
    this.emit('event', fullEvent);

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

  /**
   * Rollback journal to a specific sequence number (DEBUG mode)
   * Deletes all events AFTER the specified sequence number
   * @param showId - Show ID to rollback
   * @param sequenceNumber - Keep events up to and including this sequence
   * @returns Number of deleted events
   */
  async rollbackToSequence(showId: string, sequenceNumber: number): Promise<number> {
    const latestSeq = await this.store.getLatestSequence(showId);

    if (sequenceNumber >= latestSeq) {
      return 0; // Nothing to delete
    }

    const deletedCount = latestSeq - sequenceNumber;
    await this.store.deleteEventsAfter(showId, sequenceNumber);
    return deletedCount;
  }

  /**
   * Rollback journal to the start of a specific phase (DEBUG mode)
   * Deletes all events from the specified phase onwards
   * @param showId - Show ID to rollback
   * @param phaseId - Phase ID to rollback to (events in this phase will be deleted)
   * @returns Number of deleted events
   */
  async rollbackToPhase(showId: string, phaseId: string): Promise<number> {
    const events = await this.store.getEvents(showId);

    // Find the first event in the target phase
    const firstPhaseEvent = events.find((e) => e.phaseId === phaseId);

    if (!firstPhaseEvent) {
      return 0; // Phase not found, nothing to delete
    }

    // Delete events from the start of this phase onwards
    // We want to keep events BEFORE this phase, so delete after sequenceNumber - 1
    const keepUntil = firstPhaseEvent.sequenceNumber - 1;
    const latestSeq = await this.store.getLatestSequence(showId);

    if (keepUntil < 0) {
      // Phase starts at the beginning, delete all events
      await this.store.deleteEventsAfter(showId, 0);
      return latestSeq;
    }

    const deletedCount = latestSeq - keepUntil;
    await this.store.deleteEventsAfter(showId, keepUntil);
    return deletedCount;
  }

  /**
   * Export journal to JSON format
   * Includes all events, show metadata, and characters
   * @param showId - Show ID to export
   * @returns JSON string with complete show data
   * @throws Error if show not found
   */
  async exportJournal(showId: string): Promise<string> {
    // Get show metadata
    const show = await this.store.getShow(showId);
    if (!show) {
      throw new Error(`Show not found: ${showId}`);
    }

    // Get all characters
    const characters = await this.store.getCharacters(showId);

    // Get all events
    const events = await this.store.getEvents(showId);

    // Build export object
    const exportData: JournalExport = {
      version: '1.0',
      exportedAt: Date.now(),
      show,
      characters,
      events,
    };

    return JSON.stringify(exportData, null, 2);
  }
}
