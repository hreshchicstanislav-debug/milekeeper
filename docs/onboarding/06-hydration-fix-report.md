# MileKeeper — исправление hydration #418

Дата: 2026-10-09. База: `codex/onboarding-demo`, `37d5b79bb60057b2212ebdcb4e4adc40c43b9daf`. Работа выполнена локально в `/Users/stanislav/Mile_keeper`.

## Первопричина и доказательства

Ошибка воспроизведена на исходной локальной production-сборке после закрытия приветствия при прямом посещении `/en/demo`, viewport 320×360, browser TZ America/Los_Angeles. В тестовом браузере аннотирован только ответ JS с React, без изменения серверного HTML, исходного bundle на диске или deployment. Записаны hydration cursor и componentStack:

- React ожидает `main.app-main`.
- Текущий DOM-узел — `div.language-switcher`, первый дочерний элемент этого же `main`.
- Stack: `main → div → AppShell → ToastProvider → LocaleProvider → body → html`; внутренний стек содержит `sf` — replay suspended unit of work.
- Диагностический прогон поймал ошибку на `visit 17`; прежние прогоны с более медленной доставкой аннотированного bundle проходили без ошибки.

Причина — повторная обработка host fiber в React, когда отложенный RSC-узел в `children` разрешается во время уступки управления. `AppShell` помещал переданные сервером `children` прямо в массив детей `<main>`. React успевал сопоставить `<main>` с DOM и сдвинуть hydration cursor внутрь него, затем приостанавливался при разрешении RSC children. При быстром разрешении и replay курсор не возвращался к `<main>`. Следующее сопоставление сравнивало `<main>` с его собственным первым потомком и давало #418. Это объясняет зависимость от timing и исчезновение сбоя при некоторых способах инструментирования.

Механизм также описан в [React issue #37584](https://github.com/react/react/issues/37584). Вывод здесь опирается не только на этот issue: добавлен воспроизводимый тест с **настоящим AppShell и React, поставляемым установленным Next.js**. Он передаёт lazy node с Flight-подобным thenable (`status/value`), разрешаемым в microtask, и гидратирует идентичный SSR DOM через `startTransition`. На исходном коде 20/20 запусков дали #418 и заменили серверный DOM. После исправления 20/20 завершились без ошибки и сохранили исходный `main`.

Это не доказательство ошибки в localStorage, native dialog, форматировании дат или EN rewrite. Для воспроизведения достаточно отложенного дочернего узла; приветствие и переключение языка не требуются. Viewport 320×360 воспроизводит сценарий пользователя, но не является необходимой причиной. Старый удалённый deployment в этой задаче не инструментировался; его сохранённая ошибка имеет тот же тип и путь replay, а точное место удалось записать локально.

## Минимальное исправление

В `src/app/components/AppShell.tsx` добавлен `PageContent`, возвращающий `children`, и вместо прямого `{children}` используется `<PageContent>{children}</PageContent>`. Разрешение RSC children теперь выполняется внутри отдельного component fiber, а не повторно обрабатываемого host fiber `<main>`.

Компонент не добавляет DOM, fallback или новый эффект. SSR сохраняется; `suppressHydrationWarning`, отключение SSR и задержки по таймеру не используются. Зависимости React/Next и lockfile не обновлялись. Приветствие, RU/EN-тексты, marker, demo snapshot, расчёты, auth/middleware, OAuth и Supabase не менялись. Поскольку AppShell общий, проверены и существующие личные маршруты с локальным mock provider.

Регрессия: `scripts/test-demo-hydration.cjs`, команда `npm run test:demo:hydration`. Нужны Chrome и Playwright, передаваемый через `MILEKEEPER_PLAYWRIGHT_PATH`, как в существующем browser smoke. Bundler esbuild уже установлен транзитивно через Vitest. Тест использует настоящий AppShell; маршрутизатор и не относящиеся к проверяемой структуре компоненты оболочки заменены fixtures. Полные сценарии локализации/auth проверяются отдельно существующим smoke. Тест ждёт commit содержимого, учитывает recoverable errors/pageerror и проверяет сохранение серверного DOM, а не только появление страницы.

## Проверки

- Детерминированная browser-регрессия: до изменения 20/20 FAIL, после 20/20 PASS, RU/EN × 320×360/1280×900 × 5 запусков. Серверный DOM после исправления сохранён.
- `npm test`: 30 файлов, 422 теста PASS.
- `npx tsc --noEmit --incremental false`: 14 прежних ошибок; вывод до/после совпадает полностью.
- Production build с локальным fixture: PASS.
- Финальный обычный `npm run build`: PASS; fixture в сборке не оставлен, `.env.local` не изменялась. `git diff --check`: PASS.
- Полный production browser smoke: PASS, включая welcome/storage denial, RU/EN, demo isolation, mock Google OAuth, личные маршруты, формы, Back/Forward и logout.
- Полный dev browser smoke после исправления: PASS, те же существующие сценарии.
- Дополнительная матрица production: шесть независимых контекстов (первый RU/EN × 320×360, 390×844, 1280×900), America/Los_Angeles, reduced motion. В каждом — первое открытие/закрытие, восемь пар прямого посещения + refresh после закрытия, десять смен языка с открытым и десять с закрытым окном, Back/Forward. Всего 96 повторных document loads, 120 переключений; 0 console error/pageerror, исходный `main` сохранён. Единственная запись localStorage — welcome marker; sessionStorage/cookies пусты, личных API/POST нет. `matrix-results.json` и `matrix.log` содержат результаты, screenshots сохранены рядом.

Логи, диагностические scripts и screenshots: `/Users/stanislav/Documents/ChatGPT/MileKeeper/artifacts/hydration-fix/`. Ключевые доказательства: `probe-fast-results.json`, `regression-before.log`, `regression-after.log`, `unit-after.log`, `tsc-before.log`, `tsc-after.log`, `production-after.log`.

## Границы

Изменение локальное; deployment, promotion, push и merge не выполнялись. Production и прежний staged deployment не изменялись. Новое исправление на удалённом deployment ещё не проверялось. Физические iOS/Android и Safari не проверялись; настоящий Google OAuth не запускался. Slice 2 не начат.
