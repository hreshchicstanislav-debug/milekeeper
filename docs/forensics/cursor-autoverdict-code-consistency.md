# P7 — Автопроверка: Вердикт о консистентности кода для current mileage

## Обзор

Документ содержит результат автоматической проверки кодовой базы на предмет возможности расхождения пробега между экранами Home и ItemCalc. Проверка выполнена без участия человека, на основе анализа исходного кода.

## Вердикт

**КОД ИСКЛЮЧАЕТ РАССИНХРОН**

При одинаковом окружении (одна и та же база данных, одни и те же переменные окружения) Home и ItemCalc **не могут** показать разный current mileage из-за кода.

## Обоснование

### 1. Единая функция для всех экранов

**Функция**: `getMaxMileageEntry()`  
**Файл**: `src/lib/actions/odometerActions.ts:145-167`

**Использование**:
- **Home** (`src/app/page.tsx:44`): `getMaxMileageEntry('Home')`
- **ItemCalc** (`src/app/items/[id]/page.tsx:31`): `getMaxMileageEntry('ItemDetails:${item.title}')`
- **ItemsList** (`src/app/items/page.tsx:22`): `getMaxMileageEntry('ItemsList')`

**Вывод**: Все экраны используют **одну и ту же функцию** без различий в реализации.

### 2. Одинаковый запрос к базе данных

**Внутренняя функция**: `_getMaxMileageEntry()`  
**Файл**: `src/lib/actions/odometerActions.ts:117-135`

**Запрос**:
```typescript
const { data, error } = await supabase
  .from('odometer_entries')
  .select('*')
  .order('mileage_km', { ascending: false })
  .limit(1)
  .maybeSingle();
```

**SQL эквивалент**:
```sql
SELECT *
FROM odometer_entries
ORDER BY mileage_km DESC
LIMIT 1;
```

**Вывод**: Запрос **идентичен** для всех экранов. Сортировка всегда по `mileage_km DESC`, без дополнительных фильтров.

### 3. Отсутствие фильтров

**Проверено**:
- ❌ Нет фильтров по `car_id` (колонка отсутствует в таблице)
- ❌ Нет фильтров по `user_id` (колонка отсутствует в таблице)
- ❌ Нет фильтров по `occurred_at` (дате)
- ❌ Нет фильтров по `is_active` или `is_deleted` (колонки отсутствуют)
- ❌ Нет `.where()` условий

