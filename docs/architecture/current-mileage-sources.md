# P1 — Источники данных для "Текущий пробег"

## Обзор

Документ описывает полную цепочку данных для отображения "Текущий пробег" на всех экранах приложения, от UI-компонента до запроса к базе данных Supabase.

## Определение "Текущий пробег"

**Сущность**: Запись из таблицы `odometer_entries` с максимальным значением `mileage_km`.

**Критерий выбора**: `MAX(mileage_km)` — запись с наибольшим пробегом, независимо от даты (`occurred_at`).

**Фильтры**: Нет фильтров по `carId`, `userId` или другим параметрам. Приложение single-tenant, все записи принадлежат одному пользователю/автомобилю.

## Таблица цепочек данных

| Screen | Component | Data Function | Supabase Query | Sorting/Filter | Cache | State/Context |
|--------|-----------|---------------|----------------|----------------|-------|---------------|
| **Home** (`/`) | `src/app/page.tsx` (Server Component) | `getMaxMileageEntry()` | `SELECT * FROM odometer_entries ORDER BY mileage_km DESC LIMIT 1` | `mileage_km DESC` | ❌ Нет (обход кэша) | Нет |
| **ItemCalc** (`/items/[id]?tab=calc`) | `src/app/items/[id]/page.tsx` (Server) → `ItemDetailsPageClient.tsx` (Client) | `getMaxMileageEntry()` | `SELECT * FROM odometer_entries ORDER BY mileage_km DESC LIMIT 1` | `mileage_km DESC` | ❌ Нет (обход кэша) | Нет |
| **Items List** (`/items`) | `src/app/items/page.tsx` (Server Component) | `getMaxMileageEntry()` | `SELECT * FROM odometer_entries ORDER BY mileage_km DESC LIMIT 1` | `mileage_km DESC` | ❌ Нет (обход кэша) | Нет |

**Вывод**: Все экраны используют **одинаковую** функцию и **одинаковый** запрос к базе данных. Различий в сортировке, фильтрах или кэшировании нет.

## Детальная цепочка данных

### 1. Главная страница (Home)

#### UI-компонент
**Файл**: `src/app/page.tsx`  
**Тип**: Server Component (Next.js App Router)  
**Строки**: 415-419

```typescript
<div className="mileage-card">
  <div className="mileage-label">{RU.home.currentMileage}</div>
  <div className="mileage-value">
    {maxMileageEntry
      ? `${formatNumber(maxMileageEntry.mileage_km)} ${RU.common.km}`
      : RU.home.noEntriesYet}
  </div>
</div>
```

#### Загрузка данных
**Строки**: 43-44, 54-55

```typescript
const maxMileageEntryP = time('home:load-odometer-max', () => 
  profiler.wrap('odometer:getMaxMileage', () => getMaxMileageEntry())
);

const [maxMileageEntry, odometerEntries, serviceItems] = await Promise.all([
  maxMileageEntryP,
  odometerEntriesP,
  serviceItemsP,
]);
```

**Переменная**: `maxMileageEntry?.mileage_km` (строка 79)

#### Функция получения данных
**Файл**: `src/lib/actions/odometerActions.ts`  
**Функция**: `getMaxMileageEntry()`  
**Строки**: 129-134

```typescript
export async function getMaxMileageEntry(): Promise<OdometerEntry | null> {
  // Always bypass cache to ensure fresh data
  // This is critical for accurate current mileage display across all pages
  // The performance impact is minimal as this is a simple query with LIMIT 1
  return await _getMaxMileageEntry();
}
```

#### Внутренняя функция (без кэша)
**Файл**: `src/lib/actions/odometerActions.ts`  
**Функция**: `_getMaxMileageEntry()`  
**Строки**: 101-119

```typescript
async function _getMaxMileageEntry(): Promise<OdometerEntry | null> {
  const supabase = createAdminClient();
  
  const { data, error } = await supabase
    .from('odometer_entries')
    .select('*')
    .order('mileage_km', { ascending: false })
    .limit(1)
    .maybeSingle();
  
  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`Failed to get max mileage entry: ${error.message}`);
  }
  
  return data;
}
```

#### Supabase клиент
**Файл**: `src/lib/supabase/adminClient.ts`  
**Функция**: `createAdminClient()`  
**Тип**: Admin Client (Service Role Key)  
**RLS**: Обходит Row Level Security (RLS)

