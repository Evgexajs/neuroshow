/**
 * API Server - Fastify setup and composition root
 * Based on TASK-044 - API Server setup
 */

import Fastify, { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { SqliteStore } from '../storage/sqlite-store.js';
import { EventJournal } from '../core/event-journal.js';
import { HostModule } from '../core/host-module.js';
import { ContextBuilder } from '../core/context-builder.js';
import { MockAdapter } from '../adapters/mock-adapter.js';
import { Orchestrator } from '../core/orchestrator.js';
import { ModelAdapter } from '../types/adapter.js';
import { logger } from '../utils/logger.js';

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
