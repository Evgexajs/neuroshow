/**
 * Unit tests for Prompt Templates
 * HOST-006: Реализовать промпт-шаблоны и персоны ведущего
 */

import { describe, it, expect } from 'vitest';
import {
  buildSystemPrompt,
  buildUserPrompt,
  formatPersonalityTraits,
  formatCatchphrases,
  formatBoundaries,
  formatCharacterNames,
  formatRecentEvents,
  getTriggerDescription,
} from '../../../src/modules/llm-host/prompt-templates.js';
import {
  HOST_PERSONA_PRESETS,
  DEFAULT_HOST_PERSONA,
  getPersonaPreset,
  getPersonaPresetNames,
  resolvePersona,
  getVoiceStyleDescription,
  STANDARD_HOST_BOUNDARIES,
} from '../../../src/modules/llm-host/persona-presets.js';
import { DEFAULT_LLM_HOST_CONFIG } from '../../../src/modules/llm-host/index.js';
import { HostBudgetMode, PhaseType, ChannelType } from '../../../src/types/enums.js';
import type {
  HostPersona,
  HostContext,
  InterventionRule,
} from '../../../src/modules/llm-host/types.js';
import type { Phase } from '../../../src/types/template.js';
import type { EventSummary } from '../../../src/types/events.js';

// ─── Test Helpers ─────────────────────────────────────────────────────────────

function createTestPhase(): Phase {
  return {
    id: 'phase-001',
    name: 'Discussion',
    type: PhaseType.discussion,
    durationMode: 'turns',
    durationValue: 10,
    turnOrder: 'sequential',
    allowedChannels: [ChannelType.PUBLIC],
    triggerTemplate: null,
    completionCondition: 'turns_complete',
  };
}

function createTestContext(overrides: Partial<HostContext> = {}): HostContext {
  return {
    showId: 'show-001',
    currentPhase: createTestPhase(),
    characterNames: ['Alice', 'Bob', 'Charlie'],
    recentEvents: [],
    triggerType: 'phase_start',
    hostBudget: {
      showId: 'show-001',
      totalLimit: 10000,
      usedPrompt: 0,
      usedCompletion: 0,
      mode: HostBudgetMode.normal,
      lastUpdated: Date.now(),
    },
    ...overrides,
  };
}

function createTestRule(overrides: Partial<InterventionRule> = {}): InterventionRule {
  return {
    trigger: 'phase_start',
    enabled: true,
    priority: 10,
    cooldownTurns: 0,
    interventionType: 'announcement',
    maxTokens: 150,
    ...overrides,
  };
}

function createTestEventSummary(overrides: Partial<EventSummary> = {}): EventSummary {
  return {
    senderId: 'char-001',
    senderName: 'Alice',
    channel: ChannelType.PUBLIC,
    content: 'Hello everyone!',
    timestamp: Date.now(),
    ...overrides,
  };
}

// ─── Persona Presets Tests ────────────────────────────────────────────────────

