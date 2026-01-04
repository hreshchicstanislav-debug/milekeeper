# Документация: Логика работы MileKeeper

## Обзор системы

MileKeeper — это приложение для отслеживания пробега автомобиля и обслуживания. Система состоит из трех основных сущностей:

1. **Odometer Entries (Записи одометра)** — фактические показания пробега
2. **Service Items (Элементы обслуживания)** — настраиваемые элементы, требующие периодической замены
3. **Service Events (События обслуживания)** — факты замены элементов

---

## 0. Нормативные определения (термины)

### 0.1 Актуальный пробег (currentMileage)

**Определение**: Максимальное значение `mileage_km` из всех записей в таблице `odometer_entries`.

**Правило выбора**:
- Используется SQL-запрос: `SELECT * FROM odometer_entries ORDER BY mileage_km DESC LIMIT 1`
- **Не используется** сортировка по `occurred_at` (дате записи)
- Если записей несколько с одинаковым максимальным `mileage_km`, выбирается любая из них (обычно первая в результате запроса)

**Обработка edge cases**:
- **Несколько записей в один день**: Если в один день добавлено несколько записей с разным пробегом, выбирается запись с максимальным `mileage_km`, независимо от времени в течение дня
- **Пробег уменьшился (ошибка)**: Такая ситуация невозможна на уровне базы данных — триггер `enforce_odometer_monotonic` блокирует добавление записи с `mileage_km <= MAX(mileage_km)`
- **Нет записей**: Возвращается `null`, система не может определить текущий пробег

**Функция**: `getMaxMileageEntry()` → возвращает `OdometerEntry | null`

### 0.2 Последнее событие обслуживания (lastEvent)

**Определение**: Событие обслуживания для конкретного элемента, используемое как базовая точка для расчета следующей замены.

**Правило выбора**:
- Используется SQL-запрос с `DISTINCT ON (service_item_id)` и сортировкой:
  ```sql
  ORDER BY service_item_id, occurred_at DESC, mileage_km DESC
  ```
- **Приоритет сортировки**:
  1. Сначала по `occurred_at DESC` (самая новая дата)
  2. Затем по `mileage_km DESC` (максимальный пробег) как tie-breaker
- Если событий несколько в один день с разным пробегом, выбирается событие с максимальным `mileage_km`

**Последствия для "давно по времени"**:
- Если последнее событие было давно по дате, но есть более новое событие с меньшим пробегом (например, была добавлена запись с прошлой датой), система все равно использует событие с более новой датой
- Это означает, что для режима `'km'` система **не учитывает** "давно по времени" — только пробег имеет значение

**Функция**: `listLastServiceEventsForItems(itemIds)` → возвращает `Record<string, ServiceEvent | null>`

### 0.3 Следующий пробег замены (nextDueKm)

**Определение**: Пробег, при котором элемент должен быть заменен.

**Формула**:
```
nextDueKm = lastEvent.mileage_km + serviceItem.interval_km
```

**Условия**:
- Вычисляется только если `serviceItem.interval_km !== null` и `lastEvent !== null`
- Если `interval_km === null`, то `nextDueKm = null`

### 0.4 Оставшийся пробег (remainingKm)

**Определение**: Количество километров до следующей замены.

**Формула**:
```
remainingKm = nextDueKm - currentMileage
```

**Условия**:
- Вычисляется только если `nextDueKm !== null` и `currentMileage !== null`
- Может быть отрицательным (элемент просрочен)
- Если `nextDueKm === null` или `currentMileage === null`, то `remainingKm = null`

### 0.5 Средний дневной пробег (avgDailyKm)

**Определение**: Средний пробег в километрах за один день, вычисленный на основе истории записей одометра.

**Алгоритм вычисления** (`estimateDailyKmRate`):
1. **Входные данные**: Массив записей одометра, отсортированный по `occurred_at DESC` (новейшие первыми)
2. **Окно данных**:
   - Временное окно: последние 14 дней от новейшей записи
   - Количественное ограничение: максимум 20 записей
   - Выбирается пересечение: записи, которые попадают в оба ограничения
3. **Фильтрация**:
   - Отбираются записи, где `occurred_at >= (newestDate - 14 дней)`
   - Берется максимум 20 записей
   - Сортировка по `occurred_at ASC` (старейшие первыми) для расчета
4. **Расчет**:
   ```
   oldestEntry = windowEntries[0]
   newestEntry = windowEntries[windowEntries.length - 1]
   deltaDays = (newestEntry.occurred_at - oldestEntry.occurred_at) / (1000 * 60 * 60 * 24)
   deltaKm = newestEntry.mileage_km - oldestEntry.mileage_km
   avgDailyKm = deltaKm / deltaDays
   ```
5. **Валидация**:
   - Если `deltaDays < 1` → fallback
   - Если `deltaKm <= 0` → fallback
   - Если `avgDailyKm < 1` или `avgDailyKm > 1500` → fallback
6. **Fallback стратегия**:
   - Если недостаточно данных (менее 2 записей в окне) → используется константа **30 км/день**
   - Если расчет дал невалидное значение → используется константа **30 км/день**
   - **Важно**: `notify_before_km` не используется в fallback стратегии

**Функция**: `estimateDailyKmRate(entries, opts)` → возвращает `{ dailyKmRate: number, isFallback: boolean }`
- `dailyKmRate` всегда `> 0` (никогда не `null`)
- `isFallback: true` означает, что использована константа 30 км/день

### 0.6 Порог уведомления по пробегу (notifyBeforeKm)

**Определение**: Устаревшее поле в структуре данных, **не используется** в логике определения статуса `SOON` и попадания в блок "Скоро обслуживание".

**Статус**: Поле существует в базе данных (`service_items.notify_before_km`), но игнорируется в коде.

---

## 1. Формулы и условия (строго)

### 1.1 Расчет статуса для режима `'km'`

#### Шаг 1: Вычисление базовых значений

```
IF lastEvent === null OR serviceItem.interval_km === null OR currentMileage === null:
  status = 'UNKNOWN'
  remainingKm = null
  remainingDays = null
  RETURN
END IF

nextDueKm = lastEvent.mileage_km + serviceItem.interval_km
remainingKm = nextDueKm - currentMileage
```

#### Шаг 2: Вычисление прогноза дней

```
IF remainingKm === null OR NOT Number.isFinite(remainingKm):
  remainingDays = null
  predictedDaysFromKm = null
ELSE:
  IF avgDailyKm !== null AND avgDailyKm > 0 AND Number.isFinite(avgDailyKm):
    rateToUse = avgDailyKm
  ELSE:
    rateToUse = 30  // Fallback константа
  END IF
  
  predictedDaysFromKm = remainingKm / rateToUse
  
  // Нормализация близких к нулю значений
  IF |predictedDaysFromKm| < 0.01:
    predictedDaysFromKm = 0
  END IF
  
  remainingDays = predictedDaysFromKm
END IF
```

