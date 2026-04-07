/**
 * SQLite Storage Implementation
 * Based on PRD.md Section 5 - Data Model
 *
 * Implements IStore interface using better-sqlite3.
 */

import Database from 'better-sqlite3';
import {
  IStore,
  ShowRecord,
  ShowCharacterRecord,
  LlmCallRecord,
  TokenBudgetRecord,
} from '../types/interfaces/store.interface.js';
import { ShowEvent } from '../types/events.js';
import { ShowStatus, BudgetMode } from '../types/enums.js';
import { PrivateContext } from '../types/context.js';
import { ContextSummary } from '../types/summary.js';

/**
 * SQLite-based storage implementation
 */
export class SqliteStore implements IStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    // Enable WAL mode for better concurrent access
    this.db.pragma('journal_mode = WAL');
    // FULL synchronous ensures data is written to disk immediately
    this.db.pragma('synchronous = FULL');
    // Auto-checkpoint after 100 pages (~400KB) instead of default 1000
    this.db.pragma('wal_autocheckpoint = 100');
  }

  /**
   * Initialize database schema
   * Creates all 5 tables: shows, show_characters, show_events, llm_calls, token_budgets
   */
  async initSchema(): Promise<void> {
    // Create shows table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS shows (
        id TEXT PRIMARY KEY,
        format_id TEXT NOT NULL,
        seed TEXT NOT NULL,
        status TEXT NOT NULL,
        current_phase_id TEXT,
        started_at INTEGER,
        completed_at INTEGER,
        config_snapshot TEXT NOT NULL,
        replay_available INTEGER DEFAULT 0
      )
    `);

    // Add replay_available column if it doesn't exist (migration for existing DBs)
    try {
      this.db.exec('ALTER TABLE shows ADD COLUMN replay_available INTEGER DEFAULT 0');
    } catch {
      // Column already exists, ignore error
    }

    // Create show_characters table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS show_characters (
        show_id TEXT NOT NULL,
        character_id TEXT NOT NULL,
        model_adapter_id TEXT NOT NULL,
        private_context TEXT NOT NULL,
        speak_frequency TEXT DEFAULT 'medium',
        PRIMARY KEY (show_id, character_id)
      )
    `);

    // Add speak_frequency column if it doesn't exist (migration for existing DBs)
    try {
      this.db.exec('ALTER TABLE show_characters ADD COLUMN speak_frequency TEXT DEFAULT \'medium\'');
    } catch {
      // Column already exists, ignore error
    }

    // Create show_events table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS show_events (
        id TEXT PRIMARY KEY,
        show_id TEXT NOT NULL,
        sequence_number INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        phase_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        channel TEXT NOT NULL,
        visibility TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        receiver_ids TEXT NOT NULL,
        audience_ids TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT,
        seed TEXT NOT NULL,
        UNIQUE(show_id, sequence_number)
      )
    `);

    // Create indexes for show_events
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_show_events_show_id
      ON show_events(show_id)
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_show_events_sequence
      ON show_events(show_id, sequence_number)
    `);

    // Create llm_calls table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS llm_calls (
        id TEXT PRIMARY KEY,
        event_id TEXT,
        show_id TEXT NOT NULL,
        character_id TEXT NOT NULL,
        model_adapter_id TEXT NOT NULL,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        raw_request TEXT NOT NULL,
        raw_response TEXT NOT NULL,
        latency_ms INTEGER,
        created_at INTEGER NOT NULL
      )
    `);

    // Create token_budgets table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS token_budgets (
        show_id TEXT PRIMARY KEY,
        total_limit INTEGER NOT NULL,
        used_prompt INTEGER DEFAULT 0,
        used_completion INTEGER DEFAULT 0,
        mode TEXT NOT NULL DEFAULT 'normal',
        last_updated INTEGER NOT NULL
      )
    `);

    // Create context_summaries table for SummaryMemory
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS context_summaries (
        show_id TEXT NOT NULL,
        character_id TEXT NOT NULL,
        summary_text TEXT NOT NULL DEFAULT '',
        last_sequence_number INTEGER DEFAULT 0,
        message_count INTEGER DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (show_id, character_id)
      )
    `);
  }

  // ─── Shows ─────────────────────────────────────────────────────

  async createShow(show: ShowRecord): Promise<string> {
    const stmt = this.db.prepare(`
      INSERT INTO shows (id, format_id, seed, status, current_phase_id, started_at, completed_at, config_snapshot, replay_available)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      show.id,
      show.formatId,
      show.seed,
      show.status,
      show.currentPhaseId,
      show.startedAt,
      show.completedAt,
      show.configSnapshot,
      show.replayAvailable ? 1 : 0
    );
    return show.id;
  }

  async getShow(id: string): Promise<ShowRecord | null> {
    const stmt = this.db.prepare('SELECT * FROM shows WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapShowRow(row);
  }

  async updateShow(id: string, updates: Partial<ShowRecord>): Promise<void> {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.formatId !== undefined) {
      fields.push('format_id = ?');
      values.push(updates.formatId);
    }
    if (updates.seed !== undefined) {
      fields.push('seed = ?');
      values.push(updates.seed);
    }
    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.currentPhaseId !== undefined) {
      fields.push('current_phase_id = ?');
      values.push(updates.currentPhaseId);
    }
    if (updates.startedAt !== undefined) {
      fields.push('started_at = ?');
      values.push(updates.startedAt);
    }
    if (updates.completedAt !== undefined) {
      fields.push('completed_at = ?');
      values.push(updates.completedAt);
    }
    if (updates.configSnapshot !== undefined) {
      fields.push('config_snapshot = ?');
      values.push(updates.configSnapshot);
    }
    if (updates.replayAvailable !== undefined) {
      fields.push('replay_available = ?');
      values.push(updates.replayAvailable ? 1 : 0);
    }

    if (fields.length === 0) return;

    values.push(id);
    const stmt = this.db.prepare(`UPDATE shows SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...values);
  }

  async listShows(status?: ShowStatus): Promise<ShowRecord[]> {
    let stmt;
    let rows: unknown[];

    if (status) {
      stmt = this.db.prepare('SELECT * FROM shows WHERE status = ?');
      rows = stmt.all(status) as unknown[];
    } else {
      stmt = this.db.prepare('SELECT * FROM shows');
      rows = stmt.all() as unknown[];
    }

    return rows.map((row) => this.mapShowRow(row as Record<string, unknown>));
  }

  private mapShowRow(row: Record<string, unknown>): ShowRecord {
    return {
      id: row.id as string,
      formatId: row.format_id as string,
      seed: row.seed as string,
      status: row.status as ShowStatus,
      currentPhaseId: row.current_phase_id as string | null,
      startedAt: row.started_at as number | null,
      completedAt: row.completed_at as number | null,
      configSnapshot: row.config_snapshot as string,
      replayAvailable: (row.replay_available as number) === 1,
    };
  }

  // ─── Show Characters ───────────────────────────────────────────

  async createCharacter(char: ShowCharacterRecord): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO show_characters (show_id, character_id, model_adapter_id, private_context, speak_frequency)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(
      char.showId,
      char.characterId,
      char.modelAdapterId,
      JSON.stringify(char.privateContext),
      char.speakFrequency ?? 'medium'
    );
  }

  async getCharacter(showId: string, characterId: string): Promise<ShowCharacterRecord | null> {
    const stmt = this.db.prepare(
      'SELECT * FROM show_characters WHERE show_id = ? AND character_id = ?'
    );
    const row = stmt.get(showId, characterId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapCharacterRow(row);
  }

  async getCharacters(showId: string): Promise<ShowCharacterRecord[]> {
    const stmt = this.db.prepare('SELECT * FROM show_characters WHERE show_id = ?');
    const rows = stmt.all(showId) as unknown[];
    return rows.map((row) => this.mapCharacterRow(row as Record<string, unknown>));
  }

  async updateShowCharacterContext(
    showId: string,
    characterId: string,
    privateContext: PrivateContext
  ): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE show_characters SET private_context = ? WHERE show_id = ? AND character_id = ?
    `);
    stmt.run(JSON.stringify(privateContext), showId, characterId);
  }

  private mapCharacterRow(row: Record<string, unknown>): ShowCharacterRecord {
    return {
      showId: row.show_id as string,
      characterId: row.character_id as string,
      modelAdapterId: row.model_adapter_id as string,
      privateContext: JSON.parse(row.private_context as string) as PrivateContext,
      speakFrequency: (row.speak_frequency as 'low' | 'medium' | 'high') ?? 'medium',
    };
  }

  // ─── Events (Journal) ──────────────────────────────────────────

  async appendEvent(event: ShowEvent): Promise<number> {
    // Get next sequence number
    const seqStmt = this.db.prepare(
      'SELECT COALESCE(MAX(sequence_number), 0) + 1 as next_seq FROM show_events WHERE show_id = ?'
    );
    const seqRow = seqStmt.get(event.showId) as { next_seq: number };
    const sequenceNumber = seqRow.next_seq;

    const stmt = this.db.prepare(`
      INSERT INTO show_events (
        id, show_id, sequence_number, timestamp, phase_id, event_type,
        channel, visibility, sender_id, receiver_ids, audience_ids,
        content, metadata, seed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      event.id,
      event.showId,
      sequenceNumber,
      event.timestamp,
      event.phaseId,
      event.type,
      event.channel,
      event.channel, // visibility = channel (denormalized)
      event.senderId,
      JSON.stringify(event.receiverIds),
      JSON.stringify(event.audienceIds),
      event.content,
      event.metadata ? JSON.stringify(event.metadata) : null,
      event.seed
    );

    return sequenceNumber;
  }

  async getEvents(showId: string, fromSequence?: number): Promise<ShowEvent[]> {
    let stmt;
    let rows: unknown[];

    if (fromSequence !== undefined) {
      stmt = this.db.prepare(
        'SELECT * FROM show_events WHERE show_id = ? AND sequence_number >= ? ORDER BY sequence_number'
      );
      rows = stmt.all(showId, fromSequence) as unknown[];
    } else {
      stmt = this.db.prepare(
        'SELECT * FROM show_events WHERE show_id = ? ORDER BY sequence_number'
      );
      rows = stmt.all(showId) as unknown[];
    }

    return rows.map((row) => this.mapEventRow(row as Record<string, unknown>));
  }

  async getEventsForCharacter(
    showId: string,
    characterId: string,
    fromSequence?: number
  ): Promise<ShowEvent[]> {
    // Filter events where characterId is in audience_ids JSON array
    let sql = `
      SELECT * FROM show_events
      WHERE show_id = ?
      AND (audience_ids LIKE ? OR audience_ids = '[]')
    `;
    const params: unknown[] = [showId, `%"${characterId}"%`];

    if (fromSequence !== undefined) {
      sql += ' AND sequence_number >= ?';
      params.push(fromSequence);
    }

    sql += ' ORDER BY sequence_number';

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as unknown[];
    return rows.map((row) => this.mapEventRow(row as Record<string, unknown>));
  }

  async deleteEventsAfter(showId: string, afterSequence: number): Promise<void> {
    const stmt = this.db.prepare(
      'DELETE FROM show_events WHERE show_id = ? AND sequence_number > ?'
    );
    stmt.run(showId, afterSequence);
  }

  async getLatestSequence(showId: string): Promise<number> {
    const stmt = this.db.prepare(
      'SELECT COALESCE(MAX(sequence_number), 0) as latest FROM show_events WHERE show_id = ?'
    );
    const row = stmt.get(showId) as { latest: number };
    return row.latest;
  }

  private mapEventRow(row: Record<string, unknown>): ShowEvent {
    return {
      id: row.id as string,
      showId: row.show_id as string,
      sequenceNumber: row.sequence_number as number,
      timestamp: row.timestamp as number,
      phaseId: row.phase_id as string,
      type: row.event_type as ShowEvent['type'],
      channel: row.channel as ShowEvent['channel'],
      visibility: row.visibility as ShowEvent['channel'],
      senderId: row.sender_id as string,
      receiverIds: JSON.parse(row.receiver_ids as string) as string[],
      audienceIds: JSON.parse(row.audience_ids as string) as string[],
      content: row.content as string,
      metadata: row.metadata ? (JSON.parse(row.metadata as string) as Record<string, unknown>) : {},
      seed: row.seed as string,
    };
  }

  // ─── LLM Calls ─────────────────────────────────────────────────

  async logLLMCall(call: LlmCallRecord): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO llm_calls (
        id, event_id, show_id, character_id, model_adapter_id,
        prompt_tokens, completion_tokens, raw_request, raw_response,
        latency_ms, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      call.id,
      call.eventId,
      call.showId,
      call.characterId,
      call.modelAdapterId,
      call.promptTokens,
      call.completionTokens,
      call.rawRequest,
      call.rawResponse,
      call.latencyMs,
      call.createdAt
    );
  }

  async getLLMCalls(showId: string): Promise<LlmCallRecord[]> {
    const stmt = this.db.prepare('SELECT * FROM llm_calls WHERE show_id = ? ORDER BY created_at');
    const rows = stmt.all(showId) as unknown[];
    return rows.map((row) => this.mapLlmCallRow(row as Record<string, unknown>));
  }

  async getLLMCallByEventId(eventId: string): Promise<LlmCallRecord | null> {
    const stmt = this.db.prepare('SELECT * FROM llm_calls WHERE event_id = ?');
    const row = stmt.get(eventId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapLlmCallRow(row);
  }

  private mapLlmCallRow(row: Record<string, unknown>): LlmCallRecord {
    return {
      id: row.id as string,
      eventId: row.event_id as string | null,
      showId: row.show_id as string,
      characterId: row.character_id as string,
      modelAdapterId: row.model_adapter_id as string,
      promptTokens: row.prompt_tokens as number | null,
      completionTokens: row.completion_tokens as number | null,
      rawRequest: row.raw_request as string,
      rawResponse: row.raw_response as string,
      latencyMs: row.latency_ms as number | null,
      createdAt: row.created_at as number,
    };
  }

  // ─── Token Budget ──────────────────────────────────────────────

  async createBudget(budget: TokenBudgetRecord): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO token_budgets (show_id, total_limit, used_prompt, used_completion, mode, last_updated)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      budget.showId,
      budget.totalLimit,
      budget.usedPrompt,
      budget.usedCompletion,
      budget.mode,
      budget.lastUpdated
    );
  }

  async getBudget(showId: string): Promise<TokenBudgetRecord | null> {
    const stmt = this.db.prepare('SELECT * FROM token_budgets WHERE show_id = ?');
    const row = stmt.get(showId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapBudgetRow(row);
  }

  async updateBudget(
    showId: string,
    usedPrompt: number,
    usedCompletion: number
  ): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE token_budgets
      SET used_prompt = used_prompt + ?, used_completion = used_completion + ?, last_updated = ?
      WHERE show_id = ?
    `);
    stmt.run(usedPrompt, usedCompletion, Date.now(), showId);
  }

  async setBudgetMode(showId: string, mode: BudgetMode): Promise<void> {
    const stmt = this.db.prepare(
      'UPDATE token_budgets SET mode = ?, last_updated = ? WHERE show_id = ?'
    );
    stmt.run(mode, Date.now(), showId);
  }

  private mapBudgetRow(row: Record<string, unknown>): TokenBudgetRecord {
    return {
      showId: row.show_id as string,
      totalLimit: row.total_limit as number,
      usedPrompt: row.used_prompt as number,
      usedCompletion: row.used_completion as number,
      mode: row.mode as BudgetMode,
      lastUpdated: row.last_updated as number,
    };
  }

  // ─── Context Summaries ─────────────────────────────────────────

  async getContextSummary(showId: string, characterId: string): Promise<ContextSummary | null> {
    const stmt = this.db.prepare(
      'SELECT * FROM context_summaries WHERE show_id = ? AND character_id = ?'
    );
    const row = stmt.get(showId, characterId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapContextSummaryRow(row);
  }

  async upsertContextSummary(summary: ContextSummary): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO context_summaries (show_id, character_id, summary_text, last_sequence_number, message_count, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(show_id, character_id) DO UPDATE SET
        summary_text = excluded.summary_text,
        last_sequence_number = excluded.last_sequence_number,
        message_count = excluded.message_count,
        updated_at = excluded.updated_at
    `);
    stmt.run(
      summary.showId,
      summary.characterId,
      summary.summaryText,
      summary.lastSequenceNumber,
      summary.messageCount,
      summary.updatedAt
    );
  }

  private mapContextSummaryRow(row: Record<string, unknown>): ContextSummary {
    return {
      showId: row.show_id as string,
      characterId: row.character_id as string,
      summaryText: row.summary_text as string,
      lastSequenceNumber: row.last_sequence_number as number,
      messageCount: row.message_count as number,
      updatedAt: row.updated_at as number,
    };
  }

  // ─── Lifecycle ─────────────────────────────────────────────────

  async walCheckpoint(): Promise<void> {
    // TRUNCATE mode: checkpoint and truncate WAL file to zero size
    // This ensures all data is written to the main database file
    const result = this.db.pragma('wal_checkpoint(TRUNCATE)') as Array<{
      busy: number;
      log: number;
      checkpointed: number;
    }>;
    const info = result[0];
    if (info) {
      console.log(
        `[WAL checkpoint] busy=${info.busy}, log=${info.log}, checkpointed=${info.checkpointed}`
      );
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
