/**
 * Unit tests for Conditional Triggers
 * HOST-012: Добавить silence_detected и conflict_detected триггеры
 */

import { describe, it, expect, vi } from 'vitest';
import {
  SilenceDetector,
  ConflictDetector,
  ConditionalTriggerEvaluator,
  parseCondition,
  DEFAULT_SILENCE_THRESHOLD,
  DEFAULT_CONFLICT_KEYWORDS,
} from '../../../src/modules/llm-host/conditional-triggers.js';
import { EventType, ChannelType, CharacterIntent } from '../../../src/types/enums.js';
import type { IStore } from '../../../src/types/interfaces/store.interface.js';
import type { InterventionRule } from '../../../src/modules/llm-host/types.js';
import type { ShowEvent } from '../../../src/types/events.js';

/**
 * Creates a mock store with events
 */
function createMockStore(events: ShowEvent[] = []): IStore {
  return {
    async getEvents(showId: string): Promise<ShowEvent[]> {
      return events.filter((e) => e.showId === showId);
    },

    // Stub other IStore methods
    initSchema: vi.fn(),
    close: vi.fn(),
    createShow: vi.fn(),
    getShow: vi.fn(),
    updateShow: vi.fn(),
    listShows: vi.fn(),
    createCharacter: vi.fn(),
    getCharacter: vi.fn(),
    getCharacters: vi.fn(),
    updateShowCharacterContext: vi.fn(),
    appendEvent: vi.fn(),
    getEventsForCharacter: vi.fn(),
    deleteEventsAfter: vi.fn(),
    getLatestSequence: vi.fn(),
    logLLMCall: vi.fn(),
    getLLMCalls: vi.fn(),
    getLLMCallByEventId: vi.fn(),
    createBudget: vi.fn(),
    getBudget: vi.fn(),
    updateBudget: vi.fn(),
    setBudgetMode: vi.fn(),
    getContextSummary: vi.fn(),
    upsertContextSummary: vi.fn(),
    createHostBudget: vi.fn(),
    getHostBudget: vi.fn(),
    updateHostBudget: vi.fn(),
    getTriggerCooldown: vi.fn(),
    setTriggerCooldown: vi.fn(),
    walCheckpoint: vi.fn(),
  } as unknown as IStore;
}

/**
 * Creates a test speech event
 */
function createSpeechEvent(
  options: {
    showId?: string;
    senderId?: string;
    content?: string;
    intent?: CharacterIntent;
    sequenceNumber?: number;
  } = {}
): ShowEvent {
  return {
    id: `event-${options.sequenceNumber ?? 1}`,
    showId: options.showId ?? 'show-001',
    timestamp: Date.now(),
    sequenceNumber: options.sequenceNumber ?? 1,
    phaseId: 'phase-001',
    type: EventType.speech,
    channel: ChannelType.PUBLIC,
    visibility: ChannelType.PUBLIC,
    senderId: options.senderId ?? 'char-001',
    receiverIds: [],
    audienceIds: [],
    content: options.content ?? 'Test speech',
    metadata: {
      intent: options.intent ?? CharacterIntent.speak,
    },
    seed: 'test-seed',
  };
}

/**
 * Creates a default silence_detected rule
 */
function createSilenceRule(condition?: string): InterventionRule {
  return {
    trigger: 'silence_detected',
    enabled: true,
    priority: 6,
    cooldownTurns: 5,
    interventionType: 'question',
    maxTokens: 80,
    condition,
  };
}

/**
 * Creates a default conflict_detected rule
 */
function createConflictRule(condition?: string): InterventionRule {
  return {
    trigger: 'conflict_detected',
    enabled: true,
    priority: 7,
    cooldownTurns: 3,
    interventionType: 'question',
    maxTokens: 80,
    condition,
  };
}