#### Шаг 3: Определение статуса

```
isOverdueByKm = (remainingKm !== null) AND (remainingKm <= 0)
isOverdueByDays = (remainingDays !== null) AND (remainingDays <= 0)

IF isOverdueByKm OR isOverdueByDays:
  status = 'OVERDUE'
ELSE IF (remainingDays !== null) AND (remainingDays <= serviceItem.notify_before_days):
  status = 'SOON'
ELSE:
  status = 'OK'
END IF
```

**Важно**: 
- Статус `SOON` определяется **только** по `remainingDays` и `notify_before_days`
- `notify_before_km` **не используется** в определении статуса
- Для режима `'km'` время (`remainingDays`) используется только для прогноза, но не влияет на статус `OVERDUE` (только `remainingKm`)

### 1.2 Критерий попадания в блок "Скоро обслуживание" для режима `'km'`

Элемент попадает в блок, если выполняется **хотя бы одно** из условий:

```
IF isOverdue === true:
  RETURN true  // Просроченные элементы всегда попадают
END IF

itemNotifyDays = serviceItem.notify_before_days ?? DEFAULT_THRESHOLDS.Y_days  // Fallback: 5 дней

qualifiesByKm = (remainingKm !== null) AND (remainingKm <= DEFAULT_THRESHOLDS.X_km)  // X_km = 1200
qualifiesByDays = (remainingDays !== null) AND (remainingDays <= itemNotifyDays)

RETURN qualifiesByKm OR qualifiesByDays
```

**Интерпретация**:
- Элемент может попасть либо по пробегу (`remainingKm <= 1200 км`), либо по прогнозу дней (`remainingDays <= notify_before_days`)
- Порог по пробегу (`X_km = 1200`) — это **константа**, не зависит от `notify_before_days`
- Порог по дням — это **динамический порог**, зависит от `notify_before_days` элемента

### 1.3 Расчет статуса для режима `'calendar'`

```
IF lastEvent === null:
  status = 'UNKNOWN'
  RETURN
END IF

// Вычисление remainingDays
IF serviceItem.interval_days === null:
  status = 'UNKNOWN'
  RETURN
END IF

dueDate = lastEvent.occurred_at + serviceItem.interval_days
remainingDays = (dueDate - now) / (1000 * 60 * 60 * 24)

// Вычисление remainingKm (если есть interval_km)
IF serviceItem.interval_km !== null AND currentMileage !== null:
  nextDueKm = lastEvent.mileage_km + serviceItem.interval_km
  remainingKm = nextDueKm - currentMileage
ELSE:
  remainingKm = null
END IF

// Определение ограничивающего фактора
IF remainingKm !== null AND remainingDays !== null:
  IF remainingKm <= 0 OR remainingDays <= 0:
    // Один просрочен → он ограничивающий
    limitingFactor = (remainingKm <= 0) ? 'km' : 'time'
  ELSE:
    // Оба положительные → выбираем меньший
    limitingFactor = (remainingKm <= remainingDays) ? 'km' : 'time'
  END IF
ELSE IF remainingKm !== null:
  limitingFactor = 'km'
ELSE IF remainingDays !== null:
  limitingFactor = 'time'
ELSE:
  limitingFactor = 'none'
END IF

// Определение статуса
isOverdueByKm = (remainingKm !== null) AND (remainingKm <= 0)
isOverdueByDays = (remainingDays !== null) AND (remainingDays <= 0)

IF isOverdueByKm OR isOverdueByDays:
  status = 'OVERDUE'
ELSE IF (remainingDays !== null) AND (remainingDays <= serviceItem.notify_before_days):
  status = 'SOON'
ELSE:
  status = 'OK'
END IF
```

### 1.4 Критерий попадания в блок "Скоро обслуживание" для режима `'calendar'`

```
IF isOverdue === true:
  RETURN true  // Просроченные элементы всегда попадают
END IF

itemNotifyDays = serviceItem.notify_before_days ?? DEFAULT_THRESHOLDS.Y_days  // Fallback: 5 дней

RETURN (remainingDays !== null) AND (remainingDays <= itemNotifyDays)
```

**Интерпретация**:
- Для режима `'calendar'` используется только `remainingDays` (не используется `remainingKm` для попадания в блок)
- Порог по пробегу (`X_km = 1200`) **не применяется** для режима `'calendar'`

### 1.5 Сортировка элементов в блоке "Скоро обслуживание"

```
SORT items BY:
  1. isOverdue DESC (просроченные первыми)
  2. remainingDays ASC (ближайшие первыми, null = Infinity)
  3. remainingKm ASC (ближайшие первыми, null = Infinity)
  4. title ASC (алфавитно)

SELECT first MAX_ITEMS (5) items
```

---

## 2. Записи одометра (Odometer Entries)

### 1.1 Структура данных

```typescript
interface OdometerEntry {
  id: string;
  occurred_at: string; // ISO timestamp
  mileage_km: number;   // Пробег в километрах
  note: string | null;
  created_at: string;
}
```

### 1.2 Правила валидации

- **Монотонность пробега**: Каждая новая запись должна иметь `mileage_km` **строго больше** максимального существующего пробега
- Валидация выполняется на уровне базы данных через триггер `enforce_odometer_monotonic`
- На уровне приложения используется `getMaxMileageEntry()` для получения максимального пробега

### 1.3 Текущий пробег

**Важно**: Текущий пробег определяется как **максимальное значение** `mileage_km` из всех записей, а не последняя запись по дате.

```typescript
// Правильно: использовать getMaxMileageEntry()
const currentMileage = await getMaxMileageEntry();

// Неправильно: использовать getLatestOdometerEntry() (по дате)
// Это может вернуть запись с меньшим пробегом, если была добавлена запись с прошлой датой
```

### 1.4 Прогнозирование дневного пробега

Система вычисляет средний дневной пробег для прогнозирования:

- **Функция**: `estimateDailyKmRate(entries)`
- **Алгоритм**: 
  - Использует скользящее окно: последние 14 дней ИЛИ последние 20 записей (что меньше)
  - Вычисляет: `(новейший_пробег - старейший_пробег) / (дней_между_записями)`
  - Ограничения: минимум 1 км/день, максимум 1500 км/день
  - **Fallback**: Если недостаточно данных, используется 30 км/день

---

## 2. Элементы обслуживания (Service Items)

### 2.1 Структура данных

```typescript
interface ServiceItem {
  id: string;
  title: string;
  interval_km: number | null;        // Интервал замены по пробегу (км)
  interval_days: number | null;       // Интервал замены по времени (дни)
  notify_before_days: number;         // За сколько дней предупреждать (обязательно)
  notify_before_km: number | null;    // Устаревшее, не используется в логике
  measurement_mode: 'km' | 'calendar'; // Режим измерения
  note: string | null;
  is_active: boolean;
  created_at: string;
}
```

