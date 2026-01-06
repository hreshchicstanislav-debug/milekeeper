# P2 — Реестр Supabase-запросов, связанных с пробегом

## Обзор

Документ содержит полный реестр всех функций и запросов, которые читают, пишут или вычисляют данные, связанные с пробегом (mileage/odometer). Цель — выявить рассинхронизацию логики и различия в определении "последней" записи.

## Категории запросов

1. **Чтение текущего пробега** — получение актуального значения пробега
2. **Добавление записи пробега** — создание новой записи в `odometer_entries`
3. **Обновление/удаление записей пробега** — модификация существующих записей
4. **Вычисления среднего пробега/темпа** — расчет среднего дневного пробега
5. **Расчёт overdue/soon** — определение статуса обслуживания на основе пробега
6. **Работа с service events** — события обслуживания, связанные с пробегом

---

## 1. Чтение текущего пробега

### 1.1. `getMaxMileageEntry()` — Максимальный пробег

**Файл**: `src/lib/actions/odometerActions.ts`  
**Функция**: `getMaxMileageEntry()`  
**Строки**: 129-134

**Назначение**: Получить запись с максимальным пробегом (текущий пробег автомобиля).

**Входы**: Нет параметров

**Выходы**: 
- `Promise<OdometerEntry | null>`
- Возвращает `null`, если записей нет

**Supabase запрос**:
```sql
SELECT *
FROM odometer_entries
ORDER BY mileage_km DESC
LIMIT 1;
```

**Сортировка**: `mileage_km DESC` — по убыванию пробега

**Фильтры**: Нет WHERE-условий

**Обработка пустых данных**: 
- Если записей нет (`PGRST116`), возвращает `null`
- Другие ошибки выбрасывают исключение

**Timezone/Date parsing**: Не используется (только сортировка по числовому полю)

**Кэширование**: 
- ❌ Отключено (после коммита `2e6f64b`)
- Всегда запрашивает свежие данные из базы

**Использование**:
- Главная страница (`src/app/page.tsx:44`)
- Страница элемента (`src/app/items/[id]/page.tsx:31`)
- Список элементов (`src/app/items/page.tsx:22`)
- Валидация при добавлении service event (`src/lib/actions/serviceActions.ts:345`)

**Определение "последней"**: По максимальному `mileage_km`, **независимо от даты**.

---

### 1.2. `getLatestOdometerEntry()` — Последняя запись по дате

**Файл**: `src/lib/actions/odometerActions.ts`  
**Функция**: `getLatestOdometerEntry()`  
**Строки**: 87-94

**Назначение**: Получить последнюю запись по дате (`occurred_at`).

**Входы**: Нет параметров

**Выходы**: 
- `Promise<OdometerEntry | null>`
- Возвращает `null`, если записей нет

**Supabase запрос**:
```sql
SELECT *
FROM odometer_entries
ORDER BY occurred_at DESC, mileage_km DESC
LIMIT 1;
```

**Сортировка**: 
1. `occurred_at DESC` — сначала по дате (убывание)
2. `mileage_km DESC` — затем по пробегу (tie-breaker)

**Фильтры**: Нет WHERE-условий

**Обработка пустых данных**: 
- Если записей нет (`PGRST116`), возвращает `null`
- Другие ошибки выбрасывают исключение

**Timezone/Date parsing**: Используется `occurred_at` (TIMESTAMPTZ) для сортировки

**Кэширование**: 
- ✅ Используется в production (`unstable_cache` с тегом `TAGS.odometer`)
- ❌ Обходится в dev режиме

**Использование**:
- Удаление последней записи (`deleteLatestOdometerEntry()`)
- Обновление последней записи (`updateLatestOdometerEntry()`)
- Страница истории (`src/app/history/page.tsx:10`)

**Определение "последней"**: По максимальному `occurred_at`, затем по максимальному `mileage_km` (tie-breaker).

**⚠️ ВАЖНО**: Это **отличается** от `getMaxMileageEntry()`. Если пользователь добавит запись с прошлой датой, но с большим пробегом:
- `getMaxMileageEntry()` вернет запись с большим пробегом
- `getLatestOdometerEntry()` вернет запись с более поздней датой

---

### 1.3. `listOdometerEntries()` — Список записей пробега

**Файл**: `src/lib/actions/odometerActions.ts`  
**Функция**: `listOdometerEntries(limit?: number)`  
**Строки**: 40-50

**Назначение**: Получить список записей пробега для расчетов (средний темп, прогноз).

