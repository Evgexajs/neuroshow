# PRD: Side Effects (Действия персонажей)

**Версия:** 1.0  
**Дата:** 2026-04-08  
**Статус:** Draft  
**Зависимости:** PRD.md v1.3+, PRD-modular-architecture.md

---

## Содержание

1. [Обзор и цели](#1-обзор-и-цели)
2. [Типы Side Effects](#2-типы-side-effects)
3. [Архитектура: как персонаж выбирает действие](#3-архитектура-как-персонаж-выбирает-действие)
4. [Валидация действий](#4-валидация-действий)
5. [State Management — хранение состояния мира](#5-state-management--хранение-состояния-мира)
6. [UI отображение действий](#6-ui-отображение-действий)
7. [Интеграция с форматами шоу](#7-интеграция-с-форматами-шоу)
8. [Примеры форматов](#8-примеры-форматов)
9. [Модель данных](#9-модель-данных)
10. [Техническая архитектура (модуль)](#10-техническая-архитектура-модуль)
11. [Acceptance Criteria](#11-acceptance-criteria)
12. [Out of Scope / Future](#12-out-of-scope--future)

---

## 1. Обзор и цели

### Что это

**Side Effects** — механика, позволяющая персонажам совершать действия, которые изменяют состояние игрового мира помимо речи. В текущей реализации персонажи могут только говорить (`speech`) и использовать ограниченный набор intent'ов (`request_private`, `reveal_wildcard`, `end_turn`). Side Effects расширяют это, добавляя:

- Взаимодействие с предметами (взять, использовать, передать)
- Управление ресурсами (потратить деньги, очки, время)
- Социальные контракты (заключить пари, подписать договор)
- Воздействие на других игроков (саботаж, помощь)
- Исследование (открыть локацию, найти секрет)
- Специальные способности персонажей

### Ключевое отличие от speech

```
speech        →  Информация (персонаж ГОВОРИТ)
side_effect   →  Изменение мира (персонаж ДЕЛАЕТ)
```

Speech влияет на восприятие других персонажей через контекст. Side Effect изменяет объективное состояние мира: инвентарь, баланс ресурсов, доступные локации, статусы персонажей.

### Цели

1. **Расширить драматургию** — конфликты не только словесные, но и через конкуренцию за ресурсы и предметы
2. **Добавить стратегическую глубину** — персонажи принимают решения о распределении ограниченных ресурсов
3. **Создать stakes** — действия имеют необратимые последствия
4. **Поддержать новые форматы** — форматы с экономикой, квестами, выживанием

### Архитектурные ограничения

- **Детерминированность** — Side Effects обрабатываются оркестратором, не LLM
- **Валидация в ядре** — нельзя совершить невалидное действие
- **Полная журнализация** — все действия записываются в Event Journal
- **Replay-совместимость** — состояние мира восстанавливается из журнала

---

## 2. Типы Side Effects

### 2.1 Категории действий

| Категория | Описание | Примеры |
|-----------|----------|---------|
| **item** | Взаимодействие с предметами | take, use, give, drop, combine |
| **resource** | Операции с ресурсами | spend, gain, transfer, bet |
| **contract** | Социальные договоры | propose, accept, reject, break |
| **sabotage** | Негативное воздействие | steal, block, destroy, curse |
| **discovery** | Исследование и открытия | explore, unlock, reveal, search |
| **ability** | Способности персонажа | activate, channel, transform |

### 2.2 Детальное описание типов

#### Item Actions (Предметы)

```typescript
type ItemAction = 
  | 'take'      // Взять предмет из локации/общего пула
  | 'use'       // Использовать предмет (может уничтожить)
  | 'give'      // Передать предмет другому персонажу
  | 'drop'      // Положить предмет в локацию
  | 'combine'   // Объединить два предмета в новый
  | 'examine';  // Изучить предмет (получить информацию)
```

**Пример:** Персонаж находит ключ, использует его для открытия сейфа, находит компромат и передает союзнику.

#### Resource Actions (Ресурсы)

```typescript
type ResourceAction =
  | 'spend'     // Потратить ресурс (деньги, очки, время)
  | 'gain'      // Получить ресурс (награда, находка)
  | 'transfer'  // Передать ресурс другому персонажу
  | 'bet'       // Поставить ресурс на исход события
  | 'invest'    // Вложить с отложенным возвратом
  | 'convert';  // Конвертировать один ресурс в другой
```

**Пример:** Персонаж ставит 100 очков на то, что Алексей не пройдет испытание. Если прав — получает 200, если нет — теряет ставку.

#### Contract Actions (Контракты)

```typescript
type ContractAction =
  | 'propose'   // Предложить контракт/пари
  | 'accept'    // Принять предложенный контракт
  | 'reject'    // Отклонить предложение
  | 'fulfill'   // Выполнить условие контракта
  | 'break'     // Нарушить контракт (с последствиями)
  | 'void';     // Аннулировать контракт (по взаимному согласию)
```

**Пример:** Марина предлагает Сергею контракт: "Голосуй за меня — получишь 50% приза". Сергей принимает. Контракт записывается и проверяется в финале.

#### Sabotage Actions (Саботаж)

```typescript
type SabotageAction =
  | 'steal'     // Украсть предмет/ресурс у другого
  | 'block'     // Заблокировать действие другого персонажа
  | 'destroy'   // Уничтожить предмет (свой или общий)
  | 'curse'     // Наложить негативный эффект
  | 'frame'     // Подставить другого персонажа
  | 'spy';      // Подсмотреть приватную информацию
```

**Пример:** Анна использует способность "Саботаж" чтобы украсть у Дмитрия ключ от сейфа. Дмитрий узнает об этом только когда попытается использовать ключ.

#### Discovery Actions (Открытия)

```typescript
type DiscoveryAction =
  | 'explore'   // Исследовать локацию
  | 'unlock'    // Открыть запертое место/контейнер
  | 'reveal'    // Раскрыть скрытую информацию
  | 'search'    // Искать в локации (шанс найти)
  | 'decode'    // Расшифровать сообщение/загадку
  | 'activate'; // Активировать механизм/устройство
```

**Пример:** Персонаж исследует "Заброшенный кабинет", тратит 1 ход, находит дневник с секретом о другом участнике.

#### Ability Actions (Способности)

```typescript
type AbilityAction =
  | 'activate'  // Активировать уникальную способность
  | 'channel'   // Направить способность на цель
  | 'transform' // Изменить свое состояние
  | 'summon'    // Призвать эффект/предмет
  | 'sacrifice' // Пожертвовать чем-то ради эффекта
  | 'counter';  // Отменить действие другого
```

**Пример:** "Детектив" активирует способность "Расследование" — узнает один секрет выбранного персонажа.

---

## 3. Архитектура: как персонаж выбирает действие

### 3.1 Расширение CharacterResponse

Текущий `CharacterResponse`:

```typescript
interface CharacterResponse {
  text: string;
  intent?: CharacterIntent;
  target?: string;
  decisionValue?: string;
}
```

Расширенный `CharacterResponse` с Side Effects:

```typescript
interface CharacterResponse {
  text: string;
  intent?: CharacterIntent;
  target?: string;
  decisionValue?: string;
  
  /** Side effect action (optional) */
  action?: SideEffectAction;
}

interface SideEffectAction {
  /** Action type from allowed actions for this format */
  type: ActionType;
  
  /** Primary target (item ID, character ID, location ID) */
  targetId?: string;
  
  /** Secondary target for actions like 'give', 'transfer' */
  secondaryTargetId?: string;
  
  /** Amount for resource actions */
  amount?: number;
  
  /** Additional parameters specific to action type */
  params?: Record<string, unknown>;
}

type ActionType = ItemAction | ResourceAction | ContractAction 
                | SabotageAction | DiscoveryAction | AbilityAction;
```

### 3.2 Добавление нового Intent

```typescript
enum CharacterIntent {
  speak = 'speak',
  request_private = 'request_private',
  reveal_wildcard = 'reveal_wildcard',
  end_turn = 'end_turn',
  request_to_speak = 'request_to_speak',    // Non-MVP
  request_interrupt = 'request_interrupt',   // Non-MVP
  action = 'action',                         // NEW: Side Effect
}
```

Когда `intent === 'action'`, оркестратор обрабатывает поле `action` в ответе.

### 3.3 Prompt Engineering для Side Effects

Персонаж должен знать:
1. **Какие действия доступны** — из конфигурации формата
2. **Текущее состояние мира** — инвентарь, ресурсы, доступные локации
3. **Последствия действий** — что произойдет при выполнении

**Дополнение к System Prompt:**

```
## Доступные действия

В этом шоу ты можешь совершать следующие действия помимо речи:

[Динамически генерируется из allowedActions формата]

### Как совершить действие

Чтобы совершить действие, добавь в ответ:
- intent: "action"
- action: { type: "...", targetId: "...", ... }

Пример: взять предмет "ключ-001":
{
  "text": "Я беру этот старый ключ...",
  "intent": "action",
  "action": { "type": "take", "targetId": "ключ-001" }
}

### Твой текущий инвентарь
[Динамически из WorldState]

### Твои ресурсы
[Динамически из WorldState]

### Доступные локации
[Динамически из WorldState]
```

### 3.4 Поток обработки действия

```
Character LLM Response
        │
        ▼
┌───────────────────┐
│  Parse Response   │
│  (Orchestrator)   │
└─────────┬─────────┘
          │
          ▼ intent === 'action'?
          │
    ┌─────┴─────┐
    │           │
   NO          YES
    │           │
    ▼           ▼
  speech   ┌───────────────────┐
  event    │  SideEffectsModule│
           │  .validateAction()│
           └─────────┬─────────┘
                     │
              ┌──────┴──────┐
              │             │
           INVALID       VALID
              │             │
              ▼             ▼
        ┌─────────┐   ┌─────────────────┐
        │ Log     │   │ executeAction() │
        │ failure │   │ Update state    │
        │ event   │   │ Create events   │
        └─────────┘   └─────────────────┘
```

---

## 4. Валидация действий

### 4.1 Уровни валидации

1. **Schema Validation** — JSON структура корректна
2. **Type Validation** — action.type существует в allowedActions формата
3. **Precondition Validation** — выполнены все условия для действия
4. **Resource Validation** — достаточно ресурсов/предметов
5. **Target Validation** — цель существует и доступна

### 4.2 Preconditions по типам действий

| Action | Preconditions |
|--------|---------------|
| `take` | Предмет существует, не принадлежит другому, персонаж в той же локации |
| `use` | Предмет в инвентаре персонажа, предмет usable |
| `give` | Предмет в инвентаре, получатель существует, можно передавать |
| `spend` | Достаточно ресурса, ресурс spendable |
| `transfer` | Достаточно ресурса, получатель существует |
| `bet` | Достаточно ресурса, событие для ставки существует |
| `steal` | Цель владеет предметом/ресурсом, способность/возможность саботажа разрешена |
| `explore` | Локация существует, не исследована (или repeatable), персонаж может перемещаться |
| `activate` | Способность существует, не на кулдауне, достаточно ресурса для активации |

### 4.3 ValidationResult

```typescript
interface ActionValidationResult {
  valid: boolean;
  
  /** Error code if invalid */
  errorCode?: ActionErrorCode;
  
  /** Human-readable error message */
  errorMessage?: string;
  
  /** Validated and normalized action (with resolved IDs) */
  normalizedAction?: SideEffectAction;
}

enum ActionErrorCode {
  UNKNOWN_ACTION_TYPE = 'UNKNOWN_ACTION_TYPE',
  ACTION_NOT_ALLOWED = 'ACTION_NOT_ALLOWED',
  TARGET_NOT_FOUND = 'TARGET_NOT_FOUND',
  TARGET_NOT_ACCESSIBLE = 'TARGET_NOT_ACCESSIBLE',
  INSUFFICIENT_RESOURCES = 'INSUFFICIENT_RESOURCES',
  ITEM_NOT_IN_INVENTORY = 'ITEM_NOT_IN_INVENTORY',
  ITEM_NOT_USABLE = 'ITEM_NOT_USABLE',
  ABILITY_ON_COOLDOWN = 'ABILITY_ON_COOLDOWN',
  PRECONDITION_FAILED = 'PRECONDITION_FAILED',
  INVALID_PARAMETERS = 'INVALID_PARAMETERS',
}
```

### 4.4 Fallback при невалидном действии

Если действие невалидно:
1. Создается событие `system` с `errorCode` и `errorMessage`
2. Речь персонажа (`text`) все равно записывается как `speech` event
3. Персонаж не теряет ход
4. В следующем ходу персонаж видит в контексте: "Твое действие [X] не удалось: [причина]"

---

## 5. State Management — хранение состояния мира

### 5.1 WorldState — состояние мира

```typescript
interface WorldState {
  showId: string;
  
  /** All items in the game world */
  items: Map<string, ItemState>;
  
  /** Character inventories */
  inventories: Map<string, Inventory>;
  
  /** Character resources */
  resources: Map<string, ResourceBalance>;
  
  /** Active contracts between characters */
  contracts: Map<string, Contract>;
  
  /** Location states */
  locations: Map<string, LocationState>;
  
  /** Active effects on characters */
  effects: Map<string, ActiveEffect[]>;
  
  /** Ability cooldowns */
  cooldowns: Map<string, AbilityCooldown[]>;
  
  /** Last update sequence number (for replay) */
  lastSequenceNumber: number;
}
```

### 5.2 Компоненты состояния

#### ItemState

```typescript
interface ItemState {
  id: string;
  templateId: string;          // Reference to item definition
  name: string;
  description: string;
  
  /** Current owner (character ID or null for unowned) */
  ownerId: string | null;
  
  /** Location if not owned */
  locationId: string | null;
  
  /** Item flags */
  isUsable: boolean;
  isTransferable: boolean;
  isVisible: boolean;          // false = hidden until discovered
  isConsumedOnUse: boolean;
  
  /** Custom properties from template */
  properties: Record<string, unknown>;
  
  /** Sequence number when state last changed */
  lastModifiedSeq: number;
}
```

#### Inventory

```typescript
interface Inventory {
  characterId: string;
  items: string[];             // Item IDs
  maxSlots: number;            // -1 = unlimited
}
```

#### ResourceBalance

```typescript
interface ResourceBalance {
  characterId: string;
  balances: Map<ResourceType, number>;
}

type ResourceType = 
  | 'money'
  | 'points'
  | 'energy'
  | 'influence'
  | 'time'
  | 'tokens'
  | string;  // Custom resource types per format
```

#### Contract

```typescript
interface Contract {
  id: string;
  type: 'bet' | 'deal' | 'alliance' | 'threat';
  
  /** Parties involved */
  proposerId: string;
  acceptorId: string | null;   // null if not yet accepted
  
  /** Contract terms */
  terms: string;               // Human-readable
  conditions: ContractCondition[];
  
  /** Status */
  status: 'proposed' | 'active' | 'fulfilled' | 'broken' | 'void';
  
  /** Stakes */
  stakes: ContractStake[];
  
  /** When created/modified */
  createdSeq: number;
  resolvedSeq: number | null;
}

interface ContractCondition {
  type: 'vote_for' | 'vote_against' | 'transfer_item' | 'pay_resource' | 'custom';
  targetId?: string;
  amount?: number;
  deadline?: string;           // Phase ID
  customCheck?: string;        // Expression for custom conditions
}

interface ContractStake {
  characterId: string;
  resourceType: ResourceType;
  amount: number;
  itemIds?: string[];
}
```

#### LocationState

```typescript
interface LocationState {
  id: string;
  name: string;
  description: string;
  
  /** Is location discovered/accessible */
  isUnlocked: boolean;
  
  /** Characters currently in this location */
  presentCharacterIds: string[];
  
  /** Items available in this location */
  availableItemIds: string[];
  
  /** Has been explored (for one-time discoveries) */
  isExplored: boolean;
  
  /** Search results cache */
  searchResults: SearchResult[];
  
  lastModifiedSeq: number;
}

interface SearchResult {
  foundByCharacterId: string;
  itemId?: string;
  secretId?: string;
  foundAtSeq: number;
}
```

#### ActiveEffect

```typescript
interface ActiveEffect {
  id: string;
  type: 'buff' | 'debuff' | 'status';
  name: string;
  description: string;
  
  /** Who applied this effect */
  sourceCharacterId: string;
  
  /** Who has this effect */
  targetCharacterId: string;
  
  /** Effect modifiers */
  modifiers: EffectModifier[];
  
  /** Duration */
  expiresAtPhase?: string;     // Phase ID
  expiresAfterTurns?: number;
  
  appliedAtSeq: number;
}

interface EffectModifier {
  stat: string;                // 'voteWeight', 'actionCost', etc.
  operation: 'add' | 'multiply' | 'set';
  value: number;
}
```

### 5.3 Восстановление состояния из журнала

WorldState восстанавливается при:
- Запуске replay
- Rollback к checkpoint
- Перезапуске сервера

```typescript
class WorldStateReconstructor {
  /**
   * Rebuild world state from event journal
   * @param events - All events up to target sequence number
   * @returns Reconstructed WorldState
   */
  reconstruct(events: ShowEvent[]): WorldState {
    const state = this.createEmptyState();
    
    for (const event of events) {
      if (event.eventType === EventType.side_effect) {
        this.applyEffect(state, event);
      } else if (event.eventType === EventType.phase_start) {
        this.handlePhaseStart(state, event);
      }
      // ... handle other event types
    }
    
    return state;
  }
}
```

### 5.4 Хранение в БД

WorldState не хранится напрямую — он всегда восстанавливается из `show_events`. Но для оптимизации можно хранить snapshot:

```sql
-- Optional: WorldState snapshots for fast recovery
CREATE TABLE world_state_snapshots (
  id TEXT PRIMARY KEY,
  show_id TEXT NOT NULL,
  sequence_number INTEGER NOT NULL,
  state_json TEXT NOT NULL,  -- Serialized WorldState
  created_at INTEGER NOT NULL,
  UNIQUE(show_id, sequence_number)
);
```

---

## 6. UI отображение действий

### 6.1 Новый тип события

```typescript
enum EventType {
  // ... existing types
  side_effect = 'side_effect',        // NEW: Side effect action
  side_effect_failed = 'side_effect_failed',  // NEW: Failed action
}
```

### 6.2 Формат события side_effect

```typescript
interface SideEffectEvent extends ShowEvent {
  eventType: EventType.side_effect;
  
  content: string;  // Human-readable description: "Анна взяла Ключ от сейфа"
  
  metadata: {
    action: SideEffectAction;
    result: ActionResult;
    stateChanges: StateChange[];
  };
}

interface ActionResult {
  success: boolean;
  outcome: string;           // "Вы получили Ключ от сейфа"
  discoveredInfo?: string;   // For explore/examine actions
}

interface StateChange {
  type: 'inventory' | 'resource' | 'location' | 'effect' | 'contract';
  targetId: string;
  before: unknown;
  after: unknown;
}
```

### 6.3 Отображение в ленте событий

```
┌─────────────────────────────────────────────────────────┐
│  [14:32:15] АННА совершает действие                     │
│  ─────────────────────────────────────────────────────  │
│  🔑 Взяла предмет: Ключ от сейфа                        │
│                                                         │
│  "Думаю, это именно то, что нам нужно..."              │
│                                                         │
│  📦 Инвентарь: +1 предмет                              │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  [14:33:22] СЕРГЕЙ совершает действие                   │
│  ─────────────────────────────────────────────────────  │
│  💰 Сделал ставку: 50 очков на "Алексей проиграет"      │
│                                                         │
│  "Я уверен в своей интуиции."                          │
│                                                         │
│  📊 Баланс: 150 → 100 очков                            │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  [14:35:01] МАРИНА — действие не удалось               │
│  ─────────────────────────────────────────────────────  │
│  ❌ Попытка: Украсть Карту у Дмитрия                   │
│  Причина: Недостаточно очков влияния (нужно 30, есть 15)│
│                                                         │
│  "Черт, это сложнее чем я думала..."                   │
└─────────────────────────────────────────────────────────┘
```

### 6.4 Панель состояния персонажа

```
┌─ АННА ────────────────────────────────────────┐
│                                               │
│  📦 Инвентарь:                               │
│     • Ключ от сейфа                          │
│     • Записка (не прочитана)                 │
│                                               │
│  💰 Ресурсы:                                 │
│     • Очки: 120                              │
│     • Влияние: 45                            │
│                                               │
│  ⚡ Способности:                             │
│     • Детектив (готово)                      │
│     • Саботаж (кулдаун: 2 хода)             │
│                                               │
│  📜 Контракты:                               │
│     • Пари с Сергеем (активно)              │
│                                               │
│  🌟 Эффекты:                                 │
│     • Подозрение (-10% к влиянию, 3 хода)   │
│                                               │
└───────────────────────────────────────────────┘
```

### 6.5 Визуализация контрактов

```
┌─ КОНТРАКТ #C-001 ─────────────────────────────┐
│  Тип: Пари                                    │
│  Статус: 🟢 Активно                          │
│                                               │
│  Стороны:                                     │
│    Сергей ставит 50 очков                    │
│    vs                                         │
│    Банк (коэффициент 2.0)                    │
│                                               │
│  Условие:                                     │
│    "Алексей не пройдет в финал"              │
│                                               │
│  Срок: до конца фазы "Голосование"           │
└───────────────────────────────────────────────┘
```

---

## 7. Интеграция с форматами шоу

### 7.1 Расширение ShowFormatTemplate

```typescript
interface ShowFormatTemplate {
  // ... existing fields
  
  /** Side effects configuration (optional) */
  sideEffects?: SideEffectsConfig;
}

interface SideEffectsConfig {
  /** Is side effects enabled for this format */
  enabled: boolean;
  
  /** Allowed action categories */
  allowedCategories: ActionCategory[];
  
  /** Specific allowed actions (overrides categories) */
  allowedActions?: ActionType[];
  
  /** Resource types used in this format */
  resourceTypes: ResourceTypeConfig[];
  
  /** Item templates available in this format */
  itemTemplates?: ItemTemplate[];
  
  /** Ability templates for characters */
  abilityTemplates?: AbilityTemplate[];
  
  /** Location templates */
  locationTemplates?: LocationTemplate[];
  
  /** Starting resources for each character */
  startingResources?: ResourceBalance;
  
  /** Actions allowed per turn (0 = unlimited) */
  actionsPerTurn: number;
  
  /** Can actions and speech happen in same turn */
  allowActionWithSpeech: boolean;
}

type ActionCategory = 'item' | 'resource' | 'contract' | 'sabotage' | 'discovery' | 'ability';

interface ResourceTypeConfig {
  type: ResourceType;
  name: string;                // Display name
  icon?: string;               // Emoji or icon ID
  startingAmount: number;
  maxAmount?: number;          // -1 = unlimited
  isTransferable: boolean;
  isVisible: boolean;          // false = hidden from other players
}

interface ItemTemplate {
  id: string;
  name: string;
  description: string;
  rarity: 'common' | 'rare' | 'legendary';
  isUsable: boolean;
  isTransferable: boolean;
  isConsumedOnUse: boolean;
  useEffect?: UseEffect;
  spawnLocations?: string[];   // Location IDs where item can appear
  spawnChance?: number;        // 0-1
}

interface UseEffect {
  type: 'reveal_secret' | 'gain_resource' | 'apply_effect' | 'unlock_location' | 'custom';
  targetType: 'self' | 'other' | 'location';
  params: Record<string, unknown>;
}

interface AbilityTemplate {
  id: string;
  name: string;
  description: string;
  cooldownTurns: number;
  resourceCost?: { type: ResourceType; amount: number };
  effect: AbilityEffect;
  /** Character IDs who have this ability (empty = all) */
  assignedTo?: string[];
}

interface AbilityEffect {
  type: 'spy' | 'steal' | 'block' | 'buff' | 'debuff' | 'reveal' | 'custom';
  targetType: 'self' | 'other' | 'all';
  duration?: number;           // Turns
  params: Record<string, unknown>;
}

interface LocationTemplate {
  id: string;
  name: string;
  description: string;
  isInitiallyUnlocked: boolean;
  unlockCondition?: string;    // Expression
  explorationRewards: ExplorationReward[];
}

interface ExplorationReward {
  type: 'item' | 'secret' | 'resource';
  templateId?: string;
  amount?: number;
  chance: number;              // 0-1
  isRepeatable: boolean;
}
```

### 7.2 Phase-level ограничения

```typescript
interface Phase {
  // ... existing fields
  
  /** Side effects restrictions for this phase */
  sideEffectsOverride?: {
    /** Completely disable side effects for this phase */
    disabled?: boolean;
    
    /** Override allowed actions for this phase */
    allowedActions?: ActionType[];
    
    /** Override actions per turn for this phase */
    actionsPerTurn?: number;
  };
}
```

---

## 8. Примеры форматов

### 8.1 Формат "Аукцион" (с ресурсами)

```json
{
  "id": "auction",
  "name": "Аукцион секретов",
  "description": "5 участников торгуются за секреты друг друга. У каждого стартовый капитал и один секрет на продажу.",
  "minParticipants": 5,
  "maxParticipants": 5,
  
  "sideEffects": {
    "enabled": true,
    "allowedCategories": ["resource", "contract"],
    "allowedActions": ["spend", "transfer", "bet", "propose", "accept", "reject"],
    
    "resourceTypes": [
      {
        "type": "coins",
        "name": "Монеты",
        "icon": "🪙",
        "startingAmount": 100,
        "maxAmount": -1,
        "isTransferable": true,
        "isVisible": false
      }
    ],
    
    "actionsPerTurn": 1,
    "allowActionWithSpeech": true
  },
  
  "phases": [
    {
      "id": "auction-round-1",
      "name": "Первый аукцион",
      "type": "discussion",
      "durationMode": "turns",
      "durationValue": 10,
      "triggerTemplate": "Сейчас на торги выставлен секрет {currentSeller}. Текущая ставка: {currentBid}. Можешь поднять ставку или пас.",
      "sideEffectsOverride": {
        "allowedActions": ["spend"]
      }
    }
  ]
}
```

### 8.2 Формат "Выживание" (с предметами и локациями)

```json
{
  "id": "survival",
  "name": "Остров интриг",
  "description": "5 участников оказались на острове. Нужно найти ключи от сейфа с призом и договориться кто его откроет.",
  
  "sideEffects": {
    "enabled": true,
    "allowedCategories": ["item", "discovery", "contract"],
    
    "resourceTypes": [
      {
        "type": "energy",
        "name": "Энергия",
        "icon": "⚡",
        "startingAmount": 10,
        "maxAmount": 15,
        "isTransferable": false,
        "isVisible": true
      }
    ],
    
    "itemTemplates": [
      {
        "id": "key-fragment",
        "name": "Фрагмент ключа",
        "description": "Один из 3 фрагментов ключа от сейфа",
        "rarity": "rare",
        "isUsable": false,
        "isTransferable": true,
        "isConsumedOnUse": false,
        "spawnLocations": ["cave", "ruins", "beach"],
        "spawnChance": 0.8
      },
      {
        "id": "master-key",
        "name": "Собранный ключ",
        "description": "Ключ от сейфа с призом",
        "rarity": "legendary",
        "isUsable": true,
        "isTransferable": true,
        "isConsumedOnUse": true,
        "useEffect": {
          "type": "custom",
          "targetType": "self",
          "params": { "action": "win_game" }
        }
      }
    ],
    
    "locationTemplates": [
      {
        "id": "beach",
        "name": "Пляж",
        "description": "Песчаный берег с обломками корабля",
        "isInitiallyUnlocked": true,
        "explorationRewards": [
          { "type": "item", "templateId": "key-fragment", "chance": 0.5, "isRepeatable": false }
        ]
      },
      {
        "id": "cave",
        "name": "Пещера",
        "description": "Темная пещера в скале",
        "isInitiallyUnlocked": false,
        "unlockCondition": "has_torch",
        "explorationRewards": [
          { "type": "item", "templateId": "key-fragment", "chance": 0.7, "isRepeatable": false },
          { "type": "secret", "chance": 0.3, "isRepeatable": false }
        ]
      }
    ],
    
    "actionsPerTurn": 1,
    "allowActionWithSpeech": true
  }
}
```

### 8.3 Формат "Мафия+" (со способностями)

```json
{
  "id": "mafia-plus",
  "name": "Мафия: Новая кровь",
  "description": "Классическая мафия с уникальными способностями персонажей",
  
  "sideEffects": {
    "enabled": true,
    "allowedCategories": ["ability", "sabotage"],
    
    "abilityTemplates": [
      {
        "id": "detective-investigate",
        "name": "Расследование",
        "description": "Узнать роль одного игрока",
        "cooldownTurns": 3,
        "effect": {
          "type": "reveal",
          "targetType": "other",
          "params": { "reveals": "role" }
        },
        "assignedTo": ["detective"]
      },
      {
        "id": "doctor-protect",
        "name": "Защита",
        "description": "Защитить игрока от убийства этой ночью",
        "cooldownTurns": 2,
        "effect": {
          "type": "buff",
          "targetType": "other",
          "duration": 1,
          "params": { "immunity": "kill" }
        },
        "assignedTo": ["doctor"]
      },
      {
        "id": "mafia-kill",
        "name": "Убийство",
        "description": "Убить игрока (1 раз за ночь)",
        "cooldownTurns": 1,
        "effect": {
          "type": "custom",
          "targetType": "other",
          "params": { "action": "eliminate" }
        },
        "assignedTo": ["mafia-1", "mafia-2"]
      }
    ],
    
    "actionsPerTurn": 1,
    "allowActionWithSpeech": false
  }
}
```

---

## 9. Модель данных

### 9.1 Новый тип события в show_events

```sql
-- Existing show_events table, new event_type values:
-- 'side_effect' - successful action
-- 'side_effect_failed' - failed action attempt

-- Content format for side_effect:
-- Human-readable: "Анна взяла Ключ от сейфа"

-- Metadata JSON structure for side_effect:
{
  "action": {
    "type": "take",
    "targetId": "item-key-001"
  },
  "result": {
    "success": true,
    "outcome": "Вы получили Ключ от сейфа"
  },
  "stateChanges": [
    {
      "type": "inventory",
      "targetId": "anna",
      "before": [],
      "after": ["item-key-001"]
    },
    {
      "type": "location",
      "targetId": "loc-safe-room",
      "before": { "availableItemIds": ["item-key-001"] },
      "after": { "availableItemIds": [] }
    }
  ]
}
```

### 9.2 Таблица item_templates (опционально для кэширования)

```sql
CREATE TABLE item_templates (
  id TEXT PRIMARY KEY,
  format_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  config_json TEXT NOT NULL,  -- Full ItemTemplate JSON
  UNIQUE(format_id, id)
);
```

### 9.3 Таблица ability_templates (опционально)

```sql
CREATE TABLE ability_templates (
  id TEXT PRIMARY KEY,
  format_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  config_json TEXT NOT NULL,  -- Full AbilityTemplate JSON
  UNIQUE(format_id, id)
);
```

---

## 10. Техническая архитектура (модуль)

### 10.1 Структура модуля

```
src/modules/side-effects/
├── index.ts                 # SideEffectsModule implements IModule
├── types.ts                 # All type definitions
├── validator.ts             # Action validation logic
├── executor.ts              # Action execution logic
├── world-state.ts           # WorldState management
├── reconstructor.ts         # Rebuild state from events
├── context-provider.ts      # Provides state info for prompts
└── README.md
```

### 10.2 ISideEffectsModule interface

```typescript
interface ISideEffectsModule extends IModule {
  /**
   * Initialize world state for a new show
   */
  initializeWorldState(showId: string, config: SideEffectsConfig): Promise<void>;
  
  /**
   * Validate an action before execution
   */
  validateAction(
    showId: string,
    characterId: string,
    action: SideEffectAction
  ): Promise<ActionValidationResult>;
  
  /**
   * Execute a validated action
   */
  executeAction(
    showId: string,
    characterId: string,
    action: SideEffectAction
  ): Promise<ActionExecutionResult>;
  
  /**
   * Get current world state
   */
  getWorldState(showId: string): Promise<WorldState>;
  
  /**
   * Get state context for character prompt
   */
  getCharacterStateContext(showId: string, characterId: string): Promise<CharacterStateContext>;
  
  /**
   * Reconstruct world state from events (for replay/rollback)
   */
  reconstructState(showId: string, upToSequence?: number): Promise<WorldState>;
  
  /**
   * Check and resolve contracts at phase end
   */
  resolveContracts(showId: string, phaseId: string): Promise<ContractResolution[]>;
}

interface ActionExecutionResult {
  success: boolean;
  event: ShowEvent;
  stateChanges: StateChange[];
  discoveredInfo?: string;
}

interface CharacterStateContext {
  inventory: ItemState[];
  resources: ResourceBalance;
  activeEffects: ActiveEffect[];
  availableAbilities: AvailableAbility[];
  accessibleLocations: LocationState[];
  activeContracts: Contract[];
}

interface AvailableAbility {
  template: AbilityTemplate;
  cooldownRemaining: number;
  canActivate: boolean;
  activationBlockedReason?: string;
}

interface ContractResolution {
  contractId: string;
  outcome: 'fulfilled' | 'broken' | 'void';
  transfers: ResourceTransfer[];
}
```

### 10.3 Регистрация в Orchestrator

```typescript
// In orchestrator.ts
import { SideEffectsModule, ISideEffectsModule, SIDE_EFFECTS_MODULE_NAME } from '../modules/side-effects/index.js';

private _sideEffectsModule: ISideEffectsModule | null = null;

private async getSideEffectsModule(): Promise<ISideEffectsModule> {
  if (this._sideEffectsModule) {
    return this._sideEffectsModule;
  }

  let mod = this.moduleRegistry.getModule<ISideEffectsModule>(SIDE_EFFECTS_MODULE_NAME);
  if (!mod) {
    mod = new SideEffectsModule(this.store, this.journal);
    await this.moduleRegistry.register(mod);
  }

  this._sideEffectsModule = mod;
  return mod;
}
```

### 10.4 Интеграция с handleIntent

```typescript
async handleIntent(
  showId: string,
  response: CharacterResponse,
  senderId: string
): Promise<void> {
  // ... existing intent handling
  
  // NEW: Handle action intent
  if (response.intent === CharacterIntent.action && response.action) {
    await this.handleAction(showId, senderId, response.action, response.text);
    return;
  }
}

private async handleAction(
  showId: string,
  characterId: string,
  action: SideEffectAction,
  speechText: string
): Promise<void> {
  const sideEffectsModule = await this.getSideEffectsModule();
  
  // Validate action
  const validation = await sideEffectsModule.validateAction(showId, characterId, action);
  
  if (!validation.valid) {
    // Create failure event
    await this.journal.append({
      showId,
      phaseId: this.getCurrentPhaseId(),
      eventType: EventType.side_effect_failed,
      channel: ChannelType.PUBLIC,
      senderId: characterId,
      receiverIds: [],
      audienceIds: await this.getAllCharacterIds(showId),
      content: `Попытка действия не удалась: ${validation.errorMessage}`,
      metadata: {
        action,
        errorCode: validation.errorCode,
        errorMessage: validation.errorMessage
      },
      seed: this.generateSeed()
    });
    return;
  }
  
  // Execute action
  const result = await sideEffectsModule.executeAction(
    showId,
    characterId,
    validation.normalizedAction!
  );
  
  // Speech event is created separately if text is not empty
  if (speechText.trim()) {
    await this.createSpeechEvent(showId, characterId, speechText);
  }
}
```

---

## 11. Acceptance Criteria

### 11.1 Core Functionality

- [ ] Персонаж может вернуть `intent: 'action'` с валидным `action` объектом
- [ ] Невалидные действия логируются как `side_effect_failed` без краша
- [ ] Успешные действия изменяют WorldState и создают `side_effect` event
- [ ] WorldState полностью восстанавливается из event journal
- [ ] Replay корректно воспроизводит все side effects

### 11.2 Validation

- [ ] Каждый тип действия имеет определенные preconditions
- [ ] Недостаток ресурсов корректно определяется и сообщается
- [ ] Отсутствующие предметы не могут быть использованы/переданы
- [ ] Способности на кулдауне нельзя активировать

### 11.3 Format Integration

- [ ] Формат может включить/выключить side effects через `sideEffects.enabled`
- [ ] Формат определяет `allowedActions` — только они доступны персонажам
- [ ] Фаза может переопределить `allowedActions` через `sideEffectsOverride`
- [ ] Ресурсы и предметы инициализируются из конфигурации формата

### 11.4 UI Display

- [ ] Действия отображаются в ленте событий с понятным описанием
- [ ] Неуспешные действия показывают причину отказа
- [ ] Состояние персонажа (инвентарь, ресурсы, эффекты) доступно в UI
- [ ] Контракты отображаются со статусом и условиями

### 11.5 Context Integration

- [ ] Персонаж видит свой инвентарь в контексте
- [ ] Персонаж видит свои ресурсы в контексте
- [ ] Персонаж видит доступные способности и их кулдауны
- [ ] Персонаж видит результат предыдущего действия (успех/неудача)

---

## 12. Out of Scope / Future

### 12.1 Не входит в первую версию

- **AI-оптимизация действий** — LLM сам решает когда действовать, не подсказываем оптимальные ходы
- **Многоходовые действия** — действия выполняются за 1 ход, нет "начать исследование... продолжить... завершить"
- **Групповые действия** — несколько персонажей выполняют действие вместе
- **Реакции на действия других** — автоматические контрдействия
- **Скрытые действия** — все действия видны всем (кроме spy результатов)
- **Комбо-система** — бонусы за последовательность действий
- **Инвентарь с весом/слотами** — простой список без ограничений

### 12.2 Возможные расширения

- **Торговля между персонажами** — полноценный trade интерфейс с офферами
- **Крафт предметов** — combine с рецептами
- **Территориальный контроль** — владение локациями дает бонусы
- **Фракции** — группы персонажей с общими ресурсами
- **Аукционная механика** — встроенная система торгов
- **Achievement система** — награды за определенные действия

---

## Appendix A: Migration Path

### Этап 1: Базовая инфраструктура
1. Добавить `CharacterIntent.action` в enum
2. Расширить `CharacterResponse` полем `action`
3. Создать базовую структуру модуля side-effects

### Этап 2: Core Implementation
1. Реализовать WorldState и его persistence
2. Реализовать validator для базовых действий (take, use, give)
3. Реализовать executor
4. Интегрировать в handleIntent

### Этап 3: Format Integration
1. Расширить ShowFormatTemplate конфигурацией sideEffects
2. Обновить Context Builder для включения state в промпты
3. Обновить существующие форматы (coalition) без side effects

### Этап 4: UI & Testing
1. Добавить отображение событий side_effect в debug UI
2. Добавить панель состояния персонажа
3. Написать integration тесты для форматов с side effects

### Этап 5: Example Format
1. Создать пример формата с ресурсами (auction)
2. Создать пример формата с предметами (survival)
3. Документация и примеры