### 2.2 Режимы измерения

#### Режим `'km'` (По пробегу)

- **Основной критерий**: `interval_km` (обязательно)
- **Вторичный критерий**: `interval_days` (опционально, игнорируется в логике)
- **Логика**: 
  - Статус `OVERDUE` определяется **только** по пробегу: `remainingKm <= 0`
  - Статус `SOON` определяется **только** по прогнозу дней: `remainingDays <= notify_before_days`
  - Время (`remainingDays`) вычисляется как прогноз: `remainingKm / avgDailyKm`
  - **Важно**: Время не влияет на статус `OVERDUE`, только на статус `SOON` и попадание в блок

**Почему возможна ситуация "давно обслуживалось, но не Soon/Overdue"**:

Для режима `'km'` система **не учитывает** время с момента последней замены. Статус определяется исключительно по пробегу:

- Если `remainingKm > 0` → статус не `OVERDUE`
- Если `remainingDays > notify_before_days` → статус не `SOON`

**Пример**:
- Последняя замена: 01.01.2020, пробег 50000 км
- Интервал: 10000 км
- Текущий пробег: 55000 км (через 4 года!)
- `remainingKm = 50000 + 10000 - 55000 = -5000 км` → **OVERDUE** (просрочен по пробегу)

Но если:
- Текущий пробег: 52000 км
- `remainingKm = 50000 + 10000 - 52000 = -2000 км` → **OVERDUE**

Или если:
- Текущий пробег: 58000 км
- `remainingKm = 50000 + 10000 - 58000 = 2000 км` → не просрочен
- `avgDailyKm = 20 км/день` (мало ездит)
- `remainingDays = 2000 / 20 = 100 дней`
- `notify_before_days = 14 дней`
- `100 > 14` → статус **OK**, не попадает в блок "Скоро обслуживание"

**Вывод**: Для режима `'km'` "давно по времени" не имеет значения — важен только пробег. Элемент может быть заменен 4 года назад, но если пробег не превысил интервал, элемент не будет `OVERDUE` или `SOON`.

#### Режим `'calendar'` (По календарю)

- **Основной критерий**: `interval_days` (обязательно)
- **Вторичный критерий**: `interval_km` (опционально)
- **Логика**:
  - Статус определяется по **ограничивающему фактору** (limiting factor)
  - Ограничивающий фактор = тот критерий, который достигнет 0 раньше
  - Если оба критерия доступны, выбирается тот, у которого меньше `remainingValue`

### 2.3 Настройки уведомлений

- **`notify_before_days`**: За сколько дней до замены показывать элемент в блоке "Скоро обслуживание"
  - Используется для режима `'calendar'` и для прогноза дней в режиме `'km'`
  - Значение по умолчанию: 5 дней (если не указано для элемента)

---

## 3. События обслуживания (Service Events)

### 3.1 Структура данных

```typescript
interface ServiceEvent {
  id: string;
  service_item_id: string;
  occurred_at: string;  // ISO timestamp
  mileage_km: number;    // Пробег на момент замены
  note: string | null;
  created_at: string;
}
```

### 3.2 Правила валидации

- **Пробег обязателен**: `mileageKm` не может быть `null` или `undefined`
- **Пробег не может превышать текущий**: `mileageKm <= maxMileageEntry.mileage_km`
- При добавлении события используется **максимальный пробег** из одометра (не последний по дате)

### 3.3 Последнее событие

Для каждого элемента определяется **последнее событие** (lastEvent):
- **Правило выбора**: Сортировка по `occurred_at DESC, mileage_km DESC` (сначала по дате, затем по пробегу)
- Используется SQL-функция `get_last_service_events_for_items()` с `DISTINCT ON (service_item_id)`
- Если событий несколько в один день с разным пробегом, выбирается событие с максимальным `mileage_km`
- **Важно**: Это означает, что для режима `'km'` система использует событие с **самой новой датой**, а не с максимальным пробегом. Если была добавлена запись с прошлой датой, но более новой, чем предыдущие, она станет `lastEvent`, даже если пробег меньше.

**Последствия для "давно по времени"**:
- Если последнее событие было давно по дате, но есть более новое событие с меньшим пробегом (например, была добавлена запись с прошлой датой, но более новой, чем предыдущие), система использует событие с более новой датой
- Это означает, что для режима `'km'` система **не учитывает** "давно по времени" при определении статуса — только пробег имеет значение
- Функция: `listLastServiceEventsForItems(itemIds)`

---

## 4. Расчет статуса элемента (calcServiceStatus)

### 4.1 Входные данные

```typescript
interface CalcInput {
  serviceItem: ServiceItem;
  latestOdometerMileageKm: number | null;  // Текущий пробег (max mileage)
  lastEvent: ServiceEvent | null;           // Последнее событие замены
  dailyKmRate?: number | null;              // Средний дневной пробег для прогноза
  now?: Date;                                // Текущая дата/время
}
```

### 4.2 Алгоритм расчета

#### Шаг 1: Проверка наличия данных

- Если `lastEvent === null` → статус `UNKNOWN`
- Если `latestOdometerMileageKm === null` и режим `'km'` → статус `UNKNOWN`

#### Шаг 2: Вычисление оставшихся значений

**Для режима `'km'`:**

```typescript
// Оставшийся пробег
if (interval_km !== null && currentMileage !== null) {
  dueMileageKm = lastEvent.mileage_km + interval_km;
  remainingKm = dueMileageKm - currentMileage;
}

// Прогноз дней (если есть dailyKmRate)
if (remainingKm !== null && dailyKmRate > 0) {
  remainingDays = remainingKm / dailyKmRate;  // Может быть отрицательным!
}
```

**Для режима `'calendar'`:**

```typescript
// Оставшиеся дни
if (interval_days !== null) {
  dueDate = lastEvent.occurred_at + interval_days;
  remainingDays = (dueDate - now) / (1000 * 60 * 60 * 24);
}

// Оставшийся пробег (если есть interval_km)
if (interval_km !== null && currentMileage !== null) {
  dueMileageKm = lastEvent.mileage_km + interval_km;
  remainingKm = dueMileageKm - currentMileage;
}
```

#### Шаг 3: Определение ограничивающего фактора (limiting factor)

**Для режима `'km'`:**
- Ограничивающий фактор **всегда** `'km'` (никогда `'time'`)
- Время используется только для прогноза

**Для режима `'calendar'`:**
- Если доступны оба критерия (km и days):
  - Выбирается тот, у которого меньше `remainingValue`
  - Если один из них <= 0 (просрочен), он становится ограничивающим
- Если доступен только один критерий, он становится ограничивающим

#### Шаг 4: Определение статуса