**Входы**: 
- `limit?: number` — опциональный лимит записей

**Выходы**: 
- `Promise<OdometerEntry[]>`
- Возвращает пустой массив, если записей нет

**Supabase запрос**:
```sql
SELECT *
FROM odometer_entries
ORDER BY occurred_at DESC
LIMIT ?;
```

**Сортировка**: `occurred_at DESC` — по убыванию даты

**Фильтры**: Нет WHERE-условий

**Обработка пустых данных**: 
- Возвращает пустой массив `[]`, если записей нет
- Ошибки выбрасывают исключение

**Timezone/Date parsing**: Используется `occurred_at` для сортировки

**Кэширование**: 
- ✅ Используется `unstable_cache` с тегом `TAGS.odometerEntries`
- Ключ кэша: `odometerEntries:${limit}` или `odometerEntries:all`

**Использование**:
- Главная страница (`src/app/page.tsx:47`) — лимит 50
- Страница элемента (`src/app/items/[id]/page.tsx:32`) — лимит 50
- Список элементов (`src/app/items/page.tsx:25`) — лимит 50
- Вычисления среднего темпа (`estimateDailyKmRate()`, `computeDailyRate()`)

**Определение "последней"**: Первая запись в массиве (самая поздняя по `occurred_at`).

---

## 2. Добавление записи пробега

### 2.1. `addOdometerEntry()` — Добавить новую запись

**Файл**: `src/lib/actions/odometerActions.ts`  
**Функция**: `addOdometerEntry(input: OdometerEntryInput)`  
**Строки**: 142-202

**Назначение**: Добавить новую запись пробега с валидацией монотонности.

**Входы**: 
```typescript
interface OdometerEntryInput {
  occurredAt: Date;
  mileageKm: number;
  note?: string | null;
}
```

**Выходы**: 
- `Promise<OdometerEntry>` — вставленная запись
- Выбрасывает исключение при ошибке валидации

**Валидация**:
1. Запрашивает максимальный пробег из базы:
   ```sql
   SELECT mileage_km
   FROM odometer_entries
   ORDER BY mileage_km DESC
   LIMIT 1;
   ```
2. Проверяет: `input.mileageKm > maxMileage`
3. Если не выполняется, выбрасывает: `"Mileage must be greater than previous entry"`

**Supabase запрос (вставка)**:
```sql
INSERT INTO odometer_entries (occurred_at, mileage_km, note)
VALUES (?, ?, ?)
RETURNING *;
```

**Обработка пустых данных**: 
- Если таблица пуста (`maxMileage === null`), валидация пропускается
- Первая запись всегда принимается

**Timezone/Date parsing**: 
- `input.occurredAt.toISOString()` — конвертация в ISO строку
- База данных: `TIMESTAMPTZ` (timezone-aware)

**Кэширование**: 
- После успешной вставки инвалидирует:
  - Теги: `TAGS.odometer`, `TAGS.odometerEntries`, `TAGS.home`, `TAGS.items`
  - Пути: `/`, `/items` (page и layout)

**Использование**:
- Форма добавления пробега (`src/app/components/AddMileageForm.tsx:42`)

**Примечание**: Валидация использует `MAX(mileage_km)`, что соответствует логике `getMaxMileageEntry()`, но **не** `getLatestOdometerEntry()`.

---

## 3. Обновление/удаление записей пробега

### 3.1. `updateLatestOdometerEntry()` — Обновить последнюю запись

**Файл**: `src/lib/actions/odometerActions.ts`  
**Функция**: `updateLatestOdometerEntry(input)`  
**Строки**: 251-324

**Назначение**: Обновить последнюю запись по дате с валидацией монотонности.

**Входы**: 
```typescript
{
  mileageKm: number;
  occurredAt: Date;
  note?: string | null;
}
```

**Выходы**: 
- `Promise<OdometerEntry>` — обновленная запись
- Выбрасывает исключение при ошибке валидации

**Логика**:
1. Получает последнюю запись по дате: `getLatestOdometerEntry()`
2. Получает вторую последнюю запись для валидации:
   ```sql
   SELECT *
   FROM odometer_entries
   ORDER BY occurred_at DESC, mileage_km DESC
   LIMIT 2;
   ```
3. Валидирует: `input.mileageKm > previousEntry.mileage_km`
4. Обновляет запись по `id`

**Supabase запрос (обновление)**:
```sql
UPDATE odometer_entries
SET mileage_km = ?, occurred_at = ?, note = ?
WHERE id = ?
RETURNING *;
```

