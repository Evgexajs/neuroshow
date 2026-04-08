/**
 * Types for the template module
 *
 * INSTRUCTIONS: Copy this file when creating a new module.
 * Replace "Template" with your module name (e.g., "Auction", "Chat").
 */

import { IModule } from '../../core/types/module.js';

/**
 * ITemplateModule - interface for the template module
 * Extends IModule with module-specific methods
 *
 * CUSTOMIZE: Add your module's public methods here
 */
export interface ITemplateModule extends IModule {
  /**
   * Example method - replace with your actual methods
   *
   * @param showId - Show ID
   * @returns Promise with result (customize return type)
   */
  exampleMethod(showId: string): Promise<void>;
}