```typescript
// OVERDUE: если ЛЮБОЙ критерий <= 0
const isOverdueByKm = remainingKm !== null && remainingKm <= 0;
const isOverdueByDays = remainingDays !== null && remainingDays <= 0;

if (isOverdueByKm || isOverdueByDays) {
  status = 'OVERDUE';
}
// SOON: если НЕ OVERDUE и remainingDays <= notify_before_days
else if (remainingDays !== null && remainingDays <= notify_before_days) {
  status = 'SOON';
}
// OK: иначе
else {
  status = 'OK';
}
```

**Важно**: 
- Статус `SOON` определяется **только** по `remainingDays` и `notify_before_days`
- `notify_before_km` больше не используется в логике

### 4.3 Результат

```typescript
interface ServiceStatusResult {
  status: 'OVERDUE' | 'SOON' | 'OK' | 'UNKNOWN';
  limitingFactor: 'km' | 'time' | 'none';
  primary: PrimaryMetric;      // Основной критерий
  secondary?: SecondaryMetric;  // Вторичный критерий (если доступен)
  remainingKm: number | null;
  remainingDays: number | null; // Календарные дни для 'calendar', прогноз для 'km'
  why: string;                   // Объяснение статуса (для отладки)
}
```

---

## 5. Блок "Скоро обслуживание" (Soon Maintenance)

### 5.1 Пороги по умолчанию

```typescript
const DEFAULT_THRESHOLDS = {
  X_km: 1200,      // Максимальный оставшийся пробег для попадания в список (km mode)
  Y_days: 5,       // Максимальное количество дней для попадания в список (fallback)
  MAX_ITEMS: 5,    // Максимальное количество элементов в списке
};
```

### 5.2 Условия попадания в список

Элемент попадает в блок "Скоро обслуживание", если выполняется **хотя бы одно** условие:

1. **Элемент просрочен** (`isOverdue === true`) → **всегда включается**

2. **Для режима `'calendar'`:**
   - `remainingDays <= itemNotifyDays` (или `Y_days`, если `notify_before_days` не указан)

3. **Для режима `'km'`:**
   - `remainingKm <= X_km` (1200 км) **ИЛИ**
   - `remainingDays <= itemNotifyDays` (или `Y_days`, если `notify_before_days` не указан)

**Важно**: 
- Просроченные элементы (`isOverdue === true`) **всегда** попадают в список, независимо от других условий
- Для режима `'km'` элемент может попасть либо по пробегу, либо по прогнозу дней

### 5.3 Сортировка элементов

Элементы сортируются в следующем порядке:

1. **Просроченные элементы** (`isOverdue === true`) идут первыми
2. **По оставшимся дням** (ascending - ближайшие первыми)
3. **По оставшемуся пробегу** (ascending - ближайшие первыми) как tie-breaker
4. **По названию** (алфавитно) как финальный tie-breaker

### 5.4 Ограничение количества

После сортировки выбираются первые `MAX_ITEMS` (5) элементов.

### 5.5 Форматирование ETA

**Для просроченных элементов:**
- ETA не показывается (пустая строка)
- Показывается только статус "Просрочено"

**Для режима `'calendar'`:**
- Показываются только дни: `"5 дней"` (без `~`, так как дни точные)

**Для режима `'km'`:**
- Показываются прогноз дней и пробег: `"~10 дней (1 200 км)"`
- Если дней нет, показывается только пробег: `"(1 200 км)"`

---

## 6. Поток данных на главной странице

### 6.1 Загрузка данных

```typescript
// Фаза 1: Параллельная загрузка независимых данных
const [maxMileageEntry, odometerEntries, serviceItems] = await Promise.all([
  getMaxMileageEntry(),           // Максимальный пробег
  listOdometerEntries(50),         // Последние 50 записей
  listServiceItems(),              // Все элементы обслуживания
]);

// Фаза 2: Загрузка зависимых данных
const lastEventsMap = await listLastServiceEventsForItems(
  serviceItems.map(item => item.id)
);
```

### 6.2 Вычисление прогноза

```typescript
// Средний дневной пробег для прогноза
const forecastResult = estimateDailyKmRate(odometerEntries);
const forecastDailyKmRate = forecastResult.dailyKmRate; // Всегда > 0
```

### 6.3 Расчет статуса для каждого элемента

```typescript
const itemsWithStatus = serviceItems.map((item) => {
  const lastEvent = lastEventsMap[item.id] ?? null;
  
  const statusResult = calcServiceStatus({
    serviceItem: item,
    latestOdometerMileageKm: currentMileage,
    lastEvent,
    dailyKmRate: forecastDailyKmRate,
    now,
  });
  
  return {
    item,
    lastEvent,
    remainingKm: statusResult.remainingKm,
    remainingDays: statusResult.remainingDays,
    urgency: statusResult.status,
    statusResult,
  };
});
```

### 6.4 Формирование списка "Скоро обслуживание"

```typescript
// Преобразование в формат для pickSoonMaintenanceItems
const soonMaintenanceInputs = itemsWithStatus
  .filter(({ lastEvent, statusResult }) => !!lastEvent && !!statusResult)
  .map(({ item, statusResult }) => ({
    id: item.id,
    title: item.title,
    mode: item.measurement_mode === 'km' ? 'km' : 'calendar',
    status: statusResult.status === 'UNKNOWN' ? 'OK' : statusResult.status,
    remainingKm: statusResult.remainingKm,
    remainingDays: statusResult.remainingDays,
    isOverdue: statusResult.status === 'OVERDUE',
    notifyBeforeDays: item.notify_before_days,
  }));

// Выбор и сортировка элементов
const soonMaintenanceItems = pickSoonMaintenanceItems(
  soonMaintenanceInputs, 
  DEFAULT_THRESHOLDS
);
```

---

## 7. Кэширование и инвалидация

### 7.1 Теги кэширования

```typescript
const TAGS = {
  odometer: 'odometer',
  serviceItems: 'service-items',
  serviceEvents: 'service-events',
  home: 'home',
  items: 'items',
};
```

### 7.2 Инвалидация кэша

При любом изменении данных инвалидируются следующие теги и пути:

**При добавлении/изменении/удалении пробега:**
- `TAGS.odometer`
- `TAGS.home`
- `revalidatePath('/', 'page')`
- `revalidatePath('/', 'layout')`
- `revalidatePath('/items', 'page')`
- `revalidatePath('/items', 'layout')`
- `revalidatePath('/items/[id]', 'page')`

**При добавлении/изменении/удалении элемента обслуживания:**
- `TAGS.serviceItems`
- `TAGS.serviceEvents`
- `TAGS.home`
- `TAGS.items`
- `TAGS.odometer`
- Все пути выше

**При добавлении события обслуживания:**
- `TAGS.serviceEvents`
- `TAGS.serviceItems`
- `TAGS.home`
- `TAGS.items`
- `TAGS.odometer`
- Все пути выше

### 7.3 Динамический рендеринг

Все страницы с данными используют принудительный динамический рендеринг:

```typescript
export const dynamic = 'force-dynamic';
export const revalidate = 0;
```

