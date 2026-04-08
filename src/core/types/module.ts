/**
 * Module interface for the modular architecture
 * All feature modules must implement this interface
 */

/**
 * IModule - base interface for all pluggable modules
 * Modules are initialized on startup and disposed on shutdown
 */
export interface IModule {
  /** Unique module name for registry lookup */
  readonly name: string;

  /**
   * Initialize the module
   * Called once when module is registered
   */
  init(): Promise<void>;

  /**
   * Dispose the module and release resources
   * Called on shutdown or when module is unregistered
   */
  dispose(): Promise<void>;
}