describe('parseCondition', () => {
  it('should return empty object for undefined condition', () => {
    const result = parseCondition(undefined);
    expect(result).toEqual({});
  });

  it('should return empty object for empty string', () => {
    const result = parseCondition('');
    expect(result).toEqual({});
  });

  it('should parse consecutiveEndTurns', () => {
    const result = parseCondition('consecutiveEndTurns:5');
    expect(result.consecutiveEndTurns).toBe(5);
  });

  it('should parse keywords', () => {
    const result = parseCondition('keywords:yes,no|agree,disagree');
    expect(result.conflictKeywords).toEqual([
      ['yes', 'no'],
      ['agree', 'disagree'],
    ]);
  });

  it('should parse multiple conditions separated by semicolon', () => {
    const result = parseCondition('consecutiveEndTurns:3;keywords:yes,no');
    expect(result.consecutiveEndTurns).toBe(3);
    expect(result.conflictKeywords).toEqual([['yes', 'no']]);
  });

  it('should ignore invalid consecutiveEndTurns', () => {
    const result = parseCondition('consecutiveEndTurns:invalid');
    expect(result.consecutiveEndTurns).toBeUndefined();
  });

  it('should ignore zero or negative consecutiveEndTurns', () => {
    expect(parseCondition('consecutiveEndTurns:0').consecutiveEndTurns).toBeUndefined();
    expect(parseCondition('consecutiveEndTurns:-1').consecutiveEndTurns).toBeUndefined();
  });
});

