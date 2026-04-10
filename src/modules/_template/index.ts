/**
 * Template Module - copy this file to create a new module
 *
 * INSTRUCTIONS:
 * 1. Copy this entire _template folder to src/modules/your-module-name/
 * 2. Rename all "Template" references to your module name
 * 3. Update TEMPLATE_MODULE_NAME constant
 * 4. Add your business logic
 * 5. Register module in orchestrator (see README.md)
 */

import type { IStore } from '../../types/interfaces/store.interface.js';
import type { EventJournal } from '../../core/event-journal.js';
import type { ITemplateModule } from './types.js';

/** Module name for registry lookup - CUSTOMIZE THIS */
export const TEMPLATE_MODULE_NAME = 'template';

/**
 * TemplateModule - implements IModule interface
 *
 * Constructor receives:
 * - store: Database access (IStore interface)
 * - eventJournal: Event logging system
 */
export class TemplateModule implements ITemplateModule {
  readonly name = TEMPLATE_MODULE_NAME;

  constructor(
    private readonly store: IStore,
    // EventJournal for logging events - use this.eventJournal.append()
    protected readonly eventJournal: EventJournal
  ) {}

  /**
   * Initialize the module
   * Called once when module is registered with ModuleRegistry
   *
   * Use for: loading config, validating dependencies, warm-up
   */
  async init(): Promise<void> {
    // Add initialization logic here
  }

  /**
   * Dispose the module and release resources
   * Called on shutdown or when module is unregistered
   *
   * Use for: closing connections, clearing caches, cleanup
   */
  async dispose(): Promise<void> {
    // Add cleanup logic here
  }

  /**
   * Example method implementation
   * CUSTOMIZE: Replace with your actual business logic
   */
  async exampleMethod(showId: string): Promise<void> {
    // Access database via this.store
    const show = await this.store.getShow(showId);
    if (!show) {
      throw new Error(`Show ${showId} not found`);
    }

    // Get characters via this.store.getCharacters(showId)
    // Log events via this.eventJournal.append() - see voting module for example
    // Your implementation here
    void show; // Remove this line - just to avoid unused warning
  }
}

// Re-export types for convenient imports
export type { ITemplateModule } from './types.js';
