/**
 * Neuroshow Event Types
 * Based on PRD.md Appendix A - TypeScript Interfaces
 *
 * ShowEvent: Full event record stored in the journal
 * EventSummary: Simplified version for Context Builder sliding window
 */

import type { EventType, ChannelType } from './enums.js';

/**
 * Full event record in the show journal (append-only log)
 *
 * Events track everything that happens during a show:
 * - speech: character dialogue
 * - host_trigger: host interventions
 * - phase_start/phase_end: phase transitions
 * - channel_change: switching PUBLIC/PRIVATE/ZONE
 * - decision: character decisions in voting/decision phases
 * - revelation: wildcard reveals
 * - private_injection: host-injected private info (Non-MVP)
 * - system: budget warnings, errors, etc.
 */
export interface ShowEvent {
  /** Unique event ID (UUID) */
  id: string;

  /** Show this event belongs to */
  showId: string;

  /** Unix timestamp (ms) when event occurred */
  timestamp: number;

  /** Auto-incrementing sequence within showId for ordering */
  sequenceNumber: number;

  /** Phase ID when this event occurred */
  phaseId: string;

  /** Type of event */
  type: EventType;

  /** Communication channel */
  channel: ChannelType;

  /** Visibility scope (derived from channel in most cases) */
  visibility: ChannelType;

  /** Character ID who sent this event (empty for system events) */
  senderId: string;

  /** Direct recipients (for PRIVATE messages) */
  receiverIds: string[];

  /** All characters who can see this event */
  audienceIds: string[];

  /** Event content (speech text, decision value, etc.) */
  content: string;

  /** Additional event-specific data */
  metadata: Record<string, unknown>;

  /** Seed for deterministic replay */
  seed: string;
}

/**
 * Simplified event representation for Context Builder
 *
 * Used in the sliding window to give characters recent context
 * without the full event overhead
 */
export interface EventSummary {
  /** Who sent the message (ID) */
  senderId: string;

  /** Who sent the message (display name) */
  senderName: string;

  /** Channel (PUBLIC/PRIVATE/ZONE) */
  channel: ChannelType;

  /** Event content */
  content: string;

  /** When it happened */
  timestamp: number;
}