**Структура таблицы** (`supabase/migrations/20260101114456_init_milekeeper.sql:9-15`):
```sql
CREATE TABLE odometer_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at TIMESTAMPTZ NOT NULL,
  mileage_km INTEGER NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Вывод**: Запрос выбирает из **всей таблицы** без ограничений. Приложение single-tenant, все записи принадлежат одному контексту.

### 4. Отсутствие кэширования

**Реализация** (`src/lib/actions/odometerActions.ts:145-149`):
```typescript
export async function getMaxMileageEntry(screenName?: string): Promise<OdometerEntry | null> {
  // Always bypass cache to ensure fresh data
  // This is critical for accurate current mileage display across all pages
  // The performance impact is minimal as this is a simple query with LIMIT 1
  const result = await _getMaxMileageEntry();
  // ...
}
```

**Проверено**:
- ❌ Не используется `_getMaxMileageEntryCached` (определен, но не вызывается)
- ❌ Нет условий по `NODE_ENV` для выбора кэшированной/некэшированной версии
- ✅ Всегда вызывается `_getMaxMileageEntry()` напрямую

**Кэш определен, но не используется** (`src/lib/actions/odometerActions.ts:137-143`):
```typescript
const _getMaxMileageEntryCached = unstable_cache(
  _getMaxMileageEntry,
  ['odometer-max'],
  {
    tags: [TAGS.odometer],
  }
);
// НЕ ИСПОЛЬЗУЕТСЯ в getMaxMileageEntry()
```

**Вывод**: Кэш **полностью обходится**. Каждый вызов выполняет прямой запрос к базе данных.

### 5. Одинаковый Supabase клиент

**Клиент**: `createAdminClient()`  
**Файл**: `src/lib/supabase/adminClient.ts:26-58`

**Использование**:
- `_getMaxMileageEntry()` использует `createAdminClient()` (строка 118)
- Все запросы используют один и тот же клиент

**Проверено**:
- ✅ Одинаковые переменные окружения: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- ✅ Нет различий в конфигурации клиента
- ✅ Нет условий по `NODE_ENV` для выбора разных клиентов

**Вывод**: Все запросы используют **один и тот же клиент** с одинаковой конфигурацией.

### 6. Отсутствие ветвления логики

**Проверено**:
- ❌ Нет условий `if (NODE_ENV === 'production')` в `getMaxMileageEntry()`
- ❌ Нет условий `if (process.env.VERCEL)` или других флагов окружения
- ❌ Нет различий в логике для разных экранов
- ❌ Нет трансформации данных после получения из базы

**Код функции** (`src/lib/actions/odometerActions.ts:145-167`):
```typescript
export async function getMaxMileageEntry(screenName?: string): Promise<OdometerEntry | null> {
  // Always bypass cache to ensure fresh data
  const result = await _getMaxMileageEntry();
  
  // Diagnostic logging (only in dev/preview or when NEXT_PUBLIC_DIAGNOSTICS=1)
  if (screenName) {
    logMileageQuery({ /* ... */ });
  }
  
  return result; // Возвращает результат БЕЗ изменений
}
```

**Вывод**: Логика **детерминирована** и не зависит от окружения или экрана.

### 7. Force dynamic rendering

**Home** (`src/app/page.tsx:18-20`):
```typescript
export const dynamic = 'force-dynamic';
export const revalidate = 0;
```

**ItemDetails** (`src/app/items/[id]/page.tsx:8-10`):
```typescript
export const dynamic = 'force-dynamic';
export const revalidate = 0;
```

**Вывод**: Оба экрана используют **динамический рендеринг** без статического кэширования Next.js.

### 8. Отсутствие трансформации данных на клиенте

**ItemDetailsPageClient** (`src/app/items/[id]/ItemDetailsPageClient.tsx:165-166`):
```typescript
const currentMileage = latestOdometer?.mileage_km ?? null;
```

**Проверено**:
- ✅ Данные передаются как prop от server component
- ✅ Нет дополнительных запросов к API на клиенте
- ✅ Нет трансформации или вычислений на основе других данных
- ✅ Простое извлечение `mileage_km` из объекта

**Вывод**: Данные **не изменяются** между server component и client component.

## Теоретическая возможность рассинхрона

### Race condition на уровне базы данных

**Сценарий**: Если между двумя запросами к базе данных (Home и ItemCalc) произойдет изменение данных (добавление новой записи), то теоретически возможна ситуация:
1. Home запрашивает данные → получает запись A (mileage_km = 249466)
2. Пользователь добавляет новую запись B (mileage_km = 250000)
3. ItemCalc запрашивает данные → получает запись B (mileage_km = 250000)

**Вердикт**: Это **не проблема кода**, а проблема **timing/data consistency**. Код работает корректно, просто данные изменились между запросами.

**Вероятность**: Крайне низкая, так как:
- Оба запроса выполняются в рамках одного рендера страницы
- Пользователь не может добавить запись между двумя запросами в рамках одного HTTP-запроса
- Если пользователь добавляет запись, страница обновляется через `revalidatePath()`

## Сравнение с другими функциями

### `getLatestOdometerEntry()` — НЕ используется для current mileage

**Функция**: `getLatestOdometerEntry()`  
**Файл**: `src/lib/actions/odometerActions.ts:88-110`

**Отличие**: Сортирует по `occurred_at DESC`, а не по `mileage_km DESC`.

**Использование**: Используется только в `src/app/history/page.tsx` для отображения последней записи по дате, **не для current mileage**.

**Вывод**: Не является источником рассинхрона, так как не используется для current mileage.

## Заключение

### Код исключает рассинхрон

**Доказательства**:
1. ✅ Одна функция для всех экранов
2. ✅ Одинаковый запрос к базе данных
3. ✅ Отсутствие фильтров
4. ✅ Отсутствие кэширования
5. ✅ Одинаковый Supabase клиент
6. ✅ Отсутствие ветвления логики
7. ✅ Force dynamic rendering
8. ✅ Отсутствие трансформации данных

### Если расхождение наблюдается

Если на production наблюдается расхождение пробега между Home и ItemCalc, возможные причины **вне кода**:

1. **Разные базы данных**: Home и ItemCalc обращаются к разным Supabase проектам
   - Проверка: `docs/forensics/prod-env-and-supabase-target.md`

2. **Проблемы с переменными окружения**: Неправильные `SUPABASE_URL` или `SUPABASE_SERVICE_ROLE_KEY`
   - Проверка: Vercel Dashboard → Settings → Environment Variables

3. **RLS (Row Level Security)**: Если RLS включен и настроен неправильно (маловероятно, так как используется admin client)
   - Проверка: Supabase Dashboard → Authentication → Policies

4. **Race condition на уровне базы**: Данные изменились между запросами (крайне маловероятно)
   - Проверка: Диагностические логи (`docs/forensics/diagnostics-current-mileage.md`)

5. **Проблемы с CDN/Edge Cache**: Vercel CDN кэширует старые данные (маловероятно при `force-dynamic`)
   - Проверка: Vercel Dashboard → Deployments → Cache

## Ссылки на код

### Ключевые файлы

1. **Функция получения пробега**:
   - `src/lib/actions/odometerActions.ts:117-167`
   - `_getMaxMileageEntry()`: строки 117-135
   - `getMaxMileageEntry()`: строки 145-167

2. **Использование на Home**:
   - `src/app/page.tsx:44` — вызов `getMaxMileageEntry('Home')`
   - `src/app/page.tsx:79` — извлечение `currentMileage`

3. **Использование на ItemDetails**:
   - `src/app/items/[id]/page.tsx:31` — вызов `getMaxMileageEntry('ItemDetails:${item.title}')`
   - `src/app/items/[id]/ItemDetailsPageClient.tsx:165-166` — извлечение `currentMileage`

4. **Supabase клиент**:
   - `src/lib/supabase/adminClient.ts:26-58` — `createAdminClient()`

5. **Структура таблицы**:
   - `supabase/migrations/20260101114456_init_milekeeper.sql:9-15` — `odometer_entries`

### Связанные документы

- `docs/architecture/current-mileage-sources.md` — источники данных для current mileage
- `docs/architecture/mileage-queries-registry.md` — реестр всех запросов, связанных с пробегом
- `docs/forensics/current-mileage-mismatch.md` — описание симптома расхождения
- `docs/forensics/prod-env-and-supabase-target.md` — диагностика окружения
- `docs/forensics/diagnostics-current-mileage.md` — диагностические логи

## Дата проверки

2026-01-05

## Метод проверки

Автоматический анализ исходного кода с использованием:
- `grep` для поиска всех использований функций
- `read_file` для анализа реализации
- `codebase_search` для поиска условных ветвлений и фильтров
- Сравнение кода между экранами

## Вердикт (финальный)

**КОД ИСКЛЮЧАЕТ РАССИНХРОН**

При одинаковом окружении (одна и та же база данных, одни и те же переменные окружения) Home и ItemCalc **не могут** показать разный current mileage из-за кода.

Если расхождение наблюдается, причина находится **вне кода** (разные базы данных, неправильные переменные окружения, проблемы с RLS/CDN, или race condition на уровне базы данных).