```typescript
export function createAdminClient() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
```

#### SQL-запрос (эквивалент)
```sql
SELECT *
FROM odometer_entries
ORDER BY mileage_km DESC
LIMIT 1;
```

#### Таблица базы данных
**Таблица**: `odometer_entries`  
**Схема** (из `supabase/migrations/20260101114456_init_milekeeper.sql`):

```sql
CREATE TABLE odometer_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at TIMESTAMPTZ NOT NULL,
  mileage_km INTEGER NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_odometer_entries_mileage_km ON odometer_entries(mileage_km);
```

**Индексы**: 
- `idx_odometer_entries_mileage_km` — для быстрого поиска по пробегу
- `idx_odometer_entries_occurred_at` — для сортировки по дате

**Фильтры**: Нет WHERE-условий. Запрос выбирает из всей таблицы.

**Сортировка**: `ORDER BY mileage_km DESC` — по убыванию пробега.

**Лимит**: `LIMIT 1` — возвращает только одну запись (с максимальным пробегом).

#### Кэширование
**Статус**: ❌ Кэш отключен (после коммита `2e6f64b`)

**История**:
- До исправления: использовался `unstable_cache` с тегом `TAGS.odometer` в production
- После исправления: всегда обходит кэш, запрашивает свежие данные из базы

**Код кэширования** (не используется):
```typescript
// Не используется после исправления
const _getMaxMileageEntryCached = unstable_cache(
  _getMaxMileageEntry,
  ['odometer-max'],
  {
    tags: [TAGS.odometer],
  }
);
```

#### Состояние/Контекст
**Статус**: ❌ Нет состояния или контекста

- Нет React Context для выбора автомобиля
- Нет `selectedCarId` или `userId` в состоянии
- Нет localStorage/SessionStorage
- Нет Service Worker кэширования
- Приложение single-tenant (один пользователь, один автомобиль)

#### Настройки рендеринга
**Файл**: `src/app/page.tsx`  
**Строки**: 19-20

```typescript
export const dynamic = 'force-dynamic';
export const revalidate = 0;
```

**Эффект**: Принудительный динамический рендеринг, отключение статического кэширования.

---

### 2. Страница элемента — вкладка "Расчёт" (ItemCalc)

#### UI-компонент (Client)
**Файл**: `src/app/items/[id]/ItemDetailsPageClient.tsx`  
**Тип**: Client Component  
**Строки**: 247-255

```typescript
{/* Current mileage */}
<div className="calc-block">
  <div className="calc-row">
    <span className="k">{RU.items.details.calcCurrentMileage}</span>
    <span className="v">
      {currentMileage !== null ? `${formatNumber(currentMileage)} ${RU.common.km}` : RU.items.details.calcNoCurrentMileage}
    </span>
  </div>
</div>
```

**Переменная**: `currentMileage` (строка 165)

```typescript
const currentMileage = latestOdometer?.mileage_km ?? null;
```

#### Server Component (провайдер данных)
**Файл**: `src/app/items/[id]/page.tsx`  
**Тип**: Server Component  
**Строки**: 30-31, 47-49

```typescript
// Load parallel data
const [latestOdometer, odometerEntries] = await Promise.all([
  getMaxMileageEntry(),
  listOdometerEntries(50),
]);

return (
  <ItemDetailsPageClient
    item={item}
    latestOdometer={latestOdometer}  // Передается как prop
    lastEvent={lastEvent}
    dailyKmRate={forecastDailyKmRate}
    initialTab={activeTab}
  />
);
```

**Переменная**: `latestOdometer` (результат `getMaxMileageEntry()`)

#### Функция получения данных
**Файл**: `src/lib/actions/odometerActions.ts`  
**Функция**: `getMaxMileageEntry()`  
**Идентична функции для Home** (см. раздел 1)

#### Supabase запрос
**Идентичен запросу для Home** (см. раздел 1)

#### Кэширование
**Статус**: ❌ Кэш отключен (идентично Home)

#### Состояние/Контекст
**Статус**: ❌ Нет состояния или контекста (идентично Home)

**Дополнительно**: Client Component использует React hooks для обновления данных:
- `useEffect` с `router.refresh()` при монтировании (строка 49-62)
- `visibilitychange` event listener для обновления при возврате на вкладку (строка 64-76)

