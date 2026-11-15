# antseed-mcp

MCP-сервер для Management API [AntSeed Gateway](https://antseed.com/docs/gateway/management-api/).
Даёт агенту (Claude Desktop, Claude Code, Cursor, VS Code и другим MCP-клиентам) смотреть продавцов
и модели сети, сравнивать продавцов модели по цене, trust, аудитам и health, читать расход, журнал
запросов и политику маршрутизации, а при явном разрешении — менять список разрешённых продавцов.

Сервер не обращается к моделям (`/v1/*`) и не тратит деньги кошелька.

Нужны Node.js 20+ (для `npx`) и management-токен вашего gateway (`antseed_admin_…`).

## Настройки

Все настройки задаются переменными окружения в блоке `env` конфига клиента.

| Переменная | Обязательна | Назначение |
| --- | --- | --- |
| `ANTSEED_URL` | да | Адрес вашего gateway, например `https://gateway.example.com` |
| `ANTSEED_ADMIN_TOKEN` | да* | Management-токен `antseed_admin_…` |
| `ANTSEED_ADMIN_TOKEN_FILE` | да* | Путь к файлу с токеном — вместо `ANTSEED_ADMIN_TOKEN`, чтобы токен не лежал в конфиге |
| `ANTSEED_ALLOW_WRITES` | нет | `true` — включает изменение политики (`routing_allow_peers`). По умолчанию сервер только читает |
| `ANTSEED_TIMEOUT_MS` | нет | Таймаут запроса к API, по умолчанию `30000` |

\* Нужна одна из двух.

## Установка в Claude Desktop

Добавьте в `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`,
Windows: `%APPDATA%\Claude\claude_desktop_config.json`) и перезапустите Claude Desktop.
Подробнее — [документация MCP для Claude Desktop](https://modelcontextprotocol.io/quickstart/user).

```json
{
  "mcpServers": {
    "antseed": {
      "command": "npx",
      "args": ["-y", "@inteko/antseed-mcp"],
      "env": {
        "ANTSEED_URL": "https://your-gateway.example.com",
        "ANTSEED_ADMIN_TOKEN": "antseed_admin_your_token",
        "ANTSEED_ALLOW_WRITES": "false"
      }
    }
  }
}
```

## Установка в Claude Code

```sh
claude mcp add antseed -s user \
  -e ANTSEED_URL=https://your-gateway.example.com \
  -e ANTSEED_ADMIN_TOKEN=antseed_admin_your_token \
  -- npx -y @inteko/antseed-mcp
```

`-s user` подключает сервер во всех проектах; без него — только в текущей папке.
Проверка: `claude mcp list` или `/mcp` внутри сессии. Чтобы поменять настройки:
`claude mcp remove antseed -s user` и добавить заново.

Или файл `.mcp.json` в корне проекта — тот же JSON, что для Claude Desktop.

## Установка в Cursor

`~/.cursor/mcp.json` (для всех проектов) или `.cursor/mcp.json` в проекте — тот же JSON, что для Claude Desktop.

## Установка в VS Code

`.vscode/mcp.json` в проекте:

```json
{
  "servers": {
    "antseed": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@inteko/antseed-mcp"],
      "env": {
        "ANTSEED_URL": "https://your-gateway.example.com",
        "ANTSEED_ADMIN_TOKEN": "antseed_admin_your_token"
      }
    }
  }
}
```

## Включение записи

По умолчанию сервер только читает: инструмента изменения политики в списке нет вовсе.
Чтобы агент мог менять список разрешённых продавцов, поставьте `"ANTSEED_ALLOW_WRITES": "true"`
(в Claude Code — `-e ANTSEED_ALLOW_WRITES=true`) и перезапустите клиент.

Даже тогда `routing_allow_peers` по умолчанию делает пробный прогон и показывает diff; записывает
только с `dryRun: false`. Он меняет одно поле `allowedPeerIds`, остальную политику сохраняет как есть
и не даёт оставить список пустым (пустой список разрешил бы всех продавцов). Каждая запись попадает
в журнал аудита gateway.

## Инструменты

| Tool | Что делает |
| --- | --- |
| `status` | Версия gateway, доступность покупателя, число продавцов и DHT-узлов |
| `model_sellers` | Все продавцы модели от дешёвых к дорогим: цена, trust, аудит модели, health, success rate, разрешён ли политикой; с `officialInput`/`officialOutput` — цена в % от официальной |
| `find_peers` | Поиск продавцов по имени, префиксу peerId, модели, минимальному trust, только разрешённых |
| `peer` | Один продавец: trust и его разбор, верификация, аудиты моделей, сервисы с ценами и health |
| `search_models` | Модели сети: число продавцов и диапазон цен |
| `routing` | Текущая политика маршрутизации с именами разрешённых продавцов |
| `usage` | Расход с группировкой: `hour`, `day`, `model`, `key`, `member`, `peer`, `workspace`, `user` |
| `recent_requests` | Последние запросы; `failedOnly` — только ошибки |
| `routing_allow_peers` | Добавить или убрать продавцов из `allowedPeerIds` (только с `ANTSEED_ALLOW_WRITES=true`) |

ID моделей сравниваются с нормализацией: `grok-4.7`, `grok-4-7` и `xai/grok-4.7` — одна модель.

Примеры запросов агенту: «кто продаёт gpt-6-luna и почём?», «покажи продавца Apex Ant»,
«какие запросы падали за последний час?», «расход по продавцам с 1 ноября».

## Если не работает

- Клиент пишет, что сервер не запустился: запустите его вручную и прочитайте ошибку в stderr —
  `ANTSEED_URL=https://… ANTSEED_ADMIN_TOKEN=… npx -y @inteko/antseed-mcp`
  (без `ANTSEED_URL` или токена сервер сразу говорит, чего не хватает).
- Ответы с `401`/`403`: токен отозван, истёк или у него нет нужного scope.
- `npx` не найден в Claude Desktop: укажите полный путь в `command` (результат `which npx`).

## Разработка

```sh
git clone https://github.com/inteko/antseed-mcp.git && cd antseed-mcp
bun install
bunx tsc --noEmit   # типы
bun test            # тесты без сети, фикстуры в fixtures/
bun run build       # dist/index.js для npm
bunx @modelcontextprotocol/inspector bun src/index.ts   # ручная проверка
```

Устройство кода и правила проекта — в [CLAUDE.md](CLAUDE.md).

## Безопасность

- Токен не попадает в ответы инструментов и сообщения об ошибках.
- Имена, описания и ссылки продавцов приходят из сети и выводятся как данные, а не инструкции.
