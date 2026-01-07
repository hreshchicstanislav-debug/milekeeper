# UI Status Visual Audit — Current Version

**Дата создания:** 2025-01-02  
**Цель:** Зафиксировать текущую реализацию визуальных статусов на экранах Home и Items (без изменений кода)

---

## 1. Items List (Список элементов)

### Файлы и компоненты

**Основной файл:**
- `src/app/items/ItemsPageClient.tsx` — клиентский компонент страницы Items

**Компоненты:**
- `StatusRow` (из `src/app/components/StatusRow.tsx`) — переиспользуемый компонент для отображения статуса
- Рендерится внутри `.service-item-row` (строка элемента в списке)

**Структура рендеринга:**
```tsx
// ItemsPageClient.tsx, строки 77-106
<div className={`service-item-row clickable status-accent status-${statusVM.statusColor} ...`}>
  <div className="service-item-row-content">
    <StatusRow
      title={item.title}
      statusText={statusVM.statusText}
      statusColor={statusVM.statusColor}
      remainingRatio={statusVM.remainingRatio}
      isPredictionReliable={statusVM.isPredictionReliable}
      className="service-item-status-content"
    />
  </div>
  <span className="row-chevron">›</span>
</div>
```

### a) Левая цветная полоса

**Реализация:** Псевдоэлемент `::before` на родительском элементе с классом `.status-accent`

**CSS классы:**
- Базовый класс: `.status-accent` (применяется к `.service-item-row`)
- Модификаторы цвета: `.status-green`, `.status-yellow`, `.status-orange`, `.status-red`

**CSS правила** (`src/app/globals.css`, строки 1781-1806):
```css
.status-accent::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  border-radius: 0 2px 2px 0;
  z-index: 1;
}

.status-green::before {
  background-color: #34c759; /* iOS green */
}

.status-yellow::before {
  background-color: #ffcc00; /* iOS yellow */
}

.status-orange::before {
  background-color: #ff9500; /* iOS orange */
}

.status-red::before {
  background-color: #ff3b30; /* iOS red */
}
```

**Примечание:** Полоса имеет ширину 4px, позиционируется абсолютно слева, занимает всю высоту строки.

### b) Прогресс-бар

**Контейнер:**
- Класс: `.status-progress-bar`
- CSS: `src/app/globals.css`, строки 1914-1921
  - Ширина: 100%
  - Высота: 5px
  - Фон: `rgba(0, 0, 0, 0.08)` (серый)
  - Border-radius: 2.5px

**Заливка:**
- Класс: `.status-progress-fill` + модификатор `.status-progress-{color}`
- CSS: `src/app/globals.css`, строки 1923-1943
  - Высота: 100%
  - Border-radius: 2.5px
  - Ширина: вычисляется динамически через inline style `width: ${progressFill * 100}%`
  - Цвета:
    - `.status-progress-green`: `#34c759`
    - `.status-progress-yellow`: `#ffcc00`
    - `.status-progress-orange`: `#ff9500`
    - `.status-progress-red`: `#ff3b30`

**Логика вычисления заполнения** (`StatusRow.tsx`, строки 55-63):
```tsx
let progressFill = null;
if (remainingRatio !== null) {
  if (remainingRatio < 0) {
    progressFill = 1.0; // Overdue: 100% filled
  } else {
    progressFill = Math.max(0, Math.min(1, 1 - remainingRatio));
  }
}
```

### c) Текст статуса

**Класс:** `.status-text`

**CSS** (`src/app/globals.css`, строки 1773-1778):
```css
.status-text {
  font-size: var(--text-caption, 0.875rem);
  font-weight: var(--fw-regular, 400);
  line-height: var(--lh-normal, 1.35);
  color: rgba(0, 0, 0, 0.65);
}
```

**Источник данных:** `statusVM.statusText` (вычисляется в `buildServiceItemStatusVM`)

**Возможные значения:**
- `"Просрочено"` — для OVERDUE
- `"~N дней"` — для надежных прогнозов (N округляется до целого)
- `"Скоро"` — для ненадежных прогнозов или отсутствия данных

**Расположение:** Внутри `.status-row` (контейнер с flex, строки 1749-1753)

### d) Цветовая логика

**Источник:** `statusVM.statusColor` (тип: `'green' | 'yellow' | 'orange' | 'red'`)

**Вычисление** (`src/lib/service/serviceItemStatusVM.ts`, строки 110-131):
```typescript
if (statusResult.status === 'OVERDUE') {
  statusColor = 'red';
} else if (remainingRatio === null) {
  statusColor = 'yellow';
} else if (remainingRatio > 0.25) {
  statusColor = 'green';
} else if (remainingRatio > 0.10) {
  statusColor = 'yellow';
} else if (remainingRatio > 0.03) {
  statusColor = 'orange';
} else {
  statusColor = 'red';
}
```