Это предотвращает статическое кэширование и обеспечивает свежие данные на каждом запросе.

---

## 8. Возможные проблемы и их решения

### 8.1 Просроченные элементы не попадают в "Скоро обслуживание"

**Проблема**: Элемент имеет статус `OVERDUE`, но не отображается в блоке.

**Причины:**
1. **`lastEvent === null`** → элемент исключается из списка на этапе фильтрации в `page.tsx` (строка 284-286)
   - **Решение**: Убедитесь, что для элемента есть хотя бы одно событие замены
   
2. **`statusResult === null`** → элемент исключается из списка на этапе фильтрации
   - **Решение**: Проверьте, что `calcServiceStatus` возвращает валидный результат
   
3. **`status.status !== 'OVERDUE'`** → элемент не определяется как просроченный
   - **Причина**: В `calcServiceStatus` статус `OVERDUE` определяется как:
     - `remainingKm !== null && remainingKm <= 0` **ИЛИ**
     - `remainingDays !== null && remainingDays <= 0`
   - Если оба значения `null`, статус будет `OK` или `UNKNOWN`, а не `OVERDUE`
   - **Решение**: 
     - Для режима `'km'`: убедитесь, что `interval_km` не `null` и `currentMileage` не `null`
     - Для режима `'calendar'`: убедитесь, что `interval_days` не `null`
   
4. **`isOverdue` установлен неправильно** → элемент не попадает в список
   - **Проверка**: В `page.tsx` строка 291: `isOverdue = status.status === 'OVERDUE'`
   - **Решение**: Убедитесь, что `status.status` действительно равен `'OVERDUE'`

**Диагностика:**
1. Проверьте логи в консоли (в dev-режиме есть диагностические логи для элементов "Масло двигателя" и "Масляный фильтр")
2. Проверьте значения:
   - `lastEvent` (должно быть не `null`)
   - `statusResult.status` (должно быть `'OVERDUE'`)
   - `remainingKm` и `remainingDays` (хотя бы одно должно быть `<= 0` для просроченного элемента)
   - `isOverdue` (должно быть `true`)

**Важно**: 
- Просроченные элементы (`isOverdue === true`) **всегда** попадают в список в `pickSoonMaintenanceItems` (строка 118-120)
- Если элемент не попадает, проблема в фильтрации до вызова `pickSoonMaintenanceItems` или в определении статуса `OVERDUE`

### 8.2 Неправильный текущий пробег

**Проблема**: Текущий пробег на главной странице не совпадает с максимальным пробегом в базе.

**Причина**: Использование `getLatestOdometerEntry()` вместо `getMaxMileageEntry()`

**Решение**: Всегда использовать `getMaxMileageEntry()` для получения текущего пробега

### 8.3 Статус "Просрочено" не отображается

**Проблема**: Элемент просрочен, но статус не показывается.

**Причина**: В `calcServiceStatus` статус `OVERDUE` определяется как `remainingKm <= 0` ИЛИ `remainingDays <= 0`, но если оба значения `null`, статус будет `UNKNOWN`

**Решение**: Убедитесь, что для элемента заданы соответствующие интервалы (`interval_km` для режима `'km'`, `interval_days` для режима `'calendar'`)

### 8.4 Неправильный прогноз дней

**Проблема**: Прогноз дней для режима `'km'` показывает неверные значения.

**Причина**: 
- Недостаточно данных для расчета `dailyKmRate`
- Используется fallback значение (30 км/день)

**Решение**: 
- Добавьте больше записей пробега для более точного прогноза
- Проверьте, что `estimateDailyKmRate()` возвращает валидное значение

---

## 9. Примеры расчетов

### Пример 1: Режим 'km' — базовый случай (требование пользователя)

**Данные:**
- Элемент: "Масло двигателя"
- `interval_km`: 1000 км
- `measurement_mode`: 'km'
- `notify_before_days`: 3 дня
- Последняя замена: 500 км (01.01.2024)
- Текущий пробег: 580 км
- `avgDailyKm`: 100 км/день (вычислен из истории)

**Расчет:**
```
nextDueKm = 500 + 1000 = 1500 км
remainingKm = 1500 - 580 = 920 км
remainingDays = 920 / 100 = 9.2 дня (прогноз)
```

**Статус:**
- `remainingKm (920) > 0` → не просрочен
- `remainingDays (9.2) > notify_before_days (3)` → не скоро
- **Результат**: `status = 'OK'`

**Попадание в "Скоро обслуживание":**
- `isOverdue = false`
- `remainingKm (920) <= X_km (1200)` → **попадает по пробегу** ✅
- `remainingDays (9.2) > notify_before_days (3)` → не попадает по дням
- **Результат**: **попадает в список** (по критерию пробега)

**Примечание**: Элемент попадает в блок, потому что `remainingKm (920) <= 1200`, даже если по прогнозу дней (`9.2 > 3`) он не скоро.

### Пример 2: Режим 'km' — низкий avgDailyKm (требование пользователя)

**Данные:**
- Элемент: "Масляный фильтр"
- `interval_km`: 1000 км
- `measurement_mode`: 'km'
- `notify_before_days`: 3 дня
- Последняя замена: 500 км (01.01.2024)
- Текущий пробег: 580 км
- `avgDailyKm`: 20 км/день (мало ездит)

**Расчет:**
```
nextDueKm = 500 + 1000 = 1500 км
remainingKm = 1500 - 580 = 920 км
remainingDays = 920 / 20 = 46 дней (прогноз)
```

**Статус:**
- `remainingKm (920) > 0` → не просрочен
- `remainingDays (46) > notify_before_days (3)` → не скоро
- **Результат**: `status = 'OK'`

**Попадание в "Скоро обслуживание":**
- `isOverdue = false`
- `remainingKm (920) <= X_km (1200)` → **попадает по пробегу** ✅
- `remainingDays (46) > notify_before_days (3)` → не попадает по дням
- **Результат**: **попадает в список** (по критерию пробега)

**Примечание**: Порог по пробегу (`X_km = 1200`) — это константа, не зависит от `notify_before_days`. Если бы использовался динамический порог `avgDailyKm * notify_before_days = 20 * 3 = 60 км`, элемент не попал бы, но система использует константу 1200 км.

### Пример 3: Режим 'km' — отсутствие истории пробегов (требование пользователя)

**Данные:**
- Элемент: "Воздушный фильтр"
- `interval_km`: 1000 км
- `measurement_mode`: 'km'
- `notify_before_days`: 3 дня
- Последняя замена: 500 км (01.01.2024)
- Текущий пробег: 580 км
- История пробегов: менее 2 записей (недостаточно данных)

**Расчет avgDailyKm:**
```
estimateDailyKmRate() → fallback
avgDailyKm = 30 км/день (константа)
isFallback = true
```