describe('SilenceDetector', () => {
  let store: IStore;
  let detector: SilenceDetector;

  describe('evaluate()', () => {
    it('should return null for non-speech events', async () => {
      store = createMockStore();
      detector = new SilenceDetector(store);

      const event: ShowEvent = {
        ...createSpeechEvent(),
        type: EventType.phase_start,
      };

      const result = await detector.evaluate(event, createSilenceRule());
      expect(result).toBeNull();
    });

    it('should return null when current event is not end_turn', async () => {
      store = createMockStore();
      detector = new SilenceDetector(store);

      const event = createSpeechEvent({
        intent: CharacterIntent.speak,
      });

      const result = await detector.evaluate(event, createSilenceRule());
      expect(result).toBeNull();
    });

    it('should return null when not enough consecutive end_turns', async () => {
      // 2 previous end_turns + 1 current = 3, threshold is 3, needs > 3
      const events = [
        createSpeechEvent({
          senderId: 'char-001',
          intent: CharacterIntent.end_turn,
          sequenceNumber: 1,
        }),
        createSpeechEvent({
          senderId: 'char-001',
          intent: CharacterIntent.end_turn,
          sequenceNumber: 2,
        }),
      ];

      store = createMockStore(events);
      detector = new SilenceDetector(store);

      const currentEvent = createSpeechEvent({
        senderId: 'char-001',
        intent: CharacterIntent.end_turn,
        sequenceNumber: 3,
      });

      const result = await detector.evaluate(currentEvent, createSilenceRule('consecutiveEndTurns:3'));
      expect(result).toBeNull();
    });

    it('should trigger silence_detected when > N consecutive end_turns', async () => {
      // 3 previous end_turns + 1 current = 4 > 3 threshold
      const events = [
        createSpeechEvent({
          senderId: 'char-001',
          intent: CharacterIntent.end_turn,
          sequenceNumber: 1,
        }),
        createSpeechEvent({
          senderId: 'char-001',
          intent: CharacterIntent.end_turn,
          sequenceNumber: 2,
        }),
        createSpeechEvent({
          senderId: 'char-001',
          intent: CharacterIntent.end_turn,
          sequenceNumber: 3,
        }),
      ];

      store = createMockStore(events);
      detector = new SilenceDetector(store);

      const currentEvent = createSpeechEvent({
        senderId: 'char-001',
        intent: CharacterIntent.end_turn,
        sequenceNumber: 4,
      });

      const result = await detector.evaluate(currentEvent, createSilenceRule('consecutiveEndTurns:3'));

      expect(result).not.toBeNull();
      expect(result!.type).toBe('silence_detected');
      expect(result!.silentCharacterId).toBe('char-001');
    });

    it('should use DEFAULT_SILENCE_THRESHOLD when condition not specified', async () => {
      // DEFAULT_SILENCE_THRESHOLD is 3, so need > 3 consecutive end_turns
      const events = [
        createSpeechEvent({
          senderId: 'char-001',
          intent: CharacterIntent.end_turn,
          sequenceNumber: 1,
        }),
        createSpeechEvent({
          senderId: 'char-001',
          intent: CharacterIntent.end_turn,
          sequenceNumber: 2,
        }),
        createSpeechEvent({
          senderId: 'char-001',
          intent: CharacterIntent.end_turn,
          sequenceNumber: 3,
        }),
      ];

      store = createMockStore(events);
      detector = new SilenceDetector(store);

      const currentEvent = createSpeechEvent({
        senderId: 'char-001',
        intent: CharacterIntent.end_turn,
        sequenceNumber: 4,
      });

      // No condition specified, uses DEFAULT_SILENCE_THRESHOLD
      const result = await detector.evaluate(currentEvent, createSilenceRule());

      expect(result).not.toBeNull();
      expect(result!.type).toBe('silence_detected');
    });

    it('should reset count when a non-end_turn event breaks the streak', async () => {
      const events = [
        createSpeechEvent({
          senderId: 'char-001',
          intent: CharacterIntent.end_turn,
          sequenceNumber: 1,
        }),
        createSpeechEvent({
          senderId: 'char-001',
          intent: CharacterIntent.speak, // Breaks the streak
          sequenceNumber: 2,
        }),
        createSpeechEvent({
          senderId: 'char-001',
          intent: CharacterIntent.end_turn,
          sequenceNumber: 3,
        }),
      ];

      store = createMockStore(events);
      detector = new SilenceDetector(store);

      const currentEvent = createSpeechEvent({
        senderId: 'char-001',
        intent: CharacterIntent.end_turn,
        sequenceNumber: 4,
      });

      // Only 2 consecutive end_turns (seq 3, 4), not > 3
      const result = await detector.evaluate(currentEvent, createSilenceRule('consecutiveEndTurns:3'));
      expect(result).toBeNull();
    });

    it('should only count events from the same character', async () => {
      const events = [
        createSpeechEvent({
          senderId: 'char-002', // Different character
          intent: CharacterIntent.end_turn,
          sequenceNumber: 1,
        }),
        createSpeechEvent({
          senderId: 'char-001',
          intent: CharacterIntent.end_turn,
          sequenceNumber: 2,
        }),
        createSpeechEvent({
          senderId: 'char-001',
          intent: CharacterIntent.end_turn,
          sequenceNumber: 3,
        }),
      ];

      store = createMockStore(events);
      detector = new SilenceDetector(store);

      const currentEvent = createSpeechEvent({
        senderId: 'char-001',
        intent: CharacterIntent.end_turn,
        sequenceNumber: 4,
      });

      // Only 3 consecutive end_turns from char-001 (seq 2, 3, 4), not > 3
      const result = await detector.evaluate(currentEvent, createSilenceRule('consecutiveEndTurns:3'));
      expect(result).toBeNull();
    });
  });
});