**Применение в UI:**
- Класс `.status-{color}` добавляется к `.service-item-row` (строка 80 в `ItemsPageClient.tsx`)
- Этот класс управляет цветом левой полосы через `::before`
- Этот же цвет используется для прогресс-бара через класс `.status-progress-{color}`

---

## 2. Home Soon Maintenance Block (Блок "Скоро обслуживание")

### Файлы и компоненты

**Основной файл:**
- `src/app/components/HomeSoonMaintenanceBlock.tsx` — компонент блока "Скоро обслуживание"

**Компоненты:**
- `StatusRow` (из `src/app/components/StatusRow.tsx`) — тот же компонент, что используется в Items List
- Рендерится внутри `.soon-maintenance-row` (строка элемента в блоке)

**Структура рендеринга:**
```tsx
// HomeSoonMaintenanceBlock.tsx, строки 63-89
<div className={`soon-maintenance-row clickable status-accent status-${statusVM.statusColor} ...`}>
  <div className="soon-maintenance-row-content">
    <StatusRow
      title={item.title}
      statusText={statusVM.statusText}
      statusColor={statusVM.statusColor}
      remainingRatio={statusVM.remainingRatio}
      isPredictionReliable={statusVM.isPredictionReliable}
      className="soon-maintenance-status-content"
    />
  </div>
</div>
```

### a) Левая цветная полоса

**Реализация:** Та же, что и в Items List — псевдоэлемент `::before` на `.status-accent`

**CSS классы:** Те же самые (`.status-accent`, `.status-green`, `.status-yellow`, `.status-orange`, `.status-red`)

**CSS правила:** Те же (`src/app/globals.css`, строки 1781-1806)

**Примечание:** Визуально идентично Items List.

### b) Прогресс-бар

**Контейнер и заливка:** Те же классы и CSS, что и в Items List
- `.status-progress-bar` — контейнер
- `.status-progress-fill` + `.status-progress-{color}` — заливка

**Логика вычисления:** Та же (в компоненте `StatusRow`)

### c) Текст статуса

**Класс:** `.status-text` (тот же CSS)

**Источник данных:** `statusVM.statusText` (тот же источник)

**Возможные значения:** Те же (`"Просрочено"`, `"~N дней"`, `"Скоро"`)

### d) Цветовая логика

**Источник:** `statusVM.statusColor` (тот же источник и логика вычисления)

**Применение в UI:**
- Класс `.status-{color}` добавляется к `.soon-maintenance-row` (строка 65 в `HomeSoonMaintenanceBlock.tsx`)
- Управляет цветом левой полосы и прогресс-бара так же, как в Items List

---

## 3. Сравнительная таблица: Home vs Items

| Элемент UI | Home (Soon Maintenance) | Items List | Примечание |
|------------|-------------------------|------------|------------|
| **Левая полоса** | `::before` на `.status-accent` (4px, абсолютное позиционирование) | `::before` на `.status-accent` (4px, абсолютное позиционирование) | **Идентично** — используется один и тот же CSS |
| **Прогресс-бар** | `.status-progress-bar` + `.status-progress-fill` с модификатором цвета | `.status-progress-bar` + `.status-progress-fill` с модификатором цвета | **Идентично** — один и тот же компонент `StatusRow` |
| **Текст статуса** | `.status-text` (0.875rem, rgba(0,0,0,0.65)) | `.status-text` (0.875rem, rgba(0,0,0,0.65)) | **Идентично** — один и тот же CSS и источник данных |
| **Цвет статуса** | `statusVM.statusColor` (green/yellow/orange/red) | `statusVM.statusColor` (green/yellow/orange/red) | **Идентично** — одна и та же логика в `buildServiceItemStatusVM` |
| **Кликабельность/навигация** | Кликабельная строка → `router.push(/items/${item.id})` | Кликабельная строка → `router.push(/items/${item.id})` | **Идентично** — обе ведут на страницу деталей элемента |
| **Дополнительные элементы** | Заголовок секции "Скоро обслуживание", подсказка с темпом (если есть km-элементы) | Chevron справа (›) | **Различия** — разные контексты отображения |

### Выводы

**Визуально статусы идентичны** на обоих экранах, так как используется один и тот же компонент `StatusRow` с одинаковыми CSS классами и логикой вычисления цветов.

**Различия только в контексте:**
- Home: блок "Скоро обслуживание" с заголовком секции
- Items: полный список всех элементов с chevron-индикатором навигации

---

## 4. Screenshots Reference (Manual)

### Требуемые скриншоты

#### 4.1. Home Screen (мобильный вид)