describe('Persona Presets', () => {
  describe('HOST_PERSONA_PRESETS', () => {
    it('should have all four required presets', () => {
      expect(HOST_PERSONA_PRESETS).toHaveProperty('classic_host');
      expect(HOST_PERSONA_PRESETS).toHaveProperty('drama_queen');
      expect(HOST_PERSONA_PRESETS).toHaveProperty('provocateur');
      expect(HOST_PERSONA_PRESETS).toHaveProperty('friendly_guide');
    });

    it('classic_host should have correct properties', () => {
      const preset = HOST_PERSONA_PRESETS.classic_host!;
      expect(preset.name).toBe('Александр');
      expect(preset.voiceStyle).toBe('professional');
      expect(preset.personalityTraits).toContain('Опытный — за плечами десятки шоу');
      expect(preset.language).toBe('ru');
    });

    it('drama_queen should have correct properties', () => {
      const preset = HOST_PERSONA_PRESETS.drama_queen!;
      expect(preset.name).toBe('Виктория');
      expect(preset.voiceStyle).toBe('dramatic');
      expect(preset.catchphrases).toContain('Невероятно!');
    });

    it('provocateur should have correct properties', () => {
      const preset = HOST_PERSONA_PRESETS.provocateur!;
      expect(preset.name).toBe('Максим');
      expect(preset.voiceStyle).toBe('provocative');
      expect(preset.catchphrases).toContain('Кто-то явно врёт...');
    });

    it('friendly_guide should have correct properties', () => {
      const preset = HOST_PERSONA_PRESETS.friendly_guide!;
      expect(preset.name).toBe('Елена');
      expect(preset.voiceStyle).toBe('warm');
      expect(preset.personalityTraits).toContain('Дружелюбная — создаёт атмосферу доверия');
    });

    it('all presets should have standard boundaries', () => {
      for (const presetId of Object.keys(HOST_PERSONA_PRESETS)) {
        const preset = HOST_PERSONA_PRESETS[presetId];
        expect(preset).toBeDefined();
        expect(preset!.boundaries).toEqual(STANDARD_HOST_BOUNDARIES);
      }
    });
  });

  describe('getPersonaPreset()', () => {
    it('should return preset by ID', () => {
      const preset = getPersonaPreset('classic_host');
      expect(preset).not.toBeNull();
      expect(preset?.name).toBe('Александр');
    });

    it('should return null for unknown preset', () => {
      const preset = getPersonaPreset('unknown_preset');
      expect(preset).toBeNull();
    });
  });

  describe('getPersonaPresetNames()', () => {
    it('should return all preset names', () => {
      const names = getPersonaPresetNames();
      expect(names).toContain('classic_host');
      expect(names).toContain('drama_queen');
      expect(names).toContain('provocateur');
      expect(names).toContain('friendly_guide');
      expect(names).toHaveLength(4);
    });
  });

  describe('resolvePersona()', () => {
    it('should resolve string preset ID to HostPersona', () => {
      const persona = resolvePersona('classic_host');
      expect(persona.name).toBe('Александр');
    });

    it('should return HostPersona object as-is', () => {
      const customPersona: HostPersona = {
        name: 'Custom Host',
        voiceStyle: 'ironic',
        personalityTraits: ['Unique'],
        catchphrases: ['Custom phrase'],
        boundaries: ['Custom boundary'],
        language: 'en',
      };
      const resolved = resolvePersona(customPersona);
      expect(resolved).toBe(customPersona);
    });

    it('should fallback to DEFAULT_HOST_PERSONA for unknown preset', () => {
      const persona = resolvePersona('unknown_preset');
      expect(persona).toEqual(DEFAULT_HOST_PERSONA);
    });
  });

  describe('getVoiceStyleDescription()', () => {
    it('should return description for professional', () => {
      const desc = getVoiceStyleDescription('professional');
      expect(desc).toContain('Нейтральный');
      expect(desc).toContain('деловой');
    });

    it('should return description for dramatic', () => {
      const desc = getVoiceStyleDescription('dramatic');
      expect(desc).toContain('Эмоциональный');
      expect(desc).toContain('театральный');
    });

    it('should return description for ironic', () => {
      const desc = getVoiceStyleDescription('ironic');
      expect(desc).toContain('Ироничный');
    });

    it('should return description for warm', () => {
      const desc = getVoiceStyleDescription('warm');
      expect(desc).toContain('Дружелюбный');
    });

    it('should return description for provocative', () => {
      const desc = getVoiceStyleDescription('provocative');
      expect(desc).toContain('Провокационный');
    });
  });

  describe('STANDARD_HOST_BOUNDARIES', () => {
    it('should include key safety boundaries', () => {
      expect(STANDARD_HOST_BOUNDARIES).toContain('Не раскрывает чужие секреты');
      expect(STANDARD_HOST_BOUNDARIES).toContain('Не подсказывает, как голосовать');
      expect(STANDARD_HOST_BOUNDARIES).toContain('Не принимает решения за участников');
      expect(STANDARD_HOST_BOUNDARIES).toContain('Не меняет правила шоу');
    });
  });
});

