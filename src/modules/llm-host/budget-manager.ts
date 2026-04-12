/**
 * BudgetManager - manages LLM host token budget
 *
 * Tracks token usage and determines budget mode:
 * - normal (0-70%): All interventions allowed
 * - saving (70-90%): Only mandatory triggers
 * - exhausted (90%+): Host is silent, fallback phrases used
 */

import type { IStore } from '../../types/interfaces/store.interface.js';
import type { HostBudgetRecord, LLMHostConfig } from './types.js';
import { HostBudgetMode } from '../../types/enums.js';

/**
 * Manages the token budget for the LLM host
 */
export class BudgetManager {
  constructor(
    private readonly store: IStore,
    private readonly config: LLMHostConfig
  ) {}

  /**
   * Initialize budget for a show
   * Creates a new budget record in the store
   *
   * @param showId - Show ID
   */
  async initialize(showId: string): Promise<void> {
    const budget: HostBudgetRecord = {
      showId,
      totalLimit: this.config.hostBudget,
      usedPrompt: 0,
      usedCompletion: 0,
      mode: HostBudgetMode.normal,
      lastUpdated: Date.now(),
    };

    await this.store.createHostBudget(budget);
  }

  /**
   * Consume tokens from the budget
   * Updates the budget record and recalculates mode
   *
   * @param showId - Show ID
   * @param promptTokens - Number of prompt tokens used
   * @param completionTokens - Number of completion tokens used
   * @returns Updated budget record
   */
  async consume(
    showId: string,
    promptTokens: number,
    completionTokens: number
  ): Promise<HostBudgetRecord> {
    // Update token counts in store
    await this.store.updateHostBudget(showId, promptTokens, completionTokens);

    // Get updated budget
    const budget = await this.store.getHostBudget(showId);
    if (!budget) {
      throw new Error(`Budget not found for show: ${showId}`);
    }

    // Calculate new mode based on usage
    const newMode = this.calculateMode(budget);

    // Update mode if changed
    if (newMode !== budget.mode) {
      budget.mode = newMode;
      // Note: Store doesn't have a separate method to update mode,
      // so we recreate the budget with new mode
      // This is a design limitation that could be improved later
      await this.updateBudgetMode(showId, newMode);
    }

    return budget;
  }

  /**
   * Get current budget mode for a show
   *
   * @param showId - Show ID
   * @returns Current budget mode
   */
  async getMode(showId: string): Promise<HostBudgetMode> {
    const budget = await this.store.getHostBudget(showId);
    if (!budget) {
      throw new Error(`Budget not found for show: ${showId}`);
    }

    // Recalculate mode in case thresholds changed
    return this.calculateMode(budget);
  }

  /**
   * Get remaining budget percentage
   *
   * @param showId - Show ID
   * @returns Remaining percentage (0-100)
   */
  async getRemainingPercentage(showId: string): Promise<number> {
    const budget = await this.store.getHostBudget(showId);
    if (!budget) {
      throw new Error(`Budget not found for show: ${showId}`);
    }

    const totalUsed = budget.usedPrompt + budget.usedCompletion;
    const usedPercentage = (totalUsed / budget.totalLimit) * 100;
    return Math.max(0, 100 - usedPercentage);
  }

  /**
   * Get the full budget record for a show
   *
   * @param showId - Show ID
   * @returns Budget record or null if not found
   */
  async getBudget(showId: string): Promise<HostBudgetRecord | null> {
    return this.store.getHostBudget(showId);
  }

  /**
   * Calculate budget mode based on usage percentage
   *
   * @param budget - Budget record
   * @returns Calculated budget mode
   */
  private calculateMode(budget: HostBudgetRecord): HostBudgetMode {
    const totalUsed = budget.usedPrompt + budget.usedCompletion;
    const usedPercentage = (totalUsed / budget.totalLimit) * 100;

    if (usedPercentage >= this.config.hostBudgetExhaustedThreshold) {
      return HostBudgetMode.exhausted;
    }

    if (usedPercentage >= this.config.hostBudgetSavingThreshold) {
      return HostBudgetMode.saving;
    }

    return HostBudgetMode.normal;
  }

  /**
   * Update budget mode in store
   * Since store doesn't have a direct mode update method,
   * we work around by updating with 0 tokens (just to trigger lastUpdated)
   * and handle mode separately
   *
   * @param showId - Show ID
   * @param mode - New mode
   */
  private async updateBudgetMode(
    showId: string,
    _mode: HostBudgetMode
  ): Promise<void> {
    // Note: The current store implementation doesn't support updating mode directly
    // The mode is recalculated on read based on thresholds
    // This method is a placeholder for future improvement
    void showId;
    void _mode;
  }
}
