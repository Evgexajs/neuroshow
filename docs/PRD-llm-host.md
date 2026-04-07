# PRD: LLM-Ведущий (Host AI Agent)

**Версия:** 1.0  
**Дата:** 2026-04-08  
**Статус:** Draft  
**Зависимости:** PRD.md v1.3+, Host Module (детерминированный)

---

## Содержание

1. [Обзор и цели](#1-обзор-и-цели)
2. [Роль и ограничения](#2-роль-и-ограничения)
3. [Триггеры активации](#3-триггеры-активации)
4. [Типы интервенций](#4-типы-интервенций)
5. [Контроль токен-бюджета](#5-контроль-токен-бюджета)
6. [Промпты и персона](#6-промпты-и-персона)
7. [Отображение в UI](#7-отображение-в-ui)
8. [Конфигурация](#8-конфигурация)
9. [Модель данных](#9-модель-данных)
10. [Техническая архитектура](#10-техническая-архитектура)
11. [Acceptance Criteria](#11-acceptance-criteria)
12. [Out of Scope / Future](#12-out-of-scope--future)

---

## 1. Обзор и цели

### Что это

**LLM-Ведущий (Host AI Agent)** — дополнительный LLM-модуль, который действует как ведущий шоу с голосом и личностью. В отличие от детерминированного Host Module (который управляет правилами и таймлайном), LLM-Ведущий создаёт развлекательный контент: комментирует происходящее, задаёт провокационные вопросы, добавляет драму и выдаёт динамические директивы персонажам.

### Ключевое отличие от детерминированного HostModule

```
HostModule (существующий)     →  Контролирует ПРАВИЛА: фазы, ходы, каналы, решения
LLM-Ведущий (этот документ)  →  Создаёт КОНТЕНТ: комментарии, вопросы, интриги
```

LLM-Ведущий **не заменяет** детерминированный Host Module. Он работает *поверх* него как "голос" и "личность", но не имеет права:
- Изменять правила шаблона
- Считать очки или определять победителя
- Принимать решения за персонажей
- Переопределять очередь ходов

### Цели

- Повысить развлекательность и драматизм шоу через живую реакцию на события
- Создать уникальную персону ведущего с узнаваемым голосом и стилем
- Обеспечить динамическое управление темпом через точечные интервенции
- Сохранить детерминированность ядра: LLM-Ведущий — опциональный слой, шоу работает и без него

---

## 2. Роль и ограничения

### 2.1 Что LLM-Ведущий МОЖЕТ делать

| Действие | Описание | Пример |
|----------|----------|--------|
| **Комментировать** | Озвучивать происходящее, добавлять драматизм | "Интересный поворот! Кажется, Алексей не ожидал такого от Марины..." |
| **Задавать вопросы** | Направлять конкретному персонажу вопрос, требующий ответа | "Сергей, ты только что узнал, что Анна голосовала против тебя. Что скажешь?" |
| **Делать объявления** | Вводить новую информацию или напоминать о правилах | "Напоминаю: до финального голосования осталось 3 хода!" |
| **Выдавать приватные директивы** | Тайно направить персонажу задание или подсказку | `[PRIVATE → Марина]` "Попробуй выяснить, о чём договорились Алексей и Сергей" |
| **Нагнетать интригу** | Намекать на скрытые конфликты без раскрытия секретов | "Чувствую напряжение между некоторыми участниками... Но об этом позже." |
| **Управлять темпом** | Ускорять или замедлять через риторические приёмы | "Время поджимает!" / "Давайте разберёмся подробнее..." |

### 2.2 Что LLM-Ведущий НЕ МОЖЕТ делать

| Запрет | Причина | Enforcement |
|--------|---------|-------------|
| **Изменять правила** | Правила определяются шаблоном, не ведущим | Ведущий не имеет доступа к API изменения шаблона |
| **Считать очки** | Скоринг — детерминированная функция движка | Ведущий получает результаты, не вычисляет их |
| **Голосовать/принимать решения** | Решения принимают только персонажи | Ведущий не включён в список участников голосования |
| **Раскрывать чужие секреты** | Информационная изоляция — архитектурное ограничение | Ведущий НЕ видит содержимое `privateContext` персонажей |
| **Пропускать ходы персонажей** | Каждый персонаж должен получить свой ход | Оркестратор контролирует turnQueue, не ведущий |
| **Превышать свой токен-бюджет** | Контроль затрат | Отдельный лимит `hostBudget`, hard stop при исчерпании |
| **Выдавать приватные директивы без флага** | Не все форматы поддерживают динамические директивы | Проверка `allowHostDirectives` в конфиге |

### 2.3 Архитектурные границы

```
┌─────────────────────────────────────────────────────────────────┐
│                        ORCHESTRATOR                             │
│  ┌─────────────────┐        ┌─────────────────────────────────┐│
│  │  Host Module    │        │    LLM Host Agent               ││
│  │  (детерминир.)  │───────▶│    (генеративный)               ││
│  │                 │        │                                 ││
│  │  - Фазы        │        │  - Комментарии                 ││
│  │  - Ходы        │  даёт   │  - Вопросы                     ││
│  │  - Каналы      │  контекст│  - Объявления                  ││
│  │  - Бюджет      │◀───────│  - Приватные директивы         ││
│  │  - Решения     │ пишет   │                                 ││
│  └─────────────────┘ события└─────────────────────────────────┘│
│                              ▲                                  │
│                              │ LLM API                          │
│                              ▼                                  │
│                      ┌───────────────┐                          │
│                      │ Model Adapter │                          │
│                      └───────────────┘                          │
└─────────────────────────────────────────────────────────────────┘
```

LLM-Ведущий:
- Получает контекст от Host Module (текущая фаза, последние события, состояние)
- Генерирует интервенции через Model Adapter
- Возвращает интервенции Host Module для записи в журнал
- **Не имеет прямого доступа к оркестратору**

---

## 3. Триггеры активации

LLM-Ведущий не говорит постоянно. Он активируется по определённым триггерам — событиям или условиям, требующим его внимания.

### 3.1 Обязательные триггеры (всегда активируют)

| Триггер | Описание | Тип интервенции по умолчанию |
|---------|----------|------------------------------|
| `phase_start` | Начало новой фазы | `announcement` — объявление правил фазы |
| `phase_end` | Завершение фазы | `comment` — подведение итогов |
| `revelation` | Раскрытие решений/козырей | `comment` — драматическая реакция |
| `wildcard_reveal` | Персонаж раскрыл козырь | `comment` — эмоциональная реакция |

### 3.2 Условные триггеры (активируют при выполнении условия)

| Триггер | Условие | Тип интервенции |
|---------|---------|-----------------|
| `conflict_detected` | 2+ персонажа выразили противоположные позиции | `question` — обострить конфликт |
| `alliance_hint` | Персонажи демонстрируют согласие | `comment` — намекнуть на альянс |
| `silence_detected` | Персонаж молчит >N ходов подряд (intent: end_turn) | `question` — вовлечь молчуна |
| `budget_milestone` | Достигнут 50% / 75% бюджета | `announcement` — напоминание о времени |
| `dramatic_moment` | Анализ sentiment/keywords в последней реплике | `comment` — усилить драму |
| `private_channel_open` | Открыт приватный канал | `comment` (PUBLIC) — интрига для остальных |
| `private_channel_close` | Закрыт приватный канал | `question` — спросить о результатах |

### 3.3 Периодические триггеры

| Триггер | Частота | Тип интервенции |
|---------|---------|-----------------|
| `periodic_commentary` | Каждые N ходов (configurable) | `comment` — поддержание темпа |
| `phase_midpoint` | Половина ходов фазы пройдена | `announcement` — напоминание |

### 3.4 Конфигурация триггеров

```typescript
interface InterventionTrigger {
  type: TriggerType;
  enabled: boolean;
  priority: number;                    // 1-10, чем выше — тем важнее
  cooldownTurns: number;               // минимум ходов между срабатываниями
  condition?: ConditionExpression;     // дополнительное условие
  interventionType: InterventionType;  // тип интервенции по умолчанию
  maxTokens?: number;                  // лимит токенов для этого типа
}

type TriggerType = 
  | 'phase_start'
  | 'phase_end'
  | 'revelation'
  | 'wildcard_reveal'
  | 'conflict_detected'
  | 'alliance_hint'
  | 'silence_detected'
  | 'budget_milestone'
  | 'dramatic_moment'
  | 'private_channel_open'
  | 'private_channel_close'
  | 'periodic_commentary'
  | 'phase_midpoint';
```

### 3.5 Приоритизация триггеров

Если несколько триггеров срабатывают одновременно:
1. Выбирается триггер с наивысшим `priority`
2. При равном приоритете — FIFO (первый по времени)
3. Триггеры с истекшим `cooldownTurns` имеют приоритет над охлаждающимися
4. Максимум одна интервенция за ход (кроме `phase_start`, который всегда выполняется)

---

## 4. Типы интервенций

### 4.1 Комментарий (`comment`)

**Цель:** Добавить атмосферу, драму, эмоциональную окраску без прямого вовлечения персонажей.

**Характеристики:**
- Канал: PUBLIC
- Требует ответа: НЕТ
- Влияет на turnQueue: НЕТ
- Макс. длина: 50-100 токенов

**Формат события:**
```typescript
{
  type: EventType.host_trigger,
  channel: ChannelType.PUBLIC,
  content: "Напряжение в комнате можно резать ножом...",
  metadata: {
    interventionType: 'comment',
    triggeredBy: 'conflict_detected'
  }
}
```

**Примеры:**
- "Ого! Этого никто не ожидал!"
- "Марина явно что-то скрывает... Её взгляд говорит больше, чем слова."
- "Три голоса за Алексея, два за Сергея. Интересный расклад!"

### 4.2 Вопрос к персонажу (`question`)

**Цель:** Направить диалог, вовлечь молчащего персонажа, обострить конфликт.

**Характеристики:**
- Канал: PUBLIC
- Требует ответа: ДА (следующий ход — у target)
- Влияет на turnQueue: ДА (вставляет target следующим)
- Макс. длина: 30-80 токенов

**Формат события:**
```typescript
{
  type: EventType.host_trigger,
  channel: ChannelType.PUBLIC,
  receiverIds: ['char_sergey'],
  audienceIds: ['char_marina', 'char_alexey', 'char_anna', 'char_sergey', 'char_dmitry'],
  content: "Сергей, ты молчишь уже третий ход. Что скажешь о предложении Марины?",
  metadata: {
    interventionType: 'question',
    targetCharacterId: 'char_sergey',
    triggeredBy: 'silence_detected',
    requiresResponse: true
  }
}
```

**Важно:** После вопроса оркестратор модифицирует turnQueue, вставляя `targetCharacterId` следующим (если он ещё не там). Персонаж ОБЯЗАН ответить на своём следующем ходу.

### 4.3 Объявление (`announcement`)

**Цель:** Информировать о состоянии шоу, напомнить правила, объявить результаты.

**Характеристики:**
- Канал: PUBLIC
- Требует ответа: НЕТ
- Влияет на turnQueue: НЕТ
- Макс. длина: 50-150 токенов

**Формат события:**
```typescript
{
  type: EventType.host_trigger,
  channel: ChannelType.PUBLIC,
  content: "Внимание! Фаза переговоров завершена. Сейчас каждый из вас тайно проголосует за того, кто получит главный приз. Голосование — одновременное, результаты будут объявлены после того, как все проголосуют.",
  metadata: {
    interventionType: 'announcement',
    triggeredBy: 'phase_start',
    phaseId: 'decision'
  }
}
```

### 4.4 Приватная директива (`private_directive`)

**Цель:** Тайно направить персонажу задание, подсказку или новую информацию.

**Характеристики:**
- Канал: PRIVATE
- Требует ответа: НЕТ (но влияет на поведение)
- Влияет на turnQueue: НЕТ
- Макс. длина: 30-100 токенов
- **Требует:** `allowHostDirectives: true` в конфиге

**Формат события:**
```typescript
{
  type: EventType.private_injection, // или host_trigger с visibility: PRIVATE
  channel: ChannelType.PRIVATE,
  receiverIds: ['char_marina'],
  audienceIds: ['char_marina'], // только получатель видит
  content: "Попробуй выяснить, о чём договорились Алексей и Сергей наедине. Это может помочь тебе в финальном голосовании.",
  metadata: {
    interventionType: 'private_directive',
    targetCharacterId: 'char_marina',
    triggeredBy: 'private_channel_close', // после того как другие вышли из приватки
    isSecret: true
  }
}
```

**Ограничения:**
- Максимум `maxDirectivesPerPhase` директив за фазу (default: 2)
- Максимум `maxDirectivesPerCharacter` директив одному персонажу (default: 1)
- Директивы НЕ могут содержать информацию из чужих `privateContext`
- Директивы НЕ могут приказывать конкретное решение в голосовании

### 4.5 Сводка типов интервенций

| Тип | Канал | Требует ответа | Влияет на ходы | Лимит токенов |
|-----|-------|----------------|----------------|---------------|
| `comment` | PUBLIC | Нет | Нет | 50-100 |
| `question` | PUBLIC | Да | Да | 30-80 |
| `announcement` | PUBLIC | Нет | Нет | 50-150 |
| `private_directive` | PRIVATE | Нет | Нет | 30-100 |

---

## 5. Контроль токен-бюджета

LLM-Ведущий имеет **отдельный токен-бюджет**, не зависящий от бюджета персонажей. Это предотвращает ситуацию, когда разговорчивый ведущий съедает бюджет шоу.

### 5.1 Структура бюджета ведущего

```typescript
interface HostBudget {
  totalLimit: number;           // Общий лимит токенов для ведущего (default: 10000)
  usedPrompt: number;           // Потрачено на промпты
  usedCompletion: number;       // Потрачено на ответы
  mode: HostBudgetMode;         // normal | saving | exhausted
  lastUpdated: number;          // timestamp последнего обновления
}

type HostBudgetMode = 'normal' | 'saving' | 'exhausted';
```

### 5.2 Пороги и режимы

| Порог | Режим | Поведение |
|-------|-------|-----------|
| 0-70% | `normal` | Все интервенции разрешены |
| 70-90% | `saving` | Только обязательные триггеры (`phase_start`, `phase_end`, `revelation`) |
| 90-100% | `saving` | Только `phase_start` и `revelation` |
| 100%+ | `exhausted` | Ведущий молчит, fallback на шаблонные фразы |

### 5.3 Fallback при исчерпании бюджета

Когда `mode: exhausted`, Host Module использует детерминированные шаблонные фразы:

```typescript
const HOST_FALLBACK_PHRASES = {
  phase_start: {
    discussion: "Начинаем обсуждение.",
    voting: "Время голосования.",
    decision: "Финальное решение.",
    revelation: "Раскрытие результатов."
  },
  phase_end: "Фаза завершена.",
  revelation: "Результаты объявлены."
};
```

### 5.4 Оптимизация потребления

**Стратегии экономии токенов:**

1. **Короткий системный промпт** — персона ведущего описана лаконично (см. раздел 6)
2. **Минимальный контекст** — ведущему передаются только последние 5-10 событий
3. **Кэширование** — повторяющиеся объявления (phase_start для одинаковых фаз) кэшируются
4. **Adaptive throttling** — при приближении к лимиту увеличивается `cooldownTurns`

### 5.5 Отдельная таблица для бюджета ведущего

```sql
CREATE TABLE host_budgets (
  show_id TEXT PRIMARY KEY,
  total_limit INTEGER NOT NULL,
  used_prompt INTEGER DEFAULT 0,
  used_completion INTEGER DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'normal',
  last_updated INTEGER NOT NULL,
  FOREIGN KEY (show_id) REFERENCES shows(id)
);
```

---

## 6. Промпты и персона

### 6.1 Структура персоны ведущего

```typescript
interface HostPersona {
  name: string;                    // Имя ведущего (для UI)
  voiceStyle: VoiceStyle;          // Стиль речи
  personalityTraits: string[];     // Черты характера
  catchphrases: string[];          // Фирменные фразы
  boundaries: string[];            // Что ведущий НЕ делает
  language: string;                // ru | en
}

type VoiceStyle = 
  | 'professional'      // Нейтральный, деловой
  | 'dramatic'          // Эмоциональный, театральный
  | 'ironic'            // Ироничный, с подколками
  | 'warm'              // Дружелюбный, поддерживающий
  | 'provocative';      // Провокационный, острый
```

### 6.2 Базовая персона (default)

```typescript
const DEFAULT_HOST_PERSONA: HostPersona = {
  name: "Ведущий",
  voiceStyle: 'dramatic',
  personalityTraits: [
    "Наблюдательный — замечает детали и подтексты",
    "Интригующий — умеет создать напряжение",
    "Справедливый — не занимает чью-либо сторону",
    "Артистичный — говорит образно и запоминающе"
  ],
  catchphrases: [
    "Интересный поворот...",
    "А вот это уже серьёзно!",
    "Посмотрим, посмотрим...",
    "Кто бы мог подумать?"
  ],
  boundaries: [
    "Не раскрывает чужие секреты",
    "Не оценивает персонажей как 'хороших' или 'плохих'",
    "Не подсказывает, как голосовать",
    "Не использует грубую лексику"
  ],
  language: "ru"
};
```

### 6.3 Системный промпт ведущего

```
Ты — ведущий интерактивного AI-шоу "{show_name}".

ТВОЯ РОЛЬ:
- Комментировать происходящее, добавляя драму и интригу
- Задавать вопросы участникам, чтобы направить диалог
- Делать объявления о правилах и состоянии шоу
- Поддерживать темп и вовлечённость

СТИЛЬ: {voice_style_description}

ХАРАКТЕР:
{personality_traits}

ФИРМЕННЫЕ ФРАЗЫ (используй уместно):
{catchphrases}

СТРОГИЕ ОГРАНИЧЕНИЯ:
{boundaries}
- НЕ раскрывай информацию, которую участники не знают
- НЕ принимай решения за участников
- НЕ меняй правила шоу

ФОРМАТ ОТВЕТА:
Отвечай только текстом интервенции. Без метаданных, без пояснений.
Максимум {max_tokens} слов.

ТЕКУЩИЙ КОНТЕКСТ:
Фаза: {current_phase}
Участники: {character_names}
Последние события:
{recent_events}

ТРИГГЕР: {trigger_description}
```

### 6.4 Промпты для разных типов интервенций

**comment:**
```
Прокомментируй последнее событие. Добавь драмы, но без лишнего пафоса. 1-2 предложения.
```

**question:**
```
Задай вопрос участнику {target_name}. Причина: {trigger_reason}.
Вопрос должен требовать содержательного ответа, не да/нет.
```

**announcement:**
```
Объяви о начале/завершении фазы "{phase_name}".
Кратко напомни правила, если это начало.
Подведи итоги, если это конец.
```

**private_directive:**
```
Дай приватное задание участнику {target_name}.
Задание должно быть выполнимым в рамках шоу и не нарушать правил.
НЕ приказывай конкретное решение в голосовании.
```

### 6.5 Пресеты персон

```typescript
const HOST_PERSONA_PRESETS: Record<string, Partial<HostPersona>> = {
  
  classic_host: {
    name: "Александр",
    voiceStyle: 'professional',
    personalityTraits: ["Опытный", "Невозмутимый", "Уважительный"],
    catchphrases: ["Итак...", "Посмотрим, что будет дальше", "Решение за вами"]
  },
  
  drama_queen: {
    name: "Виктория",
    voiceStyle: 'dramatic',
    personalityTraits: ["Эмоциональная", "Театральная", "Восторженная"],
    catchphrases: ["Невероятно!", "Я в шоке!", "Это войдёт в историю!"]
  },
  
  provocateur: {
    name: "Максим",
    voiceStyle: 'provocative',
    personalityTraits: ["Острый на язык", "Провокатор", "Любит конфликты"],
    catchphrases: ["А слабо?", "Интересно, как это объяснить?", "Кто-то явно врёт..."]
  },
  
  friendly_guide: {
    name: "Елена",
    voiceStyle: 'warm',
    personalityTraits: ["Дружелюбная", "Поддерживающая", "Эмпатичная"],
    catchphrases: ["Понимаю...", "Это непросто", "Удачи всем!"]
  }
};
```

---

## 7. Отображение в UI

### 7.1 Визуальное различие от системных событий

| Источник | Цвет фона | Иконка | Шрифт |
|----------|-----------|--------|-------|
| Персонаж | Белый | Аватар персонажа | Обычный |
| LLM-Ведущий | Градиент (золотой) | Микрофон | **Жирный** |
| System (детерминированный) | Серый | Шестерёнка | Курсив |

### 7.2 Структура карточки ведущего в ленте

```
┌────────────────────────────────────────────────────────┐
│ [Микрофон] ВЕДУЩИЙ                          12:34:56  │
├────────────────────────────────────────────────────────┤
│                                                        │
│  "Напряжение в комнате можно резать ножом...          │
│   Интересно, кто первым сломается?"                   │
│                                                        │
│  ┌──────────────────────────────────────────────────┐ │
│  │ [Комментарий] Триггер: conflict_detected         │ │
│  └──────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────┘
```

### 7.3 Индикаторы в Debug UI

**Панель ведущего:**
```
┌─────────────────────────────────────────────┐
│ LLM-ВЕДУЩИЙ: Александр                      │
├─────────────────────────────────────────────┤
│ Статус: [Активен] / [Экономия] / [Молчит]   │
│ Бюджет: ████████░░ 78% (7800 / 10000)       │
│ Интервенций: 12                             │
│ Последняя: 2 хода назад                     │
│ Следующий триггер: phase_end (через 3 хода) │
└─────────────────────────────────────────────┘
```

### 7.4 Фильтрация в ленте событий

Добавить чекбокс в панель фильтров:
- [x] Персонажи
- [x] **LLM-Ведущий** (новое)
- [x] Системные события

### 7.5 Приватные директивы в UI

Приватные директивы отображаются только для оператора (Debug UI), не для зрителей:

```
┌────────────────────────────────────────────────────────┐
│ [Микрофон] ВЕДУЩИЙ → [Замок] Марина         12:35:12  │
├────────────────────────────────────────────────────────┤
│ [ПРИВАТНАЯ ДИРЕКТИВА — видна только в Debug UI]       │
│                                                        │
│  "Попробуй выяснить, о чём договорились               │
│   Алексей и Сергей наедине."                          │
│                                                        │
└────────────────────────────────────────────────────────┘
```

---

## 8. Конфигурация

### 8.1 Параметры конфигурации

```typescript
interface LLMHostConfig {
  // Основные
  hostEnabled: boolean;              // Включён ли LLM-ведущий (default: false)
  hostPersona: HostPersona | string; // Персона или ID пресета
  hostModelAdapter: string;          // ID адаптера: 'openai', 'anthropic', etc.
  hostModelId?: string;              // Конкретная модель: 'gpt-4o', 'claude-3-opus'
  
  // Бюджет
  hostBudget: number;                // Лимит токенов (default: 10000)
  hostBudgetSavingThreshold: number; // Порог экономии % (default: 70)
  hostBudgetExhaustedThreshold: number; // Порог исчерпания % (default: 90)
  
  // Триггеры
  interventionRules: InterventionRule[];
  interventionCooldown: number;      // Минимум ходов между интервенциями (default: 2)
  maxInterventionsPerPhase: number;  // Лимит за фазу (default: 10)
  
  // Директивы
  allowHostDirectives: boolean;      // Разрешены ли приватные директивы (default: false)
  maxDirectivesPerPhase: number;     // Лимит директив за фазу (default: 2)
  maxDirectivesPerCharacter: number; // Лимит директив одному персонажу (default: 1)
  
  // Дополнительно
  hostContextWindowSize: number;     // Сколько событий видит ведущий (default: 10)
  verboseLogging: boolean;           // Логировать все промпты/ответы (default: false)
}

interface InterventionRule {
  trigger: TriggerType;
  enabled: boolean;
  priority: number;
  cooldownTurns: number;
  interventionType: InterventionType;
  maxTokens: number;
  condition?: ConditionExpression;
}
```

### 8.2 Дефолтная конфигурация

```typescript
const DEFAULT_LLM_HOST_CONFIG: LLMHostConfig = {
  hostEnabled: false,
  hostPersona: 'classic_host',
  hostModelAdapter: 'openai',
  hostModelId: 'gpt-4o-mini',
  
  hostBudget: 10000,
  hostBudgetSavingThreshold: 70,
  hostBudgetExhaustedThreshold: 90,
  
  interventionRules: [
    { trigger: 'phase_start', enabled: true, priority: 10, cooldownTurns: 0, interventionType: 'announcement', maxTokens: 150 },
    { trigger: 'phase_end', enabled: true, priority: 9, cooldownTurns: 0, interventionType: 'comment', maxTokens: 100 },
    { trigger: 'revelation', enabled: true, priority: 10, cooldownTurns: 0, interventionType: 'comment', maxTokens: 100 },
    { trigger: 'conflict_detected', enabled: true, priority: 7, cooldownTurns: 3, interventionType: 'question', maxTokens: 80 },
    { trigger: 'silence_detected', enabled: true, priority: 6, cooldownTurns: 5, interventionType: 'question', maxTokens: 80 },
    { trigger: 'periodic_commentary', enabled: true, priority: 3, cooldownTurns: 5, interventionType: 'comment', maxTokens: 80 },
  ],
  interventionCooldown: 2,
  maxInterventionsPerPhase: 10,
  
  allowHostDirectives: false,
  maxDirectivesPerPhase: 2,
  maxDirectivesPerCharacter: 1,
  
  hostContextWindowSize: 10,
  verboseLogging: false,
};
```

### 8.3 Конфигурация в шаблоне формата

LLM-Host config может быть частью `ShowFormatTemplate`:

```typescript
interface ShowFormatTemplate {
  // ... существующие поля ...
  
  llmHostConfig?: Partial<LLMHostConfig>;  // Переопределения для формата
}
```

Пример в JSON:
```json
{
  "id": "coalition_v1",
  "name": "Коалиция",
  "llmHostConfig": {
    "hostEnabled": true,
    "hostPersona": "drama_queen",
    "hostBudget": 15000,
    "allowHostDirectives": true,
    "interventionRules": [
      {
        "trigger": "private_channel_close",
        "enabled": true,
        "priority": 8,
        "cooldownTurns": 0,
        "interventionType": "question",
        "maxTokens": 80
      }
    ]
  }
}
```

### 8.4 Переменные окружения

```env
# LLM Host
LLM_HOST_ENABLED=false
LLM_HOST_MODEL=gpt-4o-mini
LLM_HOST_BUDGET=10000
LLM_HOST_VERBOSE_LOGGING=false
```

---

## 9. Модель данных

### 9.1 Расширение существующих таблиц

**show_events — новые metadata поля:**
```typescript
interface HostInterventionMetadata {
  interventionType: InterventionType;
  triggeredBy: TriggerType;
  targetCharacterId?: string;      // для question и private_directive
  requiresResponse?: boolean;      // для question
  isSecret?: boolean;              // для private_directive
  hostBudgetBefore: number;        // бюджет до интервенции
  hostBudgetAfter: number;         // бюджет после
}
```

### 9.2 Новые таблицы

```sql
-- Бюджет LLM-ведущего
CREATE TABLE host_budgets (
  show_id TEXT PRIMARY KEY,
  total_limit INTEGER NOT NULL,
  used_prompt INTEGER DEFAULT 0,
  used_completion INTEGER DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'normal',  -- 'normal' | 'saving' | 'exhausted'
  last_updated INTEGER NOT NULL,
  FOREIGN KEY (show_id) REFERENCES shows(id)
);

-- История интервенций (для аналитики)
CREATE TABLE host_interventions (
  id TEXT PRIMARY KEY,
  show_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  intervention_type TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  target_character_id TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  latency_ms INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (show_id) REFERENCES shows(id),
  FOREIGN KEY (event_id) REFERENCES show_events(id)
);

-- Cooldown-трекер (чтобы не хранить в памяти)
CREATE TABLE host_trigger_cooldowns (
  show_id TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  last_fired_sequence INTEGER NOT NULL,
  PRIMARY KEY (show_id, trigger_type),
  FOREIGN KEY (show_id) REFERENCES shows(id)
);
```

### 9.3 TypeScript интерфейсы

```typescript
// ─── Host Budget ─────────────────────────────────────────────

interface HostBudgetRecord {
  showId: string;
  totalLimit: number;
  usedPrompt: number;
  usedCompletion: number;
  mode: HostBudgetMode;
  lastUpdated: number;
}

type HostBudgetMode = 'normal' | 'saving' | 'exhausted';

// ─── Host Intervention ───────────────────────────────────────

interface HostInterventionRecord {
  id: string;
  showId: string;
  eventId: string;
  interventionType: InterventionType;
  triggerType: TriggerType;
  targetCharacterId?: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  createdAt: number;
}

type InterventionType = 'comment' | 'question' | 'announcement' | 'private_directive';

// ─── Host Context ────────────────────────────────────────────

interface HostContext {
  showId: string;
  currentPhase: Phase;
  characterNames: string[];
  recentEvents: EventSummary[];    // последние N событий
  triggerEvent?: ShowEvent;        // событие, вызвавшее триггер
  triggerType: TriggerType;
  hostBudget: HostBudgetRecord;
}

// ─── Host Response ───────────────────────────────────────────

interface HostInterventionResponse {
  text: string;                    // текст интервенции
  interventionType: InterventionType;
  targetCharacterId?: string;      // для question/private_directive
}
```

---

## 10. Техническая архитектура

### 10.1 Новый модуль: LLMHostAgent

```typescript
// src/core/llm-host-agent.ts

export class LLMHostAgent {
  constructor(
    private readonly config: LLMHostConfig,
    private readonly modelAdapter: ModelAdapter,
    private readonly store: IStore,
    private readonly eventJournal: EventJournal
  ) {}

  /**
   * Проверить, должен ли ведущий вмешаться
   */
  async shouldIntervene(
    showId: string,
    event: ShowEvent
  ): Promise<InterventionTrigger | null>;

  /**
   * Сгенерировать интервенцию
   */
  async generateIntervention(
    context: HostContext
  ): Promise<HostInterventionResponse>;

  /**
   * Записать интервенцию в журнал
   */
  async emitIntervention(
    showId: string,
    response: HostInterventionResponse,
    trigger: InterventionTrigger
  ): Promise<ShowEvent>;

  /**
   * Обновить бюджет после интервенции
   */
  async updateBudget(
    showId: string,
    promptTokens: number,
    completionTokens: number
  ): Promise<void>;

  /**
   * Получить текущий статус ведущего
   */
  async getStatus(showId: string): Promise<{
    budget: HostBudgetRecord;
    interventionCount: number;
    lastInterventionSequence: number;
  }>;
}
```

### 10.2 Интеграция с Host Module

```typescript
// src/core/host-module.ts — расширение

export class HostModule {
  private llmHostAgent?: LLMHostAgent;  // опциональный

  async setLLMHostAgent(agent: LLMHostAgent): Promise<void> {
    this.llmHostAgent = agent;
  }

  /**
   * Вызывается после каждого события в журнале
   */
  async onEventAppended(event: ShowEvent): Promise<void> {
    if (!this.llmHostAgent) return;

    const trigger = await this.llmHostAgent.shouldIntervene(event.showId, event);
    if (!trigger) return;

    const context = await this.buildHostContext(event.showId, event, trigger);
    const response = await this.llmHostAgent.generateIntervention(context);
    await this.llmHostAgent.emitIntervention(event.showId, response, trigger);
  }
}
```

### 10.3 Flow интервенции

```
1. Событие появляется в журнале (speech, phase_end, etc.)
          │
          ▼
2. HostModule.onEventAppended(event)
          │
          ▼
3. LLMHostAgent.shouldIntervene(showId, event)
          │
          ├── НЕТ ──▶ return (ничего не делаем)
          │
          ▼ ДА
4. HostModule.buildHostContext(showId, event, trigger)
          │
          ▼
5. LLMHostAgent.generateIntervention(context)
          │
          ├── Промпт формируется из персоны + контекста
          ├── Вызов ModelAdapter.call()
          ├── Парсинг ответа
          │
          ▼
6. LLMHostAgent.emitIntervention(showId, response, trigger)
          │
          ├── Создание ShowEvent
          ├── Запись в журнал
          ├── Обновление бюджета
          ├── Если question → модификация turnQueue
          │
          ▼
7. Событие отправляется через SSE в UI
```

### 10.4 Обработка вопросов к персонажам

Когда LLM-Ведущий задаёт вопрос персонажу, оркестратор должен:

1. Записать событие `host_trigger` с `metadata.requiresResponse: true`
2. Модифицировать `turnQueue`, вставив `targetCharacterId` следующим
3. На следующем ходе target получает в контексте вопрос ведущего как последнее событие
4. Ответ персонажа помечается `metadata.respondingTo: <host_trigger_event_id>`

```typescript
// В Orchestrator.processNextTurn()

if (lastHostTrigger?.metadata?.requiresResponse) {
  const targetId = lastHostTrigger.metadata.targetCharacterId;
  // Вставить targetId в начало turnQueue
  this.turnQueue = [targetId, ...this.turnQueue.filter(id => id !== targetId)];
}
```

---

## 11. Acceptance Criteria

### 11.1 Базовая функциональность

- [ ] LLM-Ведущий включается/выключается через `hostEnabled` в конфиге
- [ ] При `hostEnabled: false` шоу работает как раньше (без изменений)
- [ ] При `hostEnabled: true` ведущий реагирует на обязательные триггеры (`phase_start`, `phase_end`, `revelation`)
- [ ] Интервенции записываются в журнал как `EventType.host_trigger`
- [ ] Интервенции ведущего визуально отличаются от системных событий в UI

### 11.2 Ограничения и безопасность

- [ ] Ведущий НЕ может изменить правила шаблона
- [ ] Ведущий НЕ видит содержимое `privateContext` персонажей
- [ ] Ведущий НЕ может пропустить ход персонажа
- [ ] При исчерпании `hostBudget` ведущий молчит, шоу продолжается

### 11.3 Бюджет

- [ ] `hostBudget` отделён от общего токен-бюджета шоу
- [ ] При 70% бюджета включается режим экономии (только обязательные триггеры)
- [ ] При 90% бюджета — только `phase_start` и `revelation`
- [ ] При 100% — fallback на шаблонные фразы
- [ ] Бюджет ведущего отображается в Debug UI

### 11.4 Типы интервенций

- [ ] `comment` — публичный комментарий, не требует ответа
- [ ] `question` — вопрос персонажу, target становится следующим в очереди
- [ ] `announcement` — объявление о фазе/правилах
- [ ] `private_directive` — работает только при `allowHostDirectives: true`
- [ ] Приватные директивы видны только в Debug UI

### 11.5 Триггеры

- [ ] Обязательные триггеры срабатывают всегда
- [ ] Условные триггеры проверяют `condition`
- [ ] `cooldownTurns` соблюдается
- [ ] `maxInterventionsPerPhase` не превышается
- [ ] Приоритизация работает при одновременных триггерах

### 11.6 Персона

- [ ] Можно выбрать пресет персоны по ID
- [ ] Можно задать кастомную персону
- [ ] Ведущий следует стилю и ограничениям персоны
- [ ] Фирменные фразы появляются в интервенциях

### 11.7 UI

- [ ] Интервенции ведущего отображаются с визуальным отличием
- [ ] Можно фильтровать ленту по источнику (включая/исключая ведущего)
- [ ] Панель статуса ведущего показывает бюджет и режим
- [ ] Приватные директивы видны только оператору

---

## 12. Out of Scope / Future

### 12.1 Не в MVP LLM-Ведущего

| Функция | Причина отсутствия | Когда может появиться |
|---------|-------------------|----------------------|
| Голосовая озвучка | Требует интеграции TTS | v2.0 |
| Мультиязычность | Усложняет промпты | v1.1 |
| A/B тестирование персон | Требует аналитики | v1.2 |
| Адаптивное обучение | Требует ML-пайплайна | v2.0 |
| Интерактивность с аудиторией | Другой scope | v2.0 |

### 12.2 Будущие улучшения

1. **Voice Layer интеграция**
   - TTS для озвучки интервенций
   - Голосовой профиль для каждой персоны

2. **Sentiment Analysis**
   - Автоматическое определение `conflict_detected` через анализ тональности
   - Более точные триггеры `dramatic_moment`

3. **Adaptive Persona**
   - Ведущий подстраивает стиль под ход шоу
   - Learning from feedback

4. **Audience Interaction**
   - Ведущий озвучивает голосования аудитории
   - Реагирует на комментарии зрителей

---

## Appendix: Примеры интервенций

### A.1 phase_start (discussion)

**Триггер:** Начало фазы обсуждения

**Контекст:**
```
Фаза: discussion
Участники: Марина, Алексей, Сергей, Анна, Дмитрий
```

**Интервенция:**
```
Добро пожаловать в фазу переговоров! У вас есть 15 ходов, чтобы обсудить,
убедить, а может — и обмануть друг друга. Помните: в конце каждый из вас
тайно проголосует за того, кто получит главный приз.
Итак... кто начнёт?
```

### A.2 conflict_detected

**Триггер:** Алексей и Марина выразили противоположные мнения

**Контекст:**
```
Алексей: "Я считаю, что Сергей заслуживает доверия."
Марина: "Сергей? Да он первый нас всех предаст!"
```

**Интервенция:**
```
Ого! Кажется, у нас назревает первый конфликт. Марина, ты так уверена
в коварстве Сергея — может, поделишься, откуда такие выводы?
```

### A.3 silence_detected

**Триггер:** Дмитрий молчит 3 хода подряд

**Интервенция:**
```
Дмитрий, ты подозрительно тих. В мире переговоров молчание — тоже стратегия,
но мне любопытно: ты наблюдаешь или уже всё решил?
```

### A.4 private_directive

**Триггер:** После закрытия приватного канала Алексей-Сергей

**Целевой персонаж:** Марина

**Интервенция (PRIVATE):**
```
[Только для Марины]
Алексей и Сергей о чём-то договорились наедине. Попробуй выяснить детали —
эта информация может изменить твою стратегию голосования.
```

### A.5 revelation

**Триггер:** Раскрытие козыря

**Контекст:**
```
Анна раскрыла козырь: "У меня есть доказательство, что Алексей и Сергей
знакомы до шоу — они работали вместе!"
```

**Интервенция:**
```
ВОТ ЭТО ПОВОРОТ! Анна, ты хранила этот козырь до последнего — и он того стоил!
Интересно, как теперь отреагируют Алексей и Сергей? И что скажут остальные
о тайном альянсе?
```