// ─── Formatting Helpers Tests ─────────────────────────────────────────────────

describe('Formatting Helpers', () => {
  describe('formatPersonalityTraits()', () => {
    it('should format traits as bulleted list', () => {
      const traits = ['Trait A', 'Trait B'];
      const formatted = formatPersonalityTraits(traits);
      expect(formatted).toBe('- Trait A\n- Trait B');
    });

    it('should handle empty array', () => {
      const formatted = formatPersonalityTraits([]);
      expect(formatted).toBe('');
    });
  });

  describe('formatCatchphrases()', () => {
    it('should format catchphrases with quotes', () => {
      const phrases = ['Hello', 'Goodbye'];
      const formatted = formatCatchphrases(phrases);
      expect(formatted).toBe('"Hello", "Goodbye"');
    });
  });

  describe('formatBoundaries()', () => {
    it('should format boundaries as bulleted list', () => {
      const boundaries = ['Limit A', 'Limit B'];
      const formatted = formatBoundaries(boundaries);
      expect(formatted).toBe('- Limit A\n- Limit B');
    });
  });

  describe('formatCharacterNames()', () => {
    it('should join names with commas', () => {
      const names = ['Alice', 'Bob', 'Charlie'];
      const formatted = formatCharacterNames(names);
      expect(formatted).toBe('Alice, Bob, Charlie');
    });
  });

  describe('formatRecentEvents()', () => {
    it('should format events with sender name and content', () => {
      const events: EventSummary[] = [
        createTestEventSummary({ senderName: 'Alice', content: 'Hello!' }),
        createTestEventSummary({ senderName: 'Bob', content: 'Hi there' }),
      ];
      const formatted = formatRecentEvents(events);
      expect(formatted).toContain('[Alice]: Hello!');
      expect(formatted).toContain('[Bob]: Hi there');
    });

    it('should return placeholder for empty events', () => {
      const formatted = formatRecentEvents([]);
      expect(formatted).toBe('(нет событий)');
    });

    it('should use "Система" when senderName is empty', () => {
      const events: EventSummary[] = [
        createTestEventSummary({ senderName: '', content: 'System message' }),
      ];
      const formatted = formatRecentEvents(events);
      expect(formatted).toContain('[Система]:');
    });
  });

  describe('getTriggerDescription()', () => {
    it('should describe phase_start trigger', () => {
      const context = createTestContext({ triggerType: 'phase_start' });
      const desc = getTriggerDescription('phase_start', context);
      expect(desc).toContain('Началась новая фаза');
      expect(desc).toContain('Discussion');
    });

    it('should describe phase_end trigger', () => {
      const context = createTestContext({ triggerType: 'phase_end' });
      const desc = getTriggerDescription('phase_end', context);
      expect(desc).toContain('Завершилась фаза');
    });

    it('should describe revelation trigger', () => {
      const context = createTestContext({ triggerType: 'revelation' });
      const desc = getTriggerDescription('revelation', context);
      expect(desc).toContain('Раскрытие важной информации');
    });

    it('should describe silence_detected trigger', () => {
      const context = createTestContext({ triggerType: 'silence_detected' });
      const desc = getTriggerDescription('silence_detected', context);
      expect(desc).toContain('молчит');
    });

    it('should describe conflict_detected trigger', () => {
      const context = createTestContext({ triggerType: 'conflict_detected' });
      const desc = getTriggerDescription('conflict_detected', context);
      expect(desc).toContain('конфликт');
    });
  });
});

// ─── buildSystemPrompt Tests ──────────────────────────────────────────────────