**Обработка пустых данных**: 
- Если записей нет, выбрасывает: `"Нет записей для редактирования"`
- Если только одна запись, валидация пропускается

**Timezone/Date parsing**: `input.occurredAt.toISOString()`

**Кэширование**: Инвалидирует теги и пути (как в `addOdometerEntry()`)

**Использование**: 
- Редактирование последней записи (`src/app/components/EditLatestMileage.tsx`)

**⚠️ ВАЖНО**: Использует `getLatestOdometerEntry()` (по дате), а не `getMaxMileageEntry()` (по пробегу). Это может привести к рассинхронизации, если последняя запись по дате не является записью с максимальным пробегом.

---

### 3.2. `deleteLatestOdometerEntry()` — Удалить последнюю запись

**Файл**: `src/lib/actions/odometerActions.ts`  
**Функция**: `deleteLatestOdometerEntry()`  
**Строки**: 209-242

**Назначение**: Удалить последнюю запись по дате (самая безопасная операция удаления).

**Входы**: Нет параметров

**Выходы**: 
- `Promise<string>` — ID удаленной записи
- Выбрасывает исключение, если записей нет

**Логика**:
1. Получает последнюю запись по дате: `getLatestOdometerEntry()`
2. Удаляет запись по `id`:
   ```sql
   DELETE FROM odometer_entries
   WHERE id = ?;
   ```

**Обработка пустых данных**: 
- Если записей нет, выбрасывает: `"Нет записей для удаления"`

**Кэширование**: Инвалидирует теги и пути

**Использование**: 
- Удаление последней записи (`src/app/components/DeleteLatestMileage.tsx`)

**⚠️ ВАЖНО**: Удаляет последнюю запись **по дате**, а не по пробегу. Если последняя запись по дате не является записью с максимальным пробегом, удаление может привести к неожиданному изменению "текущего пробега".

---

## 4. Вычисления среднего пробега/темпа

### 4.1. `estimateDailyKmRate()` — Оценка среднего дневного пробега

**Файл**: `src/lib/service/odometerForecast.ts`  
**Функция**: `estimateDailyKmRate(entries: OdometerEntry[], opts?)`  
**Строки**: 28-86

**Назначение**: Вычислить средний дневной пробег для прогнозирования сроков обслуживания.

**Входы**: 
- `entries: OdometerEntry[]` — массив записей, отсортированный по `occurred_at DESC` (новые первые)
- `opts?: EstimateOptions` — опции (по умолчанию: `maxDays=14`, `maxEntries=20`, `fallbackDailyKm=30`)

**Выходы**: 
```typescript
interface EstimateResult {
  dailyKmRate: number; // Всегда > 0 (никогда null)
  isFallback: boolean; // true, если использован fallback
}
```

**Алгоритм**:
1. Если записей < 2, возвращает fallback (30 км/день)
2. Берет самую новую запись (первая в массиве)
3. Вычисляет cutoff date: `newestDate - maxDays` (по умолчанию 14 дней)
4. Фильтрует записи в окне времени и ограничивает до `maxEntries`
5. Сортирует по возрастанию даты для расчета
6. Вычисляет: `deltaKm / deltaDays`
7. Валидирует результат (1-1500 км/день), иначе fallback

**Обработка пустых данных**: 
- Если записей < 2, возвращает fallback
- Если в окне < 2 записей, возвращает fallback
- Если `deltaDays < 1` или `deltaKm <= 0`, возвращает fallback

**Timezone/Date parsing**: 
- Использует `new Date(entry.occurred_at)` для парсинга
- Вычисляет разницу в миллисекундах, затем конвертирует в дни

**Кэширование**: Не используется (чистая функция)

**Использование**:
- Главная страница (`src/app/page.tsx:88`) — для прогноза "Скоро обслуживание"
- Страница элемента (`src/app/items/[id]/page.tsx:40`) — для расчетов
- `calcServiceStatus()` — для прогноза дней до замены

**Fallback стратегия**: 30 км/день, если недостаточно данных.

---

### 4.2. `computeDailyRate()` — Медианный дневной пробег

**Файл**: `src/lib/prediction/dailyRate.ts`  
**Функция**: `computeDailyRate(entries: OdometerEntry[])`  
**Строки**: 16-61

**Назначение**: Вычислить медианный дневной пробег из последних записей (для оценки уверенности прогноза).

