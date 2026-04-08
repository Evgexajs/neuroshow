# Modules

Modular architecture for NeuroShow. Each module encapsulates specific functionality.

## Creating a New Module

### 1. Copy the template

```bash
cp -r src/modules/_template src/modules/your-module
```

### 2. Define your interface

Edit `types.ts`:

```typescript
import { IModule } from '../../core/types/module.js';

export interface IYourModule extends IModule {
  yourMethod(showId: string): Promise<YourResult>;
}
```

### 3. Implement the module

Edit `index.ts`:

```typescript
import { IStore } from '../../types/interfaces/store.interface.js';
import { EventJournal } from '../../core/event-journal.js';
import { IYourModule } from './types.js';

export const YOUR_MODULE_NAME = 'your-module';

export class YourModule implements IYourModule {
  readonly name = YOUR_MODULE_NAME;

  constructor(
    private readonly store: IStore,
    private readonly eventJournal: EventJournal
  ) {}

  async init(): Promise<void> {}
  async dispose(): Promise<void> {}

  async yourMethod(showId: string): Promise<YourResult> {
    // Implementation
  }
}

export { IYourModule } from './types.js';
```

### 4. Register in Orchestrator

Add to `src/core/orchestrator.ts`:

```typescript
// Import
import { YourModule, IYourModule, YOUR_MODULE_NAME } from '../modules/your-module/index.js';

// Add property
private _yourModule: IYourModule | null = null;

// Add getter with lazy registration
private async getYourModule(): Promise<IYourModule> {
  if (this._yourModule) {
    return this._yourModule;
  }

  let mod = this.moduleRegistry.getModule<IYourModule>(YOUR_MODULE_NAME);
  if (!mod) {
    mod = new YourModule(this.store, this.journal);
    await this.moduleRegistry.register(mod);
  }

  this._yourModule = mod;
  return mod;
}
```

### 5. Use the module

```typescript
const yourModule = await this.getYourModule();
await yourModule.yourMethod(showId);
```

## Module Structure

```
src/modules/
  _template/          # Copy this to create new modules
    types.ts          # Interface (IModule + your methods)
    index.ts          # Implementation
    README.md         # Documentation
  voting/             # Example: voting module
    types.ts
    index.ts
    decision-phase.ts # Complex logic can be in separate files
  your-module/        # Your new module
    ...
```

## IModule Interface

All modules must implement:

```typescript
interface IModule {
  readonly name: string;  // Unique identifier
  init(): Promise<void>;  // Called on registration
  dispose(): Promise<void>; // Called on shutdown
}
```

## Available Dependencies

Modules receive via constructor:

| Dependency | Type | Purpose |
|------------|------|---------|
| `store` | `IStore` | Database operations |
| `eventJournal` | `EventJournal` | Event logging |

## Existing Modules

| Module | Purpose | File |
|--------|---------|------|
| `voting` | Decision phase, vote counting | `voting/index.ts` |

## Best Practices

1. **Single responsibility** - one module = one feature area
2. **Interface first** - define types.ts before implementing
3. **Lazy registration** - modules registered on first use
4. **No circular deps** - modules don't depend on each other
5. **Test independently** - each module has its own tests
