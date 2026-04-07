# Neuroshow - AI Show Engine

Движок интерактивных AI-шоу, где LLM-персонажи взаимодействуют по правилам шаблона.

## Быстрый старт

```bash
# 1. Установи зависимости
npm install

# 2. Создай .env файл
cp .env.example .env
# Впиши OPENAI_API_KEY если хочешь реальные ответы (иначе будет MockAdapter)

# 3. Запусти сервер
npm run dev

# 4. Открой http://localhost:3000
```

## Как создать и запустить шоу

### Шаг 1: Создай шоу через API

```bash
curl -X POST http://localhost:3000/shows \
  -H "Content-Type: application/json" \
  -d @- << 'EOF'
{
  "formatId": {
    "id": "coalition",
    "name": "Коалиция",
    "description": "5 персонажей соревнуются за приз",
    "minParticipants": 5,
    "maxParticipants": 5,
    "phases": [
      {
        "id": "phase-1",
        "name": "Знакомство",
        "type": "discussion",
        "durationMode": "turns",
        "durationValue": 5,
        "turnOrder": "sequential",
        "allowedChannels": ["PUBLIC"],
        "triggerTemplate": "Расск��жи о себе",
        "completionCondition": "all_turns_completed"
      }
    ],
    "contextWindowSize": 50,
    "decisionConfig": {
      "type": "vote",
      "voteType": "single",
      "tieBreaker": "random"
    },
    "privateChannelRules": {
      "maxActiveChannels": 2,
      "maxMessagesPerChannel": 10,
      "allowedInitiators": ["any"]
    }
  },
  "characters": [
    {
      "id": "viktor",
      "name": "Виктор",
      "publicCard": "Бизнес-консультант",
      "personalityPrompt": "Ты уверенный переговорщик",
      "motivationPrompt": "Хочешь победить",
      "boundaryRules": [],
      "speakFrequency": "high",
      "responseConstraints": {"maxTokens": 200, "format": "free", "language": "ru"}
    },
    {
      "id": "alina",
      "name": "Алина",
      "publicCard": "Психолог",
      "personalityPrompt": "Ты внимательный слушатель",
      "motivationPrompt": "Хочешь понять всех",
      "boundaryRules": [],
      "speakFrequency": "medium",
      "responseConstraints": {"maxTokens": 200, "format": "free", "language": "ru"}
    },
    {
      "id": "elena",
      "name": "Елена",
      "publicCard": "Журналист",
      "personalityPrompt": "Ты задаёшь острые вопросы",
      "motivationPrompt": "Хочешь раскрыть правду",
      "boundaryRules": [],
      "speakFrequency": "high",
      "responseConstraints": {"maxTokens": 200, "format": "free", "language": "ru"}
    },
    {
      "id": "maxim",
      "name": "Максим",
      "publicCard": "Программист",
      "personalityPrompt": "Ты логичный и сдержанный",
      "motivationPrompt": "Хочешь найти оптимальное решение",
      "boundaryRules": [],
      "speakFrequency": "low",
      "responseConstraints": {"maxTokens": 200, "format": "free", "language": "ru"}
    },
    {
      "id": "dmitriy",
      "name": "Дмитрий",
      "publicCard": "Актёр",
      "personalityPrompt": "Ты эмоциональный и яркий",
      "motivationPrompt": "Хочешь произвести впечатление",
      "boundaryRules": [],
      "speakFrequency": "high",
      "responseConstraints": {"maxTokens": 200, "format": "free", "language": "ru"}
    }
  ]
}
EOF
```

Ответ:
```json
{"showId": "abc123...", "status": "created"}
```

### Шаг 2: Открой Debug UI

1. Открой http://localhost:3000
2. Вставь `showId` из ответа в поле поиска
3. Нажми Connect

### Шаг 3: Запусти шоу

```bash
# Запустить
curl -X POST http://localhost:3000/shows/YOUR_SHOW_ID/control \
  -H "Content-Type: application/json" \
  -d '{"action": "start"}'

# Или пошагово
curl -X POST http://localhost:3000/shows/YOUR_SHOW_ID/control \
  -H "Content-Type: application/json" \
  -d '{"action": "step"}'
```

## API Endpoints

| Метод | URL | Описание |
|-------|-----|----------|
| POST | `/shows` | Создать новое шоу |
| POST | `/shows/:id/control` | Управление: start, pause, resume, step |
| GET | `/shows/:id/events` | SSE поток событий |
| GET | `/shows/:id/status` | Статус и бюджет токенов |
| GET | `/shows/:id/characters` | Список персонажей |
| GET | `/shows/:id/export` | Экспорт журнала в JSON |
| GET | `/health` | Health check |

## Действия управления (control)

```bash
# Запустить шоу
{"action": "start"}

# Пауза
{"action": "pause"}

# Продолжить
{"action": "resume"}

# Один шаг
{"action": "step"}

# Откат к фазе
{"action": "rollback", "phaseId": "phase-1"}
```

## Структура проекта

```
src/
├── adapters/        # LLM адаптеры (OpenAI, Mock)
├── api/             # Fastify сервер и роуты
├── core/            # Ядро: HostModule, Orchestrator, ContextBuilder
├── storage/         # SQLite хранилище
├── types/           # TypeScript типы
├── formats/         # Шаблоны шоу и персонажи
│   ├── coalition.json
│   └── characters/
└── validation/      # Zod схемы валидации

web/debug-ui/        # Debug UI (браузер)
tests/               # Unit и integration тесты
```

## Переменные окружения (.env)

```bash
OPENAI_API_KEY=sk-...        # Ключ OpenAI (опционально)
OPENAI_DEFAULT_MODEL=gpt-4o-mini
ADAPTER_MODE=mock            # mock или openai
PORT=3000
DB_PATH=./data/neuroshow.db
TOKEN_BUDGET_PER_SHOW=100000
NODE_ENV=development
```

## Скрипты

```bash
npm run dev        # Запуск в dev режиме (с hot reload)
npm run build      # Сборка
npm start          # Запуск production
npm test           # Тесты
npm run typecheck  # Проверка типов
npm run lint       # Линтер
```