**Входы**: 
- `entries: OdometerEntry[]` — массив записей, отсортированный по `occurred_at DESC`

**Выходы**: 
- `number | null` — медианный км/день или `null`, если недостаточно данных

**Алгоритм**:
1. Фильтрует записи за последние 60 дней
2. Берет последние 10 записей
3. Сортирует по возрастанию даты
4. Вычисляет км/день для каждой пары последовательных записей
5. Возвращает медиану всех значений

**Обработка пустых данных**: 
- Если записей < 2, возвращает `null`
- Если в окне < 2 записей, возвращает `null`
- Если нет валидных пар (daysDiff <= 0 или kmDiff <= 0), возвращает `null`

**Timezone/Date parsing**: Аналогично `estimateDailyKmRate()`

**Кэширование**: Не используется (чистая функция)

**Использование**:
- Главная страница (`src/app/page.tsx:83`) — для отображения среднего темпа
- `computeConfidence()` — для оценки уверенности прогноза

**Различия с `estimateDailyKmRate()`**:
- Использует медиану вместо среднего
- Окно: 60 дней, 10 записей (vs 14 дней, 20 записей)
- Возвращает `null` вместо fallback

---

### 4.3. `getDaysSinceLastEntry()` — Дней с последней записи

**Файл**: `src/lib/prediction/dailyRate.ts`  
**Функция**: `getDaysSinceLastEntry(entries: OdometerEntry[])`  
**Строки**: 68-78

**Назначение**: Вычислить количество дней с момента последней записи пробега.

**Входы**: 
- `entries: OdometerEntry[]` — массив записей, отсортированный по `occurred_at DESC`

**Выходы**: 
- `number | null` — количество дней или `null`, если записей нет

**Алгоритм**:
1. Берет первую запись (самая новая)
2. Вычисляет разницу: `now - lastEntryDate`
3. Конвертирует в дни (округление вниз)

**Обработка пустых данных**: 
- Если записей нет, возвращает `null`

**Timezone/Date parsing**: Использует `new Date(entry.occurred_at)`

**Кэширование**: Не используется (чистая функция)

**Использование**:
- `computeConfidence()` — для оценки уверенности прогноза

---

## 5. Расчёт overdue/soon

### 5.1. `calcServiceStatus()` — Статус обслуживания

**Файл**: `src/lib/service/calcServiceStatus.ts`  
**Функция**: `calcServiceStatus(input: CalcInput)`  
**Строки**: 62-428

**Назначение**: Вычислить статус обслуживания (OVERDUE, SOON, OK, UNKNOWN) на основе пробега и даты.

**Входы**: 
```typescript
interface CalcInput {
  serviceItem: ServiceItem;
  latestOdometerMileageKm: number | null; // Текущий пробег (из getMaxMileageEntry())
  lastEvent: ServiceEvent | null;
  dailyKmRate?: number | null; // Средний дневной темп (из estimateDailyKmRate())
  now?: Date; // Опционально, по умолчанию new Date()
}
```

**Выходы**: 
```typescript
interface ServiceStatusResult {
  status: 'OVERDUE' | 'SOON' | 'OK' | 'UNKNOWN';
  remainingKm: number | null;
  remainingDays: number | null;
  // ... другие поля
}
```

**Логика расчета `remainingKm`** (строка 100-102):
```typescript
if (serviceItem.interval_km !== null && latestOdometerMileageKm !== null) {
  dueMileageKm = lastServiceMileage + serviceItem.interval_km;
  remainingKm = dueMileageKm - latestOdometerMileageKm;
}
```

**Логика расчета `remainingDays`** (для km-mode, строка 116-149):
```typescript
if (remainingKm !== null && Number.isFinite(remainingKm)) {
  let rateToUse = dailyKmRate ?? 30; // Fallback: 30 км/день
  predictedDaysFromKm = remainingKm / rateToUse;
  remainingDays = predictedDaysFromKm; // Может быть отрицательным (overdue)
}
```

**Обработка пустых данных**: 
- Если `lastEvent === null`, возвращает `status: 'UNKNOWN'`
- Если `latestOdometerMileageKm === null`, `remainingKm = null`
- Если `dailyKmRate === null`, используется fallback 30 км/день

**Timezone/Date parsing**: 
- Использует `new Date(lastEvent.occurred_at)` для парсинга даты последней замены
- Использует `now` (по умолчанию `new Date()`) для текущей даты

**Кэширование**: Не используется (чистая функция)

