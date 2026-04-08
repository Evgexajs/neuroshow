# PRD: Модульная архитектура Backend

**Версия:** 1.0  
**Дата:** 2026-04-08  
**Статус:** Draft  

---

## Содержание

1. [Цели модульной архитектуры](#1-цели-модульной-архитектуры)
2. [Определение границы ЯДРО vs МОДУЛЬ](#2-определение-границы-ядро-vs-модуль)
3. [Что остается в ядре и ПОЧЕМУ](#3-что-остается-в-ядре-и-почему)
4. [Extraction plan: что из orchestrator.ts куда уходит](#4-extraction-plan-что-из-orchestratorts-куда-уходит)
5. [Контракт модуля (IModule interface)](#5-контракт-модуля-imodule-interface)
6. [Регистрация модулей (Registry pattern)](#6-регистрация-модулей-registry-pattern)
7. [Коммуникация (events / hooks)](#7-коммуникация-events--hooks)
8. [Порядок миграции](#8-порядок-миграции)

---

## 1. Цели модульной архитектуры

### 1.1 Проблема текущего состояния

Backend Neuroshow содержит два монолитных файла:
- `orchestrator.ts` — 1,623 строки
- `host-module.ts` — 1,169 строки

Это создает следующие проблемы:

| Проблема | Влияние |
|----------|---------|
| **Сложность понимания** | Новый разработчик тратит часы на понимание взаимосвязей |
| **Высокая связанность** | Изменение одной функции требует проверки всего файла |
| **Сложность тестирования** | Unit-тесты требуют мокирования большого количества зависимостей |
| **Риск регрессий** | Изменения в voting-логике могут сломать replay |
| **Невозможность расширения** | Добавление новых форматов шоу требует изменения ядра |

### 1.2 Целевое состояние

```
Текущее:                          Целевое:
┌─────────────────────────┐       ┌────────────────┐
│     orchestrator.ts     │       │     CORE       │
│  (1,623 строки, всё)    │  ──►  │  (400 строк)   │
└─────────────────────────┘       └───────┬────────┘
                                          │ IModule
                           ┌──────────────┼──────────────┐
                           ▼              ▼              ▼
                    ┌──────────┐   ┌──────────┐   ┌──────────┐
                    │ Voting   │   │ Private  │   │ Replay   │
                    │ Module   │   │ Channels │   │ Module   │
                    └──────────┘   └──────────┘   └──────────┘
```

### 1.3 Конкретные цели

1. **Уменьшить размер ядра до ~400 строк** — только координация и lifecycle
2. **Изоляция feature-логики в модулях** — каждый модуль 100-300 строк
3. **Независимое тестирование модулей** — без запуска всего движка
4. **Расширяемость без изменения ядра** — новые форматы через модули
5. **Сохранение обратной совместимости** — существующие шоу работают без изменений

### 1.4 Метрики успеха

| Метрика | Текущее значение | Целевое значение |
|---------|------------------|------------------|
| Размер orchestrator.ts | 1,623 строки | < 500 строк |
| Размер host-module.ts | 1,169 строки | < 400 строк |
| Цикломатическая сложность runShow() | ~25 | < 10 |
| Покрытие unit-тестами | ~60% | > 85% |
| Время на понимание модуля | 2+ часа | < 30 мин |

---

## 2. Определение границы ЯДРО vs МОДУЛЬ

### 2.1 Критерии отнесения к ЯДРУ

Функциональность относится к **ЯДРУ**, если она удовлетворяет **ВСЕМ** критериям:

| Критерий | Описание | Пример |
|----------|----------|--------|
| **Универсальность** | Нужна для ЛЮБОГО формата шоу | Управление фазами |
| **Координация** | Связывает несколько подсистем | Вызов adapter -> journal |
| **Стабильность** | Не меняется при добавлении форматов | Event logging |
| **Инфраструктура** | Техническая необходимость | Storage, API |

### 2.2 Критерии отнесения к МОДУЛЮ

Функциональность относится к **МОДУЛЮ**, если она удовлетворяет **ХОТЯ БЫ ОДНОМУ** критерию:

| Критерий | Описание | Пример |
|----------|----------|--------|
| **Format-specific** | Специфична для конкретного формата | Voting rules |
| **Optional** | Не все форматы используют | Private channels |
| **Replaceable** | Может иметь альтернативные реализации | Decision algorithms |
| **Feature-complete** | Самодостаточная единица функциональности | Replay system |

### 2.3 Диаграмма принятия решения

```
                    ┌─────────────────────────┐
                    │ Эта функциональность    │
                    │ нужна ВСЕМ форматам?    │
                    └───────────┬─────────────┘
                                │
                    ┌───────────┴───────────┐
                    │                       │
                   ДА                      НЕТ
                    │                       │
        ┌───────────▼───────────┐   ┌───────▼───────┐
        │ Координирует несколько │   │   МОДУЛЬ      │
        │ подсистем?            │   └───────────────┘
        └───────────┬───────────┘
                    │
        ┌───────────┴───────────┐
        │                       │
       ДА                      НЕТ
        │                       │
  ┌─────▼─────┐         ┌───────▼───────┐
  │   ЯДРО    │         │   МОДУЛЬ      │
  └───────────┘         └───────────────┘
```

### 2.4 Примеры классификации

| Функциональность | Ядро/Модуль | Обоснование |
|------------------|-------------|-------------|
| `runShow()` | ЯДРО | Координирует все фазы, нужно всегда |
| `runPhase()` | ЯДРО | Базовый lifecycle, нужен всем форматам |
| `processCharacterTurn()` | ЯДРО | Координирует adapter + journal + budget |
| `runDecisionPhase()` | МОДУЛЬ | Специфично для форматов с голосованием |
| `runRevelation()` | МОДУЛЬ | Связано только с decision, optional |
| `validatePrivateRequest()` | МОДУЛЬ | Private channels не во всех форматах |
| `replayShow()` | МОДУЛЬ | Отдельная feature, можно отключить |
| `checkBudget()` | ЯДРО | Защита системы, нужна всегда |
| `manageTurnQueue()` | ЯДРО | Базовый механизм, все форматы используют |

---

## 3. Что остается в ядре и ПОЧЕМУ

### 3.1 Компоненты ядра

```
src/core/
├── orchestrator.ts      # Координатор (уменьшенный)
├── event-journal.ts     # Append-only event log
├── context-builder.ts   # Построение промптов
├── module-registry.ts   # Регистрация модулей (NEW)
└── types/
    └── module.ts        # IModule interface (NEW)
```

### 3.2 Orchestrator — что остается

#### State Management (ЯДРО)
```typescript
// Управление состоянием шоу — координация, нужна всегда
getState(): OrchestratorState
setMode(mode: OrchestratorMode): void
pause(): void
resume(): void
stop(): void
isStopped(): boolean
isPaused(): boolean
```

**ПОЧЕМУ в ядре:** Управление состоянием — базовая координация. Любой формат шоу требует pause/resume/stop. Это не feature-логика, а инфраструктура.

#### Show Lifecycle (ЯДРО)
```typescript
// Жизненный цикл шоу — координация всех подсистем
runShow(showId: string): Promise<void>
runPhase(showId: string, phase: Phase): Promise<void>
```

**ПОЧЕМУ в ядре:** runShow координирует: storage -> phases -> modules -> journal. Без этого система не работает. Логика внутри фаз вынесена в модули.

#### Character Processing (ЯДРО)
```typescript
// Обработка хода персонажа — связывает adapter, journal, budget
processCharacterTurn(showId: string, characterId: string, trigger: string): Promise<CharacterResponse>
handleIntent(showId: string, response: CharacterResponse, senderId: string): Promise<void>
```

**ПОЧЕМУ в ядре:** Центральная точка координации LLM вызовов. Модули не должны напрямую работать с adapter — это нарушит изоляцию и бюджетирование.

#### Budget Management (ЯДРО)
```typescript
// Защита от перерасхода — критическая система
checkBudget(showId: string): Promise<BudgetMode>
getAdjustedConstraints(showId: string, baseConstraints: ResponseConstraints): Promise<ResponseConstraints>
shouldLimitPrivates(showId: string): Promise<boolean>
gracefulFinish(showId: string): Promise<void>
```

**ПОЧЕМУ в ядре:** Budget protection — это safety mechanism. Если модуль сможет обойти проверку бюджета, это создаст финансовые риски. Централизованный контроль обязателен.

### 3.3 EventJournal — полностью в ядре

```typescript
// Все методы остаются в ядре
append(event: Omit<ShowEvent, 'sequenceNumber'>): Promise<ShowEvent>
getEvents(showId: string, options?: GetEventsOptions): Promise<ShowEvent[]>
getVisibleEvents(showId: string, characterId: string, limit?: number): Promise<ShowEvent[]>
rollbackToSequence(showId: string, sequenceNumber: number): Promise<number>
rollbackToPhase(showId: string, phaseId: string): Promise<number>
exportJournal(showId: string): Promise<string>
```

**ПОЧЕМУ полностью в ядре:**
1. **Single source of truth** — все события должны проходить через один канал
2. **Consistency** — модули не должны иметь разные версии истории
3. **Security** — модуль не должен мочь удалить чужие события
4. **Replay** — целостность журнала критична для воспроизведения

### 3.4 Storage (IStore) — интерфейс в ядре

```typescript
// IStore остается интерфейсом ядра
// Модули получают доступ только через ограниченный API:
interface ModuleStorageAccess {
  // Read-only для модулей
  getShow(id: string): Promise<ShowRecord | null>
  getCharacters(showId: string): Promise<ShowCharacterRecord[]>
  getEvents(showId: string): Promise<ShowEvent[]>
  
  // Write через ядро (orchestrator передает callback)
}
```

**ПОЧЕМУ в ядре:**
1. **Data integrity** — модули не должны напрямую писать в БД
2. **Transaction control** — ядро контролирует транзакции
3. **Migration safety** — изменение схемы не ломает модули

### 3.5 API Layer — в ядре

```typescript
// src/api/ остается частью ядра
// Модули НЕ регистрируют свои эндпоинты напрямую
```

**ПОЧЕМУ в ядре:**
1. **Security** — централизованная авторизация
2. **Rate limiting** — единая точка контроля
3. **API versioning** — консистентность контракта

---

## 4. Extraction plan: что из orchestrator.ts куда уходит

### 4.1 Mapping методов в модули

#### Из `orchestrator.ts`:

| Метод | Целевой модуль | Приоритет | Строк |
|-------|----------------|-----------|-------|
| `runPhaseWithDebug()` | ОСТАЕТСЯ (упрощается) | - | ~150 |
| `waitForStep()` | ОСТАЕТСЯ | - | ~15 |
| `getActivePrivateChannel()` | **PrivateChannelsModule** | P1 | ~30 |
| `handleRequestPrivate()` | **PrivateChannelsModule** | P1 | ~45 |
| `handleRevealWildcard()` | **RevelationModule** | P2 | ~40 |
| `handleEndTurn()` | УДАЛИТЬ (тривиален) | - | ~5 |
| `createBudgetModeChangeEvent()` | **BudgetModule** | P2 | ~35 |
| `rollbackToPhase()` | **ReplayModule** | P3 | ~65 |
| `replayShow()` | **ReplayModule** | P3 | ~70 |
| `executeShowRun()` | УДАЛИТЬ (дубликат runShow) | - | ~130 |

#### Из `host-module.ts`:

| Метод | Целевой модуль | Приоритет | Строк |
|-------|----------------|-----------|-------|
| `initializeShow()` | ОСТАЕТСЯ в HostModule | - | ~90 |
| `manageTurnQueue()` | **TurnQueueModule** | P2 | ~80 |
| `orderByFrequency()` | **TurnQueueModule** | P2 | ~40 |
| `emitTrigger()` | ОСТАЕТСЯ | - | ~45 |
| `processTemplate()` | ОСТАЕТСЯ | - | ~30 |
| `openPrivateChannel()` | **PrivateChannelsModule** | P1 | ~30 |
| `closePrivateChannel()` | **PrivateChannelsModule** | P1 | ~35 |
| `validatePrivateRequest()` | **PrivateChannelsModule** | P1 | ~60 |
| `runDecisionPhase()` | **VotingModule** | P1 | ~150 |
| `buildDecisionTrigger()` | **VotingModule** | P1 | ~45 |
| `buildSequentialTrigger()` | **VotingModule** | P1 | ~15 |
| `validateDecisionValue()` | **VotingModule** | P1 | ~90 |
| `extractCandidateFromText()` | **VotingModule** | P1 | ~30 |
| `runRevelation()` | **RevelationModule** | P2 | ~180 |
| `getVoteWord()` | **RevelationModule** | P2 | ~20 |

### 4.2 Список модулей для извлечения

```
src/modules/
├── voting/                  # P1 - Критический путь
│   ├── index.ts            # VotingModule implements IModule
│   ├── types.ts            # DecisionCallback, VoteResult
│   ├── decision-phase.ts   # runDecisionPhase logic
│   ├── validation.ts       # validateDecisionValue, extractCandidate
│   └── triggers.ts         # buildDecisionTrigger, buildSequentialTrigger
│
├── private-channels/        # P1 - Критический путь
│   ├── index.ts            # PrivateChannelsModule implements IModule
│   ├── types.ts            # ChannelState, ValidationResult
│   ├── manager.ts          # open/close channel logic
│   └── validator.ts        # validatePrivateRequest
│
├── revelation/              # P2 - После voting
│   ├── index.ts            # RevelationModule implements IModule
│   ├── types.ts            # RevelationResult, VoteCount
│   ├── revelation.ts       # runRevelation logic
│   └── wildcard.ts         # handleRevealWildcard
│
├── turn-queue/              # P2 - После private-channels
│   ├── index.ts            # TurnQueueModule implements IModule
│   ├── types.ts            # TurnQueueConfig
│   └── queue.ts            # manageTurnQueue, orderByFrequency
│
├── replay/                  # P3 - Последним
│   ├── index.ts            # ReplayModule implements IModule
│   ├── types.ts            # ReplayState
│   ├── replay.ts           # replayShow logic
│   └── rollback.ts         # rollbackToPhase
│
└── _template/               # Шаблон для новых модулей
    ├── index.ts
    ├── types.ts
    └── README.md
```

### 4.3 Ожидаемое уменьшение размера

| Файл | Было | Станет | Экономия |
|------|------|--------|----------|
| `orchestrator.ts` | 1,623 | ~450 | 72% |
| `host-module.ts` | 1,169 | ~350 | 70% |
| **ИТОГО ядро** | 2,792 | ~800 | 71% |

---

## 5. Контракт модуля (IModule interface)

### 5.1 Базовый интерфейс

```typescript
// src/core/types/module.ts

/**
 * Контекст выполнения, предоставляемый ядром модулю
 */
export interface ModuleContext {
  /** Доступ к журналу событий (append-only) */
  readonly journal: EventJournal;
  
  /** Read-only доступ к storage */
  readonly store: IStore;
  
  /** Logger с префиксом модуля */
  readonly logger: ModuleLogger;
  
  /** Текущий showId (если шоу запущено) */
  readonly showId: string | null;
  
  /** Получить character definition */
  getCharacterDefinition(characterId: string): Promise<CharacterDefinition | null>;
  
  /** Запросить LLM вызов через ядро (с учетом бюджета) */
  requestLLMCall(
    characterId: string,
    trigger: string,
    options?: { skipSpeechEvent?: boolean }
  ): Promise<CharacterResponse>;
  
  /** Подписаться на события */
  subscribe(eventType: EventType, handler: EventHandler): Unsubscribe;
  
  /** Emit события (только разрешенные типы для модуля) */
  emit(event: Omit<ShowEvent, 'sequenceNumber'>): Promise<ShowEvent>;
}

/**
 * Базовый интерфейс модуля
 */
export interface IModule {
  /** Уникальное имя модуля */
  readonly name: string;
  
  /** Версия модуля (semver) */
  readonly version: string;
  
  /** Зависимости от других модулей */
  readonly dependencies?: string[];
  
  /**
   * Инициализация модуля
   * Вызывается один раз при запуске системы
   * @param context - Контекст от ядра
   */
  init(context: ModuleContext): Promise<void>;
  
  /**
   * Очистка ресурсов модуля
   * Вызывается при остановке системы
   */
  dispose(): Promise<void>;
  
  /**
   * Проверка здоровья модуля
   * @returns true если модуль работоспособен
   */
  healthCheck?(): Promise<boolean>;
}

/**
 * Модуль с поддержкой фаз шоу
 */
export interface IPhaseModule extends IModule {
  /** Типы фаз, которые обрабатывает модуль */
  readonly supportedPhaseTypes: PhaseType[];
  
  /**
   * Выполнить фазу
   * @param showId - ID шоу
   * @param phase - Конфигурация фазы
   * @param context - Контекст выполнения
   */
  runPhase(
    showId: string,
    phase: Phase,
    context: PhaseExecutionContext
  ): Promise<PhaseResult>;
}

/**
 * Модуль с поддержкой хуков
 */
export interface IHookableModule extends IModule {
  /** Хуки, которые модуль предоставляет */
  readonly hooks: HookDefinition[];
}
```

### 5.2 Пример реализации: VotingModule

```typescript
// src/modules/voting/index.ts

import { IPhaseModule, ModuleContext, PhaseExecutionContext } from '../../core/types/module.js';
import { PhaseType, Phase } from '../../types/template.js';
import { runDecisionPhase } from './decision-phase.js';
import { runRevelation } from './revelation.js';

export class VotingModule implements IPhaseModule {
  readonly name = 'voting';
  readonly version = '1.0.0';
  readonly supportedPhaseTypes = [PhaseType.decision];
  
  private context: ModuleContext | null = null;
  
  async init(context: ModuleContext): Promise<void> {
    this.context = context;
    context.logger.info('VotingModule initialized');
  }
  
  async dispose(): Promise<void> {
    this.context = null;
  }
  
  async runPhase(
    showId: string,
    phase: Phase,
    execContext: PhaseExecutionContext
  ): Promise<PhaseResult> {
    if (!this.context) {
      throw new Error('VotingModule not initialized');
    }
    
    // Получаем decisionConfig из show
    const show = await this.context.store.getShow(showId);
    const config = JSON.parse(show!.configSnapshot);
    const decisionConfig = config.decisionConfig;
    
    // Callback для вызова LLM через ядро
    const callCharacter = async (
      characterId: string,
      trigger: string,
      _previousDecisions: Array<{ characterId: string; decision: string }>
    ) => {
      return this.context!.requestLLMCall(characterId, trigger, { 
        skipSpeechEvent: true 
      });
    };
    
    // Выполняем decision phase
    await runDecisionPhase(
      showId,
      decisionConfig,
      callCharacter,
      this.context
    );
    
    return { completed: true };
  }
  
  async healthCheck(): Promise<boolean> {
    return this.context !== null;
  }
}

// Export singleton factory
export function createVotingModule(): IPhaseModule {
  return new VotingModule();
}
```

### 5.3 Пример реализации: PrivateChannelsModule

```typescript
// src/modules/private-channels/index.ts

import { IHookableModule, ModuleContext, HookDefinition } from '../../core/types/module.js';
import { ChannelManager } from './manager.js';
import { ChannelValidator } from './validator.js';

export class PrivateChannelsModule implements IHookableModule {
  readonly name = 'private-channels';
  readonly version = '1.0.0';
  
  readonly hooks: HookDefinition[] = [
    {
      name: 'beforeCharacterTurn',
      description: 'Check if character is in private channel',
    },
    {
      name: 'afterCharacterTurn', 
      description: 'Close private channel if message was sent',
    },
  ];
  
  private context: ModuleContext | null = null;
  private manager: ChannelManager | null = null;
  private validator: ChannelValidator | null = null;
  
  async init(context: ModuleContext): Promise<void> {
    this.context = context;
    this.manager = new ChannelManager(context);
    this.validator = new ChannelValidator(context);
    
    // Подписываемся на intent события
    context.subscribe(EventType.speech, this.handleSpeechEvent.bind(this));
    
    context.logger.info('PrivateChannelsModule initialized');
  }
  
  async dispose(): Promise<void> {
    this.context = null;
    this.manager = null;
    this.validator = null;
  }
  
  /**
   * Открыть приватный канал
   */
  async openChannel(showId: string, participantIds: string[]): Promise<void> {
    if (!this.manager) throw new Error('Module not initialized');
    await this.manager.open(showId, participantIds);
  }
  
  /**
   * Закрыть приватный канал
   */
  async closeChannel(showId: string): Promise<void> {
    if (!this.manager) throw new Error('Module not initialized');
    await this.manager.close(showId);
  }
  
  /**
   * Получить активный канал
   */
  async getActiveChannel(showId: string): Promise<string[] | null> {
    if (!this.manager) throw new Error('Module not initialized');
    return this.manager.getActive(showId);
  }
  
  /**
   * Валидировать запрос на приватный канал
   */
  async validateRequest(
    showId: string,
    requesterId: string,
    targetId: string
  ): Promise<boolean> {
    if (!this.validator) throw new Error('Module not initialized');
    return this.validator.validate(showId, requesterId, targetId);
  }
  
  private async handleSpeechEvent(event: ShowEvent): Promise<void> {
    // Auto-close private channel after message
    if (event.channel === ChannelType.PRIVATE && this.manager) {
      await this.manager.close(event.showId);
    }
  }
}

export function createPrivateChannelsModule(): IHookableModule {
  return new PrivateChannelsModule();
}
```

---

## 6. Регистрация модулей (Registry pattern)

### 6.1 ModuleRegistry

```typescript
// src/core/module-registry.ts

import { IModule, IPhaseModule, ModuleContext } from './types/module.js';
import { PhaseType } from '../types/template.js';
import { logger } from '../utils/logger.js';

export class ModuleRegistry {
  private modules: Map<string, IModule> = new Map();
  private phaseHandlers: Map<PhaseType, IPhaseModule> = new Map();
  private initialized: boolean = false;
  
  /**
   * Регистрация модуля
   * @param module - Экземпляр модуля
   * @throws Error если модуль с таким именем уже зарегистрирован
   */
  register(module: IModule): void {
    if (this.modules.has(module.name)) {
      throw new Error(`Module "${module.name}" is already registered`);
    }
    
    this.modules.set(module.name, module);
    
    // Регистрируем phase handlers если это IPhaseModule
    if (this.isPhaseModule(module)) {
      for (const phaseType of module.supportedPhaseTypes) {
        if (this.phaseHandlers.has(phaseType)) {
          throw new Error(
            `Phase type "${phaseType}" is already handled by module "${this.phaseHandlers.get(phaseType)!.name}"`
          );
        }
        this.phaseHandlers.set(phaseType, module);
      }
    }
    
    logger.info(`Module "${module.name}" v${module.version} registered`);
  }
  
  /**
   * Получить модуль по имени
   */
  getModule<T extends IModule>(name: string): T | undefined {
    return this.modules.get(name) as T | undefined;
  }
  
  /**
   * Получить все зарегистрированные модули
   */
  getAllModules(): IModule[] {
    return Array.from(this.modules.values());
  }
  
  /**
   * Получить обработчик для типа фазы
   */
  getPhaseHandler(phaseType: PhaseType): IPhaseModule | undefined {
    return this.phaseHandlers.get(phaseType);
  }
  
  /**
   * Проверить, зарегистрирован ли модуль
   */
  hasModule(name: string): boolean {
    return this.modules.has(name);
  }
  
  /**
   * Инициализировать все модули
   * Вызывает init() в порядке зависимостей
   */
  async initAll(context: ModuleContext): Promise<void> {
    if (this.initialized) {
      throw new Error('Modules already initialized');
    }
    
    const sorted = this.topologicalSort();
    
    for (const module of sorted) {
      logger.info(`Initializing module "${module.name}"...`);
      await module.init(context);
    }
    
    this.initialized = true;
    logger.info(`All ${sorted.length} modules initialized`);
  }
  
  /**
   * Очистить все модули
   * Вызывает dispose() в обратном порядке
   */
  async disposeAll(): Promise<void> {
    const sorted = this.topologicalSort().reverse();
    
    for (const module of sorted) {
      logger.info(`Disposing module "${module.name}"...`);
      await module.dispose();
    }
    
    this.initialized = false;
    logger.info('All modules disposed');
  }
  
  /**
   * Топологическая сортировка по зависимостям
   */
  private topologicalSort(): IModule[] {
    const result: IModule[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();
    
    const visit = (module: IModule) => {
      if (visited.has(module.name)) return;
      if (visiting.has(module.name)) {
        throw new Error(`Circular dependency detected: ${module.name}`);
      }
      
      visiting.add(module.name);
      
      for (const depName of module.dependencies ?? []) {
        const dep = this.modules.get(depName);
        if (!dep) {
          throw new Error(
            `Module "${module.name}" depends on "${depName}" which is not registered`
          );
        }
        visit(dep);
      }
      
      visiting.delete(module.name);
      visited.add(module.name);
      result.push(module);
    };
    
    for (const module of this.modules.values()) {
      visit(module);
    }
    
    return result;
  }
  
  private isPhaseModule(module: IModule): module is IPhaseModule {
    return 'supportedPhaseTypes' in module && 'runPhase' in module;
  }
}

// Singleton instance
export const moduleRegistry = new ModuleRegistry();
```

### 6.2 Интеграция с Orchestrator

```typescript
// src/core/orchestrator.ts (измененный)

import { moduleRegistry } from './module-registry.js';
import { PhaseType } from '../types/template.js';

export class Orchestrator {
  // ... existing code ...
  
  async runShow(showId: string): Promise<void> {
    // ... setup code ...
    
    for (const [i, phase] of phases.entries()) {
      // ... pause/stop checks ...
      
      // Получаем handler для типа фазы
      const handler = moduleRegistry.getPhaseHandler(phase.type);
      
      if (handler) {
        // Делегируем модулю
        const context = this.createPhaseContext(showId, phase);
        await handler.runPhase(showId, phase, context);
      } else {
        // Fallback на встроенную логику (для базовых фаз)
        await this.runPhase(showId, phase, i, phases.length);
      }
    }
    
    // ... completion code ...
  }
  
  private createPhaseContext(showId: string, phase: Phase): PhaseExecutionContext {
    return {
      showId,
      phase,
      store: this.store,
      journal: this.journal,
      requestLLMCall: (characterId, trigger, options) => 
        this.processCharacterTurn(showId, characterId, trigger, options),
    };
  }
}
```

### 6.3 Bootstrap модулей

```typescript
// src/bootstrap.ts

import { moduleRegistry } from './core/module-registry.js';
import { createVotingModule } from './modules/voting/index.js';
import { createPrivateChannelsModule } from './modules/private-channels/index.js';
import { createRevelationModule } from './modules/revelation/index.js';
import { createReplayModule } from './modules/replay/index.js';

export function registerModules(): void {
  // Регистрация модулей в порядке зависимостей
  moduleRegistry.register(createPrivateChannelsModule());
  moduleRegistry.register(createVotingModule());
  moduleRegistry.register(createRevelationModule());
  moduleRegistry.register(createReplayModule());
}
```

---

## 7. Коммуникация (events / hooks)

### 7.1 Event-driven коммуникация

Модули коммуницируют через EventJournal. Это обеспечивает:
- **Decoupling** — модули не знают друг о друге
- **Auditability** — все коммуникации записаны
- **Replay** — коммуникации воспроизводимы

```typescript
// Модуль подписывается на события
context.subscribe(EventType.decision, async (event) => {
  // Обработка решения другого модуля
});

// Модуль публикует событие
await context.emit({
  showId,
  type: EventType.revelation,
  // ... остальные поля
});
```

### 7.2 Hook система

Для синхронной интеграции используются hooks:

```typescript
// src/core/types/hooks.ts

export type HookHandler<T = void> = (context: HookContext) => Promise<T>;

export interface HookDefinition {
  name: string;
  description: string;
}

export interface Hooks {
  // Lifecycle hooks
  'beforeShowStart': HookHandler;
  'afterShowEnd': HookHandler;
  
  // Phase hooks
  'beforePhaseStart': HookHandler<boolean>; // return false to skip phase
  'afterPhaseEnd': HookHandler;
  
  // Turn hooks
  'beforeCharacterTurn': HookHandler<{ trigger: string }>; // can modify trigger
  'afterCharacterTurn': HookHandler;
  
  // Budget hooks
  'onBudgetModeChange': HookHandler;
}

export class HookRegistry {
  private handlers: Map<keyof Hooks, Set<HookHandler>> = new Map();
  
  register<K extends keyof Hooks>(
    hook: K, 
    handler: Hooks[K]
  ): Unsubscribe {
    if (!this.handlers.has(hook)) {
      this.handlers.set(hook, new Set());
    }
    this.handlers.get(hook)!.add(handler as HookHandler);
    
    return () => {
      this.handlers.get(hook)?.delete(handler as HookHandler);
    };
  }
  
  async call<K extends keyof Hooks>(
    hook: K,
    context: HookContext
  ): Promise<ReturnType<Hooks[K]> | void> {
    const handlers = this.handlers.get(hook);
    if (!handlers) return;
    
    for (const handler of handlers) {
      const result = await handler(context);
      // For hooks that return values, return first non-void result
      if (result !== undefined) {
        return result as ReturnType<Hooks[K]>;
      }
    }
  }
}
```

### 7.3 Пример использования hooks

```typescript
// В PrivateChannelsModule
async init(context: ModuleContext): Promise<void> {
  // Модифицируем trigger если персонаж в private channel
  context.hooks.register('beforeCharacterTurn', async (hookCtx) => {
    const activeChannel = await this.getActiveChannel(hookCtx.showId);
    
    if (activeChannel?.includes(hookCtx.characterId)) {
      return {
        trigger: hookCtx.trigger + '\n\n[Ты сейчас в приватном канале]',
      };
    }
  });
  
  // Закрываем канал после сообщения
  context.hooks.register('afterCharacterTurn', async (hookCtx) => {
    if (hookCtx.response.channel === ChannelType.PRIVATE) {
      await this.closeChannel(hookCtx.showId);
    }
  });
}
```

### 7.4 Диаграмма коммуникации

```
┌─────────────────────────────────────────────────────────────┐
│                      ORCHESTRATOR                           │
│                                                             │
│  runShow() ─────────────────────────────────────────────►   │
│       │                                                     │
│       │  hook: beforeShowStart                              │
│       ▼                                                     │
│  runPhase() ◄─────────── moduleRegistry.getPhaseHandler()   │
│       │                         │                           │
│       │                         ▼                           │
│       │              ┌─────────────────────┐                │
│       │              │   VotingModule      │                │
│       │              │   runPhase()        │                │
│       │              └──────────┬──────────┘                │
│       │                         │                           │
│       │         context.requestLLMCall()                    │
│       ◄─────────────────────────┘                           │
│       │                                                     │
│  processCharacterTurn()                                     │
│       │                                                     │
│       │  hook: beforeCharacterTurn                          │
│       │       ◄────── PrivateChannelsModule modifies trigger│
│       ▼                                                     │
│  adapter.call() ────────────► journal.append()              │
│       │                                                     │
│       │  hook: afterCharacterTurn                           │
│       │       ◄────── PrivateChannelsModule closes channel  │
│       ▼                                                     │
│  event emitted ─────────────────────────────────────────►   │
│                    subscribers notified                     │
└─────────────────────────────────────────────────────────────┘
```

---

## 8. Порядок миграции

### 8.1 Принципы миграции

1. **Инкрементальность** — по одному модулю за раз
2. **Backward compatibility** — существующие шоу работают
3. **Feature parity** — никаких регрессий
4. **Test-first** — сначала тесты, потом рефакторинг

### 8.2 Фазы миграции

#### Фаза 0: Инфраструктура (1-2 дня)

**Задачи:**
- [ ] Создать `src/core/types/module.ts` с IModule interface
- [ ] Создать `src/core/module-registry.ts`
- [ ] Создать `src/core/hooks.ts`
- [ ] Добавить import в Orchestrator (без использования)
- [ ] Написать unit-тесты для registry

**Критерий завершения:**
```bash
npm run typecheck  # Проходит
npm test           # Проходит, включая новые тесты registry
```

#### Фаза 1: VotingModule (2-3 дня)

**Задачи:**
- [ ] Создать `src/modules/voting/` структуру
- [ ] Извлечь `runDecisionPhase()` из host-module.ts
- [ ] Извлечь `buildDecisionTrigger()`, `validateDecisionValue()`
- [ ] Реализовать VotingModule implements IPhaseModule
- [ ] Зарегистрировать модуль в bootstrap
- [ ] Интегрировать с Orchestrator.runShow()
- [ ] Удалить старый код из host-module.ts

**Критерий завершения:**
```bash
npm test                        # Все тесты проходят
npm run test:e2e -- decision    # Decision phase работает
```

#### Фаза 2: PrivateChannelsModule (1-2 дня)

**Задачи:**
- [ ] Создать `src/modules/private-channels/` структуру
- [ ] Извлечь `openPrivateChannel()`, `closePrivateChannel()`
- [ ] Извлечь `validatePrivateRequest()`
- [ ] Извлечь `getActivePrivateChannel()` из orchestrator.ts
- [ ] Реализовать hooks для before/after turn
- [ ] Интегрировать с Orchestrator

**Критерий завершения:**
```bash
npm test                         # Все тесты проходят
npm run test:e2e -- private      # Private channels работают
```

#### Фаза 3: RevelationModule (1 день)

**Задачи:**
- [ ] Создать `src/modules/revelation/` структуру
- [ ] Извлечь `runRevelation()` из host-module.ts
- [ ] Извлечь `handleRevealWildcard()` из orchestrator.ts
- [ ] Добавить зависимость от VotingModule

**Критерий завершения:**
```bash
npm test                         # Все тесты проходят
npm run test:e2e -- revelation   # Revelation работает
```

#### Фаза 4: ReplayModule (1-2 дня)

**Задачи:**
- [ ] Создать `src/modules/replay/` структуру
- [ ] Извлечь `replayShow()` из orchestrator.ts
- [ ] Извлечь `rollbackToPhase()`
- [ ] Удалить `executeShowRun()` (дубликат)

**Критерий завершения:**
```bash
npm test                         # Все тесты проходят
npm run test:e2e -- replay       # Replay работает
```

#### Фаза 5: Cleanup и документация (1 день)

**Задачи:**
- [ ] Удалить мертвый код
- [ ] Создать `src/modules/_template/`
- [ ] Написать `src/modules/README.md`
- [ ] Обновить JSDoc комментарии
- [ ] Проверить все метрики из раздела 1.4

**Критерий завершения:**
```bash
npm run lint                     # Нет warnings
npm run typecheck                # Проходит
npm test                         # 100% тестов проходят
wc -l src/core/orchestrator.ts   # < 500 строк
```

### 8.3 Rollback план

Каждая фаза коммитится отдельно с тегом:
```bash
git tag -a migration-phase-0 -m "Module infrastructure"
git tag -a migration-phase-1 -m "VotingModule extracted"
# ...
```

При проблемах:
```bash
git revert HEAD~N..HEAD  # Откатить N коммитов
# или
git checkout migration-phase-X  # Вернуться к точке
```

### 8.4 Риски и митигация

| Риск | Вероятность | Влияние | Митигация |
|------|-------------|---------|-----------|
| Нарушение replay | Средняя | Высокое | E2E тест replay на каждой фазе |
| Падение производительности | Низкая | Среднее | Benchmark перед/после каждой фазы |
| Circular dependencies | Средняя | Среднее | Топологическая сортировка в registry |
| Утечка абстракции | Средняя | Низкое | Code review, strict interface |

---

## Appendix A: Полный список методов и их судьба

### orchestrator.ts (1,623 строки)

| Метод | Строки | Судьба | Модуль |
|-------|--------|--------|--------|
| `constructor()` | 87-93 | ОСТАЕТСЯ | - |
| `get activeAdapter()` | 98-100 | ОСТАЕТСЯ | - |
| `getState()` | 106-113 | ОСТАЕТСЯ | - |
| `setMode()` | 119-122 | ОСТАЕТСЯ | - |
| `pause()` | 129-132 | ОСТАЕТСЯ | - |
| `resume()` | 138-147 | ОСТАЕТСЯ | - |
| `stop()` | 153-163 | ОСТАЕТСЯ | - |
| `isStopped()` | 168-170 | ОСТАЕТСЯ | - |
| `isPaused()` | 175-177 | ОСТАЕТСЯ | - |
| `step()` | 184-196 | ОСТАЕТСЯ | - |
| `waitForStep()` | 202-213 | ОСТАЕТСЯ | - |
| `runPhase()` | 224-369 | ОСТАЕТСЯ (упрощ.) | - |
| `isPhaseComplete()` | 379-392 | ОСТАЕТСЯ | - |
| `runPhaseWithDebug()` | 404-548 | УДАЛИТЬ (merge с runPhase) | - |
| `processCharacterTurn()` | 564-725 | ОСТАЕТСЯ | - |
| `handleIntent()` | 739-772 | ОСТАЕТСЯ (упрощ.) | - |
| `handleRequestPrivate()` | 778-824 | МОДУЛЬ | private-channels |
| `handleRevealWildcard()` | 830-869 | МОДУЛЬ | revelation |
| `handleEndTurn()` | 875-877 | УДАЛИТЬ (тривиален) | - |
| `getActivePrivateChannel()` | 887-912 | МОДУЛЬ | private-channels |
| `checkBudget()` | 925-956 | ОСТАЕТСЯ | - |
| `createBudgetModeChangeEvent()` | 961-997 | МОДУЛЬ | budget (future) |
| `getAdjustedConstraints()` | 1007-1021 | ОСТАЕТСЯ | - |
| `shouldLimitPrivates()` | 1030-1033 | ОСТАЕТСЯ | - |
| `runShow()` | 1048-1222 | ОСТАЕТСЯ (упрощ.) | - |
| `rollbackToPhase()` | 1238-1299 | МОДУЛЬ | replay |
| `gracefulFinish()` | 1312-1390 | ОСТАЕТСЯ | - |
| `replayShow()` | 1405-1466 | МОДУЛЬ | replay |
| `executeShowRun()` | 1472-1622 | УДАЛИТЬ (дубликат) | - |

### host-module.ts (1,169 строк)

| Метод | Строки | Судьба | Модуль |
|-------|--------|--------|--------|
| `constructor()` | 31-36 | ОСТАЕТСЯ | - |
| `initializeShow()` | 52-141 | ОСТАЕТСЯ | - |
| `manageTurnQueue()` | 151-182 | МОДУЛЬ | turn-queue |
| `orderByFrequency()` | 190-234 | МОДУЛЬ | turn-queue |
| `emitTrigger()` | 245-288 | ОСТАЕТСЯ | - |
| `processTemplate()` | 299-334 | ОСТАЕТСЯ | - |
| `openPrivateChannel()` | 343-368 | МОДУЛЬ | private-channels |
| `closePrivateChannel()` | 377-407 | МОДУЛЬ | private-channels |
| `validatePrivateRequest()` | 419-474 | МОДУЛЬ | private-channels |
| `runDecisionPhase()` | 488-634 | МОДУЛЬ | voting |
| `buildDecisionTrigger()` | 644-695 | МОДУЛЬ | voting |
| `buildSequentialTrigger()` | 700-713 | МОДУЛЬ | voting |
| `validateDecisionValue()` | 733-829 | МОДУЛЬ | voting |
| `extractCandidateFromText()` | 839-864 | МОДУЛЬ | voting |
| `runRevelation()` | 882-1143 | МОДУЛЬ | revelation |
| `getVoteWord()` | 1149-1168 | МОДУЛЬ | revelation |

---

## Appendix B: Glossary

| Термин | Определение |
|--------|-------------|
| **Ядро (Core)** | Минимальный набор компонентов, необходимых для работы любого формата шоу |
| **Модуль (Module)** | Самостоятельная единица функциональности, реализующая IModule |
| **Registry** | Центральный реестр зарегистрированных модулей |
| **Hook** | Точка расширения для синхронной интеграции модулей |
| **Phase Handler** | Модуль, способный выполнять определенный тип фазы |
| **ModuleContext** | Sandbox-окружение, предоставляемое ядром модулю |

---

*Документ создан: 2026-04-08*  
*Последнее обновление: 2026-04-08*