**Расчет статуса:**
```
nextDueKm = 500 + 1000 = 1500 км
remainingKm = 1500 - 580 = 920 км
remainingDays = 920 / 30 = 30.67 дня (прогноз с fallback)
```

**Статус:**
- `remainingKm (920) > 0` → не просрочен
- `remainingDays (30.67) > notify_before_days (3)` → не скоро
- **Результат**: `status = 'OK'`

**Попадание в "Скоро обслуживание":**
- `isOverdue = false`
- `remainingKm (920) <= X_km (1200)` → **попадает по пробегу** ✅
- `remainingDays (30.67) > notify_before_days (3)` → не попадает по дням
- **Результат**: **попадает в список** (по критерию пробега)

**Примечание**: 
- Fallback стратегия: используется константа **30 км/день**, а не `notify_before_km` (который не используется в логике)
- Элемент попадает в блок по критерию пробега, даже если прогноз дней неточный из-за fallback

### Пример 4: Режим 'km' — просрочен

**Данные:**
- Элемент: "Масляный фильтр"
- `interval_km`: 10000 км
- `measurement_mode`: 'km'
- `notify_before_days`: 14 дней
- Последняя замена: 50000 км (01.01.2024)
- Текущий пробег: 61000 км
- `avgDailyKm`: 50 км/день

**Расчет:**
```
nextDueKm = 50000 + 10000 = 60000 км
remainingKm = 60000 - 61000 = -1000 км (просрочен!)
remainingDays = -1000 / 50 = -20 дней (просрочен!)
```

**Статус:**
- `remainingKm <= 0` → просрочен
- **Результат**: `status = 'OVERDUE'`

**Попадание в "Скоро обслуживание":**
- `isOverdue = true` → **всегда попадает в список** ✅

### Пример 2: Режим 'km' (просрочен)

**Данные:**
- Элемент: "Масляный фильтр"
- `interval_km`: 10000 км
- `measurement_mode`: 'km'
- `notify_before_days`: 14 дней
- Последняя замена: 50000 км (01.01.2024)
- Текущий пробег: 61000 км
- `dailyKmRate`: 50 км/день

**Расчет:**
```
dueMileageKm = 50000 + 10000 = 60000 км
remainingKm = 60000 - 61000 = -1000 км (просрочен!)
remainingDays = -1000 / 50 = -20 дней (просрочен!)
```

**Статус:**
- `remainingKm <= 0` → просрочен
- **Результат**: `status = 'OVERDUE'`

**Попадание в "Скоро обслуживание":**
- `isOverdue = true` → **всегда попадает в список**

### Пример 3: Режим 'calendar'

**Данные:**
- Элемент: "Тормозная жидкость"
- `interval_days`: 730 дней (2 года)
- `interval_km`: null
- `measurement_mode`: 'calendar'
- `notify_before_days`: 30 дней
- Последняя замена: 01.01.2023
- Текущая дата: 01.12.2024
- Текущий пробег: 60000 км

**Расчет:**
```
dueDate = 01.01.2023 + 730 дней = 01.01.2025
remainingDays = (01.01.2025 - 01.12.2024) / 1 день = 31 день
remainingKm = null (нет interval_km)
```

**Статус:**
- `remainingDays > 0` → не просрочен
- `remainingDays (31) > notify_before_days (30)` → не скоро
- **Результат**: `status = 'OK'`

**Попадание в "Скоро обслуживание":**
- `isOverdue = false`
- `remainingDays (31) > notify_before_days (30)` → не попадает
- **Результат**: не попадает в список

### Пример 4: Режим 'calendar' (оба критерия)

**Данные:**
- Элемент: "Антифриз"
- `interval_days`: 1460 дней (4 года)
- `interval_km`: 60000 км
- `measurement_mode`: 'calendar'
- `notify_before_days`: 60 дней
- Последняя замена: 01.01.2020, 100000 км
- Текущая дата: 01.11.2023
- Текущий пробег: 150000 км

**Расчет:**
```
dueDate = 01.01.2020 + 1460 дней = 01.01.2024
remainingDays = (01.01.2024 - 01.11.2023) / 1 день = 61 день

dueMileageKm = 100000 + 60000 = 160000 км
remainingKm = 160000 - 150000 = 10000 км
```

**Ограничивающий фактор:**
- `remainingDays (61) < remainingKm в днях (10000 / 50 = 200 дней)` → время ограничивает
- **limitingFactor = 'time'**

**Статус:**
- `remainingDays > 0` → не просрочен
- `remainingDays (61) > notify_before_days (60)` → не скоро
- **Результат**: `status = 'OK'`

---

## 10. Edge cases (граничные случаи)

### 10.1 Пробег уменьшился (ошибка ввода)

**Ситуация**: Пользователь пытается добавить запись одометра с пробегом меньше максимального.

**Обработка**:
- Триггер базы данных `enforce_odometer_monotonic` блокирует операцию
- Возвращается ошибка: "Пробег должен быть больше предыдущего значения"
- **Результат**: Такая ситуация невозможна на уровне базы данных

### 10.2 Несколько записей в один день

**Ситуация**: В один день добавлено несколько записей одометра с разным пробегом.

**Обработка для currentMileage**:
- `getMaxMileageEntry()` выбирает запись с максимальным `mileage_km`
- Если пробеги одинаковые, выбирается любая из них
- **Результат**: Используется максимальный пробег, независимо от времени в течение дня

**Обработка для lastEvent**:
- `listLastServiceEventsForItems()` сортирует по `occurred_at DESC, mileage_km DESC`
- Если события в один день, выбирается событие с максимальным `mileage_km`
- **Результат**: Используется событие с максимальным пробегом среди событий одного дня

### 10.3 lastEvent без mileage_km

**Ситуация**: Событие обслуживания не имеет `mileage_km` (невозможно по схеме БД).

**Обработка**:
- Поле `mileage_km` обязательное в схеме БД (`NOT NULL`)
- **Результат**: Такая ситуация невозможна

### 10.4 interval_km = 0 или NULL

**Ситуация**: Элемент обслуживания имеет `interval_km = 0` или `interval_km = NULL`.

**Обработка**:
- Для режима `'km'`: `interval_km` обязателен при создании элемента (валидация на уровне приложения)
- Если `interval_km === null` и режим `'km'`:
  - `nextDueKm = null`
  - `remainingKm = null`
  - `status = 'UNKNOWN'`
- **Результат**: Элемент не может быть в статусе `OVERDUE` или `SOON`, попадает в `UNKNOWN`

### 10.5 notify_before_days = 0 или NULL

**Ситуация**: Элемент обслуживания имеет `notify_before_days = 0` или `notify_before_days = NULL`.

**Обработка**:
- `notify_before_days` обязателен при создании элемента (валидация на уровне приложения)
- Если `notify_before_days === null` (невозможно по валидации):
  - В `pickSoonMaintenanceItems` используется fallback: `DEFAULT_THRESHOLDS.Y_days = 5`