describe('ConflictDetector', () => {
  let store: IStore;
  let detector: ConflictDetector;

  describe('evaluate()', () => {
    it('should return null for non-speech events', async () => {
      store = createMockStore();
      detector = new ConflictDetector(store);

      const event: ShowEvent = {
        ...createSpeechEvent(),
        type: EventType.phase_start,
      };

      const result = await detector.evaluate(event, createConflictRule());
      expect(result).toBeNull();
    });

    it('should return null when no conflicting keywords found', async () => {
      const events = [
        createSpeechEvent({
          senderId: 'char-001',
          content: 'Hello everyone',
          sequenceNumber: 1,
        }),
        createSpeechEvent({
          senderId: 'char-002',
          content: 'Nice to meet you',
          sequenceNumber: 2,
        }),
      ];

      store = createMockStore(events);
      detector = new ConflictDetector(store);

      const currentEvent = createSpeechEvent({
        senderId: 'char-003',
        content: 'Good day',
        sequenceNumber: 3,
      });

      const result = await detector.evaluate(currentEvent, createConflictRule());
      expect(result).toBeNull();
    });

    it('should detect conflict when characters use opposing keywords', async () => {
      const events = [
        createSpeechEvent({
          senderId: 'char-001',
          content: 'Я полностью согласен с этим предложением',
          sequenceNumber: 1,
        }),
        createSpeechEvent({
          senderId: 'char-002',
          content: 'Я не согласен, это плохая идея',
          sequenceNumber: 2,
        }),
      ];

      store = createMockStore(events);
      detector = new ConflictDetector(store);

      const currentEvent = createSpeechEvent({
        senderId: 'char-003',
        content: 'Интересная дискуссия',
        sequenceNumber: 3,
      });

      const result = await detector.evaluate(currentEvent, createConflictRule());

      expect(result).not.toBeNull();
      expect(result!.type).toBe('conflict_detected');
      expect(result!.conflictingCharacterIds).toContain('char-001');
      expect(result!.conflictingCharacterIds).toContain('char-002');
    });

    it('should use custom keywords from condition', async () => {
      const events = [
        createSpeechEvent({
          senderId: 'char-001',
          content: 'I vote yes',
          sequenceNumber: 1,
        }),
        createSpeechEvent({
          senderId: 'char-002',
          content: 'I vote no',
          sequenceNumber: 2,
        }),
      ];

      store = createMockStore(events);
      detector = new ConflictDetector(store);

      const currentEvent = createSpeechEvent({
        senderId: 'char-003',
        content: 'Interesting',
        sequenceNumber: 3,
      });

      const rule = createConflictRule('keywords:yes|no');
      const result = await detector.evaluate(currentEvent, rule);

      expect(result).not.toBeNull();
      expect(result!.type).toBe('conflict_detected');
      expect(result!.matchedKeywords).toContain('yes');
      expect(result!.matchedKeywords).toContain('no');
    });

    it('should not trigger when same character uses both keywords', async () => {
      const events = [
        createSpeechEvent({
          senderId: 'char-001',
          content: 'Я согласен и не согласен одновременно',
          sequenceNumber: 1,
        }),
      ];

      store = createMockStore(events);
      detector = new ConflictDetector(store);

      const currentEvent = createSpeechEvent({
        senderId: 'char-001',
        content: 'Сложный выбор',
        sequenceNumber: 2,
      });

      const result = await detector.evaluate(currentEvent, createConflictRule());
      // Same character using both keywords shouldn't trigger conflict
      expect(result).toBeNull();
    });

    it('should detect conflict with правда/ложь keywords', async () => {
      const events = [
        createSpeechEvent({
          senderId: 'char-001',
          content: 'Это правда, я видел это своими глазами',
          sequenceNumber: 1,
        }),
        createSpeechEvent({
          senderId: 'char-002',
          content: 'Ты врёшь! Этого не было',
          sequenceNumber: 2,
        }),
      ];

      store = createMockStore(events);
      detector = new ConflictDetector(store);

      const currentEvent = createSpeechEvent({
        senderId: 'char-003',
        content: 'Кому верить?',
        sequenceNumber: 3,
      });

      const result = await detector.evaluate(currentEvent, createConflictRule());

      expect(result).not.toBeNull();
      expect(result!.type).toBe('conflict_detected');
    });
  });
});

