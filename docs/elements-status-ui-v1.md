# Elements Status UI v1 — Audit & Specification

## Current logic: avgKmPerDay

### Функции расчета среднего пробега в день

В проекте используются **две разные функции** для расчета среднего пробега:

#### 1. `estimateDailyKmRate()` — Основная функция для прогнозов

**Файл**: `src/lib/service/odometerForecast.ts`  
**Функция**: `estimateDailyKmRate(entries: OdometerEntry[], opts?: EstimateOptions)`  
**Строки**: 28-86

**Назначение**: Оценка среднего дневного пробега для прогноза дней до замены элементов обслуживания в режиме 'km'.

**Входные данные**:
- `entries: OdometerEntry[]` — массив записей одометра, отсортированный по `occurred_at DESC` (новейшие первыми)
- `opts?: EstimateOptions` — опциональные параметры:
  - `maxDays?: number` — окно времени (по умолчанию: 14 дней)
  - `maxEntries?: number` — максимальное количество записей (по умолчанию: 20)
  - `minDailyKm?: number` — минимальный валидный км/день (по умолчанию: 1)
  - `maxDailyKm?: number` — максимальный валидный км/день (по умолчанию: 1500)
  - `fallbackDailyKm?: number` — fallback значение (по умолчанию: 30 км/день)

**Алгоритм**:
1. **Фильтрация по окну времени**:
   - Берется самая новая запись (первая в массиве)
   - Вычисляется дата отсечки: `newestDate - maxDays` (по умолчанию 14 дней назад)
   - Фильтруются записи, где `occurred_at >= cutoffDate`
   - Берется максимум `maxEntries` записей (по умолчанию 20)

2. **Сортировка для расчета**:
   - Записи сортируются по `occurred_at ASC` (старейшие первыми)

3. **Расчет среднего**:
   ```
   oldestEntry = windowEntries[0]
   newestEntry = windowEntries[windowEntries.length - 1]
   deltaDays = (newestEntry.occurred_at - oldestEntry.occurred_at) / (1000 * 60 * 60 * 24)
   deltaKm = newestEntry.mileage_km - oldestEntry.mileage_km
   avgDailyKm = deltaKm / deltaDays
   ```

4. **Валидация**:
   - Если `entries.length < 2` → fallback (30 км/день)
   - Если `windowEntries.length < 2` → fallback
   - Если `deltaDays < 1` → fallback
   - Если `deltaKm <= 0` → fallback
   - Если `avgDailyKm < minDailyKm` или `avgDailyKm > maxDailyKm` → fallback

5. **Результат**:
   - Возвращает `{ dailyKmRate: number, isFallback: boolean }`
   - `dailyKmRate` всегда `> 0` (никогда не `null`)
   - `isFallback: true` означает, что использована константа 30 км/день

**Использование**:
- Главная страница (`src/app/page.tsx:88`) — для расчета прогноза дней для элементов в режиме 'km'
- Страница списка элементов (`src/app/items/page.tsx:47`) — для расчета статусов
- Страница деталей элемента (`src/app/items/[id]/page.tsx:40`) — для расчета статуса

**Особенности**:
- Использует **скользящее окно**: последние 14 дней ИЛИ последние 20 записей (что меньше)
- Использует **простое среднее** (не медиану)
- Всегда возвращает положительное число (fallback гарантирует это)

#### 2. `computeDailyRate()` — Функция для оценки уверенности

**Файл**: `src/lib/prediction/dailyRate.ts`  
**Функция**: `computeDailyRate(entries: OdometerEntry[])`  
**Строки**: 16-61

**Назначение**: Вычисление медианного дневного пробега для оценки уверенности прогноза (не используется для прогнозов дней).

**Входные данные**:
- `entries: OdometerEntry[]` — массив записей, отсортированный по `occurred_at DESC`

**Алгоритм**:
1. Фильтрует записи за последние **60 дней**
2. Берет последние **10 записей**
3. Сортирует по возрастанию даты
4. Вычисляет км/день для каждой пары последовательных записей
5. Возвращает **медиану** всех значений

