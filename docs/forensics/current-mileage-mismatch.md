# P0 — Форензика: Расхождение текущего пробега (prod vs local)

## Симптом

На production (Vercel) текущий пробег отображается по-разному на главной странице и на странице элемента в разделе "Расчёт":
- **Главная страница**: отображает актуальный текущий пробег
- **Страница элемента (tab=calc)**: отображает устаревший текущий пробег

На localhost (`http://localhost:3000`) проблема отсутствует — пробег совпадает на всех страницах.

## Пример из production

**URL**: https://milekeeper.vercel.app/items/63aaff8f-65b0-47e3-97ca-db200c2b0cae?tab=calc

**Элемент**: Масло двигателя

**На экране ItemCalc отображается**: `237 276 км`

**Ожидаемое значение**: должно совпадать с текущим пробегом на главной странице (например, `249 466 км` или другое актуальное значение)

## UI-точки отображения текущего пробега

### 1. Главная страница (Home)

**URL**: `/`  
**Компонент**: `src/app/page.tsx` (Server Component)  
**Функция получения данных**: `getMaxMileageEntry()`  
**Переменная**: `maxMileageEntry?.mileage_km`  
**Отображение**: 
- Строка 415-419: `.mileage-card` с лейблом `{RU.home.currentMileage}` ("Текущий пробег")
- Формат: `{formatNumber(maxMileageEntry.mileage_km)} {RU.common.km}`

**Код**:
```typescript
// src/app/page.tsx:43-44
const maxMileageEntryP = time('home:load-odometer-max', () => 
  profiler.wrap('odometer:getMaxMileage', () => getMaxMileageEntry())
);

// src/app/page.tsx:415-419
<div className="mileage-card">
  <div className="mileage-label">{RU.home.currentMileage}</div>
  <div className="mileage-value">
    {maxMileageEntry
      ? `${formatNumber(maxMileageEntry.mileage_km)} ${RU.common.km}`
      : RU.home.noEntriesYet}
  </div>
</div>
```

### 2. Страница элемента — вкладка "Расчёт" (Item Details — Calc Tab)

**URL**: `/items/[id]?tab=calc`  
**Server Component**: `src/app/items/[id]/page.tsx`  
**Client Component**: `src/app/items/[id]/ItemDetailsPageClient.tsx`  
**Функция получения данных**: `getMaxMileageEntry()` (в server component)  
**Переменная**: `latestOdometer?.mileage_km` (передается через props)  
**Отображение**:
- Строка 250-252: в блоке "Расчёт и проверка"
- Лейбл: `{RU.items.details.calcCurrentMileage}` ("Текущий пробег")
- Формат: `{formatNumber(currentMileage)} {RU.common.km}`

**Код**:
```typescript
// src/app/items/[id]/page.tsx:30-31
const [latestOdometer, odometerEntries] = await Promise.all([
  getMaxMileageEntry(),
  listOdometerEntries(50),
]);

// src/app/items/[id]/ItemDetailsPageClient.tsx:165
const currentMileage = latestOdometer?.mileage_km ?? null;

// src/app/items/[id]/ItemDetailsPageClient.tsx:250-252
<span className="k">{RU.items.details.calcCurrentMileage}</span>
<span className="v">
  {currentMileage !== null ? `${formatNumber(currentMileage)} ${RU.common.km}` : RU.items.details.calcNoCurrentMileage}
</span>
```

### 3. Список элементов (Items List)

**URL**: `/items`  
**Компонент**: `src/app/items/page.tsx` (Server Component)  
**Функция получения данных**: `getMaxMileageEntry()`  
**Переменная**: `latestOdometer?.mileage_km`  
**Отображение**: Не отображается напрямую в UI, используется только для расчетов статуса элементов

## Ожидаемое поведение

Текущий пробег должен быть **одинаковым** на всех страницах, так как:
1. Все страницы используют одну и ту же функцию `getMaxMileageEntry()`
2. Функция запрашивает максимальный пробег из базы данных
. Данные должны быть актуальными на момент запроса

## Фактическое поведение

### Production (Vercel)