describe('ConditionalTriggerEvaluator', () => {
  let store: IStore;
  let evaluator: ConditionalTriggerEvaluator;

  describe('evaluate()', () => {
    it('should check silence_detected rules first', async () => {
      // Setup events for silence detection
      const events = [
        createSpeechEvent({
          senderId: 'char-001',
          intent: CharacterIntent.end_turn,
          sequenceNumber: 1,
        }),
        createSpeechEvent({
          senderId: 'char-001',
          intent: CharacterIntent.end_turn,
          sequenceNumber: 2,
        }),
        createSpeechEvent({
          senderId: 'char-001',
          intent: CharacterIntent.end_turn,
          sequenceNumber: 3,
        }),
      ];

      store = createMockStore(events);
      evaluator = new ConditionalTriggerEvaluator(store);

      const currentEvent = createSpeechEvent({
        senderId: 'char-001',
        intent: CharacterIntent.end_turn,
        sequenceNumber: 4,
      });

      const rules = [
        createSilenceRule('consecutiveEndTurns:3'),
        createConflictRule(),
      ];

      const result = await evaluator.evaluate(currentEvent, rules);

      expect(result).not.toBeNull();
      expect(result!.type).toBe('silence_detected');
    });

    it('should check conflict_detected if silence not triggered', async () => {
      // Use same content as the direct ConflictDetector test that passes
      const events = [
        createSpeechEvent({
          senderId: 'char-001',
          content: 'Я полностью согласен с этим предложением',
          sequenceNumber: 1,
        }),
        createSpeechEvent({
          senderId: 'char-002',
          content: 'Я не согласен, это плохая идея',
          sequenceNumber: 2,
        }),
      ];

      store = createMockStore(events);
      evaluator = new ConditionalTriggerEvaluator(store);

      const currentEvent = createSpeechEvent({
        senderId: 'char-003',
        content: 'Интересная дискуссия',
        intent: CharacterIntent.speak, // Not end_turn, so silence won't trigger
        sequenceNumber: 3,
      });

      const rules = [
        createSilenceRule('consecutiveEndTurns:3'),
        createConflictRule(),
      ];

      const result = await evaluator.evaluate(currentEvent, rules);

      expect(result).not.toBeNull();
      expect(result!.type).toBe('conflict_detected');
    });

    it('should return null when no rules provided', async () => {
      store = createMockStore();
      evaluator = new ConditionalTriggerEvaluator(store);

      const event = createSpeechEvent();
      const result = await evaluator.evaluate(event, []);

      expect(result).toBeNull();
    });

    it('should only evaluate rules of matching trigger type', async () => {
      const events = [
        createSpeechEvent({
          senderId: 'char-001',
          intent: CharacterIntent.end_turn,
          sequenceNumber: 1,
        }),
        createSpeechEvent({
          senderId: 'char-001',
          intent: CharacterIntent.end_turn,
          sequenceNumber: 2,
        }),
        createSpeechEvent({
          senderId: 'char-001',
          intent: CharacterIntent.end_turn,
          sequenceNumber: 3,
        }),
      ];

      store = createMockStore(events);
      evaluator = new ConditionalTriggerEvaluator(store);

      const currentEvent = createSpeechEvent({
        senderId: 'char-001',
        intent: CharacterIntent.end_turn,
        sequenceNumber: 4,
      });

      // Only conflict rule, no silence rule
      const rules = [createConflictRule()];

      const result = await evaluator.evaluate(currentEvent, rules);

      // Should not trigger silence_detected since rule is not present
      expect(result).toBeNull();
    });
  });
});

describe('DEFAULT constants', () => {
  it('DEFAULT_SILENCE_THRESHOLD should be 3', () => {
    expect(DEFAULT_SILENCE_THRESHOLD).toBe(3);
  });

  it('DEFAULT_CONFLICT_KEYWORDS should contain agreement/disagreement pairs', () => {
    expect(DEFAULT_CONFLICT_KEYWORDS.length).toBeGreaterThan(0);

    // Check that первые пары содержат согласие/несогласие
    const flatKeywords = DEFAULT_CONFLICT_KEYWORDS.flat();
    expect(flatKeywords.some(k => k.includes('согласен'))).toBe(true);
    expect(flatKeywords).toContain('не согласен');
  });

  it('DEFAULT_CONFLICT_KEYWORDS should be organized in opposing pairs', () => {
    // Keywords at indices 0,1 should be opposing, 2,3 should be opposing, etc.
    expect(DEFAULT_CONFLICT_KEYWORDS.length % 2).toBe(0);
  });
});
