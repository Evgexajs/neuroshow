/**
 * Unit tests for SQLiteStore host budget and trigger cooldown methods
 * HOST-002: Add host_budgets and host_trigger_cooldowns tables to SQLite Store
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStore } from '../../src/storage/sqlite-store.js';
import { HostBudgetMode } from '../../src/types/enums.js';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';

const TEST_DB_PATH = join(process.cwd(), 'data', 'test-host-store.db');

describe('SqliteStore - Host Budget and Trigger Cooldowns', () => {
  let store: SqliteStore;

  beforeEach(async () => {
    // Clean up any existing test database
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
    // Also clean up WAL files if they exist
    if (existsSync(`${TEST_DB_PATH}-wal`)) {
      unlinkSync(`${TEST_DB_PATH}-wal`);
    }
    if (existsSync(`${TEST_DB_PATH}-shm`)) {
      unlinkSync(`${TEST_DB_PATH}-shm`);
    }

    store = new SqliteStore(TEST_DB_PATH);
    await store.initSchema();
  });

  afterEach(async () => {
    await store.close();

    // Clean up test database
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
    if (existsSync(`${TEST_DB_PATH}-wal`)) {
      unlinkSync(`${TEST_DB_PATH}-wal`);
    }
    if (existsSync(`${TEST_DB_PATH}-shm`)) {
      unlinkSync(`${TEST_DB_PATH}-shm`);
    }
  });

  describe('host_budgets table', () => {
    it('should create host_budgets table in initSchema', async () => {
      // Table should already be created in beforeEach
      // Verify by inserting and retrieving a record
      const budget = {
        showId: 'show-001',
        totalLimit: 10000,
        usedPrompt: 0,
        usedCompletion: 0,
        mode: HostBudgetMode.normal,
        lastUpdated: Date.now(),
      };

      await store.createHostBudget(budget);
      const retrieved = await store.getHostBudget('show-001');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.showId).toBe('show-001');
    });
  });

  describe('host_trigger_cooldowns table', () => {
    it('should create host_trigger_cooldowns table in initSchema', async () => {
      // Verify by inserting and retrieving a record
      await store.setTriggerCooldown('show-001', 'phase_start', 5);
      const retrieved = await store.getTriggerCooldown('show-001', 'phase_start');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.showId).toBe('show-001');
      expect(retrieved!.triggerType).toBe('phase_start');
    });
  });

  describe('createHostBudget', () => {
    it('should create a new host budget record', async () => {
      const budget = {
        showId: 'show-budget-001',
        totalLimit: 15000,
        usedPrompt: 100,
        usedCompletion: 50,
        mode: HostBudgetMode.normal,
        lastUpdated: Date.now(),
      };

      await store.createHostBudget(budget);
      const retrieved = await store.getHostBudget('show-budget-001');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.showId).toBe('show-budget-001');
      expect(retrieved!.totalLimit).toBe(15000);
      expect(retrieved!.usedPrompt).toBe(100);
      expect(retrieved!.usedCompletion).toBe(50);
      expect(retrieved!.mode).toBe(HostBudgetMode.normal);
    });

    it('should handle different budget modes', async () => {
      const modes: HostBudgetMode[] = [
        HostBudgetMode.normal,
        HostBudgetMode.saving,
        HostBudgetMode.exhausted,
      ];

      for (const [i, mode] of modes.entries()) {
        const budget = {
          showId: `show-mode-${i}`,
          totalLimit: 10000,
          usedPrompt: 0,
          usedCompletion: 0,
          mode,
          lastUpdated: Date.now(),
        };

        await store.createHostBudget(budget);
        const retrieved = await store.getHostBudget(`show-mode-${i}`);

        expect(retrieved!.mode).toBe(mode);
      }
    });
  });

  describe('getHostBudget', () => {
    it('should return null for non-existent show', async () => {
      const result = await store.getHostBudget('non-existent-show');
      expect(result).toBeNull();
    });

    it('should return correct budget record', async () => {
      const now = Date.now();
      const budget = {
        showId: 'show-get-001',
        totalLimit: 20000,
        usedPrompt: 500,
        usedCompletion: 250,
        mode: HostBudgetMode.saving,
        lastUpdated: now,
      };

      await store.createHostBudget(budget);
      const retrieved = await store.getHostBudget('show-get-001');

      expect(retrieved).toEqual(budget);
    });
  });

  describe('updateHostBudget', () => {
    it('should increment used tokens', async () => {
      const budget = {
        showId: 'show-update-001',
        totalLimit: 10000,
        usedPrompt: 100,
        usedCompletion: 50,
        mode: HostBudgetMode.normal,
        lastUpdated: Date.now(),
      };

      await store.createHostBudget(budget);

      // Add more tokens
      await store.updateHostBudget('show-update-001', 200, 100);

      const retrieved = await store.getHostBudget('show-update-001');
      expect(retrieved!.usedPrompt).toBe(300); // 100 + 200
      expect(retrieved!.usedCompletion).toBe(150); // 50 + 100
    });

    it('should update lastUpdated timestamp', async () => {
      const oldTime = Date.now() - 10000;
      const budget = {
        showId: 'show-update-002',
        totalLimit: 10000,
        usedPrompt: 0,
        usedCompletion: 0,
        mode: HostBudgetMode.normal,
        lastUpdated: oldTime,
      };

      await store.createHostBudget(budget);
      await store.updateHostBudget('show-update-002', 50, 25);

      const retrieved = await store.getHostBudget('show-update-002');
      expect(retrieved!.lastUpdated).toBeGreaterThan(oldTime);
    });

    it('should handle multiple updates correctly', async () => {
      const budget = {
        showId: 'show-update-003',
        totalLimit: 10000,
        usedPrompt: 0,
        usedCompletion: 0,
        mode: HostBudgetMode.normal,
        lastUpdated: Date.now(),
      };

      await store.createHostBudget(budget);

      // Multiple updates
      await store.updateHostBudget('show-update-003', 100, 50);
      await store.updateHostBudget('show-update-003', 150, 75);
      await store.updateHostBudget('show-update-003', 50, 25);

      const retrieved = await store.getHostBudget('show-update-003');
      expect(retrieved!.usedPrompt).toBe(300); // 100 + 150 + 50
      expect(retrieved!.usedCompletion).toBe(150); // 50 + 75 + 25
    });
  });

  describe('getTriggerCooldown', () => {
    it('should return null for non-existent cooldown', async () => {
      const result = await store.getTriggerCooldown('show-001', 'phase_start');
      expect(result).toBeNull();
    });

    it('should return correct cooldown record', async () => {
      await store.setTriggerCooldown('show-cd-001', 'revelation', 10);

      const retrieved = await store.getTriggerCooldown('show-cd-001', 'revelation');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.showId).toBe('show-cd-001');
      expect(retrieved!.triggerType).toBe('revelation');
      expect(retrieved!.lastTriggeredSequence).toBe(10);
      expect(retrieved!.lastTriggeredAt).toBeGreaterThan(0);
    });

    it('should distinguish between different trigger types', async () => {
      await store.setTriggerCooldown('show-cd-002', 'phase_start', 5);
      await store.setTriggerCooldown('show-cd-002', 'phase_end', 15);

      const phaseStart = await store.getTriggerCooldown('show-cd-002', 'phase_start');
      const phaseEnd = await store.getTriggerCooldown('show-cd-002', 'phase_end');

      expect(phaseStart!.lastTriggeredSequence).toBe(5);
      expect(phaseEnd!.lastTriggeredSequence).toBe(15);
    });

    it('should distinguish between different shows', async () => {
      await store.setTriggerCooldown('show-a', 'phase_start', 10);
      await store.setTriggerCooldown('show-b', 'phase_start', 20);

      const showA = await store.getTriggerCooldown('show-a', 'phase_start');
      const showB = await store.getTriggerCooldown('show-b', 'phase_start');

      expect(showA!.lastTriggeredSequence).toBe(10);
      expect(showB!.lastTriggeredSequence).toBe(20);
    });
  });

  describe('setTriggerCooldown', () => {
    it('should create a new cooldown record', async () => {
      await store.setTriggerCooldown('show-set-001', 'conflict_detected', 25);

      const retrieved = await store.getTriggerCooldown('show-set-001', 'conflict_detected');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.showId).toBe('show-set-001');
      expect(retrieved!.triggerType).toBe('conflict_detected');
      expect(retrieved!.lastTriggeredSequence).toBe(25);
    });

    it('should update existing cooldown record (upsert)', async () => {
      // First insert
      await store.setTriggerCooldown('show-set-002', 'silence_detected', 5);

      // Verify first insert
      let retrieved = await store.getTriggerCooldown('show-set-002', 'silence_detected');
      expect(retrieved!.lastTriggeredSequence).toBe(5);

      // Update
      await store.setTriggerCooldown('show-set-002', 'silence_detected', 15);

      // Verify update
      retrieved = await store.getTriggerCooldown('show-set-002', 'silence_detected');
      expect(retrieved!.lastTriggeredSequence).toBe(15);
    });

    it('should update timestamp on upsert', async () => {
      await store.setTriggerCooldown('show-set-003', 'phase_start', 1);
      const first = await store.getTriggerCooldown('show-set-003', 'phase_start');

      // Small delay to ensure timestamp changes
      await new Promise((resolve) => setTimeout(resolve, 10));

      await store.setTriggerCooldown('show-set-003', 'phase_start', 10);
      const second = await store.getTriggerCooldown('show-set-003', 'phase_start');

      expect(second!.lastTriggeredAt).toBeGreaterThanOrEqual(first!.lastTriggeredAt);
    });

    it('should handle all trigger types', async () => {
      const triggerTypes: string[] = [
        'phase_start',
        'phase_end',
        'revelation',
        'wildcard_reveal',
        'conflict_detected',
        'alliance_hint',
        'silence_detected',
        'budget_milestone',
        'dramatic_moment',
        'private_channel_open',
        'private_channel_close',
        'periodic_commentary',
        'phase_midpoint',
      ];

      for (const [i, triggerType] of triggerTypes.entries()) {
        await store.setTriggerCooldown('show-types', triggerType, i * 5);
      }

      for (const [i, triggerType] of triggerTypes.entries()) {
        const retrieved = await store.getTriggerCooldown('show-types', triggerType);
        expect(retrieved!.triggerType).toBe(triggerType);
        expect(retrieved!.lastTriggeredSequence).toBe(i * 5);
      }
    });
  });
});