describe('buildSystemPrompt()', () => {
  it('should include role description', () => {
    const persona = getPersonaPreset('classic_host')!;
    const context = createTestContext();
    const config = { ...DEFAULT_LLM_HOST_CONFIG };

    const prompt = buildSystemPrompt(persona, context, config);

    expect(prompt).toContain('Ты — ведущий интерактивного AI-шоу');
    expect(prompt).toContain('ТВОЯ РОЛЬ:');
    expect(prompt).toContain('Комментировать происходящее');
  });

  it('should include voice style description', () => {
    const persona = getPersonaPreset('drama_queen')!;
    const context = createTestContext();
    const config = { ...DEFAULT_LLM_HOST_CONFIG };

    const prompt = buildSystemPrompt(persona, context, config);

    expect(prompt).toContain('СТИЛЬ:');
    expect(prompt).toContain('Эмоциональный');
    expect(prompt).toContain('театральный');
  });

  it('should include personality traits', () => {
    const persona = getPersonaPreset('classic_host')!;
    const context = createTestContext();
    const config = { ...DEFAULT_LLM_HOST_CONFIG };

    const prompt = buildSystemPrompt(persona, context, config);

    expect(prompt).toContain('ХАРАКТЕР:');
    expect(prompt).toContain('Опытный');
  });

  it('should include catchphrases', () => {
    const persona = getPersonaPreset('provocateur')!;
    const context = createTestContext();
    const config = { ...DEFAULT_LLM_HOST_CONFIG };

    const prompt = buildSystemPrompt(persona, context, config);

    expect(prompt).toContain('ФИРМЕННЫЕ ФРАЗЫ');
    expect(prompt).toContain('А слабо?');
  });

  it('should include boundaries (limitations)', () => {
    const persona = getPersonaPreset('classic_host')!;
    const context = createTestContext();
    const config = { ...DEFAULT_LLM_HOST_CONFIG };

    const prompt = buildSystemPrompt(persona, context, config);

    expect(prompt).toContain('СТРОГИЕ ОГРАНИЧЕНИЯ:');
    expect(prompt).toContain('Не раскрывает чужие секреты');
    expect(prompt).toContain('НЕ принимай решения за участников');
    expect(prompt).toContain('НЕ меняй правила шоу');
  });

  it('should include current phase information', () => {
    const persona = DEFAULT_HOST_PERSONA;
    const context = createTestContext();
    const config = { ...DEFAULT_LLM_HOST_CONFIG };

    const prompt = buildSystemPrompt(persona, context, config);

    expect(prompt).toContain('ТЕКУЩИЙ КОНТЕКСТ:');
    expect(prompt).toContain('Фаза: Discussion');
  });

  it('should include character names', () => {
    const persona = DEFAULT_HOST_PERSONA;
    const context = createTestContext({ characterNames: ['Alice', 'Bob'] });
    const config = { ...DEFAULT_LLM_HOST_CONFIG };

    const prompt = buildSystemPrompt(persona, context, config);

    expect(prompt).toContain('Участники: Alice, Bob');
  });

  it('should include recent events', () => {
    const persona = DEFAULT_HOST_PERSONA;
    const context = createTestContext({
      recentEvents: [
        createTestEventSummary({ senderName: 'Alice', content: 'Hello!' }),
      ],
    });
    const config = { ...DEFAULT_LLM_HOST_CONFIG };

    const prompt = buildSystemPrompt(persona, context, config);

    expect(prompt).toContain('Последние события:');
    expect(prompt).toContain('[Alice]: Hello!');
  });

  it('should include trigger description', () => {
    const persona = DEFAULT_HOST_PERSONA;
    const context = createTestContext({ triggerType: 'phase_start' });
    const config = { ...DEFAULT_LLM_HOST_CONFIG };

    const prompt = buildSystemPrompt(persona, context, config);

    expect(prompt).toContain('ТРИГГЕР:');
    expect(prompt).toContain('Началась новая фаза');
  });

  it('should include max tokens limit', () => {
    const persona = DEFAULT_HOST_PERSONA;
    const context = createTestContext();
    const config = { ...DEFAULT_LLM_HOST_CONFIG };

    const prompt = buildSystemPrompt(persona, context, config);

    expect(prompt).toContain('Максимум');
    expect(prompt).toContain('токенов');
  });

  it('should add budget warning in saving mode', () => {
    const persona = DEFAULT_HOST_PERSONA;
    const context = createTestContext({
      hostBudget: {
        showId: 'show-001',
        totalLimit: 10000,
        usedPrompt: 7500,
        usedCompletion: 500,
        mode: HostBudgetMode.saving,
        lastUpdated: Date.now(),
      },
    });
    const config = { ...DEFAULT_LLM_HOST_CONFIG };

    const prompt = buildSystemPrompt(persona, context, config);

    expect(prompt).toContain('Бюджет ограничен');
    expect(prompt).toContain('Будь краток');
  });

  it('should resolve string preset ID to persona', () => {
    // Pass string instead of HostPersona object
    const context = createTestContext();
    const config = { ...DEFAULT_LLM_HOST_CONFIG };

    const prompt = buildSystemPrompt('classic_host' as unknown as HostPersona, context, config);

    // Should still work because resolvePersona is called internally
    expect(prompt).toContain('Нейтральный');
  });
});