**Использование**:
- Главная страница (`src/app/page.tsx:126`) — для каждого элемента
- Страница элемента (`src/app/items/[id]/ItemDetailsPageClient.tsx:127`) — для расчетов
- Список элементов (`src/app/items/page.tsx:54`) — для статусов

**⚠️ ВАЖНО**: Использует `latestOdometerMileageKm` (из `getMaxMileageEntry()`), что гарантирует согласованность с отображением "текущего пробега" на главной странице.

---

## 6. Работа с service events

### 6.1. `addServiceEvent()` — Добавить событие обслуживания

**Файл**: `src/lib/actions/serviceActions.ts`  
**Функция**: `addServiceEvent(input: ServiceEventInput)`  
**Строки**: 334-395

**Назначение**: Добавить событие обслуживания (замену) с валидацией пробега.

**Входы**: 
```typescript
interface ServiceEventInput {
  serviceItemId: string;
  occurredAt: Date;
  mileageKm?: number; // Обязательно (валидируется)
  note?: string | null;
}
```

**Выходы**: 
- `Promise<ServiceEvent>` — вставленное событие
- Выбрасывает исключение при ошибке валидации

**Валидация пробега**:
1. Запрашивает максимальный пробег: `getMaxMileageEntry()`
2. Проверяет: `input.mileageKm <= maxMileageEntry.mileage_km`
3. Если не выполняется, выбрасывает: `"Пробег замены не может быть больше текущего пробега"`

**Supabase запрос (вставка)**:
```sql
INSERT INTO service_events (service_item_id, occurred_at, mileage_km, note)
VALUES (?, ?, ?, ?)
RETURNING *;
```

**Обработка пустых данных**: 
- Если `mileageKm === undefined || null`, выбрасывает: `"Mileage required"`
- Если `maxMileageEntry === null`, выбрасывает: `"Сначала добавьте пробег (одометр)"`

**Timezone/Date parsing**: `input.occurredAt.toISOString()`

**Кэширование**: Инвалидирует теги и пути

**Использование**: 
- Форма отметки замены (`src/app/components/AddServiceEventForm.tsx`)

**⚠️ ВАЖНО**: Валидация использует `getMaxMileageEntry()`, что гарантирует согласованность с "текущим пробегом" на главной странице.

---

### 6.2. `listLastServiceEventsForItems()` — Последние события обслуживания

**Файл**: `src/lib/actions/serviceActions.ts`  
**Функция**: `listLastServiceEventsForItems(itemIds: string[])`  
**Строки**: 512-528

**Назначение**: Получить последнее событие обслуживания для каждого элемента (для расчета статуса).

**Входы**: 
- `itemIds: string[]` — массив ID элементов обслуживания

**Выходы**: 
- `Promise<Record<string, ServiceEvent | null>>` — карта `itemId -> lastEvent`

**Supabase запрос (RPC)**:
```sql
-- Функция: get_last_service_events_for_items(item_ids UUID[])
SELECT DISTINCT ON (service_item_id)
  id, service_item_id, occurred_at, mileage_km, note, created_at
FROM service_events
WHERE service_item_id = ANY(item_ids)
ORDER BY service_item_id, occurred_at DESC, mileage_km DESC;
```

**Сортировка**: 
1. `service_item_id` — группировка по элементу
2. `occurred_at DESC` — сначала по дате (убывание)
3. `mileage_km DESC` — затем по пробегу (tie-breaker)

**Fallback запрос** (если RPC недоступен):
```sql
SELECT *
FROM service_events
WHERE service_item_id IN (?)
ORDER BY service_item_id, occurred_at DESC, mileage_km DESC;
```
Затем в JS берется первое событие для каждого `service_item_id`.

**Обработка пустых данных**: 
- Если `itemIds.length === 0`, возвращает `{}`
- Если для элемента нет событий, значение в карте: `null`

**Timezone/Date parsing**: Используется `occurred_at` для сортировки

**Кэширование**: 
- ✅ Используется `unstable_cache` с тегом `TAGS.serviceEvents`
- Ключ кэша: `serviceEvents:lastForItems:${sortedIds}`

**Использование**:
- Главная страница (`src/app/page.tsx:66`) — для всех элементов
- Страница элемента (`src/app/items/[id]/page.tsx:36`) — для одного элемента
- Список элементов (`src/app/items/page.tsx:35`) — для всех элементов

**Определение "последней"**: По максимальному `occurred_at`, затем по максимальному `mileage_km` (tie-breaker).

