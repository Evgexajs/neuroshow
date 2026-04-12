/**
 * Conditional Triggers for LLM Host
 * HOST-012: Добавить silence_detected и conflict_detected триггеры
 *
 * Provides detection of:
 * - silence_detected: Character does >N end_turn in a row
 * - conflict_detected: Opposing positions from 2+ characters (keyword analysis)
 */

import type { ShowEvent } from '../../types/events.js';
import type { IStore } from '../../types/interfaces/store.interface.js';
import { EventType, CharacterIntent } from '../../types/enums.js';
import type { TriggerType, InterventionRule } from './types.js';

/**
 * Result of conditional trigger evaluation
 */
export interface ConditionalTriggerResult {
  /** Trigger type that fired */
  type: TriggerType;

  /** Character ID that triggered silence (for silence_detected) */
  silentCharacterId?: string;

  /** Character IDs involved in conflict (for conflict_detected) */
  conflictingCharacterIds?: string[];

  /** Keywords that matched (for conflict_detected) */
  matchedKeywords?: string[];
}

/**
 * Condition parser result
 */
export interface ParsedCondition {
  /** Number of consecutive end_turns required for silence_detected */
  consecutiveEndTurns?: number;

  /** Keywords to detect conflict */
  conflictKeywords?: string[][];
}

/**
 * Default consecutive end_turns threshold for silence detection
 */
export const DEFAULT_SILENCE_THRESHOLD = 3;

/**
 * Default opposing keyword pairs for conflict detection (Russian)
 * Each sub-array contains synonyms that represent the same position
 * Note: Longer phrases come first to avoid substring matching issues
 */
export const DEFAULT_CONFLICT_KEYWORDS: string[][] = [
  // Agreement (index 0) - phrases that indicate agreement
  ['полностью согласен', 'я согласен', 'согласен с', 'поддерживаю', 'правильно', 'верно'],
  // Disagreement (index 1) - phrases that indicate disagreement
  ['не согласен', 'категорически против', 'против', 'неправильно', 'неверно', 'ошибаешься'],
  // Support (index 2) - positive evaluation
  ['за это', 'одобряю', 'хорошая идея'],
  // Opposition (index 3) - negative evaluation
  ['против этого', 'возражаю', 'плохая идея'],
  // Truth (index 4) - claiming truth
  ['это правда', 'честно говорю', 'искренне'],
  // Lie (index 5) - accusing of lying
  ['это ложь', 'ты врёшь', 'обманываешь', 'лжёшь'],
];

/**
 * Check if content contains a keyword with word boundary awareness
 * Uses longer phrases first to avoid substring issues
 */
function containsKeyword(content: string, keyword: string): boolean {
  const lowerContent = content.toLowerCase();
  const lowerKeyword = keyword.toLowerCase();

  // For single words, check word boundaries
  if (!lowerKeyword.includes(' ')) {
    // Use regex for word boundary matching
    const regex = new RegExp(`(^|[^а-яёa-z])${escapeRegex(lowerKeyword)}([^а-яёa-z]|$)`, 'i');
    return regex.test(lowerContent);
  }

  // For phrases, simple includes is fine
  return lowerContent.includes(lowerKeyword);
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parse condition string from InterventionRule
 *
 * Supported condition formats:
 * - "consecutiveEndTurns:3" - silence threshold
 * - "keywords:согласен,против" - custom conflict keywords (comma-separated pairs)
 *
 * @param condition - Condition string from rule
 * @returns Parsed condition parameters
 */
export function parseCondition(condition?: string): ParsedCondition {
  const result: ParsedCondition = {};

  if (!condition) {
    return result;
  }

  const parts = condition.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith('consecutiveEndTurns:')) {
      const value = parseInt(trimmed.slice('consecutiveEndTurns:'.length), 10);
      if (!isNaN(value) && value > 0) {
        result.consecutiveEndTurns = value;
      }
    } else if (trimmed.startsWith('keywords:')) {
      // Format: "keywords:word1,word2|word3,word4" where | separates opposing pairs
      const keywordStr = trimmed.slice('keywords:'.length);
      const pairs = keywordStr.split('|').map((p) => p.split(',').map((k) => k.trim().toLowerCase()));
      if (pairs.length > 0) {
        result.conflictKeywords = pairs;
      }
    }
  }

  return result;
}

/**
 * SilenceDetector - detects when a character does >N end_turn in a row
 *
 * Scans recent speech events from the same character and counts
 * consecutive end_turn intents.
 */
export class SilenceDetector {
  constructor(private readonly store: IStore) {}

  /**
   * Check if the current event triggers silence detection
   *
   * @param event - The speech event to evaluate
   * @param rule - The intervention rule with condition
   * @returns ConditionalTriggerResult if silence detected, null otherwise
   */
  async evaluate(
    event: ShowEvent,
    rule: InterventionRule
  ): Promise<ConditionalTriggerResult | null> {
    // Only evaluate speech events
    if (event.type !== EventType.speech) {
      return null;
    }

    // Check if current event is end_turn
    const intent = event.metadata?.intent as CharacterIntent | undefined;
    if (intent !== CharacterIntent.end_turn) {
      return null;
    }

    // Parse threshold from condition
    const parsed = parseCondition(rule.condition);
    const threshold = parsed.consecutiveEndTurns ?? DEFAULT_SILENCE_THRESHOLD;

    // Get recent events for this show
    const events = await this.store.getEvents(event.showId);

    // Filter to speech events from the same sender before this event
    const senderEvents = events.filter(
      (e) =>
        e.type === EventType.speech &&
        e.senderId === event.senderId &&
        e.sequenceNumber < event.sequenceNumber
    );

    // Sort by sequence descending (most recent first)
    senderEvents.sort((a, b) => b.sequenceNumber - a.sequenceNumber);

    // Count consecutive end_turns (including current event)
    let consecutiveCount = 1; // Current event is already end_turn
    for (const e of senderEvents) {
      const eIntent = e.metadata?.intent as CharacterIntent | undefined;
      if (eIntent === CharacterIntent.end_turn) {
        consecutiveCount++;
      } else {
        break; // Non-end_turn breaks the streak
      }
    }

    // Trigger if threshold exceeded
    if (consecutiveCount > threshold) {
      return {
        type: 'silence_detected',
        silentCharacterId: event.senderId,
      };
    }

    return null;
  }
}

