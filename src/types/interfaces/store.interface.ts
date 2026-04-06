/**
 * Neuroshow Storage Interface
 * Based on PRD.md Section 5 - Data Model
 *
 * IStore defines the contract for storage implementations.
 * MVP uses SQLite, but interface allows for other backends.
 */

import { ShowEvent } from '../events.js';
import { ShowStatus, BudgetMode } from '../enums.js';
import { PrivateContext } from '../context.js';

/**
 * Show record in storage
 */
export interface ShowRecord {
  id: string;
  formatId: string;
  seed: string;
  status: ShowStatus;
  currentPhaseId: string | null;
  startedAt: number | null;
  completedAt: number | null;
  configSnapshot: string; // JSON
}

/**
 * Character assignment in a show
 */
export interface ShowCharacterRecord {
  showId: string;
  characterId: string;
  modelAdapterId: string;
  privateContext: PrivateContext;
}

/**
 * LLM call log for debugging and replay
 */
export interface LlmCallRecord {
  id: string;
  eventId: string | null;
  showId: string;
  characterId: string;
  modelAdapterId: string;
  promptTokens: number | null;
  completionTokens: number | null;
  rawRequest: string; // JSON
  rawResponse: string; // JSON
  latencyMs: number | null;
  createdAt: number;
}

/**
 * Token budget state for a show
 */
export interface TokenBudgetRecord {
  showId: string;
  totalLimit: number;
  usedPrompt: number;
  usedCompletion: number;
  mode: BudgetMode;
  lastUpdated: number;
}

/**
 * Storage interface for Neuroshow
 *
 * Provides CRUD operations for all persistence needs.
 * Implementations must be transactional where needed.
 */
export interface IStore {
  // ─── Shows ─────────────────────────────────────────────────────

  /** Create a new show, returns show id */
  createShow(show: ShowRecord): Promise<string>;

  /** Get show by ID */
  getShow(id: string): Promise<ShowRecord | null>;

  /** Update show status and current phase */
  updateShow(id: string, updates: Partial<ShowRecord>): Promise<void>;

  /** List all shows (optionally filter by status) */
  listShows(status?: ShowStatus): Promise<ShowRecord[]>;

  // ─── Show Characters ───────────────────────────────────────────

  /** Create character in show */
  createCharacter(char: ShowCharacterRecord): Promise<void>;

  /** Get character in show */
  getCharacter(showId: string, characterId: string): Promise<ShowCharacterRecord | null>;

  /** Get all characters in show */
  getCharacters(showId: string): Promise<ShowCharacterRecord[]>;

  /** Update character's private context */
  updateShowCharacterContext(showId: string, characterId: string, privateContext: PrivateContext): Promise<void>;

  // ─── Events (Journal) ──────────────────────────────────────────

  /** Append event to journal (returns assigned sequence number) */
  appendEvent(event: ShowEvent): Promise<number>;

  /** Get events for show (optionally from sequence number) */
  getEvents(showId: string, fromSequence?: number): Promise<ShowEvent[]>;

  /** Get events visible to specific character */
  getEventsForCharacter(showId: string, characterId: string, fromSequence?: number): Promise<ShowEvent[]>;

  /** Delete events after sequence number (for rollback) */
  deleteEventsAfter(showId: string, afterSequence: number): Promise<void>;

  /** Get latest sequence number for show */
  getLatestSequence(showId: string): Promise<number>;

  // ─── LLM Calls ─────────────────────────────────────────────────

  /** Log an LLM call */
  logLlmCall(record: LlmCallRecord): Promise<void>;

  /** Get LLM calls for show */
  getLlmCalls(showId: string): Promise<LlmCallRecord[]>;

  // ─── Token Budget ──────────────────────────────────────────────

  /** Initialize token budget for show */
  initTokenBudget(showId: string, totalLimit: number): Promise<void>;

  /** Get token budget state */
  getTokenBudget(showId: string): Promise<TokenBudgetRecord | null>;

  /** Update token budget (add used tokens) */
  updateTokenBudget(showId: string, promptTokens: number, completionTokens: number): Promise<void>;

  /** Set budget mode */
  setBudgetMode(showId: string, mode: BudgetMode): Promise<void>;

  // ─── Lifecycle ─────────────────────────────────────────────────

  /** Initialize storage schema (create tables, etc.) */
  initSchema(): Promise<void>;

  /** Close storage connection */
  close(): Promise<void>;
}
