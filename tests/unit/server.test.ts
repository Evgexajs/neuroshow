import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, AppDependencies } from '../../src/api/server.js';
import { FastifyInstance } from 'fastify';
import { ShowFormatTemplate } from '../../src/types/template.js';
import { CharacterDefinition } from '../../src/types/character.js';
import { PhaseType, ChannelType, SpeakFrequency } from '../../src/types/enums.js';
import { PrivateContext } from '../../src/types/context.js';
import * as fs from 'fs';

describe('API Server', () => {
  let app: FastifyInstance;
  let deps: AppDependencies;
  const testDbPath = './data/neuroshow.db';

  // Helper to create test template
  const createTestTemplate = (): ShowFormatTemplate => ({
    id: 'test-format-v1',
    name: 'Test Format',
    description: 'A test show format',
    minParticipants: 2,
    maxParticipants: 5,
    phases: [
      {
        id: 'phase-1',
        name: 'Discussion',
        type: PhaseType.discussion,
        durationMode: 'turns',
        durationValue: 5,
        turnOrder: 'sequential',
        allowedChannels: [ChannelType.PUBLIC],
        triggerTemplate: 'Start discussion',
        completionCondition: 'turns_complete',
      },
    ],
    decisionConfig: {
      timing: 'simultaneous',
      visibility: 'hidden_until_reveal',
      revealMoment: 'after_all',
      format: 'choice',
      options: ['yes', 'no'],
    },
    channelTypes: [ChannelType.PUBLIC],
    privateChannelRules: {
      initiator: 'any',
      maxPrivatesPerPhase: 2,
      maxPrivatesPerCharacterPerPhase: 1,
      requestQueueMode: 'fifo',
      requestFormat: 'Requesting private talk',
    },
    contextWindowSize: 50,
  });

  // Helper to create test character
  const createTestCharacter = (id: string, name: string): CharacterDefinition & { modelAdapterId?: string } => {
    const privateContext: PrivateContext = {
      secrets: [`${name}'s secret`],
      alliances: [],
      goals: [`${name}'s goal`],
      wildcards: [],
    };

    return {
      id,
      name,
      publicCard: `${name} is a participant`,
      personalityPrompt: `You are ${name}`,
      motivationPrompt: `${name} wants to win`,
      boundaryRules: ['No violence'],
      startingPrivateContext: privateContext,
      speakFrequency: SpeakFrequency.medium,
      responseConstraints: {
        maxTokens: 200,
        format: 'free',
        language: 'ru',
      },
      modelAdapterId: 'mock',
    };
  };

  beforeEach(async () => {
    // Clean up test db if exists
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    const server = await createServer();
    app = server.app;
    deps = server.deps;
  });

  afterEach(async () => {
    await app.close();
    await deps.store.close();

    // Clean up test db
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('GET /health', () => {
    it('should return status ok', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok' });
    });
  });

  describe('POST /shows', () => {
    it('should create a show with valid data', async () => {
      const template = createTestTemplate();
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
      ];

      const response = await app.inject({
        method: 'POST',
        url: '/shows',
        payload: {
          formatId: template,
          characters,
          seed: 12345,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.showId).toBeDefined();
      expect(typeof body.showId).toBe('string');
      expect(body.status).toBe('created');
    });

    it('should create a show without seed', async () => {
      const template = createTestTemplate();
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
      ];

      const response = await app.inject({
        method: 'POST',
        url: '/shows',
        payload: {
          formatId: template,
          characters,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.showId).toBeDefined();
      expect(body.status).toBe('created');
    });

    it('should store show in database', async () => {
      const template = createTestTemplate();
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
      ];

      const response = await app.inject({
        method: 'POST',
        url: '/shows',
        payload: {
          formatId: template,
          characters,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();

      // Verify show exists in database
      const show = await deps.store.getShow(body.showId);
      expect(show).toBeDefined();
      expect(show?.formatId).toBe(template.id);
    });

    it('should return 400 when body is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/shows',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBeDefined();
    });

    it('should return 400 when formatId is missing', async () => {
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
      ];

      const response = await app.inject({
        method: 'POST',
        url: '/shows',
        payload: {
          characters,
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('formatId');
    });

    it('should return 400 when formatId.id is missing', async () => {
      const template = { ...createTestTemplate(), id: undefined };
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
      ];

      const response = await app.inject({
        method: 'POST',
        url: '/shows',
        payload: {
          formatId: template,
          characters,
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('formatId.id');
    });

    it('should return 400 when characters is missing', async () => {
      const template = createTestTemplate();

      const response = await app.inject({
        method: 'POST',
        url: '/shows',
        payload: {
          formatId: template,
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('characters');
    });

    it('should return 400 when characters is empty', async () => {
      const template = createTestTemplate();

      const response = await app.inject({
        method: 'POST',
        url: '/shows',
        payload: {
          formatId: template,
          characters: [],
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('character');
    });

    it('should return 400 when too few characters', async () => {
      const template = createTestTemplate();
      template.minParticipants = 3;
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
      ];

      const response = await app.inject({
        method: 'POST',
        url: '/shows',
        payload: {
          formatId: template,
          characters,
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('Minimum');
    });

    it('should return 400 when too many characters', async () => {
      const template = createTestTemplate();
      template.maxParticipants = 2;
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
        createTestCharacter('char-3', 'Charlie'),
      ];

      const response = await app.inject({
        method: 'POST',
        url: '/shows',
        payload: {
          formatId: template,
          characters,
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('Maximum');
    });

    it('should return 400 when character id is missing', async () => {
      const template = createTestTemplate();
      const characters = [
        { ...createTestCharacter('char-1', 'Alice'), id: undefined },
        createTestCharacter('char-2', 'Bob'),
      ];

      const response = await app.inject({
        method: 'POST',
        url: '/shows',
        payload: {
          formatId: template,
          characters,
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('characters[0].id');
    });

    it('should return 400 when character name is missing', async () => {
      const template = createTestTemplate();
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        { ...createTestCharacter('char-2', 'Bob'), name: undefined },
      ];

      const response = await app.inject({
        method: 'POST',
        url: '/shows',
        payload: {
          formatId: template,
          characters,
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('characters[1].name');
    });

    it('should return 400 when seed is not a number', async () => {
      const template = createTestTemplate();
      const characters = [
        createTestCharacter('char-1', 'Alice'),
        createTestCharacter('char-2', 'Bob'),
      ];

      const response = await app.inject({
        method: 'POST',
        url: '/shows',
        payload: {
          formatId: template,
          characters,
          seed: 'not-a-number',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('seed');
    });
  });
});