- Если `notify_before_days = 0`:
  - Статус `SOON` никогда не устанавливается (условие `remainingDays <= 0` означает `OVERDUE`)
  - Попадание в блок возможно только по критерию пробега (`remainingKm <= 1200`) или если `OVERDUE`
- **Результат**: Элемент с `notify_before_days = 0` не попадет в блок по критерию дней, только по пробегу или если просрочен

### 10.6 Несколько событий в один день с разным пробегом

**Ситуация**: Для одного элемента есть несколько событий обслуживания в один день с разным пробегом.

**Обработка**:
- `listLastServiceEventsForItems()` сортирует по `occurred_at DESC, mileage_km DESC`
- Выбирается событие с максимальным `mileage_km` среди событий одного дня
- **Результат**: Используется событие с максимальным пробегом

### 10.7 Нет записей одометра (currentMileage = null)

**Ситуация**: В системе нет записей одометра.

**Обработка**:
- `getMaxMileageEntry()` возвращает `null`
- Для режима `'km'`: `remainingKm = null`, `status = 'UNKNOWN'`
- Для режима `'calendar'`: `remainingDays` вычисляется нормально (не зависит от пробега)
- **Результат**: Элементы в режиме `'km'` получают статус `UNKNOWN` и не попадают в блок "Скоро обслуживание"

### 10.8 Недостаточно данных для avgDailyKm

**Ситуация**: В истории одометра менее 2 записей или записи не попадают в окно (14 дней, 20 записей).

**Обработка**:
- `estimateDailyKmRate()` возвращает fallback: `{ dailyKmRate: 30, isFallback: true }`
- Для режима `'km'`: `remainingDays = remainingKm / 30`
- **Результат**: Прогноз дней будет неточным (используется fallback 30 км/день), но элемент все равно попадет в блок по критерию пробега (`remainingKm <= 1200`)

---

## 11. Чек-лист отладки (пошагово)

### Шаг 1: Проверка наличия данных

- [ ] **lastEvent**: Проверьте, что `lastEvent !== null`
  - Если `null` → элемент исключается из списка на этапе фильтрации (`page.tsx`, строка 284-286)
  - **Решение**: Добавьте событие замены для элемента

- [ ] **currentMileage**: Проверьте, что `currentMileage !== null`
  - Если `null` → для режима `'km'` статус будет `UNKNOWN`
  - **Решение**: Добавьте запись одометра

- [ ] **interval_km** (для режима `'km'`): Проверьте, что `interval_km !== null` и `interval_km > 0`
  - Если `null` или `0` → статус будет `UNKNOWN`
  - **Решение**: Установите корректный интервал для элемента

- [ ] **interval_days** (для режима `'calendar'`): Проверьте, что `interval_days !== null` и `interval_days > 0`
  - Если `null` или `0` → статус будет `UNKNOWN`
  - **Решение**: Установите корректный интервал для элемента

### Шаг 2: Проверка расчета статуса

- [ ] **statusResult.status**: Проверьте значение статуса
  - Должно быть `'OVERDUE'`, `'SOON'`, `'OK'` или `'UNKNOWN'`
  - Если `'UNKNOWN'` → элемент не попадет в блок

- [ ] **remainingKm**: Проверьте значение
  - Для режима `'km'`: должно быть вычислено, если `interval_km !== null` и `currentMileage !== null`
  - Если `null` → статус будет `UNKNOWN`

- [ ] **remainingDays**: Проверьте значение
  - Для режима `'km'`: должно быть вычислено как `remainingKm / avgDailyKm` (или fallback 30)
  - Для режима `'calendar'`: должно быть вычислено из `interval_days`
  - Если `null` → статус `SOON` не установится

- [ ] **isOverdue**: Проверьте, что `isOverdue = (statusResult.status === 'OVERDUE')`
  - Если `false`, но элемент просрочен → проблема в расчете статуса

### Шаг 3: Проверка попадания в блок "Скоро обслуживание"

- [ ] **isOverdue === true**: Если да → элемент **всегда** попадает в список
  - Проверьте логику в `pickSoonMaintenanceItems` (строка 118-120)

- [ ] **Для режима `'km'`**: Проверьте оба критерия
  - `remainingKm <= 1200` (константа `X_km`) → попадает по пробегу
  - `remainingDays <= notify_before_days` → попадает по дням
  - Если оба `false` → элемент не попадет в список

- [ ] **Для режима `'calendar'`**: Проверьте критерий
  - `remainingDays <= notify_before_days` (или fallback 5 дней)
  - Если `false` → элемент не попадет в список

- [ ] **MAX_ITEMS = 5**: Проверьте, не превышает ли количество элементов лимит
  - После сортировки выбираются первые 5 элементов
  - Если элемент на 6-м месте → не отобразится, даже если `SOON` или `OVERDUE`

### Шаг 4: Проверка avgDailyKm (для режима `'km'`)

- [ ] **История записей**: Проверьте количество записей одометра
  - Нужно минимум 2 записи для расчета
  - Записи должны попадать в окно: последние 14 дней ИЛИ последние 20 записей

- [ ] **isFallback**: Проверьте, используется ли fallback
  - Если `isFallback = true` → используется константа 30 км/день
  - Прогноз дней будет неточным (используется fallback 30 км/день)

- [ ] **Валидность avgDailyKm**: Проверьте значение
  - Должно быть `> 0` и `<= 1500`
  - Если невалидное → используется fallback 30 км/день

### Шаг 5: Диагностические логи

- [ ] **Консоль браузера**: Проверьте логи в dev-режиме
  - Ищите `[Home] Overdue items analysis:` для анализа просроченных элементов
  - Ищите `[Home DIAG]` для диагностики конкретных элементов

- [ ] **Значения в логах**: Сравните с ожидаемыми
  - `currentMileage`, `lastEvent.mileage_km`, `interval_km`
  - `remainingKm`, `remainingDays`, `status`, `isOverdue`

---

## 12. Матрица ожиданий: Mode × Settings → Status × Попадание в блок

### 12.1 Таблица: Статус calcServiceStatus vs Попадание в блок "Скоро обслуживание"

| Статус calcServiceStatus | isOverdue | Попадание в блок | Условие |
|-------------------------|-----------|------------------|---------|
| `OVERDUE` | `true` | **Всегда** ✅ | Независимо от других условий |
| `SOON` | `false` | **Зависит от критериев** | См. таблицу ниже |
| `OK` | `false` | **Зависит от критериев** | См. таблицу ниже |
| `UNKNOWN` | `false` | **Никогда** ❌ | Элемент исключается на этапе фильтрации |

**Важно**: Статус `calcServiceStatus` и попадание в блок — это **разные** понятия:
- Статус определяет, просрочен ли элемент или скоро обслуживание
- Попадание в блок определяется дополнительными критериями (пороги по пробегу/дням)

### 12.2 Таблица: Режим × Настройки → Статус и попадание в блок

