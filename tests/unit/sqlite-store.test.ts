/**
 * Tests for SqliteStore - TASK-013
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStore } from '../../src/storage/sqlite-store.js';
import Database from 'better-sqlite3';
import { unlinkSync, existsSync } from 'fs';

const TEST_DB_PATH = './data/test-sqlite-store.db';

describe('SqliteStore', () => {
  let store: SqliteStore;

  beforeEach(async () => {
    // Clean up if exists
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
    store = new SqliteStore(TEST_DB_PATH);
  });

  afterEach(async () => {
    await store.close();
    // Clean up
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
  });

  describe('initSchema', () => {
    it('should create all 5 tables', async () => {
      await store.initialize();

      // Check tables via SQL
      const db = new Database(TEST_DB_PATH);
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as { name: string }[];
      db.close();

      const tableNames = tables.map((t) => t.name);
      expect(tableNames).toContain('shows');
      expect(tableNames).toContain('show_characters');
      expect(tableNames).toContain('show_events');
      expect(tableNames).toContain('llm_calls');
      expect(tableNames).toContain('token_budgets');
    });

    it('should create indexes for show_events', async () => {
      await store.initialize();

      const db = new Database(TEST_DB_PATH);
      const indexes = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='show_events'"
        )
        .all() as { name: string }[];
      db.close();

      const indexNames = indexes.map((i) => i.name);
      expect(indexNames).toContain('idx_show_events_show_id');
      expect(indexNames).toContain('idx_show_events_sequence');
    });
  });
});
