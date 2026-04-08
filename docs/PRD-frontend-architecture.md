# PRD: Модульная архитектура Frontend (Debug UI)

**Версия:** 1.0  
**Дата:** 2026-04-08  
**Статус:** Draft  

---

## Содержание

1. [Цели модульной UI архитектуры](#1-цели-модульной-ui-архитектуры)
2. [Структура компонента (файлы, контракты)](#2-структура-компонента-файлы-контракты)
3. [State management (глобальный vs локальный)](#3-state-management-глобальный-vs-локальный)
4. [Коммуникация между компонентами](#4-коммуникация-между-компонентами)
5. [Миграция app.ts на компоненты](#5-миграция-appts-на-компоненты)
6. [Шаблон создания нового компонента](#6-шаблон-создания-нового-компонента)

---

## 1. Цели модульной UI архитектуры

### 1.1 Проблема текущего состояния

Debug UI содержит один монолитный файл:
- `app.ts` — 1,641 строка

Анализ текущей структуры:

| Функциональный блок | Строки (прибл.) | Ответственность |
|---------------------|-----------------|-----------------|
| Types + Interfaces | 1-78 | Типы данных |
| DOM Elements | 79-125 | Получение элементов |
| State variables | 126-172 | Глобальное состояние |
| Control Panel | 177-412 | Управление шоу |
| Character Cards | 414-650 | Отображение персонажей |
| Event Feed | 652-992 | Лента событий |
| History Modal | 1028-1362 | История шоу |
| New Show Modal | 992-1638 | Создание шоу |
| Init | 1640-1641 | Инициализация |

Это создает следующие проблемы:

| Проблема | Влияние |
|----------|---------|
| **Сложность навигации** | Поиск нужной функции требует scroll по 1600+ строк |
| **Высокая связанность** | Все компоненты имеют доступ ко всему глобальному состоянию |
| **Сложность тестирования** | Невозможно протестировать компонент изолированно |
| **Конфликты при разработке** | Два разработчика часто правят один файл |
| **Дублирование кода** | Render-функции повторяют похожие паттерны |
| **Отсутствие переиспользования** | Компоненты нельзя использовать в других местах |

### 1.2 Целевое состояние

```
Текущее:                          Целевое:
┌─────────────────────────┐       ┌────────────────────────┐
│        app.ts           │       │         core/          │
│  (1,641 строка, всё)    │  ──►  │  state, api, events    │
└─────────────────────────┘       └───────────┬────────────┘
                                              │ IComponent
                          ┌───────────────────┼───────────────────┐
                          ▼                   ▼                   ▼
                   ┌────────────┐      ┌────────────┐      ┌────────────┐
                   │ EventFeed  │      │ Characters │      │  Control   │
                   │ Component  │      │  Cards     │      │   Panel    │
                   └────────────┘      └────────────┘      └────────────┘
```

### 1.3 Конкретные цели

1. **Уменьшить размер main.ts до ~100 строк** — только инициализация и связывание
2. **Изоляция UI-компонентов** — каждый компонент 100-300 строк
3. **Независимое тестирование компонентов** — без загрузки всего приложения
4. **Переиспользование** — компоненты можно использовать в других UI
5. **Типобезопасность** — строгие контракты между компонентами
6. **Сохранение обратной совместимости** — существующий HTML не меняется

### 1.4 Метрики успеха

| Метрика | Текущее значение | Целевое значение |
|---------|------------------|------------------|
| Размер app.ts (main.ts) | 1,641 строки | < 150 строк |
| Максимальный размер компонента | N/A | < 350 строк |
| Количество глобальных переменных | 25+ | 0 (всё в store) |
| Цикломатическая сложность | ~15 | < 8 |
| Время на понимание компонента | 30+ мин | < 10 мин |

---

## 2. Структура компонента (файлы, контракты)

### 2.1 Файловая структура

```
web/debug-ui/
├── main.ts                      # Entry point (init + component wiring)
├── index.html                   # HTML (без изменений)
├── styles.css                   # Стили (без изменений)
│
├── core/                        # Ядро приложения
│   ├── index.ts                 # Re-exports
│   ├── types.ts                 # Общие типы и интерфейсы
│   ├── state.ts                 # Global state (Store)
│   ├── api.ts                   # HTTP API client
│   ├── events.ts                # Event bus для компонентов
│   └── router.ts                # Simple hash router (опционально)
│
├── components/                  # UI компоненты
│   ├── _template/               # Шаблон для новых компонентов
│   │   ├── index.ts             # Component implementation
│   │   ├── types.ts             # Component-specific types
│   │   └── README.md            # Documentation
│   │
│   ├── event-feed/              # Лента событий
│   │   ├── index.ts
│   │   ├── types.ts
│   │   └── event-item.ts        # Рендер отдельного события
│   │
│   ├── character-cards/         # Карточки персонажей
│   │   ├── index.ts
│   │   ├── types.ts
│   │   └── character-card.ts    # Рендер одной карточки
│   │
│   ├── phase-panel/             # Панель фаз и шаблона
│   │   ├── index.ts
│   │   ├── types.ts
│   │   └── phase-item.ts        # Рендер одной фазы
│   │
│   ├── control-panel/           # Панель управления
│   │   ├── index.ts
│   │   ├── types.ts
│   │   └── token-counter.ts     # Счетчик токенов
│   │
│   ├── new-show-modal/          # Модальное окно создания шоу
│   │   ├── index.ts
│   │   ├── types.ts
│   │   ├── template-selector.ts
│   │   └── character-selector.ts
│   │
│   └── history-modal/           # Модальное окно истории
│       ├── index.ts
│       ├── types.ts
│       └── show-list-item.ts
│
└── utils/                       # Утилиты
    ├── dom.ts                   # DOM helpers (escapeHtml, etc.)
    ├── format.ts                # Форматирование (время, числа)
    └── storage.ts               # localStorage wrapper
```

### 2.2 Интерфейс компонента (IComponent)

```typescript
// core/types.ts

/**
 * Базовый интерфейс UI компонента
 */
export interface IComponent {
  /** Уникальное имя компонента */
  readonly name: string;
  
  /**
   * Инициализация компонента
   * Вызывается один раз при старте приложения
   * @param container - DOM элемент для рендера
   */
  init(container: HTMLElement): void;
  
  /**
   * Обновить состояние компонента
   * Вызывается при изменении глобального state
   */
  update(state: AppState): void;
  
  /**
   * Очистка ресурсов компонента
   * Вызывается при unmount
   */
  dispose(): void;
}

/**
 * Компонент с подпиской на события
 */
export interface IEventSubscriber extends IComponent {
  /** Типы событий, на которые подписан компонент */
  readonly subscribedEvents: EventType[];
  
  /**
   * Обработка события
   */
  handleEvent(event: AppEvent): void;
}

/**
 * Компонент-модальное окно
 */
export interface IModalComponent extends IComponent {
  /** Открыть модальное окно */
  open(): void;
  
  /** Закрыть модальное окно */
  close(): void;
  
  /** Проверить, открыто ли окно */
  isOpen(): boolean;
}
```

### 2.3 Базовый класс компонента

```typescript
// core/base-component.ts

import { IComponent, AppState } from './types.js';
import { eventBus } from './events.js';

export abstract class BaseComponent implements IComponent {
  abstract readonly name: string;
  protected container: HTMLElement | null = null;
  private subscriptions: Array<() => void> = [];
  
  init(container: HTMLElement): void {
    this.container = container;
    this.setupEventListeners();
    this.render();
  }
  
  /**
   * Переопределите для добавления event listeners
   */
  protected setupEventListeners(): void {}
  
  /**
   * Переопределите для рендера компонента
   */
  protected abstract render(): void;
  
  update(state: AppState): void {
    // Переопределите для реакции на изменение state
  }
  
  dispose(): void {
    // Отписываемся от всех событий
    for (const unsubscribe of this.subscriptions) {
      unsubscribe();
    }
    this.subscriptions = [];
    
    // Очищаем контейнер
    if (this.container) {
      this.container.innerHTML = '';
      this.container = null;
    }
  }
  
  /**
   * Подписаться на событие (автоматическая отписка при dispose)
   */
  protected subscribe<T>(
    eventType: string,
    handler: (data: T) => void
  ): void {
    const unsubscribe = eventBus.on(eventType, handler);
    this.subscriptions.push(unsubscribe);
  }
  
  /**
   * Отправить событие
   */
  protected emit<T>(eventType: string, data: T): void {
    eventBus.emit(eventType, data);
  }
}
```

### 2.4 Пример реализации: EventFeedComponent

```typescript
// components/event-feed/index.ts

import { BaseComponent } from '../../core/base-component.js';
import { AppState, ShowEvent } from '../../core/types.js';
import { escapeHtml, formatTime } from '../../utils/format.js';
import { EventItemRenderer } from './event-item.js';

export class EventFeedComponent extends BaseComponent {
  readonly name = 'event-feed';
  
  private eventsContainer: HTMLElement | null = null;
  private itemRenderer: EventItemRenderer;
  private currentPhaseId: string | null = null;
  private phaseEventCount = 0;
  
  constructor() {
    super();
    this.itemRenderer = new EventItemRenderer();
  }
  
  protected setupEventListeners(): void {
    // Подписка на новые события
    this.subscribe<ShowEvent>('show:event', this.handleShowEvent.bind(this));
    this.subscribe<void>('show:disconnect', this.handleDisconnect.bind(this));
  }
  
  protected render(): void {
    if (!this.container) return;
    
    this.eventsContainer = this.container.querySelector('#events-container');
    if (!this.eventsContainer) {
      console.error('EventFeed: #events-container not found');
    }
  }
  
  update(state: AppState): void {
    // При подключении к шоу очищаем ленту
    if (state.isConnecting && this.eventsContainer) {
      this.clearEvents();
    }
  }
  
  private handleShowEvent(event: ShowEvent): void {
    if (!this.eventsContainer) return;
    
    // Пропускаем внутренние события
    if (event.type === 'host_trigger') return;
    
    // Обработка фаз
    if (event.type === 'phase_start' && event.phaseId) {
      this.handlePhaseStart(event.phaseId);
    } else if (event.type === 'phase_end' && event.phaseId) {
      this.handlePhaseEnd(event.phaseId);
    }
    
    // Рендер события
    const eventEl = this.itemRenderer.render(event);
    this.eventsContainer.appendChild(eventEl);
    this.scrollToBottom();
    
    // Счетчик событий в фазе
    if (event.type === 'speech') {
      this.phaseEventCount++;
    }
  }
  
  private handlePhaseStart(phaseId: string): void {
    if (this.currentPhaseId && this.phaseEventCount === 0) {
      this.addEmptyPhaseMessage();
    }
    this.addPhaseSeparator(phaseId, true);
    this.currentPhaseId = phaseId;
    this.phaseEventCount = 0;
  }
  
  private handlePhaseEnd(phaseId: string): void {
    if (this.phaseEventCount === 0) {
      this.addEmptyPhaseMessage();
    }
    this.currentPhaseId = null;
    this.phaseEventCount = 0;
  }
  
  private clearEvents(): void {
    if (this.eventsContainer) {
      this.eventsContainer.innerHTML = '';
    }
    this.currentPhaseId = null;
    this.phaseEventCount = 0;
  }
  
  private handleDisconnect(): void {
    this.clearEvents();
  }
  
  private addPhaseSeparator(phaseId: string, isStart: boolean): void {
    if (!this.eventsContainer) return;
    
    const separatorEl = document.createElement('div');
    separatorEl.className = 'phase-separator';
    const label = isStart ? `Фаза: ${phaseId}` : `Конец фазы: ${phaseId}`;
    separatorEl.innerHTML = `<span class="phase-label">${escapeHtml(label)}</span>`;
    this.eventsContainer.appendChild(separatorEl);
  }
  
  private addEmptyPhaseMessage(): void {
    if (!this.eventsContainer) return;
    
    const messageEl = document.createElement('div');
    messageEl.className = 'empty-phase-message';
    messageEl.innerHTML = '<span>Нет событий в этой фазе</span>';
    this.eventsContainer.appendChild(messageEl);
  }
  
  private scrollToBottom(): void {
    if (this.eventsContainer) {
      this.eventsContainer.scrollTop = this.eventsContainer.scrollHeight;
    }
  }
  
  /**
   * Добавить системное сообщение
   */
  addSystemMessage(message: string): void {
    if (!this.eventsContainer) return;
    
    const messageEl = document.createElement('div');
    messageEl.className = 'event-item system-message';
    messageEl.style.cssText = `
      background-color: var(--bg-light);
      color: var(--text-secondary);
      font-style: italic;
      border-left-color: var(--accent);
    `;
    
    const time = formatTime(Date.now());
    messageEl.innerHTML = `
      <div class="event-header">
        <span class="event-sender">System</span>
        <span class="event-time">${time}</span>
      </div>
      <div class="event-content">${escapeHtml(message)}</div>
    `;
    
    this.eventsContainer.appendChild(messageEl);
    this.scrollToBottom();
  }
}
```

---

## 3. State management (глобальный vs локальный)

### 3.1 Принципы разделения состояния

| Тип состояния | Где хранится | Примеры |
|---------------|--------------|---------|
| **Глобальное** | Store (core/state.ts) | currentShowId, showStatus, characters |
| **Компонентное** | Внутри компонента | isExpanded, scrollPosition, inputValue |
| **Производное** | Вычисляется из глобального | canStart (зависит от status) |

### 3.2 Глобальное состояние (Store)

```typescript
// core/state.ts

import { ShowStatus, Character, ShowConfig, ShowEvent } from './types.js';

/**
 * Глобальное состояние приложения
 */
export interface AppState {
  // Connection state
  currentShowId: string | null;
  isConnecting: boolean;
  isConnected: boolean;
  isReadOnlyMode: boolean;
  reconnectAttempts: number;
  
  // Show state
  showStatus: ShowStatus | null;
  currentPhaseId: string | null;
  turnCount: number;
  
  // Data
  characters: Character[];
  showConfig: ShowConfig | null;
  
  // Token budget
  tokenBudget: {
    total: number;
    used: number;
    percentUsed: number;
  } | null;
  
  // Character state
  characterStatuses: Map<string, CharacterStatus>;
  activeCharacterId: string | null;
  
  // Phase progress
  phaseTurnCounts: Map<string, number>;
}

type StateListener = (state: AppState, changedKeys: Array<keyof AppState>) => void;

/**
 * Centralized store for application state
 * Single source of truth, immutable updates
 */
class Store {
  private state: AppState;
  private listeners: Set<StateListener> = new Set();
  
  constructor() {
    this.state = this.getInitialState();
  }
  
  private getInitialState(): AppState {
    return {
      currentShowId: null,
      isConnecting: false,
      isConnected: false,
      isReadOnlyMode: false,
      reconnectAttempts: 0,
      showStatus: null,
      currentPhaseId: null,
      turnCount: 0,
      characters: [],
      showConfig: null,
      tokenBudget: null,
      characterStatuses: new Map(),
      activeCharacterId: null,
      phaseTurnCounts: new Map(),
    };
  }
  
  /**
   * Получить текущее состояние (read-only)
   */
  getState(): Readonly<AppState> {
    return this.state;
  }
  
  /**
   * Обновить состояние
   * @param updates - Частичное обновление
   */
  setState(updates: Partial<AppState>): void {
    const changedKeys = Object.keys(updates) as Array<keyof AppState>;
    this.state = { ...this.state, ...updates };
    this.notifyListeners(changedKeys);
  }
  
  /**
   * Сбросить состояние к начальному
   */
  reset(): void {
    this.state = this.getInitialState();
    this.notifyListeners(Object.keys(this.state) as Array<keyof AppState>);
  }
  
  /**
   * Подписаться на изменения состояния
   * @returns Функция отписки
   */
  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  
  private notifyListeners(changedKeys: Array<keyof AppState>): void {
    for (const listener of this.listeners) {
      listener(this.state, changedKeys);
    }
  }
}

// Singleton instance
export const store = new Store();
```

### 3.3 Производное состояние (Selectors)

```typescript
// core/selectors.ts

import { AppState } from './types.js';

/**
 * Selectors для вычисления производного состояния
 * Чистые функции без side effects
 */

export function canStartShow(state: AppState): boolean {
  return state.isConnected && 
         (state.showStatus === 'created' || state.showStatus === 'paused');
}

export function canPauseShow(state: AppState): boolean {
  return state.isConnected && state.showStatus === 'running';
}

export function canResumeShow(state: AppState): boolean {
  return state.isConnected && state.showStatus === 'paused';
}

export function isShowActive(state: AppState): boolean {
  return state.showStatus === 'running' || state.showStatus === 'paused';
}

export function isShowFinished(state: AppState): boolean {
  return state.showStatus === 'completed' || state.showStatus === 'aborted';
}

export function getCharacterName(state: AppState, characterId: string): string {
  const char = state.characters.find(c => c.id === characterId);
  return char?.name ?? characterId;
}

export function getCurrentPhaseName(state: AppState): string {
  if (!state.showConfig || !state.currentPhaseId) return '--';
  const phase = state.showConfig.phases.find(p => p.id === state.currentPhaseId);
  return phase?.name ?? state.currentPhaseId;
}
```

### 3.4 Локальное состояние компонента

```typescript
// components/new-show-modal/index.ts

export class NewShowModalComponent extends BaseComponent implements IModalComponent {
  readonly name = 'new-show-modal';
  
  // Локальное состояние - специфично для этого компонента
  private isOpen_ = false;
  private selectedTemplateId: string | null = null;
  private selectedCharacterIds: Set<string> = new Set();
  private isCreating = false;
  private validationError: string | null = null;
  
  // Кешированные данные (из API)
  private availableTemplates: ShowFormatTemplate[] = [];
  private availableCharacters: CharacterDefinition[] = [];
  
  // ... rest of implementation
  
  isOpen(): boolean {
    return this.isOpen_;
  }
  
  open(): void {
    this.isOpen_ = true;
    this.loadData();
    this.render();
  }
  
  close(): void {
    this.isOpen_ = false;
    this.resetLocalState();
    this.render();
  }
  
  private resetLocalState(): void {
    this.selectedTemplateId = null;
    this.selectedCharacterIds.clear();
    this.validationError = null;
    this.isCreating = false;
  }
}
```

---

## 4. Коммуникация между компонентами

### 4.1 Паттерны коммуникации

```
┌─────────────────────────────────────────────────────────┐
│                      main.ts                            │
│  (создает компоненты, подписывает их на store)          │
└─────────────────────────────────────────────────────────┘
                            │
            ┌───────────────┼───────────────┐
            ▼               ▼               ▼
    ┌───────────┐   ┌───────────┐   ┌───────────┐
    │ Component │   │ Component │   │ Component │
    │     A     │   │     B     │   │     C     │
    └─────┬─────┘   └─────┬─────┘   └─────┬─────┘
          │               │               │
          │    ┌──────────┴──────────┐    │
          └───►│     Event Bus       │◄───┘
               │  (core/events.ts)   │
               └──────────┬──────────┘
                          │
                          ▼
               ┌──────────────────────┐
               │        Store         │
               │  (core/state.ts)     │
               └──────────────────────┘
```

### 4.2 Event Bus

```typescript
// core/events.ts

type EventHandler<T = unknown> = (data: T) => void;

/**
 * Simple typed event bus for component communication
 */
class EventBus {
  private handlers: Map<string, Set<EventHandler>> = new Map();
  
  /**
   * Подписаться на событие
   * @returns Функция отписки
   */
  on<T>(eventType: string, handler: EventHandler<T>): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler as EventHandler);
    
    return () => {
      this.handlers.get(eventType)?.delete(handler as EventHandler);
    };
  }
  
  /**
   * Подписаться на событие один раз
   */
  once<T>(eventType: string, handler: EventHandler<T>): () => void {
    const wrapper: EventHandler<T> = (data) => {
      unsubscribe();
      handler(data);
    };
    const unsubscribe = this.on(eventType, wrapper);
    return unsubscribe;
  }
  
  /**
   * Отправить событие
   */
  emit<T>(eventType: string, data: T): void {
    const handlers = this.handlers.get(eventType);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (err) {
          console.error(`EventBus: Error in handler for "${eventType}":`, err);
        }
      }
    }
  }
  
  /**
   * Удалить все подписки на событие
   */
  off(eventType: string): void {
    this.handlers.delete(eventType);
  }
  
  /**
   * Очистить все подписки
   */
  clear(): void {
    this.handlers.clear();
  }
}

// Singleton instance
export const eventBus = new EventBus();
```

### 4.3 Типы событий

```typescript
// core/types.ts

/**
 * Типы событий приложения
 */
export const AppEventTypes = {
  // SSE events from server
  SHOW_EVENT: 'show:event',           // ShowEvent received
  SHOW_CONNECTED: 'show:connected',   // SSE connection established
  SHOW_DISCONNECTED: 'show:disconnected',
  SHOW_ERROR: 'show:error',
  
  // User actions
  CONNECT_REQUEST: 'connect:request', // User wants to connect
  DISCONNECT_REQUEST: 'connect:disconnect',
  CONTROL_ACTION: 'control:action',   // Start/pause/resume/step
  
  // Modal events
  MODAL_OPEN: 'modal:open',
  MODAL_CLOSE: 'modal:close',
  
  // Show creation
  SHOW_CREATED: 'show:created',       // New show created
  SHOW_CREATE_ERROR: 'show:create:error',
  
  // UI events
  CHARACTER_SELECTED: 'character:selected',
  PHASE_CHANGED: 'phase:changed',
} as const;

export type AppEventType = typeof AppEventTypes[keyof typeof AppEventTypes];
```

### 4.4 Пример коммуникации

```typescript
// components/control-panel/index.ts

export class ControlPanelComponent extends BaseComponent {
  readonly name = 'control-panel';
  
  protected setupEventListeners(): void {
    // Подписка на изменение статуса через EventBus
    this.subscribe<StatusResponse>('show:status', this.handleStatusUpdate.bind(this));
    
    // DOM event listeners
    this.startBtn?.addEventListener('click', () => {
      // Отправляем событие через EventBus, а не вызываем API напрямую
      this.emit('control:action', { action: 'start' });
    });
  }
  
  private handleStatusUpdate(status: StatusResponse): void {
    this.updateButtonStates(status);
    this.updateStatusDisplay(status);
  }
}

// main.ts - связывание компонентов

import { eventBus } from './core/events.js';
import { api } from './core/api.js';
import { store } from './core/state.js';

// Обработчик control:action - центральное место для API вызовов
eventBus.on<{ action: ControlAction }>('control:action', async ({ action }) => {
  const showId = store.getState().currentShowId;
  if (!showId) return;
  
  try {
    const result = await api.controlShow(showId, action);
    eventBus.emit('show:status', await api.getStatus(showId));
  } catch (err) {
    eventBus.emit('show:error', { message: err.message });
  }
});
```

---

## 5. Миграция app.ts на компоненты

### 5.1 План миграции

Миграция выполняется итеративно, по одному компоненту:

| Этап | Компонент | Зависимости | Сложность | Строк |
|------|-----------|-------------|-----------|-------|
| 0 | Core (state, events, api) | - | Средняя | ~200 |
| 1 | **EventFeed** | Core | Низкая | ~250 |
| 2 | **CharacterCards** | Core | Низкая | ~150 |
| 3 | **PhasePanel** | Core | Низкая | ~150 |
| 4 | **ControlPanel** | Core | Средняя | ~200 |
| 5 | **HistoryModal** | Core | Средняя | ~200 |
| 6 | **NewShowModal** | Core | Высокая | ~300 |
| 7 | **main.ts** | Все компоненты | Низкая | ~100 |

### 5.2 Этап 0: Core

**Создать:**
```
core/
├── index.ts      # Re-exports
├── types.ts      # Перенести типы из app.ts (строки 6-78)
├── state.ts      # Глобальное состояние (строки 126-172 app.ts)
├── events.ts     # Event bus
└── api.ts        # HTTP клиент (извлечь из функций fetch)
```

**Extraction из app.ts:**

```typescript
// core/api.ts

export interface ApiClient {
  // Status
  getStatus(showId: string): Promise<StatusResponse>;
  
  // Control
  controlShow(showId: string, action: ControlAction, phaseId?: string): Promise<void>;
  
  // Data
  getCharacters(showId: string): Promise<Character[]>;
  getShowConfig(showId: string): Promise<ShowConfig>;
  getShows(): Promise<ShowHistoryItem[]>;
  
  // Create
  createShow(params: CreateShowParams): Promise<{ showId: string }>;
  generateCharacters(count: number, theme?: string): Promise<CharacterDefinition[]>;
  
  // Templates
  getTemplates(): Promise<ShowFormatTemplate[]>;
  getAvailableCharacters(): Promise<CharacterDefinition[]>;
}

class ApiClientImpl implements ApiClient {
  private baseUrl = '';
  
  async getStatus(showId: string): Promise<StatusResponse> {
    const response = await fetch(`/shows/${showId}/status`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }
  
  async controlShow(showId: string, action: ControlAction, phaseId?: string): Promise<void> {
    const body: { action: ControlAction; phaseId?: string } = { action };
    if (phaseId) body.phaseId = phaseId;
    
    const response = await fetch(`/shows/${showId}/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}`);
    }
  }
  
  // ... остальные методы
}

export const api = new ApiClientImpl();
```

### 5.3 Этап 1: EventFeed

**Извлекаемые функции из app.ts:**
- `addEventToFeed()` (867-944)
- `addSystemMessage()` (794-812)
- `addPhaseSeparator()` (843-850)
- `addEmptyPhaseMessage()` (856-862)
- `clearEvents()` (784-789)
- `getChannelClass()` (950-961)
- `getCharacterName()` (818-821)
- `getCharacterColor()` (826-829)
- `getAudienceNames()` (834-838)

**Файловая структура:**
```
components/event-feed/
├── index.ts        # EventFeedComponent class
├── types.ts        # EventFeedConfig, EventItemData
└── event-item.ts   # EventItemRenderer class
```

**Критерий завершения:**
- [ ] EventFeed работает изолированно
- [ ] Подписан на `show:event` через EventBus
- [ ] Не зависит от глобальных переменных app.ts
- [ ] Тесты проходят

### 5.4 Этап 2: CharacterCards

**Извлекаемые функции:**
- `renderCharacterCards()` (450-475)
- `updateCharacterStatus()` (608-650)
- `fetchCharacters()` (417-445)
- `formatStatus()` (593-603)

**Критерий завершения:**
- [ ] CharacterCards работает изолированно
- [ ] Получает данные через props или store
- [ ] Обновляется при получении события speech

### 5.5 Этап 3: PhasePanel

**Извлекаемые функции:**
- `renderTemplateInfo()` (509-574)
- `updatePhaseProgress()` (579-587)
- `fetchShowConfig()` (480-504)

### 5.6 Этап 4: ControlPanel

**Извлекаемые функции:**
- `handleControl()` (235-267)
- `updateControlPanelUI()` (304-339)
- `updateButtonStates()` (344-391)
- `fetchStatus()` (287-298)
- `startStatusPolling()` (396-402)
- `stopStatusPolling()` (407-412)

### 5.7 Этап 5-6: Modals

**HistoryModal:**
- `openHistoryModal()` (1048-1051)
- `closeHistoryModal()` (1056-1058)
- `loadShowHistory()` (1070-1097)
- `renderShowHistory()` (1207-1242)
- `selectShowFromHistory()` (1248-1272)
- `loadRecentShows()` (1102-1138)
- `getRecentShows()` (1143-1181)
- `saveToRecentShows()` (1186-1202)

**NewShowModal:**
- `openNewShowModal()` (996-1000)
- `closeNewShowModal()` (1005-1008)
- `loadModalData()` (1367-1395)
- `handleTemplateChange()` (1449-1460)
- `handleCharacterToggle()` (1465-1476)
- `validateCharacterSelection()` (1481-1504)
- `handleGenerateCharacters()` (1510-1572)
- `handleCreateShow()` (1577-1638)

### 5.8 Этап 7: main.ts

```typescript
// main.ts

import { store } from './core/state.js';
import { eventBus } from './core/events.js';
import { api } from './core/api.js';

// Components
import { EventFeedComponent } from './components/event-feed/index.js';
import { CharacterCardsComponent } from './components/character-cards/index.js';
import { PhasePanelComponent } from './components/phase-panel/index.js';
import { ControlPanelComponent } from './components/control-panel/index.js';
import { NewShowModalComponent } from './components/new-show-modal/index.js';
import { HistoryModalComponent } from './components/history-modal/index.js';

// SSE Connection Manager
import { SSEConnectionManager } from './core/sse-connection.js';

/**
 * Initialize the application
 */
function init(): void {
  // Create components
  const eventFeed = new EventFeedComponent();
  const characterCards = new CharacterCardsComponent();
  const phasePanel = new PhasePanelComponent();
  const controlPanel = new ControlPanelComponent();
  const newShowModal = new NewShowModalComponent();
  const historyModal = new HistoryModalComponent();
  
  // Initialize components with their containers
  eventFeed.init(document.getElementById('event-feed')!);
  characterCards.init(document.getElementById('character-cards')!);
  phasePanel.init(document.getElementById('template-info-panel')!);
  controlPanel.init(document.getElementById('control-panel')!);
  newShowModal.init(document.getElementById('new-show-modal')!);
  historyModal.init(document.getElementById('show-history-modal')!);
  
  // Subscribe components to store changes
  store.subscribe((state, changedKeys) => {
    eventFeed.update(state);
    characterCards.update(state);
    phasePanel.update(state);
    controlPanel.update(state);
  });
  
  // Setup SSE connection
  const sseManager = new SSEConnectionManager(eventBus, store);
  
  // Wire up header controls
  const connectBtn = document.getElementById('connect-btn')!;
  const showIdInput = document.getElementById('show-id') as HTMLInputElement;
  const newShowBtn = document.getElementById('new-show-btn')!;
  const historyBtn = document.getElementById('show-history-btn')!;
  
  connectBtn.addEventListener('click', () => {
    const showId = showIdInput.value.trim();
    if (showId) {
      sseManager.connect(showId);
    }
  });
  
  showIdInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      connectBtn.click();
    }
  });
  
  newShowBtn.addEventListener('click', () => newShowModal.open());
  historyBtn.addEventListener('click', () => historyModal.open());
  
  // Handle show creation
  eventBus.on<{ showId: string }>('show:created', ({ showId }) => {
    showIdInput.value = showId;
    newShowModal.close();
    sseManager.connect(showId);
  });
  
  // Handle show selection from history
  eventBus.on<{ showId: string }>('history:select', ({ showId }) => {
    showIdInput.value = showId;
    historyModal.close();
    sseManager.connect(showId);
  });
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);
```

### 5.9 Порядок миграции (пошаговый)

```
Неделя 1:
├── День 1-2: Core (state, events, api, types)
├── День 3-4: EventFeed component
└── День 5: Интеграционное тестирование

Неделя 2:
├── День 1: CharacterCards component
├── День 2: PhasePanel component
├── День 3-4: ControlPanel component
└── День 5: Интеграционное тестирование

Неделя 3:
├── День 1-2: HistoryModal component
├── День 3-4: NewShowModal component
└── День 5: main.ts + финальная интеграция

Неделя 4:
├── День 1-2: Удаление старого app.ts
├── День 3: E2E тестирование
└── День 4-5: Документация + код-ревью
```

---

## 6. Шаблон создания нового компонента

### 6.1 Структура шаблона

```
components/_template/
├── index.ts      # Component implementation
├── types.ts      # Component-specific types
└── README.md     # Documentation
```

### 6.2 index.ts (шаблон)

```typescript
// components/_template/index.ts

/**
 * Template Component - copy this file to create a new component
 *
 * INSTRUCTIONS:
 * 1. Copy this entire _template folder to components/your-component-name/
 * 2. Rename all "Template" references to your component name
 * 3. Update the component name constant
 * 4. Add your UI logic
 * 5. Register component in main.ts
 */

import { BaseComponent } from '../../core/base-component.js';
import { AppState } from '../../core/types.js';
import { ITemplateComponentConfig } from './types.js';

export class TemplateComponent extends BaseComponent {
  /** Component name for debugging - CUSTOMIZE THIS */
  readonly name = 'template';
  
  private config: ITemplateComponentConfig;
  
  constructor(config: ITemplateComponentConfig = {}) {
    super();
    this.config = config;
  }
  
  /**
   * Setup DOM event listeners
   * Called once during init()
   */
  protected setupEventListeners(): void {
    // Example: subscribe to events from other components
    this.subscribe<{ data: string }>('some:event', this.handleSomeEvent.bind(this));
    
    // Example: add DOM event listener
    // this.container?.querySelector('.button')?.addEventListener('click', this.handleClick);
  }
  
  /**
   * Render the component
   * Called once during init() and can be called again to re-render
   */
  protected render(): void {
    if (!this.container) return;
    
    // Get elements from existing HTML (recommended)
    // or render dynamic content
    
    // Example: this.buttonEl = this.container.querySelector('.my-button');
  }
  
  /**
   * Update component when global state changes
   * Called automatically when store changes
   */
  update(state: AppState): void {
    // React to state changes
    // Example: this.buttonEl.disabled = !state.isConnected;
  }
  
  /**
   * Handle events from EventBus
   */
  private handleSomeEvent(data: { data: string }): void {
    console.log('Received event:', data);
  }
  
  // Add your component-specific public methods below
  
  /**
   * Example public method
   */
  public doSomething(): void {
    // Implementation
    this.emit('template:action', { action: 'something' });
  }
}

// Re-export types
export { ITemplateComponentConfig } from './types.js';
```

### 6.3 types.ts (шаблон)

```typescript
// components/_template/types.ts

/**
 * Types for the template component
 *
 * INSTRUCTIONS: Copy this file when creating a new component.
 * Replace "Template" with your component name.
 */

/**
 * Configuration options for TemplateComponent
 */
export interface ITemplateComponentConfig {
  /** Optional: custom class name for styling */
  className?: string;
  
  /** Optional: callback when action occurs */
  onAction?: (data: unknown) => void;
  
  // Add your component-specific config options here
}

/**
 * Local state for TemplateComponent
 * Not part of global AppState
 */
export interface ITemplateLocalState {
  isExpanded: boolean;
  selectedId: string | null;
  
  // Add your component-specific state here
}

/**
 * Events emitted by TemplateComponent
 */
export const TemplateEvents = {
  ACTION: 'template:action',
  SELECTED: 'template:selected',
} as const;
```

### 6.4 README.md (шаблон)

```markdown
# Template Component

This is a template for creating new UI components. Copy this folder and customize.

## Quick Start

```bash
# 1. Copy template
cp -r web/debug-ui/components/_template web/debug-ui/components/your-component

# 2. Rename files and classes
# Replace "Template" with "YourComponent" everywhere
```

## Files

| File | Purpose |
|------|---------|
| `index.ts` | Component class extending BaseComponent |
| `types.ts` | Component-specific types and events |
| `README.md` | Component documentation |

## Usage

```typescript
import { YourComponent } from './components/your-component/index.js';

const component = new YourComponent({ /* config */ });
component.init(document.getElementById('container')!);
```

## Events

| Event | Data | Description |
|-------|------|-------------|
| `your:event` | `{ data: T }` | Emitted when... |

## Checklist

- [ ] Rename component class and file
- [ ] Update `name` property
- [ ] Add DOM event listeners in `setupEventListeners()`
- [ ] Implement `render()` method
- [ ] Handle state updates in `update(state)`
- [ ] Add component to main.ts
- [ ] Add tests
```

### 6.5 Процесс создания нового компонента

1. **Скопировать шаблон:**
   ```bash
   cp -r web/debug-ui/components/_template web/debug-ui/components/my-component
   ```

2. **Переименовать:**
   - `TemplateComponent` -> `MyComponent`
   - `ITemplateComponentConfig` -> `IMyComponentConfig`
   - `name = 'template'` -> `name = 'my-component'`

3. **Реализовать логику:**
   - Определить types в `types.ts`
   - Добавить event listeners в `setupEventListeners()`
   - Реализовать `render()` и `update()`

4. **Зарегистрировать в main.ts:**
   ```typescript
   import { MyComponent } from './components/my-component/index.js';
   
   const myComponent = new MyComponent();
   myComponent.init(document.getElementById('my-container')!);
   ```

5. **Добавить тесты:**
   ```typescript
   // tests/components/my-component.test.ts
   describe('MyComponent', () => {
     it('should render correctly', () => { /* ... */ });
   });
   ```

---

## Приложение A: Маппинг функций app.ts -> компоненты

| Функция в app.ts | Строки | Целевой компонент | Файл |
|------------------|--------|-------------------|------|
| Types/Interfaces | 1-78 | core | types.ts |
| DOM Elements | 79-125 | main.ts + components | - |
| State variables | 126-172 | core | state.ts |
| `init()` | 177-212 | main.ts | main.ts |
| `handleConnect()` | 217-230 | SSEManager | sse-connection.ts |
| `handleControl()` | 235-267 | ControlPanel | control-panel/index.ts |
| `handleRollback()` | 272-281 | ControlPanel | control-panel/index.ts |
| `fetchStatus()` | 287-298 | api | api.ts |
| `updateControlPanelUI()` | 304-339 | ControlPanel | control-panel/index.ts |
| `updateButtonStates()` | 344-391 | ControlPanel | control-panel/index.ts |
| `startStatusPolling()` | 396-402 | SSEManager | sse-connection.ts |
| `stopStatusPolling()` | 407-412 | SSEManager | sse-connection.ts |
| `fetchCharacters()` | 417-445 | api + CharacterCards | api.ts, character-cards/ |
| `renderCharacterCards()` | 450-475 | CharacterCards | character-cards/index.ts |
| `fetchShowConfig()` | 480-504 | api + PhasePanel | api.ts, phase-panel/ |
| `renderTemplateInfo()` | 509-574 | PhasePanel | phase-panel/index.ts |
| `updatePhaseProgress()` | 579-587 | PhasePanel | phase-panel/index.ts |
| `formatStatus()` | 593-603 | utils | format.ts |
| `updateCharacterStatus()` | 608-650 | CharacterCards | character-cards/index.ts |
| `connect()` | 655-698 | SSEManager | sse-connection.ts |
| `disconnect()` | 713-744 | SSEManager | sse-connection.ts |
| `resetControlPanelUI()` | 749-756 | ControlPanel | control-panel/index.ts |
| `attemptReconnect()` | 761-779 | SSEManager | sse-connection.ts |
| `clearEvents()` | 784-789 | EventFeed | event-feed/index.ts |
| `addSystemMessage()` | 794-812 | EventFeed | event-feed/index.ts |
| `getCharacterName()` | 818-821 | selectors | selectors.ts |
| `getCharacterColor()` | 826-829 | CharacterCards | character-cards/index.ts |
| `getAudienceNames()` | 834-838 | EventFeed | event-feed/event-item.ts |
| `addPhaseSeparator()` | 843-850 | EventFeed | event-feed/index.ts |
| `addEmptyPhaseMessage()` | 856-862 | EventFeed | event-feed/index.ts |
| `addEventToFeed()` | 867-944 | EventFeed | event-feed/event-item.ts |
| `getChannelClass()` | 950-961 | EventFeed | event-feed/event-item.ts |
| `formatTime()` | 966-973 | utils | format.ts |
| `escapeHtml()` | 979-983 | utils | dom.ts |
| `scrollToBottom()` | 989-991 | EventFeed | event-feed/index.ts |
| `openNewShowModal()` | 996-1000 | NewShowModal | new-show-modal/index.ts |
| `closeNewShowModal()` | 1005-1008 | NewShowModal | new-show-modal/index.ts |
| `resetModalState()` | 1013-1026 | NewShowModal | new-show-modal/index.ts |
| `openHistoryModal()` | 1048-1051 | HistoryModal | history-modal/index.ts |
| `closeHistoryModal()` | 1056-1058 | HistoryModal | history-modal/index.ts |
| `loadShowHistory()` | 1070-1097 | HistoryModal | history-modal/index.ts |
| `loadRecentShows()` | 1102-1138 | HistoryModal | history-modal/index.ts |
| `getRecentShows()` | 1143-1181 | utils | storage.ts |
| `saveToRecentShows()` | 1186-1202 | utils | storage.ts |
| `renderShowHistory()` | 1207-1242 | HistoryModal | history-modal/index.ts |
| `selectShowFromHistory()` | 1248-1272 | HistoryModal | history-modal/index.ts |
| `connectToCompletedShow()` | 1278-1340 | SSEManager | sse-connection.ts |
| `parseSSEEvents()` | 1345-1362 | utils | sse-parser.ts |
| `loadModalData()` | 1367-1395 | NewShowModal | new-show-modal/index.ts |
| `renderTemplateSelect()` | 1400-1409 | NewShowModal | new-show-modal/template-selector.ts |
| `renderCharacterCheckboxes()` | 1414-1444 | NewShowModal | new-show-modal/character-selector.ts |
| `handleTemplateChange()` | 1449-1460 | NewShowModal | new-show-modal/index.ts |
| `handleCharacterToggle()` | 1465-1476 | NewShowModal | new-show-modal/index.ts |
| `validateCharacterSelection()` | 1481-1504 | NewShowModal | new-show-modal/index.ts |
| `handleGenerateCharacters()` | 1510-1572 | NewShowModal | new-show-modal/index.ts |
| `handleCreateShow()` | 1577-1638 | NewShowModal | new-show-modal/index.ts |

---

## Приложение B: Сравнение с backend модульной архитектурой

| Аспект | Backend (PRD-modular-architecture) | Frontend (этот PRD) |
|--------|-----------------------------------|---------------------|
| Базовый интерфейс | `IModule` | `IComponent` |
| Lifecycle | `init()`, `dispose()` | `init()`, `update()`, `dispose()` |
| Регистрация | `ModuleRegistry` | Ручная в main.ts |
| Состояние | `ModuleContext` от ядра | `AppState` из Store |
| Коммуникация | Event hooks | EventBus |
| Зависимости | `dependencies[]` | Нет (flat structure) |
| Шаблон | `src/modules/_template/` | `components/_template/` |