#### Режим `'km'` (По пробегу)

| Условие | Статус | Попадание в блок | Объяснение |
|---------|--------|------------------|------------|
| `remainingKm <= 0` | `OVERDUE` | ✅ **Всегда** | Просрочен по пробегу |
| `remainingKm > 0` AND `remainingDays <= notify_before_days` | `SOON` | ✅ **Да** | Скоро по прогнозу дней |
| `remainingKm > 0` AND `remainingDays > notify_before_days` AND `remainingKm <= 1200` | `OK` | ✅ **Да** | Не скоро, но попадает по пробегу |
| `remainingKm > 0` AND `remainingDays > notify_before_days` AND `remainingKm > 1200` | `OK` | ❌ **Нет** | Не скоро и не попадает по пробегу |
| `remainingKm === null` OR `currentMileage === null` | `UNKNOWN` | ❌ **Нет** | Нет данных для расчета |

**Критерии попадания для режима `'km'`**:
1. `isOverdue === true` → **всегда попадает**
2. `remainingKm <= 1200` (константа `X_km`) → **попадает по пробегу**
3. `remainingDays <= notify_before_days` → **попадает по дням**

#### Режим `'calendar'` (По календарю)

| Условие | Статус | Попадание в блок | Объяснение |
|---------|--------|------------------|------------|
| `remainingDays <= 0` OR `remainingKm <= 0` | `OVERDUE` | ✅ **Всегда** | Просрочен по времени или пробегу |
| `remainingDays > 0` AND `remainingDays <= notify_before_days` | `SOON` | ✅ **Да** | Скоро по календарю |
| `remainingDays > 0` AND `remainingDays > notify_before_days` | `OK` | ❌ **Нет** | Не скоро |
| `remainingDays === null` OR `interval_days === null` | `UNKNOWN` | ❌ **Нет** | Нет данных для расчета |

**Критерии попадания для режима `'calendar'`**:
1. `isOverdue === true` → **всегда попадает**
2. `remainingDays <= notify_before_days` → **попадает по дням**

**Важно**: Для режима `'calendar'` порог по пробегу (`X_km = 1200`) **не применяется**.

### 12.3 Сравнительная таблица: Режимы измерения

| Аспект | Режим `'km'` | Режим `'calendar'` |
|--------|--------------|---------------------|
| **Основной критерий статуса OVERDUE** | `remainingKm <= 0` | `remainingDays <= 0` ИЛИ `remainingKm <= 0` |
| **Основной критерий статуса SOON** | `remainingDays <= notify_before_days` | `remainingDays <= notify_before_days` |
| **Порог по пробегу для попадания в блок** | ✅ `remainingKm <= 1200` (константа) | ❌ Не применяется |
| **Порог по дням для попадания в блок** | ✅ `remainingDays <= notify_before_days` | ✅ `remainingDays <= notify_before_days` |
| **Учитывается ли "давно по времени"** | ❌ Нет (только пробег) | ✅ Да (время имеет значение) |
| **Используется ли avgDailyKm** | ✅ Да (для прогноза дней) | ❌ Нет |
| **Fallback для avgDailyKm** | ✅ 30 км/день | ❌ Не применимо |

---

## 13. Известные ограничения

1. **Прогноз дней для режима 'km'**: Используется упрощенный расчет на основе среднего дневного пробега. Не учитываются сезонные колебания, плановые поездки и т.д.

2. **Ограничивающий фактор для 'calendar'**: Если оба критерия доступны, выбирается тот, который достигнет 0 раньше (меньший `remainingValue`). Это не всегда интуитивно понятно для пользователя.

3. **Fallback для dailyKmRate**: Если недостаточно данных, используется константа 30 км/день. Это будет неточно для пользователей с другим режимом эксплуатации (например, таксисты с высоким пробегом или редко используемые автомобили).

4. **Максимальное количество элементов**: В блоке "Скоро обслуживание" показывается максимум 5 элементов. Если просроченных элементов больше, некоторые могут не отображаться.

---

## 14. Правила исключения элементов

### 14.1 Элементы без lastEvent

**Правило**: Элементы без `lastEvent` (последнего события замены) **не попадают** в блок "Скоро обслуживание".

**Причина**:
- Нет базовой точки для расчета следующей замены
- Невозможно вычислить `remainingKm` и `remainingDays`
- Статус будет `UNKNOWN`

**Обработка в коде**:
```typescript
// page.tsx, строка 284-286
const soonMaintenanceInputs = itemsWithStatus
  .filter(({ lastEvent, statusResult }) => !!lastEvent && !!statusResult)
  // Элементы без lastEvent исключаются здесь
```

**Как это должно восприниматься пользователем**:
- Элемент без истории замен не может быть в статусе `SOON` или `OVERDUE`
- Пользователь должен сначала добавить событие замены (отметить замену)
- После добавления события элемент появится в расчетах

### 14.2 Элементы со статусом UNKNOWN

**Правило**: Элементы со статусом `UNKNOWN` **не попадают** в блок "Скоро обслуживание".

**Причины статуса `UNKNOWN`**:
1. `lastEvent === null` (нет события замены)
2. Для режима `'km'`: `interval_km === null` или `currentMileage === null`
3. Для режима `'calendar'`: `interval_days === null`

**Обработка в коде**:
```typescript
// page.tsx, строка 296
status: statusResult.status === 'UNKNOWN' ? 'OK' : statusResult.status,
// UNKNOWN преобразуется в 'OK', но элемент все равно исключается на этапе фильтрации
```

### 14.3 Ограничение MAX_ITEMS = 5

**Правило**: В блоке "Скоро обслуживание" отображается максимум 5 элементов.

**Обработка**:
- После сортировки выбираются первые `MAX_ITEMS` (5) элементов
- Если элементов больше 5, остальные не отображаются, даже если они `SOON` или `OVERDUE`

**Приоритет сортировки**:
1. Просроченные элементы (`isOverdue === true`) идут первыми
2. Затем по `remainingDays` (ascending — ближайшие первыми)
3. Затем по `remainingKm` (ascending — ближайшие первыми)
4. Затем по названию (алфавитно)

**Последствия**:
- Если просроченных элементов больше 5, некоторые не отобразятся
- Если элементов `SOON` много, некоторые не отобразятся
- Пользователь должен проверять полный список элементов на странице `/items`

---

## 15. Ссылки на код

- **Расчет статуса**: `src/lib/service/calcServiceStatus.ts`
- **Логика "Скоро обслуживание"**: `src/lib/home/soonMaintenance.ts`
- **Прогноз пробега**: `src/lib/service/odometerForecast.ts`
- **Расчет дневного пробега**: `src/lib/prediction/dailyRate.ts`
- **Главная страница**: `src/app/page.tsx`
- **Действия с данными**: `src/lib/actions/odometerActions.ts`, `src/lib/actions/serviceActions.ts`

