/**
 * ModuleRegistry - central registry for all modules
 * Manages module lifecycle: registration, lookup, disposal
 */

import { IModule } from './types/module.js';

/**
 * ModuleRegistry provides centralized module management
 *
 * Usage:
 *   const registry = new ModuleRegistry();
 *   await registry.register(new MyModule());
 *   const module = registry.getModule<MyModule>('myModule');
 */
export class ModuleRegistry {
  private modules: Map<string, IModule> = new Map();

  /**
   * Register a module
   * Calls init() on the module after registration
   * @throws Error if module with same name already registered
   */
  async register(module: IModule): Promise<void> {
    if (this.modules.has(module.name)) {
      throw new Error(`Module '${module.name}' is already registered`);
    }

    await module.init();
    this.modules.set(module.name, module);
  }

  /**
   * Get a module by name
   * @returns The module or undefined if not found
   */
  getModule<T extends IModule>(name: string): T | undefined {
    return this.modules.get(name) as T | undefined;
  }

  /**
   * Get all registered modules
   * @returns Array of all modules
   */
  getAllModules(): IModule[] {
    return Array.from(this.modules.values());
  }

  /**
   * Dispose all modules and clear registry
   * Called on shutdown
   */
  async disposeAll(): Promise<void> {
    for (const module of this.modules.values()) {
      await module.dispose();
    }
    this.modules.clear();
  }
}