**⚠️ ВАЖНО**: Для service events "последняя" определяется по дате (`occurred_at`), а не по пробегу. Это может привести к рассинхронизации, если событие с более поздней датой имеет меньший пробег, чем событие с более ранней датой.

---

## Сравнительная таблица: Определение "последней" записи

| Функция | Критерий "последней" | Сортировка | Использование |
|---------|---------------------|------------|---------------|
| `getMaxMileageEntry()` | Максимальный `mileage_km` | `mileage_km DESC` | Текущий пробег (Home, ItemCalc) |
| `getLatestOdometerEntry()` | Максимальный `occurred_at` | `occurred_at DESC, mileage_km DESC` | Удаление/обновление последней записи |
| `listOdometerEntries()` | Максимальный `occurred_at` | `occurred_at DESC` | Список для расчетов |
| `listLastServiceEventsForItems()` | Максимальный `occurred_at` | `occurred_at DESC, mileage_km DESC` | Последнее событие обслуживания |

**Вывод**: Существует **рассинхронизация** в определении "последней" записи:
- Для **текущего пробега** используется максимальный `mileage_km`
- Для **удаления/обновления** используется максимальный `occurred_at`
- Для **service events** используется максимальный `occurred_at`

Это может привести к неожиданному поведению, если пользователь добавит запись с прошлой датой, но с большим пробегом.

---

## Группировка по категориям использования

### Чтение текущего пробега
1. `getMaxMileageEntry()` — максимальный пробег (используется везде для отображения)
2. `getLatestOdometerEntry()` — последняя запись по дате (используется для удаления/обновления)

### Добавление/модификация записей пробега
1. `addOdometerEntry()` — добавление с валидацией по `MAX(mileage_km)`
2. `updateLatestOdometerEntry()` — обновление последней по дате
3. `deleteLatestOdometerEntry()` — удаление последней по дате

### Вычисления среднего пробега/темпа
1. `estimateDailyKmRate()` — средний дневной темп (14 дней, 20 записей, fallback 30)
2. `computeDailyRate()` — медианный дневной темп (60 дней, 10 записей, без fallback)
3. `getDaysSinceLastEntry()` — дней с последней записи

### Расчёт overdue/soon
1. `calcServiceStatus()` — статус обслуживания на основе пробега и даты

### Работа с service events
1. `addServiceEvent()` — добавление с валидацией по `getMaxMileageEntry()`
2. `listLastServiceEventsForItems()` — последние события по дате

---

## Заметки о рассинхронизации

### 1. Различия в определении "последней" записи

**Проблема**: `getMaxMileageEntry()` и `getLatestOdometerEntry()` возвращают разные записи, если:
- Пользователь добавил запись с прошлой датой, но с большим пробегом
- Или наоборот: запись с будущей датой, но с меньшим пробегом

**Последствия**:
- "Текущий пробег" на главной странице может отличаться от "последней записи" в истории
- Удаление "последней записи" может не удалить запись с максимальным пробегом

**Решение**: Использовать `getMaxMileageEntry()` везде, где нужен "текущий пробег", и явно документировать различие.

### 2. Различия в определении "последнего" service event

**Проблема**: `listLastServiceEventsForItems()` использует `occurred_at DESC`, а не `mileage_km DESC`.

**Последствия**:
- Если пользователь отметил замену с прошлой датой, но с большим пробегом, она может не считаться "последней"
- Это может привести к неправильному расчету статуса обслуживания

**Решение**: Для km-mode элементов использовать `mileage_km DESC` вместо `occurred_at DESC` (уже реализовано в некоторых местах, но не везде).

### 3. Различия в fallback стратегиях

**Проблема**: 
- `estimateDailyKmRate()` возвращает fallback (30 км/день), если недостаточно данных
- `computeDailyRate()` возвращает `null`, если недостаточно данных

**Последствия**: Разные функции могут давать разные результаты при недостатке данных.

**Решение**: Унифицировать fallback стратегию или явно документировать различия.

---

## Связанные документы

- `docs/architecture/current-mileage-sources.md` — источники данных для текущего пробега
- `docs/forensics/current-mileage-mismatch.md` — описание проблемы расхождения пробега
- `src/lib/actions/odometerActions.ts` — реализация функций работы с пробегом
- `supabase/migrations/20260101160000_add_get_last_service_events_rpc.sql` — RPC функция для service events

---

## Дата создания

2026-01-05

## Автор

Registry based on comprehensive code analysis.