**Результат**:
- Возвращает `number | null` (может быть `null` при недостатке данных)

**Использование**:
- Главная страница (`src/app/page.tsx:83`) — для отображения среднего темпа езды
- `computeConfidence()` — для оценки уверенности прогноза

**Различия с `estimateDailyKmRate()`**:
- Использует **медиану** вместо среднего
- Окно: **60 дней, 10 записей** (vs 14 дней, 20 записей)
- Возвращает `null` вместо fallback
- **Не используется** для прогнозов дней до замены

### Формула прогноза дней

Для элементов в режиме 'km' прогноз дней вычисляется в `calcServiceStatus()`:

**Файл**: `src/lib/service/calcServiceStatus.ts`  
**Строки**: 112-149

**Формула**:
```
IF remainingKm === null OR !Number.isFinite(remainingKm):
  remainingDays = null
ELSE:
  IF dailyKmRate !== null AND dailyKmRate > 0 AND Number.isFinite(dailyKmRate):
    rateToUse = dailyKmRate
  ELSE:
    rateToUse = 30  // Fallback
  END IF
  
  predictedDaysFromKm = remainingKm / rateToUse
  
  // Нормализация близких к нулю значений
  IF |predictedDaysFromKm| < 0.01:
    predictedDaysFromKm = 0
  END IF
  
  remainingDays = predictedDaysFromKm
END IF
```

**Важно**:
- `remainingKm` может быть отрицательным (просрочено) → `remainingDays` тоже будет отрицательным
- Если `dailyKmRate` невалиден → используется fallback **30 км/день**
- `remainingDays` сохраняет знак (отрицательные значения = просрочено)

---

## Current logic: currentMileage source of truth

### Единый источник правды

**Функция**: `getMaxMileageEntry()`  
**Файл**: `src/lib/actions/odometerActions.ts`  
**Строки**: 145-167

**Определение "текущий пробег"**:
- Запись из таблицы `odometer_entries` с **максимальным** значением `mileage_km`
- Критерий выбора: `MAX(mileage_km)` — запись с наибольшим пробегом, **независимо от даты** (`occurred_at`)

**SQL запрос**:
```sql
SELECT * 
FROM odometer_entries 
ORDER BY mileage_km DESC 
LIMIT 1
```

**Кэширование**: ❌ **Отключено** (всегда обходит кэш для свежих данных)

### Использование на разных экранах

#### 1. Главная страница (Home)

**Файл**: `src/app/page.tsx`  
**Строки**: 43-44, 79

```typescript
const maxMileageEntry = await getMaxMileageEntry('Home');
const currentMileage = maxMileageEntry?.mileage_km ?? null;
```

**Отображение**: Строки 415-419
- Переменная: `maxMileageEntry?.mileage_km`
- Формат: `{formatNumber(maxMileageEntry.mileage_km)} {RU.common.km}`

#### 2. Страница элемента / Расчеты (ItemCalc)

**Server Component**: `src/app/items/[id]/page.tsx`  
**Строки**: 30-31

```typescript
const [latestOdometer, odometerEntries] = await Promise.all([
  getMaxMileageEntry(`ItemDetails:${item.title}`),
  listOdometerEntries(50),
]);
```

**Client Component**: `src/app/items/[id]/ItemDetailsPageClient.tsx`  
**Строки**: 166

```typescript
const currentMileage = latestOdometer?.mileage_km ?? null;
```

**Отображение**: Строки 269-275
- Переменная: `currentMileage` (из пропса `latestOdometer`)
- Формат: `{formatNumber(currentMileage)} {RU.common.km}`

#### 3. Список элементов (Items List)

**Файл**: `src/app/items/page.tsx`  
**Строки**: 21-22, 42

```typescript
const latestOdometer = await getMaxMileageEntry('ItemsList');
const currentMileage = latestOdometer?.mileage_km ?? null;
```

**Использование**: Передается в `calcServiceStatus()` для расчета статусов элементов

### Вывод

