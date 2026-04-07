/**
 * API Server - Fastify setup and composition root
 * Based on TASK-044 - API Server setup
 */

import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import OpenAI from 'openai';
import { config } from '../config.js';
import { SqliteStore } from '../storage/sqlite-store.js';
import { EventJournal } from '../core/event-journal.js';
import { HostModule } from '../core/host-module.js';
import { ContextBuilder } from '../core/context-builder.js';
import { MockAdapter } from '../adapters/mock-adapter.js';
import { Orchestrator } from '../core/orchestrator.js';
import { ModelAdapter } from '../types/adapter.js';
import { logger } from '../utils/logger.js';
import { CharacterDefinition } from '../types/character.js';
import { SpeakFrequency } from '../types/enums.js';
import { generateId } from '../utils/id.js';
import {
  validateCreateShowRequest,
  validateControlShowRequest,
} from '../validation/schemas.js';

/**
 * Generate characters using OpenAI API
 */
async function generateCharactersWithOpenAI(count: number, theme?: string): Promise<CharacterDefinition[]> {
  const client = new OpenAI({ apiKey: config.openaiApiKey });

  const themeContext = theme
    ? `Сеттинг/тема персонажей: "${theme}". Все персонажи должны соответствовать этой теме.`
    : 'Персонажи могут быть из любого сеттинга - современность, фэнтези, научная фантастика, историческая эпоха и т.д.';

  const prompt = `Сгенерируй ${count} уникальных персонажей для интерактивного шоу-дискуссии.

${themeContext}

Каждый персонаж должен быть уникальным и интересным. У них должны быть разные:
- Характеры и темпераменты
- Мотивации и цели
- Секреты и скрытые стороны
- Стили общения (кто-то говорит много, кто-то мало)

Верни JSON объект с массивом персонажей в формате:
{
  "characters": [
    {
      "name": "Имя персонажа",
      "publicCard": "Публичное описание персонажа (2-3 предложения, что видят другие)",
      "personalityPrompt": "Инструкция для ИИ как отыгрывать этого персонажа (стиль речи, манеры, особенности)",
      "motivationPrompt": "Скрытые мотивации и цели персонажа",
      "secrets": ["секрет 1", "секрет 2"],
      "goals": ["цель 1", "цель 2"],
      "speakFrequency": "low" | "medium" | "high",
      "boundaryRules": ["что персонаж никогда не сделает"]
    }
  ]
}

ВАЖНО: Персонажи должны быть разнообразными - не делай их похожими друг на друга!
Используй разные speakFrequency: хотя бы один "low", хотя бы один "high", остальные "medium".`;

  const response = await client.chat.completions.create({
    model: config.openaiDefaultModel,
    messages: [
      {
        role: 'system',
        content: 'Ты генератор персонажей для интерактивных шоу. Отвечай только валидным JSON без дополнительного текста.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 1.0, // More creative generation
  });

  const content = response.choices[0]?.message?.content ?? '{"characters":[]}';
  logger.info('OpenAI response content:', content);

  const parsed = JSON.parse(content);

  // Handle both array and object with any key containing an array
  let rawCharacters: unknown[];
  if (Array.isArray(parsed)) {
    rawCharacters = parsed;
  } else {
    // Find the first array property in the object (could be "characters", "result", "data", "персонажи", etc.)
    const arrayValue = Object.values(parsed).find((val) => Array.isArray(val));
    rawCharacters = (arrayValue as unknown[]) ?? [];
  }

  logger.info(`Parsed ${rawCharacters.length} characters from OpenAI response`);

  // Define the expected shape of raw character from OpenAI
  interface RawCharacter {
    name: string;
    publicCard: string;
    personalityPrompt: string;
    motivationPrompt: string;
    secrets?: string[];
    goals?: string[];
    speakFrequency?: string;
    boundaryRules?: string[];
  }

  // Convert to CharacterDefinition format
  return (rawCharacters as RawCharacter[]).map((char) => ({
    id: generateId(),
    name: char.name,
    publicCard: char.publicCard,
    personalityPrompt: char.personalityPrompt,
    motivationPrompt: char.motivationPrompt,
    boundaryRules: char.boundaryRules ?? [],
    startingPrivateContext: {
      secrets: char.secrets ?? [],
      alliances: [],
      goals: char.goals ?? [],
      wildcards: [],
    },
    speakFrequency: (char.speakFrequency as SpeakFrequency) ?? SpeakFrequency.medium,
    responseConstraints: {
      maxTokens: 256,
      format: 'free' as const,
      language: 'ru',
    },
  }));
}

/**
 * Generate mock characters as fallback when OpenAI is unavailable
 */
function generateMockCharacters(count: number, theme?: string): CharacterDefinition[] {
  const themePrefix = theme ? `[${theme}] ` : '';

  const mockTemplates = [
    {
      name: 'Алексей Громов',
      publicCard: 'Опытный бизнесмен, владелец сети ресторанов. Уверен в себе и привык добиваться своего.',
      personalityPrompt: 'Говори уверенно и деловито. Используй бизнес-лексику. Ценишь время и конкретику.',
      motivationPrompt: 'Хочешь расширить влияние и найти новых партнёров.',
      speakFrequency: SpeakFrequency.high,
      secrets: ['В прошлом году чуть не обанкротился'],
      goals: ['Заключить выгодную сделку'],
    },
    {
      name: 'Марина Светлова',
      publicCard: 'Психолог с 15-летним стажем. Внимательно слушает и задаёт неудобные вопросы.',
      personalityPrompt: 'Говори мягко но проницательно. Задавай вопросы. Анализируй мотивы других.',
      motivationPrompt: 'Хочешь понять истинные мотивы каждого участника.',
      speakFrequency: SpeakFrequency.medium,
      secrets: ['Пишет книгу об этом шоу'],
      goals: ['Собрать материал для исследования'],
    },
    {
      name: 'Дмитрий Волков',
      publicCard: 'Молчаливый программист. Больше наблюдает, чем говорит.',
      personalityPrompt: 'Говори кратко и по делу. Предпочитай логику эмоциям. Часто молчишь.',
      motivationPrompt: 'Анализируешь ситуацию и ждёшь подходящего момента.',
      speakFrequency: SpeakFrequency.low,
      secrets: ['Разрабатывает конкурентный продукт'],
      goals: ['Собрать информацию о конкурентах'],
    },
    {
      name: 'Елена Краснова',
      publicCard: 'Яркая журналистка, ведущая популярного блога. Любит провокации.',
      personalityPrompt: 'Говори эмоционально и провокационно. Ищи скандалы. Задавай острые вопросы.',
      motivationPrompt: 'Хочешь найти сенсационный материал для статьи.',
      speakFrequency: SpeakFrequency.high,
      secrets: ['Работает на конкурента одного из участников'],
      goals: ['Раскопать компромат'],
    },
    {
      name: 'Андрей Миронов',
      publicCard: 'Философ и преподаватель университета. Любит рассуждать о высоком.',
      personalityPrompt: 'Говори размеренно и философски. Цитируй классиков. Ищи глубинный смысл.',
      motivationPrompt: 'Хочешь найти единомышленников для нового проекта.',
      speakFrequency: SpeakFrequency.medium,
      secrets: ['Уволен из университета за скандал'],
      goals: ['Восстановить репутацию'],
    },
    {
      name: 'Ольга Петрова',
      publicCard: 'Домохозяйка с тремя детьми. Простая и открытая.',
      personalityPrompt: 'Говори просто и по-домашнему. Делись бытовыми примерами. Будь эмпатичной.',
      motivationPrompt: 'Хочешь доказать, что обычные люди тоже могут быть интересными.',
      speakFrequency: SpeakFrequency.medium,
      secrets: ['В прошлом была успешным адвокатом'],
      goals: ['Найти новое призвание'],
    },
    {
      name: 'Виктор Сидоров',
      publicCard: 'Отставной военный, полковник в отставке. Дисциплинирован и прямолинеен.',
      personalityPrompt: 'Говори чётко и по-военному. Цени порядок и иерархию. Не терпи хаоса.',
      motivationPrompt: 'Хочешь навести порядок в любой ситуации.',
      speakFrequency: SpeakFrequency.medium,
      secrets: ['Участвовал в засекреченной операции'],
      goals: ['Найти достойного преемника'],
    },
    {
      name: 'Анна Белова',
      publicCard: 'Молодая художница, мечтательница. Видит мир иначе.',
      personalityPrompt: 'Говори образно и поэтично. Используй метафоры. Будь немного не от мира сего.',
      motivationPrompt: 'Ищешь вдохновение для новой серии работ.',
      speakFrequency: SpeakFrequency.low,
      secrets: ['Её картины - это зашифрованные послания'],
      goals: ['Найти человека, который поймёт её искусство'],
    },
    {
      name: 'Игорь Козлов',
      publicCard: 'Стендап-комик, любит шутить даже в серьёзных ситуациях.',
      personalityPrompt: 'Шути постоянно. Разряжай обстановку. Используй иронию и сарказм.',
      motivationPrompt: 'Хочешь проверить новый материал на живой аудитории.',
      speakFrequency: SpeakFrequency.high,
      secrets: ['Страдает от тяжёлой депрессии'],
      goals: ['Скрыть свою уязвимость за юмором'],
    },
    {
      name: 'Татьяна Орлова',
      publicCard: 'Бывший следователь, теперь частный детектив. Замечает всё.',
      personalityPrompt: 'Будь наблюдательной и подозрительной. Задавай уточняющие вопросы. Ищи противоречия.',
      motivationPrompt: 'Расследуешь одного из участников по заказу клиента.',
      speakFrequency: SpeakFrequency.medium,
      secrets: ['Знает компромат на нескольких участников'],
      goals: ['Собрать доказательства'],
    },
  ];

  const selected = mockTemplates.slice(0, count);

  return selected.map((template) => ({
    id: generateId(),
    name: themePrefix + template.name,
    publicCard: template.publicCard,
    personalityPrompt: template.personalityPrompt,
    motivationPrompt: template.motivationPrompt,
    boundaryRules: [],
    startingPrivateContext: {
      secrets: template.secrets,
      alliances: [],
      goals: template.goals,
      wildcards: [],
    },
    speakFrequency: template.speakFrequency,
    responseConstraints: {
      maxTokens: 256,
      format: 'free' as const,
      language: 'ru',
    },
  }));
}

/**
 * Application dependencies container
 * Created by composition root for dependency injection
 */
export interface AppDependencies {
  store: SqliteStore;
  journal: EventJournal;
  hostModule: HostModule;
  contextBuilder: ContextBuilder;
  adapter: ModelAdapter;
  orchestrator: Orchestrator;
}

/**
 * Create all application dependencies (composition root)
 * Initializes storage schema and wires up all modules
 */
async function createDependencies(): Promise<AppDependencies> {
  // Create storage
  const store = new SqliteStore(config.dbPath);
  await store.initSchema();

  // Create event journal
  const journal = new EventJournal(store);

  // Create host module
  const hostModule = new HostModule(store, journal);

  // Create context builder
  const contextBuilder = new ContextBuilder(journal, store);

  // Create model adapter (MockAdapter for default/testing)
  // Note: OpenAI adapter requires per-show context (showId, characterId),
  // so it's created on-demand when running shows, not in composition root
  const adapter: ModelAdapter = new MockAdapter();

  // Create orchestrator with all dependencies
  const orchestrator = new Orchestrator(
    store,
    adapter,
    journal,
    hostModule,
    contextBuilder
  );

  return {
    store,
    journal,
    hostModule,
    contextBuilder,
    adapter,
    orchestrator,
  };
}

/**
 * Create and configure Fastify server
 */
export async function createServer(): Promise<{
  app: FastifyInstance;
  deps: AppDependencies;
}> {
  // Create Fastify instance
  const app = Fastify({
    logger: false, // Using custom logger
  });

  // Serve static files from web/debug-ui
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  await app.register(fastifyStatic, {
    root: path.join(__dirname, '../../web/debug-ui'),
    prefix: '/',
  });

  // Create all dependencies via composition root
  const deps = await createDependencies();

  // Health check endpoint
  app.get('/health', async () => {
    return { status: 'ok' };
  });

  // GET /templates - List available show format templates
  app.get('/templates', async (_request: FastifyRequest, reply: FastifyReply) => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const formatsDir = path.join(__dirname, '../../src/formats');

    try {
      const files = await fs.readdir(formatsDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));

      const templates = await Promise.all(
        jsonFiles.map(async (file) => {
          const content = await fs.readFile(path.join(formatsDir, file), 'utf-8');
          return JSON.parse(content);
        })
      );

      return reply.send(templates);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return reply.status(404).send({ error: 'Templates directory not found' });
      }
      logger.error('Failed to read templates:', err);
      return reply.status(500).send({ error: 'Failed to read templates' });
    }
  });

  // GET /characters - List available character definitions
  app.get('/characters', async (_request: FastifyRequest, reply: FastifyReply) => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const charactersDir = path.join(__dirname, '../../src/formats/characters');

    try {
      const files = await fs.readdir(charactersDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));

      const characters = await Promise.all(
        jsonFiles.map(async (file) => {
          const content = await fs.readFile(path.join(charactersDir, file), 'utf-8');
          return JSON.parse(content);
        })
      );

      return reply.send(characters);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return reply.status(404).send({ error: 'Characters directory not found' });
      }
      logger.error('Failed to read characters:', err);
      return reply.status(500).send({ error: 'Failed to read characters' });
    }
  });

  // POST /generate/characters - Generate random characters via OpenAI
  app.post('/generate/characters', async (request: FastifyRequest, reply: FastifyReply) => {
    const { count = 5, theme } = request.body as { count?: number; theme?: string };

    logger.info(`POST /generate/characters - count: ${count}, theme: ${theme ?? 'none'}`);

    // Validate count
    if (count < 1 || count > 10) {
      logger.warn(`Invalid count: ${count}`);
      return reply.status(400).send({ error: 'Count must be between 1 and 10' });
    }

    // Check if OpenAI API key is available
    const hasOpenAIKey = Boolean(config.openaiApiKey);

    if (!hasOpenAIKey) {
      logger.info('No OpenAI API key, using mock characters');
      // Fallback: generate mock characters
      const characters = generateMockCharacters(count, theme);
      logger.info(`Generated ${characters.length} mock characters`);
      return reply.send(characters);
    }

    try {
      const characters = await generateCharactersWithOpenAI(count, theme);
      logger.info(`Successfully generated ${characters.length} characters via OpenAI`);

      if (characters.length === 0) {
        logger.warn('OpenAI returned empty array, falling back to mock');
        const mockCharacters = generateMockCharacters(count, theme);
        return reply.send(mockCharacters);
      }

      return reply.send(characters);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      logger.error(`OpenAI character generation failed: ${errorMessage}`, err);
      // Fallback to mock on error
      const characters = generateMockCharacters(count, theme);
      logger.info(`Fallback: generated ${characters.length} mock characters`);
      return reply.send(characters);
    }
  });

  // GET /shows - List all shows
  app.get('/shows', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const shows = await deps.store.listShows();

      // Sort by startedAt descending (newest first)
      shows.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));

      // Map to response format
      const response = shows.map((show) => {
        // Parse config snapshot to get template name
        let templateName = 'Unknown';
        try {
          const config = JSON.parse(show.configSnapshot);
          templateName = config.templateName ?? config.templateId ?? 'Unknown';
        } catch {
          // Ignore parse errors
        }

        return {
          showId: show.id,
          status: show.status,
          createdAt: show.startedAt ? new Date(show.startedAt).toISOString() : null,
          templateName,
        };
      });

      return reply.send({ shows: response });
    } catch (err) {
      logger.error('Failed to list shows:', err);
      return reply.status(500).send({ error: 'Failed to list shows' });
    }
  });

  // GET /shows/:id/events - SSE endpoint for real-time events
  app.get('/shows/:id/events', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { snapshot } = request.query as { snapshot?: string };

    // Check if show exists
    const show = await deps.store.getShow(id);
    if (!show) {
      return reply.status(404).send({ error: 'Show not found' });
    }

    // Tell Fastify we're taking over the response
    reply.hijack();

    // Set SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    });

    // Get Last-Event-ID for reconnection support
    // Last-Event-ID contains the sequence number of the last received event
    // We want events AFTER that, so we use lastEventId + 1 as cursor (which is inclusive)
    const lastEventIdHeader = request.headers['last-event-id'];
    const lastEventId = lastEventIdHeader
      ? parseInt(lastEventIdHeader as string, 10)
      : 0;

    // Send all existing events from the cursor position
    // cursor is inclusive (events >= cursor), so we add 1 to get events after lastEventId
    const existingEvents = await deps.journal.getEvents(id, {
      cursor: lastEventId > 0 ? lastEventId + 1 : undefined,
    });

    for (const event of existingEvents) {
      const sseData = `id: ${event.sequenceNumber}\ndata: ${JSON.stringify(event)}\n\n`;
      reply.raw.write(sseData);
    }

    // If snapshot mode, close connection after sending existing events
    // This is useful for testing and one-time fetches
    if (snapshot === 'true') {
      reply.raw.end();
      return;
    }

    // Subscribe to new events
    const eventHandler = (event: import('../types/events.js').ShowEvent) => {
      if (event.showId === id) {
        const sseData = `id: ${event.sequenceNumber}\ndata: ${JSON.stringify(event)}\n\n`;
        reply.raw.write(sseData);
      }
    };

    deps.journal.on('event', eventHandler);

    // Handle client disconnect
    request.raw.on('close', () => {
      deps.journal.off('event', eventHandler);
    });
  });

  // POST /shows/:id/control - Control show execution
  app.post('/shows/:id/control', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    // Validate request body with Zod
    const validation = validateControlShowRequest(request.body);
    if (!validation.success) {
      return reply.status(400).send({
        error: validation.error,
      });
    }

    const { action, phaseId } = validation.data;

    // Check if show exists
    const show = await deps.store.getShow(id);
    if (!show) {
      return reply.status(404).send({ error: 'Show not found' });
    }

    try {
      switch (action) {
        case 'start':
          // Run show in background (don't await)
          deps.orchestrator.runShow(id).catch((err) => {
            logger.error(`Show ${id} execution error:`, err);
          });
          return reply.send({
            status: 'started',
            message: 'Show started in background',
          });

        case 'pause':
          deps.orchestrator.pause();
          return reply.send({
            status: 'paused',
            message: 'Show paused',
          });

        case 'resume':
          deps.orchestrator.resume();
          return reply.send({
            status: 'resumed',
            message: 'Show resumed',
          });

        case 'step':
          await deps.orchestrator.step();
          return reply.send({
            status: 'stepped',
            message: 'One step executed',
          });

        case 'rollback':
          // phaseId is guaranteed by Zod validation for rollback action
          await deps.orchestrator.rollbackToPhase(id, phaseId!);
          return reply.send({
            status: 'rolled_back',
            message: `Rolled back to phase ${phaseId}`,
          });
      }
    } catch (err) {
      logger.error(`Control action ${action} failed for show ${id}:`, err);
      return reply.status(500).send({
        error: `Control action failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      });
    }
  });

  // GET /shows/:id/status - Get show status and budget
  app.get('/shows/:id/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    // Check if show exists
    const show = await deps.store.getShow(id);
    if (!show) {
      return reply.status(404).send({ error: 'Show not found' });
    }

    // Get token budget
    const budget = await deps.store.getBudget(id);

    // Get events count
    const eventsCount = await deps.store.getLatestSequence(id);

    // Calculate token budget info
    let tokenBudget: {
      total: number;
      used: number;
      mode: string;
      percentUsed: number;
    } | null = null;

    if (budget) {
      const used = budget.usedPrompt + budget.usedCompletion;
      tokenBudget = {
        total: budget.totalLimit,
        used,
        mode: budget.mode,
        percentUsed: budget.totalLimit > 0 ? (used / budget.totalLimit) * 100 : 0,
      };
    }

    return reply.send({
      status: show.status,
      currentPhaseId: show.currentPhaseId,
      eventsCount,
      tokenBudget,
    });
  });

  // GET /shows/:id/export - Export show journal to JSON
  app.get('/shows/:id/export', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    try {
      const exportJson = await deps.journal.exportJournal(id);
      reply.header('Content-Type', 'application/json');
      reply.header('Content-Disposition', `attachment; filename="show-${id}-export.json"`);
      return reply.send(exportJson);
    } catch (err) {
      if (err instanceof Error && err.message.includes('not found')) {
        return reply.status(404).send({ error: 'Show not found' });
      }
      logger.error(`Failed to export show ${id}:`, err);
      return reply.status(500).send({ error: 'Export failed' });
    }
  });

  // GET /shows/:id/config - Get show config (template + phases info)
  app.get('/shows/:id/config', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    // Check if show exists
    const show = await deps.store.getShow(id);
    if (!show) {
      return reply.status(404).send({ error: 'Show not found' });
    }

    try {
      const config = JSON.parse(show.configSnapshot);
      const phases = (config.phases ?? []) as Array<{
        id: string;
        name: string;
        type: string;
        durationMode: string;
        durationValue: number | string;
        allowedChannels: string[];
      }>;

      return reply.send({
        templateId: config.templateId ?? show.formatId,
        templateName: config.templateName ?? 'Unknown Template',
        templateDescription: config.templateDescription ?? '',
        phases: phases.map((p) => ({
          id: p.id,
          name: p.name,
          type: p.type,
          durationMode: p.durationMode,
          durationValue: p.durationValue,
          allowedChannels: p.allowedChannels,
        })),
        currentPhaseId: show.currentPhaseId,
      });
    } catch {
      return reply.status(500).send({ error: 'Failed to parse show config' });
    }
  });

  // GET /shows/:id/characters - Get characters for a show
  app.get('/shows/:id/characters', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    // Check if show exists
    const show = await deps.store.getShow(id);
    if (!show) {
      return reply.status(404).send({ error: 'Show not found' });
    }

    // Get characters from store
    const characterRecords = await deps.store.getCharacters(id);

    // Parse configSnapshot to get character definitions (name, publicCard)
    let characterDefinitions: Array<{
      id: string;
      name: string;
      publicCard: string;
    }> = [];

    try {
      const config = JSON.parse(show.configSnapshot);
      if (config.characterDefinitions) {
        characterDefinitions = config.characterDefinitions;
      }
    } catch {
      // If parsing fails, we'll use characterRecords only
    }

    // Build character response with merged data
    const characters = characterRecords.map((record) => {
      const definition = characterDefinitions.find((d) => d.id === record.characterId);
      return {
        id: record.characterId,
        name: definition?.name ?? record.characterId,
        modelAdapterId: record.modelAdapterId,
        publicCard: definition?.publicCard ?? '',
      };
    });

    return reply.send({ characters });
  });

  // POST /shows - Create a new show
  app.post('/shows', async (request: FastifyRequest, reply: FastifyReply) => {
    // Validate request body with Zod
    const validation = validateCreateShowRequest(request.body);
    if (!validation.success) {
      return reply.status(400).send({
        error: validation.error,
      });
    }

    const { formatId, characters, seed } = validation.data;

    // Validate character count against template limits
    if (characters.length < formatId.minParticipants) {
      return reply.status(400).send({
        error: `Minimum ${formatId.minParticipants} participants required, got ${characters.length}`,
      });
    }

    if (characters.length > formatId.maxParticipants) {
      return reply.status(400).send({
        error: `Maximum ${formatId.maxParticipants} participants allowed, got ${characters.length}`,
      });
    }

    try {
      // Call HostModule.initializeShow()
      // Cast types - Zod validation ensures they match the interfaces
      const show = await deps.hostModule.initializeShow(
        formatId as import('../types/template.js').ShowFormatTemplate,
        characters as Array<import('../types/character.js').CharacterDefinition & { modelAdapterId?: string }>,
        seed
      );

      // Return response
      return reply.status(201).send({
        showId: show.id,
        status: 'created',
      });
    } catch (err) {
      logger.error('Failed to create show:', err);
      return reply.status(500).send({
        error: 'Failed to create show',
      });
    }
  });

  return { app, deps };
}

/**
 * Start the API server
 * Sets up graceful shutdown handlers
 */
export async function startServer(): Promise<void> {
  const { app, deps } = await createServer();

  // Graceful shutdown handler
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);

    try {
      await app.close();
      await deps.store.close();
      logger.info('Server shut down successfully');
      process.exit(0);
    } catch (err) {
      logger.error('Error during shutdown:', err);
      process.exit(1);
    }
  };

  // Register shutdown handlers
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGHUP', () => shutdown('SIGHUP'));
  process.on('SIGTSTP', () => shutdown('SIGTSTP')); // Ctrl+Z

  // Start listening
  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
    logger.info(`Server listening on port ${config.port}`);
  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
}

// Start server if this is the main module
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  startServer();
}
