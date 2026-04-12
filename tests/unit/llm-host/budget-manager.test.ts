/**
 * Unit tests for BudgetManager
 * HOST-003: Реализовать BudgetManager для управления бюджетом ведущего
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BudgetManager } from '../../../src/modules/llm-host/budget-manager.js';
import { DEFAULT_LLM_HOST_CONFIG } from '../../../src/modules/llm-host/index.js';
import { HostBudgetMode } from '../../../src/types/enums.js';
import type { IStore, HostBudgetRecord } from '../../../src/types/interfaces/store.interface.js';
import type { LLMHostConfig } from '../../../src/modules/llm-host/types.js';

/**
 * Creates a mock store with tracking for host budget operations
 */
function createMockStore(): IStore & {
  budgets: Map<string, HostBudgetRecord>;
  cooldowns: Map<string, { sequence: number; timestamp: number }>;
} {
  const budgets = new Map<string, HostBudgetRecord>();
  const cooldowns = new Map<string, { sequence: number; timestamp: number }>();

  return {
    budgets,
    cooldowns,

    // Host budget methods
    async createHostBudget(budget: HostBudgetRecord): Promise<void> {
      budgets.set(budget.showId, { ...budget });
    },

    async getHostBudget(showId: string): Promise<HostBudgetRecord | null> {
      const budget = budgets.get(showId);
      return budget ? { ...budget } : null;
    },

    async updateHostBudget(
      showId: string,
      usedPrompt: number,
      usedCompletion: number
    ): Promise<void> {
      const budget = budgets.get(showId);
      if (budget) {
        budget.usedPrompt += usedPrompt;
        budget.usedCompletion += usedCompletion;
        budget.lastUpdated = Date.now();
      }
    },

    // Trigger cooldown methods (not used in BudgetManager but required by interface)
    async getTriggerCooldown(
      showId: string,
      triggerType: string
    ): Promise<{ showId: string; triggerType: string; lastTriggeredSequence: number; lastTriggeredAt: number } | null> {
      const key = `${showId}:${triggerType}`;
      const cooldown = cooldowns.get(key);
      if (!cooldown) return null;
      return {
        showId,
        triggerType,
        lastTriggeredSequence: cooldown.sequence,
        lastTriggeredAt: cooldown.timestamp,
      };
    },

    async setTriggerCooldown(
      showId: string,
      triggerType: string,
      sequence: number
    ): Promise<void> {
      const key = `${showId}:${triggerType}`;
      cooldowns.set(key, { sequence, timestamp: Date.now() });
    },

    // Stub other IStore methods
    initSchema: vi.fn(),
    close: vi.fn(),
    createShow: vi.fn(),
    getShow: vi.fn(),
    updateShow: vi.fn(),
    listShows: vi.fn(),
    deleteShow: vi.fn(),
    createCharacter: vi.fn(),
    getCharacter: vi.fn(),
    getCharactersByShowId: vi.fn(),
    updateCharacter: vi.fn(),
    deleteCharacter: vi.fn(),
    createTokenBudget: vi.fn(),
    getTokenBudget: vi.fn(),
    updateTokenBudget: vi.fn(),
    appendEvent: vi.fn(),
    getEvents: vi.fn(),
    countEvents: vi.fn(),
    getLastSequence: vi.fn(),
    countEventsByType: vi.fn(),
    getEventsAfterSequence: vi.fn(),
    getTurnsSinceEvent: vi.fn(),
    checkpoint: vi.fn(),
  } as unknown as IStore & {
    budgets: Map<string, HostBudgetRecord>;
    cooldowns: Map<string, { sequence: number; timestamp: number }>;
  };
}