#### Настройки рендеринга
**Файл**: `src/app/items/[id]/page.tsx`  
**Строки**: 8-10

```typescript
export const dynamic = 'force-dynamic';
export const revalidate = 0;
```

**Эффект**: Принудительный динамический рендеринг, отключение статического кэширования.

---

### 3. Список элементов (Items List)

#### UI-компонент
**Файл**: `src/app/items/page.tsx`  
**Тип**: Server Component  
**Использование**: Текущий пробег не отображается напрямую в UI, используется только для расчетов статуса элементов

**Строки**: 42, 54

```typescript
const currentMileage = latestOdometer?.mileage_km ?? null;

// Используется в calcServiceStatus для каждого элемента
itemsWithLastEvent.map(({ item, lastEvent }) => {
  const statusResult = calcServiceStatus({
    serviceItem: item,
    latestOdometerMileageKm: currentMileage,
    lastEvent,
    dailyKmRate,
  });
  // ...
});
```

#### Функция получения данных
**Идентична функции для Home** (см. раздел 1)

#### Supabase запрос
**Идентичен запросу для Home** (см. раздел 1)

---

## Сравнительная таблица

| Аспект | Home | ItemCalc | Items List |
|--------|------|----------|------------|
| **Компонент** | Server Component | Server → Client | Server Component |
| **Функция данных** | `getMaxMileageEntry()` | `getMaxMileageEntry()` | `getMaxMileageEntry()` |
| **Таблица** | `odometer_entries` | `odometer_entries` | `odometer_entries` |
| **Сортировка** | `mileage_km DESC` | `mileage_km DESC` | `mileage_km DESC` |
| **Фильтры** | Нет | Нет | Нет |
| **Лимит** | `LIMIT 1` | `LIMIT 1` | `LIMIT 1` |
| **Кэш** | ❌ Отключен | ❌ Отключен | ❌ Отключен |
| **RLS** | Обход (Admin Client) | Обход (Admin Client) | Обход (Admin Client) |
| **Состояние** | Нет | Нет | Нет |
| **Контекст** | Нет | Нет | Нет |
| **localStorage** | Нет | Нет | Нет |
| **Service Worker** | Нет | Нет | Нет |
| **Dynamic rendering** | `force-dynamic` | `force-dynamic` | `force-dynamic` |

**Вывод**: Все три экрана используют **идентичную** цепочку данных. Различий нет.

## Критерий выбора записи

### Текущая реализация

**Критерий**: Максимальный `mileage_km` из всей таблицы `odometer_entries`.

**SQL-эквивалент**:
```sql
SELECT *
FROM odometer_entries
ORDER BY mileage_km DESC
LIMIT 1;
```

**Логика**: 
- Выбирается запись с наибольшим значением `mileage_km`
- Не зависит от даты (`occurred_at`)
- Не зависит от времени создания (`created_at`)
- Если несколько записей имеют одинаковый максимальный пробег, возвращается одна из них (поведение `LIMIT 1`)

### Альтернативный подход (не используется)

**Критерий**: Последняя запись по дате (`occurred_at`).

**Функция**: `getLatestOdometerEntry()` (не используется для текущего пробега)

**SQL-эквивалент**:
```sql
SELECT *
FROM odometer_entries
ORDER BY occurred_at DESC, mileage_km DESC
LIMIT 1;
```

**Почему не используется**: Если пользователь добавит запись с прошлой датой, но с большим пробегом, она должна считаться "текущим пробегом", так как пробег не может уменьшаться.

## Фильтры и ограничения

### Фильтры по пользователю/автомобилю

**Статус**: ❌ Нет фильтров

**Причина**: Приложение single-tenant:
- Один пользователь
- Один автомобиль
- Все записи принадлежат одному контексту

**Структура таблицы**: В таблице `odometer_entries` нет колонок `user_id`, `car_id` или аналогичных.

### Фильтры по дате

**Статус**: ❌ Нет фильтров

Запрос выбирает из всей таблицы, независимо от даты записи.

### Фильтры по активности

**Статус**: ❌ Нет фильтров

В таблице `odometer_entries` нет колонки `is_active` или `is_deleted`.

## Кэширование

### Next.js `unstable_cache`

**Статус**: ❌ Отключен (после коммита `2e6f64b`)

