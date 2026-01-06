# P4 — Диагностические логи для текущего пробега

## Обзор

Документ описывает систему диагностического логирования для отслеживания проблем с текущим пробегом. Логи позволяют понять, почему разные экраны (Home и ItemCalc) могут получать разные данные.

## Включение диагностики

### Автоматическое включение

Диагностика **автоматически включена** в следующих режимах:
- `NODE_ENV !== 'production'` (development, test)
- Preview окружения на Vercel

### Ручное включение в production

Для включения диагностики в production добавьте переменную окружения:

```bash
NEXT_PUBLIC_DIAGNOSTICS=1
```

**На Vercel**:
1. Откройте Vercel Dashboard → Settings → Environment Variables
2. Добавьте переменную:
   - **Name**: `NEXT_PUBLIC_DIAGNOSTICS`
   - **Value**: `1`
   - **Environments**: Production (или Preview, если нужно)
3. Пересоберите проект (Redeploy)

**⚠️ ВАЖНО**: Диагностика в production должна использоваться только для отладки и должна быть отключена после решения проблемы.

## Где смотреть логи

### Локально (development)

Логи выводятся в **консоль сервера** (терминал, где запущен `npm run dev`):

```bash
npm run dev
# Логи будут в терминале
```

### На Vercel (production/preview)

Логи доступны в **Vercel Dashboard**:

1. Откройте [Vercel Dashboard](https://vercel.com/dashboard)
2. Выберите проект `milekeeper`
3. Перейдите в **Deployments**
4. Выберите нужный деплой
5. Откройте вкладку **Functions** или **Logs**
6. Ищите строки с префиксом `[MileageDiagnostics]`

**Альтернатива**: Используйте Vercel CLI:
```bash
vercel logs --follow
```

## Формат логов

### Лог запроса пробега

**Префикс**: `[MileageDiagnostics]`

**Формат**:
```json
{
  "screen": "Home",
  "query": "getMaxMileageEntry",
  "sortKey": "mileage_km DESC",
  "record": {
    "id": "a1b2c3",
    "mileage_km": 249466,
    "occurred_at": "2026-01-05T12:00:00.000Z",
    "timestamp": "2026-01-05T12:00:00.000Z"
  }
}
```

**Поля**:
- `screen`: Имя экрана/контекста (например, "Home", "ItemDetails:Масло двигателя")
- `query`: Название функции запроса (например, "getMaxMileageEntry")
- `sortKey`: Ключ сортировки, использованный в запросе
- `record`: Возвращенная запись (или `null`, если записей нет)
  - `id`: Первые 6 символов UUID (безопасно для логирования)
  - `mileage_km`: Значение пробега
  - `occurred_at`: Дата записи (ISO timestamp)
  - `timestamp`: Дубликат `occurred_at` для удобства

**Пример с ошибкой**:
```json
{
  "screen": "Home",
  "query": "getMaxMileageEntry",
  "sortKey": "mileage_km DESC",
  "record": null,
  "error": "Failed to get max mileage entry: ..."
}
```

### Лог сравнения пробега

**Префикс**: `[MileageDiagnostics:Comparison]`

**Формат**:
```json
{
  "screen": "ItemDetails:Масло двигателя",
  "comparison": {
    "source1": {
      "query": "getMaxMileageEntry (server)",
      "mileage": 249466
    },
    "source2": {
      "query": "latestOdometer prop (client)",
      "mileage": 249466
    },
    "match": true,
    "diff": 0
  }
}
```

**Поля**:
- `screen`: Имя экрана/контекста
- `comparison`: Сравнение двух источников данных
  - `source1`, `source2`: Два источника для сравнения
    - `query`: Название запроса/источника
    - `mileage`: Значение пробега (или `null`)
  - `match`: Совпадают ли значения (`true`/`false`)
  - `diff`: Разница в километрах (или `null`, если одно из значений `null`)

**Пример расхождения**:
```json
{
  "screen": "ItemDetails:Масло двигателя",
  "comparison": {
    "source1": {
      "query": "getMaxMileageEntry (server)",
      "mileage": 249466
    },
    "source2": {
      "query": "latestOdometer prop (client)",
      "mileage": 237276
    },
    "match": false,
    "diff": 12190
  }
}
```

## Где логируются данные

### 1. Главная страница (Home)

**Файл**: `src/app/page.tsx`

**Логирование**:
- При загрузке данных: `getMaxMileageEntry('Home')`
- Лог содержит: screen="Home", query="getMaxMileageEntry", sortKey="mileage_km DESC"

**Пример лога**:
```json
[MileageDiagnostics] {
  "screen": "Home",
  "query": "getMaxMileageEntry",
  "sortKey": "mileage_km DESC",
  "record": {
    "id": "a1b2c3",
    "mileage_km": 249466,
    "occurred_at": "2026-01-05T12:00:00.000Z",
    "timestamp": "2026-01-05T12:00:00.000Z"
  }
}
```

### 2. Страница элемента (ItemDetails)

**Файл**: `src/app/items/[id]/page.tsx` (server) + `ItemDetailsPageClient.tsx` (client)

**Логирование**:
- Server component: `getMaxMileageEntry('ItemDetails:Масло двигателя')`
- Client component: Сравнение server prop vs client state

**Пример логов**:
```json
[MileageDiagnostics] {
  "screen": "ItemDetails:Масло двигателя",
  "query": "getMaxMileageEntry",
  "sortKey": "mileage_km DESC",
  "record": {
    "id": "a1b2c3",
    "mileage_km": 249466,
    "occurred_at": "2026-01-05T12:00:00.000Z",
    "timestamp": "2026-01-05T12:00:00.000Z"
  }
}

[MileageDiagnostics:Comparison] {
  "screen": "ItemDetails:Масло двигателя",
  "comparison": {
    "source1": {
      "query": "getMaxMileageEntry (server)",
      "mileage": 249466
    },
    "source2": {
      "query": "latestOdometer prop (client)",
      "mileage": 249466
    },
    "match": true,
    "diff": 0
  }
}
```

### 3. Список элементов (ItemsList)

**Файл**: `src/app/items/page.tsx`

**Логирование**:
- При загрузке данных: `getMaxMileageEntry('ItemsList')`

**Пример лога**:
```json
[MileageDiagnostics] {
  "screen": "ItemsList",
  "query": "getMaxMileageEntry",
  "sortKey": "mileage_km DESC",
  "record": {
    "id": "a1b2c3",
    "mileage_km": 249466,
    "occurred_at": "2026-01-05T12:00:00.000Z",
    "timestamp": "2026-01-05T12:00:00.000Z"
  }
}
```

### 4. Добавление события обслуживания (AddServiceEvent)

**Файл**: `src/lib/actions/serviceActions.ts`

**Логирование**:
- При валидации пробега: `getMaxMileageEntry('AddServiceEvent')`

**Пример лога**:
```json
[MileageDiagnostics] {
  "screen": "AddServiceEvent",
  "query": "getMaxMileageEntry",
  "sortKey": "mileage_km DESC",
  "record": {
    "id": "a1b2c3",
    "mileage_km": 249466,
    "occurred_at": "2026-01-05T12:00:00.000Z",
    "timestamp": "2026-01-05T12:00:00.000Z"
  }
}
```

## Безопасность

### Что НЕ логируется (PII)

Диагностика **никогда не логирует**:
- ❌ Полные UUID (только первые 6 символов)
- ❌ Email адреса
- ❌ Номера телефонов
- ❌ Имена пользователей
- ❌ Другие персональные данные

### Что логируется (безопасно)

Диагностика логирует только:
- ✅ Имена экранов (например, "Home", "ItemDetails:Масло двигателя")
- ✅ Названия запросов (например, "getMaxMileageEntry")
- ✅ Ключи сортировки (например, "mileage_km DESC")
- ✅ Значения пробега (числа)
- ✅ Даты/время (ISO timestamps)
- ✅ Усеченные ID (первые 6 символов UUID)

### Проверка безопасности

**Файл**: `src/lib/dev/mileageDiagnostics.ts`

**Функция**: `truncateId()` — усекает UUID до первых 6 символов

**Пример**:
```typescript
truncateId('a1b2c3d4-e5f6-7890-abcd-ef1234567890') // → 'a1b2c3'
```

## Использование для диагностики

### Сценарий 1: Расхождение пробега между Home и ItemCalc

**Шаги**:
1. Включите диагностику (если в production)
2. Откройте главную страницу
3. Откройте страницу элемента
4. Проверьте логи

**Ожидаемый результат**:
- Оба лога должны показывать одинаковый `mileage_km`
- `comparison` лог должен показывать `match: true`

**Если расхождение**:
- Сравните `record.id` в обоих логах
- Если ID разные — выбраны разные записи
- Проверьте `sortKey` — должен быть одинаковым (`mileage_km DESC`)
- Проверьте `occurred_at` — могут быть разные даты при одинаковом пробеге

### Сценарий 2: Проверка кэширования

**Шаги**:
1. Включите диагностику
2. Добавьте новую запись пробега
3. Проверьте логи на главной странице до и после добавления

**Ожидаемый результат**:
- После добавления должна появиться новая запись с большим `mileage_km`
- `record.id` должен измениться

**Если не обновляется**:
- Проверьте, что `getMaxMileageEntry()` обходит кэш (должен быть `sortKey: "mileage_km DESC"`)
- Проверьте логи Vercel на наличие ошибок инвалидации кэша

### Сценарий 3: Проверка источника данных

**Шаги**:
1. Включите диагностику
2. Откройте страницу элемента
3. Проверьте логи

**Ожидаемый результат**:
- `query` должен быть `"getMaxMileageEntry"`
- `sortKey` должен быть `"mileage_km DESC"`
- `record` должен содержать запись с максимальным пробегом

**Если не соответствует**:
- Проверьте, что используется правильная функция
- Проверьте, что сортировка правильная
- Проверьте, что нет фильтров по дате или другим полям

## Отключение диагностики

### Автоматическое отключение

Диагностика автоматически отключена в production, если:
- `NODE_ENV === 'production'` И
- `NEXT_PUBLIC_DIAGNOSTICS !== '1'`

### Ручное отключение

**На Vercel**:
1. Откройте Vercel Dashboard → Settings → Environment Variables
2. Удалите переменную `NEXT_PUBLIC_DIAGNOSTICS` или установите значение `0`
3. Пересоберите проект

**Локально**:
- Убедитесь, что `NODE_ENV=production` (или просто не устанавливайте `NEXT_PUBLIC_DIAGNOSTICS=1`)

## Реализация

### Утилита логирования

**Файл**: `src/lib/dev/mileageDiagnostics.ts`

**Функции**:
- `isDiagnosticsEnabled()` — проверка, включена ли диагностика
- `truncateId()` — усечение UUID для безопасности
- `logMileageQuery()` — логирование запроса пробега
- `logMileageComparison()` — логирование сравнения пробега

### Интеграция

**Файл**: `src/lib/actions/odometerActions.ts`

**Изменения**:
- `getMaxMileageEntry(screenName?: string)` — добавлен опциональный параметр `screenName`
- `getLatestOdometerEntry(screenName?: string)` — добавлен опциональный параметр `screenName`
- Логирование вызывается после получения данных

**Файлы с вызовами**:
- `src/app/page.tsx` — `getMaxMileageEntry('Home')`
- `src/app/items/[id]/page.tsx` — `getMaxMileageEntry('ItemDetails:...')`
- `src/app/items/page.tsx` — `getMaxMileageEntry('ItemsList')`
- `src/lib/actions/serviceActions.ts` — `getMaxMileageEntry('AddServiceEvent')`

## Примеры использования

### Пример 1: Локальная диагностика

```bash
# Запустить dev сервер
npm run dev

# Открыть браузер: http://localhost:3000
# Открыть страницу элемента: http://localhost:3000/items/[id]?tab=calc

# В терминале увидите:
[MileageDiagnostics] {
  "screen": "Home",
  "query": "getMaxMileageEntry",
  "sortKey": "mileage_km DESC",
  "record": {
    "id": "a1b2c3",
    "mileage_km": 249466,
    "occurred_at": "2026-01-05T12:00:00.000Z",
    "timestamp": "2026-01-05T12:00:00.000Z"
  }
}

[MileageDiagnostics] {
  "screen": "ItemDetails:Масло двигателя",
  "query": "getMaxMileageEntry",
  "sortKey": "mileage_km DESC",
  "record": {
    "id": "a1b2c3",
    "mileage_km": 249466,
    "occurred_at": "2026-01-05T12:00:00.000Z",
    "timestamp": "2026-01-05T12:00:00.000Z"
  }
}

[MileageDiagnostics:Comparison] {
  "screen": "ItemDetails:Масло двигателя",
  "comparison": {
    "source1": {
      "query": "getMaxMileageEntry (server)",
      "mileage": 249466
    },
    "source2": {
      "query": "latestOdometer prop (client)",
      "mileage": 249466
    },
    "match": true,
    "diff": 0
  }
}
```

### Пример 2: Production диагностика на Vercel

```bash
# 1. Добавить переменную на Vercel
NEXT_PUBLIC_DIAGNOSTICS=1

# 2. Пересобрать проект

# 3. Просмотреть логи
vercel logs --follow

# Или через Dashboard:
# Vercel Dashboard → Deployments → [deployment] → Logs
```

## Troubleshooting

### Логи не появляются

**Причины**:
1. Диагностика отключена (проверьте `NODE_ENV` и `NEXT_PUBLIC_DIAGNOSTICS`)
2. `screenName` не передан в функцию (проверьте вызовы `getMaxMileageEntry()`)
3. Логи идут в другой поток (проверьте server logs, не client console)

**Решение**:
- Убедитесь, что `NODE_ENV !== 'production'` или `NEXT_PUBLIC_DIAGNOSTICS=1`
- Проверьте, что `screenName` передается в функцию
- Проверьте server logs, а не browser console

### Логи показывают разные ID

**Причина**: Выбраны разные записи (возможно, из-за кэширования или рассинхронизации)

**Решение**:
- Проверьте `sortKey` — должен быть одинаковым
- Проверьте `occurred_at` — могут быть разные даты
- Проверьте, что кэш инвалидируется после добавления записи

### Логи показывают `record: null`

**Причина**: В базе данных нет записей пробега

**Решение**:
- Добавьте хотя бы одну запись пробега
- Проверьте подключение к правильной базе данных
- Проверьте переменные окружения

## Связанные документы

- `docs/forensics/current-mileage-mismatch.md` — описание проблемы расхождения пробега
- `docs/architecture/current-mileage-sources.md` — источники данных для текущего пробега
- `docs/forensics/prod-env-and-supabase-target.md` — диагностика конфигурации окружения

## Дата создания

2026-01-05

## Автор

Diagnostic logging implementation for mileage tracking.

