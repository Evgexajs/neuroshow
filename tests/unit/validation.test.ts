import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  sanitizeString,
  validateShowFormatTemplate,
  validateCharacterDefinition,
  validateCreateShowRequest,
  validateControlShowRequest,
  formatValidationError,
  showFormatTemplateSchema,
} from '../../src/validation/schemas.js';

describe('Validation Schemas', () => {
  describe('sanitizeString', () => {
    it('should remove null bytes', () => {
      expect(sanitizeString('hello\0world')).toBe('helloworld');
    });

    it('should remove control characters', () => {
      expect(sanitizeString('hello\x00\x01\x02\x03world')).toBe('helloworld');
    });

    it('should preserve newlines and tabs', () => {
      expect(sanitizeString('hello\nworld\ttab')).toBe('hello\nworld\ttab');
    });

    it('should trim whitespace', () => {
      expect(sanitizeString('  hello world  ')).toBe('hello world');
    });

    it('should limit length if specified', () => {
      expect(sanitizeString('hello world', 5)).toBe('hello');
    });

    it('should handle empty strings', () => {
      expect(sanitizeString('')).toBe('');
    });

    it('should handle strings with only whitespace', () => {
      expect(sanitizeString('   ')).toBe('');
    });
  });

  describe('validateShowFormatTemplate', () => {
    // Load real coalition template for testing
    const templatePath = join(__dirname, '../../src/formats/coalition.json');
    const validTemplate = JSON.parse(readFileSync(templatePath, 'utf-8'));

    it('should validate a valid ShowFormatTemplate', () => {
      const result = validateShowFormatTemplate(validTemplate);
      expect(result.id).toBe('coalition');
      expect(result.name).toBe('Коалиция');
    });

    it('should reject template without id', () => {
      const invalid = { ...validTemplate, id: undefined };
      expect(() => validateShowFormatTemplate(invalid)).toThrow('Invalid ShowFormatTemplate');
    });

    it('should reject template without name', () => {
      const invalid = { ...validTemplate, name: '' };
      expect(() => validateShowFormatTemplate(invalid)).toThrow('Invalid ShowFormatTemplate');
    });

    it('should reject template without phases', () => {
      const invalid = { ...validTemplate, phases: undefined };
      expect(() => validateShowFormatTemplate(invalid)).toThrow('Invalid ShowFormatTemplate');
    });

    it('should reject template with empty phases array', () => {
      const invalid = { ...validTemplate, phases: [] };
      expect(() => validateShowFormatTemplate(invalid)).toThrow('Invalid ShowFormatTemplate');
    });

    it('should reject template with minParticipants > maxParticipants', () => {
      const invalid = { ...validTemplate, minParticipants: 10, maxParticipants: 5 };
      expect(() => validateShowFormatTemplate(invalid)).toThrow('minParticipants must be less than or equal to maxParticipants');
    });

    it('should sanitize strings in template', () => {
      const templateWithDirtyStrings = {
        ...validTemplate,
        name: '  Dirty\0Name  ',
        description: 'Test\x00description',
      };
      const result = validateShowFormatTemplate(templateWithDirtyStrings);
      expect(result.name).toBe('DirtyName');
      expect(result.description).toBe('Testdescription');
    });
  });

  describe('validateCharacterDefinition', () => {
    // Load real character for testing
    const charactersPath = join(__dirname, '../../src/formats/characters');
    const validCharacter = JSON.parse(readFileSync(join(charactersPath, 'alina.json'), 'utf-8'));

    it('should validate a valid CharacterDefinition', () => {
      const result = validateCharacterDefinition(validCharacter);
      expect(result.id).toBeTruthy();
      expect(result.name).toBeTruthy();
    });

    it('should reject character without id', () => {
      const invalid = { ...validCharacter, id: undefined };
      expect(() => validateCharacterDefinition(invalid)).toThrow('Invalid CharacterDefinition');
    });

    it('should reject character without name', () => {
      const invalid = { ...validCharacter, name: '' };
      expect(() => validateCharacterDefinition(invalid)).toThrow('Invalid CharacterDefinition');
    });

    it('should reject character with invalid speakFrequency', () => {
      const invalid = { ...validCharacter, speakFrequency: 'invalid' };
      expect(() => validateCharacterDefinition(invalid)).toThrow('Invalid CharacterDefinition');
    });

    it('should reject character with invalid responseConstraints.format', () => {
      const invalid = {
        ...validCharacter,
        responseConstraints: { ...validCharacter.responseConstraints, format: 'invalid' },
      };
      expect(() => validateCharacterDefinition(invalid)).toThrow('Invalid CharacterDefinition');
    });

    it('should sanitize strings in character definition', () => {
      const characterWithDirtyStrings = {
        ...validCharacter,
        name: '  Dirty\0Name  ',
        publicCard: 'Card\x00content',
      };
      const result = validateCharacterDefinition(characterWithDirtyStrings);
      expect(result.name).toBe('DirtyName');
      expect(result.publicCard).toBe('Cardcontent');
    });
  });

  describe('validateControlShowRequest', () => {
    it('should validate a valid start action', () => {
      const result = validateControlShowRequest({ action: 'start' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.action).toBe('start');
      }
    });

    it('should validate a valid pause action', () => {
      const result = validateControlShowRequest({ action: 'pause' });
      expect(result.success).toBe(true);
    });

    it('should validate a valid resume action', () => {
      const result = validateControlShowRequest({ action: 'resume' });
      expect(result.success).toBe(true);
    });

    it('should validate a valid step action', () => {
      const result = validateControlShowRequest({ action: 'step' });
      expect(result.success).toBe(true);
    });

    it('should validate a valid rollback action with phaseId', () => {
      const result = validateControlShowRequest({ action: 'rollback', phaseId: 'phase-1' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.action).toBe('rollback');
        expect(result.data.phaseId).toBe('phase-1');
      }
    });

    it('should reject rollback without phaseId', () => {
      const result = validateControlShowRequest({ action: 'rollback' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('phaseId is required for rollback action');
      }
    });

    it('should reject invalid action', () => {
      const result = validateControlShowRequest({ action: 'invalid' });
      expect(result.success).toBe(false);
    });

    it('should reject null body', () => {
      const result = validateControlShowRequest(null);
      expect(result.success).toBe(false);
    });

    it('should reject empty body', () => {
      const result = validateControlShowRequest({});
      expect(result.success).toBe(false);
    });

    it('should sanitize phaseId', () => {
      const result = validateControlShowRequest({ action: 'rollback', phaseId: '  phase-1\0  ' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.phaseId).toBe('phase-1');
      }
    });
  });

  describe('validateCreateShowRequest', () => {
    const templatePath = join(__dirname, '../../src/formats/coalition.json');
    const validTemplate = JSON.parse(readFileSync(templatePath, 'utf-8'));
    const charactersPath = join(__dirname, '../../src/formats/characters');
    const validCharacter = JSON.parse(readFileSync(join(charactersPath, 'alina.json'), 'utf-8'));

    it('should validate a valid create show request', () => {
      const result = validateCreateShowRequest({
        formatId: validTemplate,
        characters: [
          validCharacter,
          { ...validCharacter, id: 'char-2', name: 'Character 2' },
          { ...validCharacter, id: 'char-3', name: 'Character 3' },
          { ...validCharacter, id: 'char-4', name: 'Character 4' },
          { ...validCharacter, id: 'char-5', name: 'Character 5' },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('should reject request without formatId', () => {
      const result = validateCreateShowRequest({
        characters: [validCharacter],
      });
      expect(result.success).toBe(false);
    });

    it('should reject request without characters', () => {
      const result = validateCreateShowRequest({
        formatId: validTemplate,
      });
      expect(result.success).toBe(false);
    });

    it('should reject request with empty characters array', () => {
      const result = validateCreateShowRequest({
        formatId: validTemplate,
        characters: [],
      });
      expect(result.success).toBe(false);
    });

    it('should reject request with invalid character', () => {
      const result = validateCreateShowRequest({
        formatId: validTemplate,
        characters: [{ id: '', name: 'Test' }], // invalid - empty id
      });
      expect(result.success).toBe(false);
    });

    it('should accept optional seed', () => {
      const result = validateCreateShowRequest({
        formatId: validTemplate,
        characters: [
          validCharacter,
          { ...validCharacter, id: 'char-2', name: 'Character 2' },
          { ...validCharacter, id: 'char-3', name: 'Character 3' },
          { ...validCharacter, id: 'char-4', name: 'Character 4' },
          { ...validCharacter, id: 'char-5', name: 'Character 5' },
        ],
        seed: 12345,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.seed).toBe(12345);
      }
    });

    it('should reject invalid seed type', () => {
      const result = validateCreateShowRequest({
        formatId: validTemplate,
        characters: [validCharacter],
        seed: 'not-a-number',
      });
      expect(result.success).toBe(false);
    });

    it('should accept optional modelAdapterId on characters', () => {
      const result = validateCreateShowRequest({
        formatId: validTemplate,
        characters: [
          { ...validCharacter, modelAdapterId: 'openai' },
          { ...validCharacter, id: 'char-2', name: 'Character 2', modelAdapterId: 'mock' },
          { ...validCharacter, id: 'char-3', name: 'Character 3' },
          { ...validCharacter, id: 'char-4', name: 'Character 4' },
          { ...validCharacter, id: 'char-5', name: 'Character 5' },
        ],
      });
      expect(result.success).toBe(true);
    });
  });

  describe('formatValidationError', () => {
    it('should format Zod errors nicely', () => {
      const result = showFormatTemplateSchema.safeParse({ id: '', name: '' });
      expect(result.success).toBe(false);
      if (!result.success) {
        const formatted = formatValidationError(result.error);
        expect(formatted).toContain('id');
        expect(formatted).toContain('name');
      }
    });
  });

  describe('injection prevention', () => {
    it('should sanitize potential SQL injection in strings', () => {
      const malicious = "Robert'; DROP TABLE users;--";
      const result = sanitizeString(malicious);
      // The string is sanitized but SQL injection is primarily prevented by
      // parameterized queries, not string sanitization. This just ensures
      // control characters are removed.
      expect(result).toBe("Robert'; DROP TABLE users;--");
    });

    it('should remove null bytes that could cause truncation attacks', () => {
      const malicious = 'safe\0unsafe_payload';
      const result = sanitizeString(malicious);
      expect(result).toBe('safeunsafe_payload');
    });

    it('should remove control characters that could cause terminal injection', () => {
      const malicious = 'safe\x1b[2J\x1b[H'; // ANSI escape codes
      const result = sanitizeString(malicious);
      expect(result).not.toContain('\x1b');
    });
  });
});