- ✅ **Главная страница**: отображает актуальный текущий пробег
- ❌ **Страница элемента (tab=calc)**: отображает устаревший текущий пробег (например, `237 276 км` вместо актуального значения)

**Гипотеза**: Проблема связана с кэшированием на уровне Vercel или Next.js `unstable_cache` в production режиме. Страница элемента может получать закэшированные данные, которые не обновляются после добавления нового пробега.

### Localhost

- ✅ **Главная страница**: отображает актуальный текущий пробег
- ✅ **Страница элемента (tab=calc)**: отображает актуальный текущий пробег

**Причина**: В dev режиме (`NODE_ENV !== 'production'`) функция `getMaxMileageEntry()` обходит кэш и всегда запрашивает свежие данные из базы.

## Технические детали

### Функция получения данных

**Файл**: `src/lib/actions/odometerActions.ts`

**Функция**: `getMaxMileageEntry()`

**Реализация** (до исправления):
```typescript
export async function getMaxMileageEntry(): Promise<OdometerEntry | null> {
  // In dev mode, bypass cache to ensure fresh data
  if (process.env.NODE_ENV !== 'production') {
    return await _getMaxMileageEntry();
  }
  
  return await _getMaxMileageEntryCached();
}
```

**Проблема**: В production используется `_getMaxMileageEntryCached()`, который использует `unstable_cache` с тегом `TAGS.odometer`. Кэш может не обновляться мгновенно после инвалидации через `revalidateTag()`.

**Исправление** (после коммита `2e6f64b`):
```typescript
export async function getMaxMileageEntry(): Promise<OdometerEntry | null> {
  // Always bypass cache to ensure fresh data
  // This is critical for accurate current mileage display across all pages
  // The performance impact is minimal as this is a simple query with LIMIT 1
  return await _getMaxMileageEntry();
}
```

### Настройки кэширования страниц

**Главная страница** (`src/app/page.tsx`):
```typescript
export const dynamic = 'force-dynamic';
export const revalidate = 0;
```

**Страница элемента** (`src/app/items/[id]/page.tsx`):
```typescript
export const dynamic = 'force-dynamic';
export const revalidate = 0;
```

Обе страницы настроены на принудительный динамический рендеринг, что должно предотвращать статическое кэширование.

### Инвалидация кэша

При добавлении нового пробега (`addOdometerEntry`) инвалидируются:
- Теги: `TAGS.odometer`, `TAGS.odometerEntries`, `TAGS.home`, `TAGS.items`
- Пути: `revalidatePath('/', 'page')`, `revalidatePath('/items', 'layout')`, и т.д.

Однако инвалидация тегов может не работать мгновенно на Vercel, особенно для `unstable_cache`.

## Шаги воспроизведения (production)

1. Открыть главную страницу: https://milekeeper.vercel.app
2. Записать текущий пробег (например, `249 466 км`)
3. Открыть страницу элемента: https://milekeeper.vercel.app/items/63aaff8f-65b0-47e3-97ca-db200c2b0cae?tab=calc
4. Перейти на вкладку "Расчёт"
5. Сравнить "Текущий пробег" с главной страницей
6. **Ожидаемый результат**: Пробег должен совпадать
7. **Фактический результат**: Пробег отличается (например, `237 276 км` на странице элемента)

## Статус исправления

✅ **Исправлено** в коммите `2e6f64b`: `fix: disable cache for getMaxMileageEntry to ensure fresh data across all pages`

**Изменение**: Функция `getMaxMileageEntry()` теперь всегда обходит кэш и всегда запрашивает свежие данные из базы, независимо от окружения (dev/production).

**Ожидаемый результат после деплоя**: Текущий пробег будет одинаковым на всех страницах как на localhost, так и на production.

## Связанные файлы

- `src/lib/actions/odometerActions.ts` — функция `getMaxMileageEntry()`
- `src/app/page.tsx` — главная страница
- `src/app/items/[id]/page.tsx` — server component страницы элемента
- `src/app/items/[id]/ItemDetailsPageClient.tsx` — client component страницы элемента
- `src/lib/cache/tags.ts` — теги кэширования

## Дата создания документа

2026-01-05

## Автор

Forensic analysis after user report of mileage mismatch on production.