**Все экраны используют одинаковую функцию** `getMaxMileageEntry()`:
- ✅ Одинаковый SQL запрос: `ORDER BY mileage_km DESC LIMIT 1`
- ✅ Одинаковый источник данных: таблица `odometer_entries`
- ✅ Нет фильтров по `carId`, `userId` или другим параметрам
- ✅ Кэш отключен (всегда свежие данные)
- ✅ Нет различий в сортировке или логике выбора

**Различий в источниках данных нет** — все экраны получают текущий пробег из одного и того же места.

---

## Current logic: maintenance status per item

### Функция расчета статуса

**Файл**: `src/lib/service/calcServiceStatus.ts`  
**Функция**: `calcServiceStatus(input: CalcInput)`  
**Строки**: 62-428

**Входные данные**:
```typescript
interface CalcInput {
  serviceItem: ServiceItem;
  latestOdometerMileageKm: number | null;
  lastEvent: ServiceEvent | null;
  dailyKmRate?: number | null; // Для прогноза дней в режиме 'km'
  now?: Date;
}
```

**Поля элемента, используемые в расчете**:
- `measurement_mode: 'km' | 'calendar'` — режим измерения
- `interval_km: number | null` — интервал замены по пробегу
- `interval_days: number | null` — интервал замены по времени
- `notify_before_days: number | null` — порог уведомления по дням
- `notify_before_km: number | null` — **не используется** в определении статуса

**Поля последнего события**:
- `lastEvent.mileage_km: number` — пробег на момент последней замены
- `lastEvent.occurred_at: string` — дата последней замены

### Формулы расчета

#### Режим 'km' (По пробегу)

**Шаг 1: Расчет remainingKm**
```
IF interval_km !== null AND currentMileage !== null:
  dueMileageKm = lastEvent.mileage_km + interval_km
  remainingKm = dueMileageKm - currentMileage
ELSE:
  remainingKm = null
END IF
```

**Шаг 2: Расчет remainingDays (прогноз)**
```
IF remainingKm !== null AND Number.isFinite(remainingKm):
  IF dailyKmRate !== null AND dailyKmRate > 0:
    rateToUse = dailyKmRate
  ELSE:
    rateToUse = 30  // Fallback
  END IF
  
  predictedDaysFromKm = remainingKm / rateToUse
  remainingDays = predictedDaysFromKm  // Может быть отрицательным (просрочено)
ELSE:
  remainingDays = null
END IF
```

**Шаг 3: Определение статуса**
```
isOverdueByKm = (remainingKm !== null) AND (remainingKm <= 0)
isOverdueByDays = (remainingDays !== null) AND (remainingDays <= 0)

IF isOverdueByKm OR isOverdueByDays:
  status = 'OVERDUE'
ELSE IF (remainingDays !== null) AND (remainingDays <= notify_before_days):
  status = 'SOON'
ELSE:
  status = 'OK'
END IF
```

**Важно для режима 'km'**:
- Статус `OVERDUE` определяется по `remainingKm <= 0` (пробег превышен)
- Статус `SOON` определяется **только** по `remainingDays <= notify_before_days` (прогноз дней)
- `notify_before_km` **не используется** в определении статуса
- `remainingDays` — это прогноз, основанный на среднем темпе езды

#### Режим 'calendar' (По календарю)

**Шаг 1: Расчет remainingDays**
```
IF interval_days === null:
  status = 'UNKNOWN'
  RETURN
END IF

dueDate = lastEvent.occurred_at + interval_days
remainingDays = (dueDate - now) / (1000 * 60 * 60 * 24)
```

**Шаг 2: Расчет remainingKm (если есть interval_km)**
```
IF interval_km !== null AND currentMileage !== null:
  nextDueKm = lastEvent.mileage_km + interval_km
  remainingKm = nextDueKm - currentMileage
ELSE:
  remainingKm = null
END IF
```

**Шаг 3: Определение ограничивающего фактора**
```
IF remainingKm !== null AND remainingDays !== null:
  IF remainingKm <= 0 OR remainingDays <= 0:
    limitingFactor = (remainingKm <= 0) ? 'km' : 'time'
  ELSE:
    limitingFactor = (remainingKm < remainingDays) ? 'km' : 'time'
  END IF
ELSE IF remainingKm !== null:
  limitingFactor = 'km'
ELSE IF remainingDays !== null:
  limitingFactor = 'time'
ELSE:
  limitingFactor = 'none'
END IF
```

