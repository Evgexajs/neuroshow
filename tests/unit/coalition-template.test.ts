import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { ShowFormatTemplate, Phase } from '../../src/types/template.js';
import { PhaseType, ChannelType } from '../../src/types/enums.js';

describe('Coalition Template', () => {
  const templatePath = join(__dirname, '../../src/formats/coalition.json');
  const template: ShowFormatTemplate = JSON.parse(readFileSync(templatePath, 'utf-8'));

  describe('basic structure', () => {
    it('should have valid id and name', () => {
      expect(template.id).toBe('coalition');
      expect(template.name).toBe('Коалиция');
    });

    it('should have description', () => {
      expect(template.description).toBeTruthy();
      expect(template.description.length).toBeGreaterThan(10);
    });

    it('should have correct participant limits', () => {
      expect(template.minParticipants).toBe(5);
      expect(template.maxParticipants).toBe(5);
    });
  });

  describe('phases', () => {
    it('should have exactly 3 phases', () => {
      expect(template.phases).toHaveLength(3);
    });

    it('should have Phase 1: Знакомство (PUBLIC only)', () => {
      const phase1 = template.phases[0];
      expect(phase1.id).toBe('phase-1-introduction');
      expect(phase1.name).toBe('Знакомство');
      expect(phase1.type).toBe('discussion');
      expect(phase1.turnOrder).toBe('sequential');
      expect(phase1.allowedChannels).toEqual(['PUBLIC']);
      expect(phase1.triggerTemplate).toContain('Расскажи о себе');
    });

    it('should have Phase 2: Переговоры (PUBLIC + PRIVATE)', () => {
      const phase2 = template.phases[1];
      expect(phase2.id).toBe('phase-2-negotiations');
      expect(phase2.name).toBe('Переговоры');
      expect(phase2.type).toBe('discussion');
      expect(phase2.turnOrder).toBe('frequency_weighted');
      expect(phase2.allowedChannels).toContain('PUBLIC');
      expect(phase2.allowedChannels).toContain('PRIVATE');
    });

    it('should have Phase 3: Финальное решение (DECISION)', () => {
      const phase3 = template.phases[2];
      expect(phase3.id).toBe('phase-3-decision');
      expect(phase3.name).toBe('Финальное решение');
      expect(phase3.type).toBe('decision');
    });

    it('should have all required Phase fields', () => {
      template.phases.forEach((phase: Phase, index: number) => {
        expect(phase.id).toBeTruthy();
        expect(phase.name).toBeTruthy();
        expect(phase.type).toBeTruthy();
        expect(phase.durationMode).toBeTruthy();
        expect(phase.durationValue).toBeDefined();
        expect(phase.turnOrder).toBeTruthy();
        expect(phase.allowedChannels).toBeInstanceOf(Array);
        expect(phase.completionCondition).toBeTruthy();
      });
    });
  });

  describe('privateChannelRules', () => {
    it('should have maxPrivatesPerPhase = 4', () => {
      expect(template.privateChannelRules.maxPrivatesPerPhase).toBe(4);
    });

    it('should have maxPrivatesPerCharacterPerPhase = 2', () => {
      expect(template.privateChannelRules.maxPrivatesPerCharacterPerPhase).toBe(2);
    });

    it('should have character_request_host_approves initiator', () => {
      expect(template.privateChannelRules.initiator).toBe('character_request_host_approves');
    });

    it('should have fifo requestQueueMode', () => {
      expect(template.privateChannelRules.requestQueueMode).toBe('fifo');
    });

    it('should have structured_signal requestFormat', () => {
      expect(template.privateChannelRules.requestFormat).toBe('structured_signal');
    });
  });

  describe('decisionConfig', () => {
    it('should have timing = simultaneous', () => {
      expect(template.decisionConfig.timing).toBe('simultaneous');
    });

    it('should have visibility = secret_until_reveal', () => {
      expect(template.decisionConfig.visibility).toBe('secret_until_reveal');
    });

    it('should have revealMoment = after_all', () => {
      expect(template.decisionConfig.revealMoment).toBe('after_all');
    });

    it('should have format = choice', () => {
      expect(template.decisionConfig.format).toBe('choice');
    });
  });

  describe('channelTypes', () => {
    it('should support PUBLIC and PRIVATE channels', () => {
      expect(template.channelTypes).toContain('PUBLIC');
      expect(template.channelTypes).toContain('PRIVATE');
    });
  });

  describe('other settings', () => {
    it('should have contextWindowSize defined', () => {
      expect(template.contextWindowSize).toBeGreaterThan(0);
    });

    it('should not allow character initiative (Non-MVP)', () => {
      expect(template.allowCharacterInitiative).toBe(false);
    });
  });
});
