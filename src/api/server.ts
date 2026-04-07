/**
 * API Server - Fastify setup and composition root
 * Based on TASK-044 - API Server setup
 */

import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config.js';
import { SqliteStore } from '../storage/sqlite-store.js';
import { EventJournal } from '../core/event-journal.js';
import { HostModule } from '../core/host-module.js';
import { ContextBuilder } from '../core/context-builder.js';
import { MockAdapter } from '../adapters/mock-adapter.js';
import { Orchestrator } from '../core/orchestrator.js';
import { ModelAdapter } from '../types/adapter.js';
import { logger } from '../utils/logger.js';
import { ShowFormatTemplate } from '../types/template.js';
import { CharacterDefinition } from '../types/character.js';

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

  // Create all dependencies via composition root
  const deps = await createDependencies();

  // Health check endpoint
  app.get('/health', async () => {
    return { status: 'ok' };
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

  // POST /shows - Create a new show
  app.post('/shows', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      formatId?: ShowFormatTemplate;
      characters?: Array<CharacterDefinition & { modelAdapterId?: string }>;
      seed?: number;
    } | null;

    // Validate request body exists
    if (!body) {
      return reply.status(400).send({
        error: 'Request body is required',
      });
    }

    const { formatId, characters, seed } = body;

    // Validate formatId (ShowFormatTemplate)
    if (!formatId || typeof formatId !== 'object') {
      return reply.status(400).send({
        error: 'formatId is required and must be a valid ShowFormatTemplate object',
      });
    }

    // Validate required ShowFormatTemplate fields
    if (!formatId.id || typeof formatId.id !== 'string') {
      return reply.status(400).send({
        error: 'formatId.id is required',
      });
    }

    if (!formatId.name || typeof formatId.name !== 'string') {
      return reply.status(400).send({
        error: 'formatId.name is required',
      });
    }

    if (!Array.isArray(formatId.phases)) {
      return reply.status(400).send({
        error: 'formatId.phases must be an array',
      });
    }

    // Validate characters
    if (!characters || !Array.isArray(characters)) {
      return reply.status(400).send({
        error: 'characters is required and must be an array',
      });
    }

    if (characters.length === 0) {
      return reply.status(400).send({
        error: 'At least one character is required',
      });
    }

    // Validate character count against template limits
    if (formatId.minParticipants && characters.length < formatId.minParticipants) {
      return reply.status(400).send({
        error: `Minimum ${formatId.minParticipants} participants required, got ${characters.length}`,
      });
    }

    if (formatId.maxParticipants && characters.length > formatId.maxParticipants) {
      return reply.status(400).send({
        error: `Maximum ${formatId.maxParticipants} participants allowed, got ${characters.length}`,
      });
    }

    // Validate each character has required fields
    for (let i = 0; i < characters.length; i++) {
      const char = characters[i];
      if (!char || !char.id || typeof char.id !== 'string') {
        return reply.status(400).send({
          error: `characters[${i}].id is required`,
        });
      }
      if (!char.name || typeof char.name !== 'string') {
        return reply.status(400).send({
          error: `characters[${i}].name is required`,
        });
      }
    }

    // Validate seed if provided
    if (seed !== undefined && typeof seed !== 'number') {
      return reply.status(400).send({
        error: 'seed must be a number',
      });
    }

    try {
      // Call HostModule.initializeShow()
      const show = await deps.hostModule.initializeShow(
        formatId,
        characters,
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