**Шаг 4: Определение статуса**
```
isOverdueByKm = (remainingKm !== null) AND (remainingKm <= 0)
isOverdueByDays = (remainingDays !== null) AND (remainingDays <= 0)

IF isOverdueByKm OR isOverdueByDays:
  status = 'OVERDUE'
ELSE IF (remainingDays !== null) AND (remainingDays <= notify_before_days):
  status = 'SOON'
ELSE:
  status = 'OK'
END IF
```

**Важно для режима 'calendar'**:
- Статус `OVERDUE` определяется по **любому** критерию (пробег ИЛИ время)
- Статус `SOON` определяется **только** по `remainingDays <= notify_before_days`
- `notify_before_km` **не используется** в определении статуса

### Попадание в блок "Скоро обслуживание"

**Файл**: `src/lib/home/soonMaintenance.ts`  
**Функции**: `shouldShowSoonMaintenanceBlock()`, `pickSoonMaintenanceItems()`  
**Строки**: 76-184

**Критерии попадания**:

#### Для режима 'km':
```
IF isOverdue === true:
  RETURN true  // Просроченные элементы всегда попадают
END IF

itemNotifyDays = notify_before_days ?? DEFAULT_THRESHOLDS.Y_days  // Fallback: 5 дней

RETURN (remainingDays !== null) AND (remainingDays <= itemNotifyDays)
```

**Интерпретация**:
- Элемент попадает в блок, если `remainingDays <= notify_before_days`
- `remainingDays` — это прогноз дней, основанный на `remainingKm / avgDailyKm`
- **Не используется** фиксированный порог по пробегу (1200 км удален из логики)

#### Для режима 'calendar':
```
IF isOverdue === true:
  RETURN true  // Просроченные элементы всегда попадают
END IF

itemNotifyDays = notify_before_days ?? DEFAULT_THRESHOLDS.Y_days  // Fallback: 5 дней

RETURN (remainingDays !== null) AND (remainingDays <= itemNotifyDays)
```

**Интерпретация**:
- Элемент попадает в блок, если `remainingDays <= notify_before_days`
- `remainingDays` — это календарные дни до следующей замены

**Сортировка элементов в блоке**:
1. `OVERDUE` элементы первыми
2. Затем по `remainingDays` (по возрастанию — ближайшие первыми)
3. Tie-breaker: по `remainingKm` (по возрастанию)
4. Финальный tie-breaker: по названию (алфавитно)

**Ограничение**: Максимум 5 элементов (`DEFAULT_THRESHOLDS.MAX_ITEMS`)

---

## Target UI (v1)

### Требования к списку элементов на экране "Элементы"

#### Структура элемента в списке

Каждый элемент в списке должен показывать **только**:
1. **Название элемента** (например, "Масло двигателя")
2. **Текст статуса**:
   - `~N дней` — если скоро (прогноз дней)
   - `Просрочено` — если просрочено
   - `Скоро` — если скоро, но прогноз ненадежен (без указания дней)
3. **Прогресс-бар** — визуальное отображение прогресса до замены
4. **Цвет статуса** — индикация срочности

**Внутри элемента (детальная страница)** остаются все числа и детали:
- Текущий пробег
- Последняя замена (дата и пробег)
- Интервалы замены
- Остаток до следующей замены (км и дни)
- Прогноз даты замены
- Все расчеты и метрики

### Унифицированные метрики

Для каждого элемента вычисляются следующие метрики:

#### 1. `daysToReplace: number | null`
- Количество дней до следующей замены
- Для режима 'km': прогноз дней (`remainingDays` из `calcServiceStatus`)
- Для режима 'calendar': календарные дни (`remainingDays` из `calcServiceStatus`)
- `null` если данные недоступны

#### 2. `totalDays: number | null`
- Общий интервал замены в днях
- Для режима 'km': вычисляется как `interval_km / avgDailyKm` (прогноз)
- Для режима 'calendar': `interval_days` (точное значение)
- `null` если данные недоступны

