/**
 * TriggerEvaluator - determines when the LLM host should intervene
 *
 * Evaluates incoming events against intervention rules:
 * - Mandatory triggers (phase_start, phase_end, revelation) always fire
 * - Conditional triggers respect cooldown periods
 * - Priority-based selection when multiple triggers match
 */

import type { IStore } from '../../types/interfaces/store.interface.js';
import type { ShowEvent } from '../../types/events.js';
import { EventType } from '../../types/enums.js';
import type {
  LLMHostConfig,
  TriggerType,
  EvaluatedTrigger,
  InterventionRule,
} from './types.js';

/**
 * Mandatory trigger types that always fire regardless of cooldown
 * These are critical for show flow and should never be skipped
 */
export const MANDATORY_TRIGGERS: ReadonlySet<TriggerType> = new Set([
  'phase_start',
  'phase_end',
  'revelation',
]);

/**
 * Maps EventType to TriggerType for direct event-based triggers
 * Not all events map directly to triggers
 */
const EVENT_TO_TRIGGER_MAP: Partial<Record<EventType, TriggerType>> = {
  [EventType.phase_start]: 'phase_start',
  [EventType.phase_end]: 'phase_end',
  [EventType.revelation]: 'revelation',
};

/**
 * Evaluates events to determine if and how the LLM host should intervene
 */
export class TriggerEvaluator {
  constructor(
    private readonly store: IStore,
    private readonly config: LLMHostConfig
  ) {}

  /**
   * Evaluate an event and determine if it triggers an intervention
   *
   * @param event - The event to evaluate
   * @returns EvaluatedTrigger if intervention should happen, null otherwise
   */
  async evaluate(event: ShowEvent): Promise<EvaluatedTrigger | null> {
    // Get trigger type from event, if any
    const triggerType = this.getTriggerTypeFromEvent(event);
    if (!triggerType) {
      return null;
    }

    // Find all matching rules for this trigger type
    const matchingRules = this.findMatchingRules(triggerType);
    if (matchingRules.length === 0) {
      return null;
    }

    // Filter rules based on cooldown (mandatory triggers skip cooldown check)
    const eligibleRules = await this.filterByCooldown(
      matchingRules,
      event.showId,
      event.sequenceNumber
    );

    if (eligibleRules.length === 0) {
      return null;
    }

    // Select highest priority rule
    const selectedRule = this.selectByPriority(eligibleRules);

    return {
      type: triggerType,
      rule: selectedRule,
      triggerEvent: event,
      priority: selectedRule.priority,
    };
  }

  /**
   * Map an event to its corresponding trigger type
   * Returns null if event doesn't map to a trigger
   *
   * @param event - The event to map
   * @returns TriggerType or null
   */
  private getTriggerTypeFromEvent(event: ShowEvent): TriggerType | null {
    return EVENT_TO_TRIGGER_MAP[event.type] ?? null;
  }

  /**
   * Find all enabled rules that match a trigger type
   *
   * @param triggerType - The trigger type to match
   * @returns Array of matching enabled rules
   */
  private findMatchingRules(triggerType: TriggerType): InterventionRule[] {
    return this.config.interventionRules.filter(
      (rule) => rule.trigger === triggerType && rule.enabled
    );
  }

  /**
   * Filter rules based on cooldown constraints
   * Mandatory triggers always pass; others must respect cooldown
   *
   * @param rules - Rules to filter
   * @param showId - Show ID for cooldown lookup
   * @param currentSequence - Current event sequence number
   * @returns Rules that pass cooldown check
   */
  private async filterByCooldown(
    rules: InterventionRule[],
    showId: string,
    currentSequence: number
  ): Promise<InterventionRule[]> {
    const eligible: InterventionRule[] = [];

    for (const rule of rules) {
      // Mandatory triggers always fire
      if (MANDATORY_TRIGGERS.has(rule.trigger)) {
        eligible.push(rule);
        continue;
      }

      // Check cooldown for non-mandatory triggers
      const cooldownRecord = await this.store.getTriggerCooldown(
        showId,
        rule.trigger
      );

      if (!cooldownRecord) {
        // Never triggered before, eligible
        eligible.push(rule);
        continue;
      }

      // Check if enough turns have passed
      const turnsSinceLastTrigger =
        currentSequence - cooldownRecord.lastTriggeredSequence;

      if (turnsSinceLastTrigger > rule.cooldownTurns) {
        eligible.push(rule);
      }
    }

    return eligible;
  }

  /**
   * Select the highest priority rule from eligible rules
   * Precondition: rules array is non-empty
   *
   * @param rules - Eligible rules to select from (must be non-empty)
   * @returns The highest priority rule
   */
  private selectByPriority(rules: InterventionRule[]): InterventionRule {
    // Sort by priority descending (higher = more important)
    const sorted = [...rules].sort((a, b) => b.priority - a.priority);
    // Caller ensures rules.length > 0, so sorted[0] is always defined
    return sorted[0] as InterventionRule;
  }

  /**
   * Record that a trigger was activated
   * Should be called after intervention is emitted
   *
   * @param showId - Show ID
   * @param triggerType - Type of trigger that was activated
   * @param sequenceNumber - Sequence number when triggered
   */
  async recordTriggerActivation(
    showId: string,
    triggerType: TriggerType,
    sequenceNumber: number
  ): Promise<void> {
    await this.store.setTriggerCooldown(showId, triggerType, sequenceNumber);
  }
}