describe('BudgetManager', () => {
  let store: ReturnType<typeof createMockStore>;
  let config: LLMHostConfig;
  let manager: BudgetManager;

  beforeEach(() => {
    store = createMockStore();
    config = { ...DEFAULT_LLM_HOST_CONFIG };
    manager = new BudgetManager(store, config);
  });

  describe('initialize()', () => {
    it('should create a budget record with initial values', async () => {
      await manager.initialize('show-001');

      const budget = await store.getHostBudget('show-001');
      expect(budget).not.toBeNull();
      expect(budget!.showId).toBe('show-001');
      expect(budget!.totalLimit).toBe(config.hostBudget);
      expect(budget!.usedPrompt).toBe(0);
      expect(budget!.usedCompletion).toBe(0);
      expect(budget!.mode).toBe(HostBudgetMode.normal);
    });

    it('should use hostBudget from config as totalLimit', async () => {
      config.hostBudget = 25000;
      manager = new BudgetManager(store, config);

      await manager.initialize('show-002');

      const budget = await store.getHostBudget('show-002');
      expect(budget!.totalLimit).toBe(25000);
    });

    it('should set lastUpdated to current timestamp', async () => {
      const before = Date.now();
      await manager.initialize('show-003');
      const after = Date.now();

      const budget = await store.getHostBudget('show-003');
      expect(budget!.lastUpdated).toBeGreaterThanOrEqual(before);
      expect(budget!.lastUpdated).toBeLessThanOrEqual(after);
    });
  });

  describe('consume()', () => {
    beforeEach(async () => {
      await manager.initialize('show-001');
    });

    it('should add tokens to the budget', async () => {
      const result = await manager.consume('show-001', 100, 50);

      expect(result.usedPrompt).toBe(100);
      expect(result.usedCompletion).toBe(50);
    });

    it('should accumulate multiple consume calls', async () => {
      await manager.consume('show-001', 100, 50);
      const result = await manager.consume('show-001', 200, 100);

      expect(result.usedPrompt).toBe(300);
      expect(result.usedCompletion).toBe(150);
    });

    it('should throw if budget not found', async () => {
      await expect(manager.consume('nonexistent', 100, 50)).rejects.toThrow(
        'Budget not found for show: nonexistent'
      );
    });

    it('should update mode when threshold is crossed', async () => {
      // Budget is 10000, saving threshold is 70%
      // Consume 7000 tokens to hit 70%
      const result = await manager.consume('show-001', 5000, 2000);

      expect(result.mode).toBe(HostBudgetMode.saving);
    });
  });

  describe('getMode()', () => {
    beforeEach(async () => {
      await manager.initialize('show-001');
    });

    it('should return normal mode for fresh budget', async () => {
      const mode = await manager.getMode('show-001');
      expect(mode).toBe(HostBudgetMode.normal);
    });

    it('should throw if budget not found', async () => {
      await expect(manager.getMode('nonexistent')).rejects.toThrow(
        'Budget not found for show: nonexistent'
      );
    });
  });

  describe('getRemainingPercentage()', () => {
    beforeEach(async () => {
      await manager.initialize('show-001');
    });

    it('should return 100% for fresh budget', async () => {
      const remaining = await manager.getRemainingPercentage('show-001');
      expect(remaining).toBe(100);
    });

    it('should return correct percentage after consumption', async () => {
      // Use 1000 tokens out of 10000 = 10% used, 90% remaining
      await manager.consume('show-001', 500, 500);

      const remaining = await manager.getRemainingPercentage('show-001');
      expect(remaining).toBe(90);
    });

    it('should return 0% when fully consumed', async () => {
      await manager.consume('show-001', 5000, 5000);

      const remaining = await manager.getRemainingPercentage('show-001');
      expect(remaining).toBe(0);
    });

    it('should not return negative percentage when over budget', async () => {
      await manager.consume('show-001', 6000, 6000);

      const remaining = await manager.getRemainingPercentage('show-001');
      expect(remaining).toBe(0);
    });

    it('should throw if budget not found', async () => {
      await expect(manager.getRemainingPercentage('nonexistent')).rejects.toThrow(
        'Budget not found for show: nonexistent'
      );
    });
  });

  describe('Mode threshold transitions', () => {
    beforeEach(async () => {
      // Budget: 10000 tokens
      // Saving threshold: 70% (7000 tokens)
      // Exhausted threshold: 90% (9000 tokens)
      await manager.initialize('show-001');
    });

    it('should stay in normal mode below 70%', async () => {
      // Use 6999 tokens (69.99%)
      await manager.consume('show-001', 3500, 3499);

      const mode = await manager.getMode('show-001');
      expect(mode).toBe(HostBudgetMode.normal);
    });

    it('should switch to saving mode at exactly 70%', async () => {
      // Use 7000 tokens (exactly 70%)
      await manager.consume('show-001', 3500, 3500);

      const mode = await manager.getMode('show-001');
      expect(mode).toBe(HostBudgetMode.saving);
    });

    it('should stay in saving mode between 70% and 90%', async () => {
      // Use 8500 tokens (85%)
      await manager.consume('show-001', 4500, 4000);

      const mode = await manager.getMode('show-001');
      expect(mode).toBe(HostBudgetMode.saving);
    });

    it('should switch to exhausted mode at exactly 90%', async () => {
      // Use 9000 tokens (exactly 90%)
      await manager.consume('show-001', 4500, 4500);

      const mode = await manager.getMode('show-001');
      expect(mode).toBe(HostBudgetMode.exhausted);
    });

    it('should stay in exhausted mode above 90%', async () => {
      // Use 9500 tokens (95%)
      await manager.consume('show-001', 5000, 4500);

      const mode = await manager.getMode('show-001');
      expect(mode).toBe(HostBudgetMode.exhausted);
    });

    it('should use custom thresholds from config', async () => {
      // Create a manager with custom thresholds
      const customConfig: LLMHostConfig = {
        ...DEFAULT_LLM_HOST_CONFIG,
        hostBudget: 1000,
        hostBudgetSavingThreshold: 50, // 50% = 500 tokens
        hostBudgetExhaustedThreshold: 80, // 80% = 800 tokens
      };
      const customManager = new BudgetManager(store, customConfig);
      await customManager.initialize('show-custom');

      // Use 499 tokens (49.9%) - should be normal
      await customManager.consume('show-custom', 250, 249);
      let mode = await customManager.getMode('show-custom');
      expect(mode).toBe(HostBudgetMode.normal);

      // Use 1 more token to hit 500 (50%) - should switch to saving
      await customManager.consume('show-custom', 1, 0);
      mode = await customManager.getMode('show-custom');
      expect(mode).toBe(HostBudgetMode.saving);

      // Use 300 more tokens to hit 800 (80%) - should switch to exhausted
      await customManager.consume('show-custom', 150, 150);
      mode = await customManager.getMode('show-custom');
      expect(mode).toBe(HostBudgetMode.exhausted);
    });
  });

  describe('getBudget()', () => {
    it('should return null for non-existent budget', async () => {
      const budget = await manager.getBudget('nonexistent');
      expect(budget).toBeNull();
    });

    it('should return budget record after initialization', async () => {
      await manager.initialize('show-001');

      const budget = await manager.getBudget('show-001');
      expect(budget).not.toBeNull();
      expect(budget!.showId).toBe('show-001');
    });
  });
});
