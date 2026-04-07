/**
 * API Server - Fastify setup and composition root
 * Based on TASK-044 - API Server setup
 */

import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { config } from '../config.js';
import { SqliteStore } from '../storage/sqlite-store.js';
import { EventJournal } from '../core/event-journal.js';
import { HostModule } from '../core/host-module.js';
import { ContextBuilder } from '../core/context-builder.js';
import { MockAdapter } from '../adapters/mock-adapter.js';
import { Orchestrator } from '../core/orchestrator.js';
import { ModelAdapter } from '../types/adapter.js';
import { logger } from '../utils/logger.js';
import {
  validateCreateShowRequest,
  validateControlShowRequest,
} from '../validation/schemas.js';

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