// ─── buildUserPrompt Tests ────────────────────────────────────────────────────

describe('buildUserPrompt()', () => {
  describe('comment intervention', () => {
    it('should generate comment prompt', () => {
      const context = createTestContext();
      const rule = createTestRule({ interventionType: 'comment' });

      const prompt = buildUserPrompt(context, rule);

      expect(prompt).toContain('Прокомментируй последнее событие');
      expect(prompt).toContain('1-2 предложения');
    });
  });

  describe('question intervention', () => {
    it('should generate question prompt', () => {
      const context = createTestContext({ triggerType: 'silence_detected' });
      const rule = createTestRule({ interventionType: 'question', trigger: 'silence_detected' });

      const prompt = buildUserPrompt(context, rule);

      expect(prompt).toContain('Задай вопрос');
      expect(prompt).toContain('молчит');
      expect(prompt).toContain('требовать содержательного ответа');
    });

    it('should include trigger reason for conflict', () => {
      const context = createTestContext({ triggerType: 'conflict_detected' });
      const rule = createTestRule({ interventionType: 'question', trigger: 'conflict_detected' });

      const prompt = buildUserPrompt(context, rule);

      expect(prompt).toContain('конфликт');
    });
  });

  describe('announcement intervention', () => {
    it('should generate phase_start announcement prompt', () => {
      const context = createTestContext({ triggerType: 'phase_start' });
      const rule = createTestRule({ interventionType: 'announcement', trigger: 'phase_start' });

      const prompt = buildUserPrompt(context, rule);

      expect(prompt).toContain('Объяви о начале фазы');
      expect(prompt).toContain('Discussion');
      expect(prompt).toContain('правила');
    });

    it('should generate phase_end announcement prompt', () => {
      const context = createTestContext({ triggerType: 'phase_end' });
      const rule = createTestRule({ interventionType: 'announcement', trigger: 'phase_end' });

      const prompt = buildUserPrompt(context, rule);

      expect(prompt).toContain('Объяви о завершении фазы');
      expect(prompt).toContain('итоги');
    });
  });

  describe('private_directive intervention', () => {
    it('should generate private_directive prompt', () => {
      const context = createTestContext();
      const rule = createTestRule({ interventionType: 'private_directive' });

      const prompt = buildUserPrompt(context, rule);

      expect(prompt).toContain('приватное задание');
      expect(prompt).toContain('НЕ приказывай конкретное решение в голосовании');
    });
  });

  describe('fallback', () => {
    it('should handle unknown intervention type gracefully', () => {
      const context = createTestContext();
      // Force an unknown type (type assertion for testing)
      const rule = createTestRule({ interventionType: 'unknown_type' as 'comment' });

      // Should not throw
      const prompt = buildUserPrompt(context, rule);
      expect(prompt).toBeTruthy();
    });
  });
});