**История**:
- До исправления: использовался `unstable_cache` с тегом `TAGS.odometer` в production
- Проблема: кэш не обновлялся мгновенно после инвалидации через `revalidateTag()`
- Решение: всегда обходить кэш, запрашивать свежие данные из базы

**Код** (не используется):
```typescript
// src/lib/actions/odometerActions.ts:121-127
const _getMaxMileageEntryCached = unstable_cache(
  _getMaxMileageEntry,
  ['odometer-max'],
  {
    tags: [TAGS.odometer],
  }
);
```

### Next.js Fetch Cache

**Статус**: ❌ Отключен

**Настройки**:
- `export const dynamic = 'force-dynamic'` — принудительный динамический рендеринг
- `export const revalidate = 0` — отключение revalidation

**Эффект**: Страницы всегда рендерятся динамически, без статического кэширования.

### React Cache

**Статус**: ❌ Не используется

Нет использования `cache()` из React для кэширования данных.

### Service Worker

**Статус**: ❌ Не используется

Приложение не использует Service Worker для кэширования данных.

### localStorage / SessionStorage

**Статус**: ❌ Не используется

Текущий пробег не сохраняется в браузерном хранилище.

### Vercel Edge Cache / CDN

**Статус**: ⚠️ Потенциально активен

**Настройки**: Не контролируются напрямую в коде, зависят от настроек Vercel.

**Эффект**: Может кэшировать ответы на уровне CDN, но `force-dynamic` должен это предотвращать.

## Состояние и контекст

### React Context

**Статус**: ❌ Не используется

Нет Context Provider для хранения текущего пробега или выбора автомобиля.

### React State

**Статус**: ❌ Не используется (для текущего пробега)

- Home: Server Component, данные загружаются на сервере
- ItemCalc: Client Component получает данные через props от Server Component
- Items List: Server Component, данные загружаются на сервере

### URL Parameters

**Статус**: ❌ Не используется (для текущего пробега)

Текущий пробег не передается через URL параметры.

### Query Parameters

**Статус**: ⚠️ Используется для cache-busting

**ItemCalc**: При монтировании добавляется параметр `_t` (timestamp) для принудительного обновления:
```typescript
// src/app/items/[id]/ItemDetailsPageClient.tsx:56-59
if (!urlParams.has('_t')) {
  const separator = currentUrl.includes('?') ? '&' : '?';
  router.replace(`${currentUrl}${separator}_t=${Date.now()}`, { scroll: false });
}
```

**Эффект**: Заставляет Next.js перерендерить Server Component с новыми данными.

## Инвалидация кэша

### При добавлении пробега

**Файл**: `src/lib/actions/odometerActions.ts`  
**Функция**: `addOdometerEntry()`  
**Строки**: 189-199

```typescript
// Invalidate cache tags after successful write
revalidateTag(TAGS.odometer, 'max');
revalidateTag(TAGS.odometerEntries, 'max');
revalidateTag(TAGS.home, 'max');
revalidateTag(TAGS.items, 'max');

// Also revalidate paths to ensure immediate UI update
revalidatePath('/', 'page');
revalidatePath('/', 'layout');
revalidatePath('/items', 'page');
revalidatePath('/items', 'layout'); // This invalidates all /items/* dynamic routes
```

**Эффект**: Инвалидирует кэш тегов и путей, но после отключения кэша для `getMaxMileageEntry()` это не критично.

## Выводы

1. **Все экраны используют идентичную цепочку данных**: одна функция, один запрос, одинаковые настройки.

2. **Критерий выбора**: Максимальный `mileage_km`, независимо от даты.

3. **Кэширование**: Отключено для обеспечения свежих данных.

4. **Состояние/Контекст**: Не используется, данные всегда запрашиваются из базы.

5. **Фильтры**: Нет фильтров по пользователю/автомобилю (single-tenant приложение).

6. **Проблема расхождения на production**: Связана с кэшированием на уровне Vercel или задержкой инвалидации кэша, решена отключением кэша для `getMaxMileageEntry()`.

## Связанные документы

- `docs/forensics/current-mileage-mismatch.md` — описание проблемы расхождения пробега
- `src/lib/actions/odometerActions.ts` — реализация функций получения данных
- `supabase/migrations/20260101114456_init_milekeeper.sql` — схема таблицы `odometer_entries`

## Дата создания

2026-01-05

## Автор

Architecture documentation based on code analysis.

