/**
 * Tests for HOST-015: LLM Host configuration in ShowFormatTemplate
 */

import { describe, it, expect } from 'vitest';
import {
  llmHostConfigSchema,
  showFormatTemplateSchema,
  validateShowFormatTemplate,
  interventionRuleSchema,
} from '../../src/validation/schemas.js';
import { DEFAULT_LLM_HOST_CONFIG } from '../../src/modules/llm-host/index.js';
import { HOST_PERSONA_PRESETS } from '../../src/modules/llm-host/persona-presets.js';
import type { LLMHostConfig } from '../../src/modules/llm-host/types.js';
import coalitionTemplate from '../../src/formats/coalition.json' with { type: 'json' };
import coalitionWithHostTemplate from '../../src/formats/coalition-with-host.json' with { type: 'json' };

describe('llmHostConfigSchema', () => {
  describe('partial validation (all fields optional)', () => {
    it('validates empty object', () => {
      const result = llmHostConfigSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('validates hostEnabled only', () => {
      const result = llmHostConfigSchema.safeParse({ hostEnabled: true });
      expect(result.success).toBe(true);
    });

    it('validates single field override', () => {
      const result = llmHostConfigSchema.safeParse({ hostBudget: 20000 });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.hostBudget).toBe(20000);
      }
    });

    it('validates multiple field overrides', () => {
      const result = llmHostConfigSchema.safeParse({
        hostEnabled: true,
        hostBudget: 15000,
        hostBudgetSavingThreshold: 60,
        hostBudgetExhaustedThreshold: 85,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('hostPersona validation', () => {
    it('accepts valid preset string', () => {
      const result = llmHostConfigSchema.safeParse({ hostPersona: 'classic_host' });
      expect(result.success).toBe(true);
    });

    it('accepts all valid presets', () => {
      const presets = Object.keys(HOST_PERSONA_PRESETS);
      for (const preset of presets) {
        const result = llmHostConfigSchema.safeParse({ hostPersona: preset });
        expect(result.success).toBe(true);
      }
    });

    it('rejects invalid preset string', () => {
      const result = llmHostConfigSchema.safeParse({ hostPersona: 'invalid_preset' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain('hostPersona must be a valid preset');
      }
    });

    it('accepts full HostPersona object', () => {
      const persona = {
        name: 'Custom Host',
        voiceStyle: 'dramatic',
        personalityTraits: ['trait1', 'trait2'],
        catchphrases: ['phrase1'],
        boundaries: ['no secrets'],
        language: 'ru',
      };
      const result = llmHostConfigSchema.safeParse({ hostPersona: persona });
      expect(result.success).toBe(true);
    });
  });

  describe('threshold validation', () => {
    it('accepts valid threshold order', () => {
      const result = llmHostConfigSchema.safeParse({
        hostBudgetSavingThreshold: 60,
        hostBudgetExhaustedThreshold: 85,
      });
      expect(result.success).toBe(true);
    });

    it('rejects saving >= exhausted threshold', () => {
      const result = llmHostConfigSchema.safeParse({
        hostBudgetSavingThreshold: 90,
        hostBudgetExhaustedThreshold: 85,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain('hostBudgetSavingThreshold must be less than hostBudgetExhaustedThreshold');
      }
    });

    it('rejects equal thresholds', () => {
      const result = llmHostConfigSchema.safeParse({
        hostBudgetSavingThreshold: 80,
        hostBudgetExhaustedThreshold: 80,
      });
      expect(result.success).toBe(false);
    });

    it('allows single threshold without validation', () => {
      // If only one threshold is provided, the other uses default so no cross-validation
      const result1 = llmHostConfigSchema.safeParse({ hostBudgetSavingThreshold: 60 });
      expect(result1.success).toBe(true);

      const result2 = llmHostConfigSchema.safeParse({ hostBudgetExhaustedThreshold: 85 });
      expect(result2.success).toBe(true);
    });
  });

  describe('interventionRules validation', () => {
    it('validates valid intervention rule', () => {
      const rule = {
        trigger: 'phase_start',
        enabled: true,
        priority: 10,
        cooldownTurns: 0,
        interventionType: 'announcement',
        maxTokens: 150,
      };
      const result = interventionRuleSchema.safeParse(rule);
      expect(result.success).toBe(true);
    });

    it('rejects invalid trigger type', () => {
      const rule = {
        trigger: 'invalid_trigger',
        enabled: true,
        priority: 5,
        cooldownTurns: 0,
        interventionType: 'comment',
        maxTokens: 100,
      };
      const result = interventionRuleSchema.safeParse(rule);
      expect(result.success).toBe(false);
    });

    it('rejects priority out of range', () => {
      const rule = {
        trigger: 'phase_start',
        enabled: true,
        priority: 15, // max is 10
        cooldownTurns: 0,
        interventionType: 'comment',
        maxTokens: 100,
      };
      const result = interventionRuleSchema.safeParse(rule);
      expect(result.success).toBe(false);
    });

    it('validates array of rules', () => {
      const result = llmHostConfigSchema.safeParse({
        interventionRules: [
          {
            trigger: 'phase_start',
            enabled: true,
            priority: 10,
            cooldownTurns: 0,
            interventionType: 'announcement',
            maxTokens: 150,
          },
          {
            trigger: 'conflict_detected',
            enabled: true,
            priority: 7,
            cooldownTurns: 3,
            interventionType: 'question',
            maxTokens: 80,
          },
        ],
      });
      expect(result.success).toBe(true);
    });
  });

  describe('model adapter validation', () => {
    it('accepts valid adapter', () => {
      const result = llmHostConfigSchema.safeParse({ hostModelAdapter: 'openai' });
      expect(result.success).toBe(true);
    });

    it('accepts anthropic adapter', () => {
      const result = llmHostConfigSchema.safeParse({ hostModelAdapter: 'anthropic' });
      expect(result.success).toBe(true);
    });

    it('accepts mock adapter', () => {
      const result = llmHostConfigSchema.safeParse({ hostModelAdapter: 'mock' });
      expect(result.success).toBe(true);
    });

    it('rejects invalid adapter', () => {
      const result = llmHostConfigSchema.safeParse({ hostModelAdapter: 'invalid' });
      expect(result.success).toBe(false);
    });
  });
});

describe('showFormatTemplateSchema with llmHostConfig', () => {
  it('validates template without llmHostConfig', () => {
    const result = showFormatTemplateSchema.safeParse(coalitionTemplate);
    expect(result.success).toBe(true);
  });

  it('validates template with llmHostConfig', () => {
    const result = showFormatTemplateSchema.safeParse(coalitionWithHostTemplate);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.llmHostConfig).toBeDefined();
      expect(result.data.llmHostConfig?.hostEnabled).toBe(true);
      expect(result.data.llmHostConfig?.hostPersona).toBe('drama_queen');
    }
  });

  it('validateShowFormatTemplate function works with llmHostConfig', () => {
    const validated = validateShowFormatTemplate(coalitionWithHostTemplate);
    expect(validated.llmHostConfig).toBeDefined();
    expect(validated.llmHostConfig?.hostBudget).toBe(15000);
  });
});

describe('config merging', () => {
  it('DEFAULT_LLM_HOST_CONFIG has all required fields', () => {
    expect(DEFAULT_LLM_HOST_CONFIG.hostEnabled).toBeDefined();
    expect(DEFAULT_LLM_HOST_CONFIG.hostPersona).toBeDefined();
    expect(DEFAULT_LLM_HOST_CONFIG.hostBudget).toBeDefined();
    expect(DEFAULT_LLM_HOST_CONFIG.interventionRules).toBeDefined();
    expect(DEFAULT_LLM_HOST_CONFIG.hostBudgetSavingThreshold).toBeDefined();
    expect(DEFAULT_LLM_HOST_CONFIG.hostBudgetExhaustedThreshold).toBeDefined();
  });

  it('partial config can be merged with defaults', () => {
    const templateConfig: Partial<LLMHostConfig> = {
      hostEnabled: true,
      hostBudget: 20000,
    };

    const merged: LLMHostConfig = {
      ...DEFAULT_LLM_HOST_CONFIG,
      ...templateConfig,
    };

    expect(merged.hostEnabled).toBe(true);
    expect(merged.hostBudget).toBe(20000);
    // Defaults preserved
    expect(merged.hostPersona).toBe(DEFAULT_LLM_HOST_CONFIG.hostPersona);
    expect(merged.interventionRules).toEqual(DEFAULT_LLM_HOST_CONFIG.interventionRules);
    expect(merged.hostBudgetSavingThreshold).toBe(DEFAULT_LLM_HOST_CONFIG.hostBudgetSavingThreshold);
  });

  it('template config overrides module config', () => {
    const moduleConfig: LLMHostConfig = {
      ...DEFAULT_LLM_HOST_CONFIG,
      hostEnabled: true,
      hostBudget: 12000,
    };

    const templateConfig: Partial<LLMHostConfig> = {
      hostBudget: 18000,
      hostPersona: 'provocateur',
    };

    const merged: LLMHostConfig = {
      ...DEFAULT_LLM_HOST_CONFIG,
      ...moduleConfig,
      ...templateConfig,
    };

    // Template overrides module
    expect(merged.hostBudget).toBe(18000);
    expect(merged.hostPersona).toBe('provocateur');
    // Module config preserved where not overridden
    expect(merged.hostEnabled).toBe(true);
  });

  it('omitted fields default correctly', () => {
    const templateConfig: Partial<LLMHostConfig> = {
      hostEnabled: true,
    };

    const merged: LLMHostConfig = {
      ...DEFAULT_LLM_HOST_CONFIG,
      ...templateConfig,
    };

    // Only hostEnabled changed
    expect(merged.hostEnabled).toBe(true);
    // All others are defaults
    expect(merged.hostBudget).toBe(DEFAULT_LLM_HOST_CONFIG.hostBudget);
    expect(merged.hostPersona).toBe(DEFAULT_LLM_HOST_CONFIG.hostPersona);
    expect(merged.allowHostDirectives).toBe(DEFAULT_LLM_HOST_CONFIG.allowHostDirectives);
    expect(merged.maxDirectivesPerPhase).toBe(DEFAULT_LLM_HOST_CONFIG.maxDirectivesPerPhase);
    expect(merged.interventionCooldown).toBe(DEFAULT_LLM_HOST_CONFIG.interventionCooldown);
  });
});

describe('coalition-with-host.json template', () => {
  it('has valid structure', () => {
    expect(coalitionWithHostTemplate.id).toBe('coalition-with-host');
    expect(coalitionWithHostTemplate.name).toContain('AI-ведущим');
  });

  it('has llmHostConfig with expected values', () => {
    const config = coalitionWithHostTemplate.llmHostConfig;
    expect(config).toBeDefined();
    expect(config.hostEnabled).toBe(true);
    expect(config.hostPersona).toBe('drama_queen');
    expect(config.hostBudget).toBe(15000);
    expect(config.hostBudgetSavingThreshold).toBe(60);
    expect(config.hostBudgetExhaustedThreshold).toBe(85);
    expect(config.allowHostDirectives).toBe(true);
  });

  it('validates via showFormatTemplateSchema', () => {
    const result = showFormatTemplateSchema.safeParse(coalitionWithHostTemplate);
    expect(result.success).toBe(true);
  });
});