**Что должно быть видно:**
1. Блок "Скоро обслуживание" (если есть элементы)
2. Заголовок секции "Скоро обслуживание"
3. Подсказка с темпом (если есть km-элементы): "Темп: ~N км/день"
4. Список элементов с:
   - Левая цветная полоса (4px, green/yellow/orange/red)
   - Название элемента (крупный шрифт)
   - Текст статуса (например, "~5 дней", "Просрочено", "Скоро")
   - Индикатор ⓘ (если прогноз ненадежный)
   - Прогресс-бар под текстом статуса
5. Белый фон блока с закругленными углами (iOS inset-grouped стиль)

**Рекомендуемые состояния для скриншотов:**
- Элементы с разными цветами статусов (green, yellow, orange, red)
- Элемент с ненадежным прогнозом (с индикатором ⓘ)
- Элемент в статусе "Просрочено"

#### 4.2. Items Screen (мобильный вид)

**Что должно быть видно:**
1. Заголовок страницы "Элементы"
2. Список всех элементов в группе (белый фон, iOS inset-grouped стиль)
3. Каждый элемент с:
   - Левая цветная полоса (4px, green/yellow/orange/red)
   - Название элемента (крупный шрифт)
   - Текст статуса (например, "~5 дней", "Просрочено", "Скоро")
   - Индикатор ⓘ (если прогноз ненадежный)
   - Прогресс-бар под текстом статуса
   - Chevron справа (›) — индикатор навигации
4. Разделители между элементами (1px, rgba(0,0,0,0.08))
5. Кнопка "Добавить элемент" внизу

**Рекомендуемые состояния для скриншотов:**
- Список с элементами разных цветов статусов
- Элемент с ненадежным прогнозом (с индикатором ⓘ)
- Элемент в статусе "Просрочено"
- Пустое состояние (если нет элементов)

---

## 5. Технические детали

### Файлы, отвечающие за визуализацию статусов

**Компоненты:**
- `src/app/components/StatusRow.tsx` — переиспользуемый компонент статуса
- `src/app/components/HomeSoonMaintenanceBlock.tsx` — блок "Скоро обслуживание" на Home
- `src/app/items/ItemsPageClient.tsx` — список элементов на Items

**CSS:**
- `src/app/globals.css`:
  - Строки 1781-1806: левая цветная полоса (`.status-accent::before`, `.status-{color}::before`)
  - Строки 1914-1943: прогресс-бар (`.status-progress-bar`, `.status-progress-fill`, `.status-progress-{color}`)
  - Строки 1773-1778: текст статуса (`.status-text`)
  - Строки 1684-1744: стили строк элементов (`.service-item-row`)
  - Строки 371-421: стили строк блока "Скоро обслуживание" (`.soon-maintenance-row`)

**Логика вычисления:**
- `src/lib/service/serviceItemStatusVM.ts` — функция `buildServiceItemStatusVM()`:
  - Вычисляет `statusColor` (строки 110-131)
  - Вычисляет `statusText` (строки 133-149)
  - Вычисляет `remainingRatio` (строки 95-99)

### Где задаются цвета в CSS

**Левая полоса:**
- `src/app/globals.css`, строки 1792-1806:
  - `.status-green::before`: `#34c759` (iOS green)
  - `.status-yellow::before`: `#ffcc00` (iOS yellow)
  - `.status-orange::before`: `#ff9500` (iOS orange)
  - `.status-red::before`: `#ff3b30` (iOS red)

**Прогресс-бар:**
- `src/app/globals.css`, строки 1929-1943:
  - `.status-progress-green`: `#34c759`
  - `.status-progress-yellow`: `#ffcc00`
  - `.status-progress-orange`: `#ff9500`
  - `.status-progress-red`: `#ff3b30`

**Примечание:** Цвета для полосы и прогресс-бара идентичны, что обеспечивает визуальную согласованность.

---

## 6. Резюме

### Саммари

**Файлы для полосы/прогресса/текста:**

**Home:**
- Компонент: `src/app/components/HomeSoonMaintenanceBlock.tsx`
- Переиспользуемый компонент: `src/app/components/StatusRow.tsx`
- CSS: `src/app/globals.css` (строки 1781-1943)

**Items:**
- Компонент: `src/app/items/ItemsPageClient.tsx`
- Переиспользуемый компонент: `src/app/components/StatusRow.tsx` (тот же)
- CSS: `src/app/globals.css` (строки 1781-1943, те же)

**Где задаются цвета в CSS:**
- Левая полоса: `src/app/globals.css`, строки 1792-1806 (`.status-{color}::before`)
- Прогресс-бар: `src/app/globals.css`, строки 1929-1943 (`.status-progress-{color}`)
- Текст статуса: цвет задается в `.status-text` (строка 1777): `rgba(0, 0, 0, 0.65)` (не зависит от статуса)

**Вывод:** Оба экрана используют один и тот же компонент `StatusRow` и одни и те же CSS классы, поэтому визуально статусы идентичны.