#### 3. `remainingRatio: number | null`
- Отношение оставшихся дней к общему интервалу
- Формула: `remainingRatio = daysToReplace / totalDays`
- Диапазон: `0.0` (сейчас) до `1.0` (только что заменили)
- Может быть отрицательным (просрочено)
- `null` если `daysToReplace === null` или `totalDays === null`

#### 4. `statusColor: 'green' | 'yellow' | 'orange' | 'red'`
- Цвет индикации статуса
- Определяется по `remainingRatio` и статусу `OVERDUE`

### Правила определения цвета

```
IF status === 'OVERDUE':
  statusColor = 'red'  // Просрочено всегда красный
ELSE IF remainingRatio === null:
  statusColor = 'yellow'  // Ненадежные данные — желтый
ELSE IF remainingRatio > 0.25:
  statusColor = 'green'  // >25% осталось — зеленый
ELSE IF remainingRatio > 0.10:
  statusColor = 'yellow'  // 10-25% осталось — желтый
ELSE IF remainingRatio > 0.03:
  statusColor = 'orange'  // 3-10% осталось — оранжевый
ELSE:
  statusColor = 'red'  // <3% осталось — красный
END IF
```

**Пороги**:
- `> 25%` → зеленый (`green`)
- `10-25%` → желтый (`yellow`)
- `3-10%` → оранжевый (`orange`)
- `< 3%` → красный (`red`)
- `OVERDUE` → всегда красный (`red`)

### Правила отображения текста статуса

#### Если прогноз ненадежен:
- Текст: `"Скоро"` (без указания дней)
- Цвет: желтый (`yellow`)
- Условия ненадежности:
  - `dailyKmRateUsed === 30` (использован fallback)
  - `isFallbackRate === true` (из `estimateDailyKmRate`)
  - `confidence === 'low'` (из `computeConfidence`)

#### Если прогноз надежен:
- Если `status === 'OVERDUE'`:
  - Текст: `"Просрочено"`
  - Цвет: красный (`red`)
- Если `status === 'SOON'`:
  - Текст: `"~{daysToReplace} дней"` (с округлением до целого)
  - Цвет: определяется по `remainingRatio` (желтый/оранжевый/красный)
- Если `status === 'OK'`:
  - Текст: `"~{daysToReplace} дней"` (если `daysToReplace !== null`)
  - Цвет: зеленый (`green`)

### Прогресс-бар

**Визуальное отображение**:
- Ширина: 100% контейнера элемента
- Высота: ~4-6px (тонкая полоса)
- Заполнение: `(1 - remainingRatio) * 100%` (если `remainingRatio !== null`)
- Цвет заполнения: соответствует `statusColor`
- Фон: светло-серый (`#e5e5e5` или аналогичный)

**Особые случаи**:
- Если `remainingRatio === null`: прогресс-бар не отображается или показывается как неопределенный (желтый, пунктир)
- Если `remainingRatio < 0` (просрочено): прогресс-бар заполнен на 100% красным цветом

### Примеры отображения

#### Пример 1: Элемент скоро (надежный прогноз)
```
Масло двигателя
~5 дней
[████████████░░░░░░░░] (оранжевый)
```

#### Пример 2: Элемент просрочен
```
Воздушный фильтр
Просрочено
[████████████████████] (красный, 100%)
```

#### Пример 3: Элемент скоро (ненадежный прогноз)
```
Топливный фильтр
Скоро
[████████████░░░░░░░░] (желтый)
```

#### Пример 4: Элемент в норме
```
Салонный фильтр
~45 дней
[░░░░░░░░░░░░░░░░░░░░] (зеленый, ~0%)
```

### Ограничения и примечания

1. **Не придумывать новых сущностей** — использовать существующие поля и функции
2. **Внутри элемента** остаются все детали — изменения только в списке
3. **Унифицированные метрики** — все элементы используют одинаковую логику расчета
4. **Цвета по remainingRatio** — единая система для всех элементов
5. **Ненадежный прогноз** — показывать "Скоро" без дней + желтый цвет

