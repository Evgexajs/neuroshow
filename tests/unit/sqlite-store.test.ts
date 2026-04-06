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

  describe('shows CRUD - TASK-014', () => {
    beforeEach(async () => {
      await store.initialize();
    });

    it('should create and get a show', async () => {
      const show = {
        id: 'show-001',
        formatId: 'coalition-v1',
        seed: 'test-seed-123',
        status: 'running' as const,
        currentPhaseId: 'phase-1',
        startedAt: Date.now(),
        completedAt: null,
        configSnapshot: JSON.stringify({ maxPlayers: 5 }),
      };

      await store.createShow(show);
      const retrieved = await store.getShow('show-001');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe('show-001');
      expect(retrieved!.formatId).toBe('coalition-v1');
      expect(retrieved!.seed).toBe('test-seed-123');
      expect(retrieved!.status).toBe('running');
      expect(retrieved!.currentPhaseId).toBe('phase-1');
    });

    it('should update show status and verify changes', async () => {
      const show = {
        id: 'show-002',
        formatId: 'coalition-v1',
        seed: 'seed-456',
        status: 'running' as const,
        currentPhaseId: 'phase-1',
        startedAt: Date.now(),
        completedAt: null,
        configSnapshot: JSON.stringify({}),
      };

      await store.createShow(show);

      // Update status to completed
      await store.updateShow('show-002', {
        status: 'completed' as const,
        completedAt: Date.now(),
        currentPhaseId: null,
      });

      const updated = await store.getShow('show-002');

      expect(updated).not.toBeNull();
      expect(updated!.status).toBe('completed');
      expect(updated!.completedAt).not.toBeNull();
      expect(updated!.currentPhaseId).toBeNull();
    });

    it('should list all shows', async () => {
      const shows = [
        {
          id: 'show-a',
          formatId: 'format-1',
          seed: 'seed-a',
          status: 'running' as const,
          currentPhaseId: 'p1',
          startedAt: Date.now(),
          completedAt: null,
          configSnapshot: '{}',
        },
        {
          id: 'show-b',
          formatId: 'format-1',
          seed: 'seed-b',
          status: 'completed' as const,
          currentPhaseId: null,
          startedAt: Date.now() - 1000,
          completedAt: Date.now(),
          configSnapshot: '{}',
        },
      ];

      for (const s of shows) {
        await store.createShow(s);
      }

      const allShows = await store.listShows();
      expect(allShows.length).toBe(2);

      const runningShows = await store.listShows('running');
      expect(runningShows.length).toBe(1);
      expect(runningShows[0].id).toBe('show-a');
    });

    it('should return null for non-existent show', async () => {
      const result = await store.getShow('non-existent');
      expect(result).toBeNull();
    });

    it('should serialize configSnapshot as JSON', async () => {
      const config = { maxPlayers: 5, phases: ['intro', 'main', 'finale'] };
      const show = {
        id: 'show-json',
        formatId: 'format-1',
        seed: 'seed',
        status: 'running' as const,
        currentPhaseId: null,
        startedAt: Date.now(),
        completedAt: null,
        configSnapshot: JSON.stringify(config),
      };

      await store.createShow(show);
      const retrieved = await store.getShow('show-json');

      expect(retrieved).not.toBeNull();
      const parsedConfig = JSON.parse(retrieved!.configSnapshot);
      expect(parsedConfig.maxPlayers).toBe(5);
      expect(parsedConfig.phases).toEqual(['intro', 'main', 'finale']);
    });
  });
});