/**
 * ConflictDetector - detects opposing positions from 2+ characters
 *
 * Uses simple keyword/sentiment analysis without external APIs:
 * - Scans recent speech content for opposing keyword pairs
 * - Triggers when different characters use opposing keywords
 */
export class ConflictDetector {
  constructor(private readonly store: IStore) {}

  /**
   * Check if recent events indicate a conflict
   *
   * @param event - The speech event to evaluate
   * @param rule - The intervention rule with condition
   * @returns ConditionalTriggerResult if conflict detected, null otherwise
   */
  async evaluate(
    event: ShowEvent,
    rule: InterventionRule
  ): Promise<ConditionalTriggerResult | null> {
    // Only evaluate speech events
    if (event.type !== EventType.speech) {
      return null;
    }

    // Parse keywords from condition or use defaults
    const parsed = parseCondition(rule.condition);
    const keywordPairs = parsed.conflictKeywords ?? DEFAULT_CONFLICT_KEYWORDS;

    // Get recent speech events from this show
    const events = await this.store.getEvents(event.showId);
    const speechEvents = events.filter(
      (e) =>
        e.type === EventType.speech &&
        e.content &&
        e.sequenceNumber <= event.sequenceNumber
    );

    // Take last 10 speech events for analysis (configurable window)
    const recentSpeeches = speechEvents
      .sort((a, b) => b.sequenceNumber - a.sequenceNumber)
      .slice(0, 10);

    // Map: keyword pair index -> set of character IDs using keywords from that pair
    const pairToCharacters: Map<number, Set<string>> = new Map();
    const pairToKeywords: Map<number, Set<string>> = new Map();

    for (const speech of recentSpeeches) {
      const content = speech.content;
      const senderId = speech.senderId;

      // Check each keyword pair
      for (let pairIndex = 0; pairIndex < keywordPairs.length; pairIndex++) {
        const keywords = keywordPairs[pairIndex]!;
        for (const keyword of keywords) {
          if (containsKeyword(content, keyword)) {
            if (!pairToCharacters.has(pairIndex)) {
              pairToCharacters.set(pairIndex, new Set());
              pairToKeywords.set(pairIndex, new Set());
            }
            pairToCharacters.get(pairIndex)!.add(senderId);
            pairToKeywords.get(pairIndex)!.add(keyword);
          }
        }
      }
    }

    // Check for conflict: adjacent pairs with different characters
    // Pairs at indices 0,1 and 2,3 and 4,5 are opposing pairs
    for (let i = 0; i < keywordPairs.length - 1; i += 2) {
      const chars1 = pairToCharacters.get(i);
      const chars2 = pairToCharacters.get(i + 1);

      if (chars1 && chars2) {
        // Find characters in pair 1 that are NOT in pair 2 and vice versa
        const conflicting1 = [...chars1].filter((c) => !chars2.has(c));
        const conflicting2 = [...chars2].filter((c) => !chars1.has(c));

        if (conflicting1.length > 0 && conflicting2.length > 0) {
          // We have different characters using opposing keywords
          const allKeywords = [
            ...(pairToKeywords.get(i) ?? []),
            ...(pairToKeywords.get(i + 1) ?? []),
          ];

          return {
            type: 'conflict_detected',
            conflictingCharacterIds: [...conflicting1, ...conflicting2],
            matchedKeywords: allKeywords,
          };
        }
      }
    }

    return null;
  }
}

/**
 * ConditionalTriggerEvaluator - orchestrates conditional trigger evaluation
 *
 * Combines silence and conflict detectors, respecting cooldowns
 */
export class ConditionalTriggerEvaluator {
  private silenceDetector: SilenceDetector;
  private conflictDetector: ConflictDetector;

  constructor(store: IStore) {
    this.silenceDetector = new SilenceDetector(store);
    this.conflictDetector = new ConflictDetector(store);
  }

  /**
   * Evaluate conditional triggers for an event
   *
   * @param event - The event to evaluate
   * @param rules - Intervention rules to check (should be filtered to enabled conditional triggers)
   * @returns ConditionalTriggerResult if any trigger fires, null otherwise
   */
  async evaluate(
    event: ShowEvent,
    rules: InterventionRule[]
  ): Promise<ConditionalTriggerResult | null> {
    // Check silence_detected rules
    for (const rule of rules.filter((r) => r.trigger === 'silence_detected')) {
      const result = await this.silenceDetector.evaluate(event, rule);
      if (result) {
        return result;
      }
    }

    // Check conflict_detected rules
    for (const rule of rules.filter((r) => r.trigger === 'conflict_detected')) {
      const result = await this.conflictDetector.evaluate(event, rule);
      if (result) {
        return result;
      }
    }

    return null;
  }
}
