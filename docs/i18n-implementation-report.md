# MileKeeper: отчёт о добавлении английской локализации

Реализация готова к локальному тестовому запуску и проверке. Публикация не выполнялась.

Рабочий репозиторий: `/Users/stanislav/Mile_keeper`. Указанная в чате папка `/Users/stanislav/Documents/ChatGPT/MileKeeper` не содержит исходников приложения и истории main; изменения сделаны в существующем репозитории MileKeeper.

Ветка: `codex/english-localization`, создана от актуального `origin/main`, commit `fdf532f44f7298101f1f7d7e0cf387c1b2da0730`. До изменений рабочее дерево было чистым. Перед работой проверена опубликованная версия: Vercel deployment `dpl_6FVMye9i5uypGZJAyk91grWPoZUh`, состояние READY, production alias `milekeeper.vercel.app`, тот же commit main. Это была проверка метаданных deployment и публичных страниц без чтения личных записей.

## 1. Организация локализации

Добавлен небольшой собственный слой i18n без новой библиотеки и без новых зависимостей. Исходный `src/lib/copy/ru.ts` сохранён без изменений. Английский словарь находится в `src/lib/i18n/en.ts`; ключами служат исходные русские системные фразы. `copy.ts` создаёт локализованную копию прежнего вложенного словаря и предоставляет типизированную функцию `t`, форматирование и локализованные ссылки. Добавление русского ключа без английского соответствия обнаруживается типами и тестами.

Server Components получают локаль из заголовка, который middleware всегда устанавливает заново, игнорируя присланное клиентом значение. Client Components используют общий `LocaleProvider` и `useCopy`. Одни и те же страницы и компоненты обслуживают обе локали.

Тексты существующего расчётного движка переводятся только на границе отображения через `systemText`: известные статусы, объяснения и шаблоны. Сам движок не изменён. Для неизвестной ошибки с кириллицей английский интерфейс показывает понятное общее сообщение; техническая ошибка остаётся доступна существующему логированию. Пользовательские названия и заметки не передаются в этот переводчик.

## 2. Маршруты RU и EN

| Русский URL | Английский URL |
| --- | --- |
| `/` | `/en` |
| `/login` | `/en/login` |
| `/items` | `/en/items` |
| `/items/[id]` | `/en/items/[id]` |
| `/history` | `/en/history` |

Middleware выполняет внутренний rewrite разрешённых английских маршрутов на существующие страницы **после прежних проверок сессии**. Видимый URL сохраняет `/en`. `/auth/callback`, `/api/*`, ресурсы Next.js и manifest остаются общими. Редиректы на вход учитывают префикс; ответы авторизации, включая редиректы, используют `no-store`.

URL — главный источник языка. Обновление `/en/...` сохраняет английский интерфейс. Русские URL остаются русскими независимо от языка браузера и locale cookie. Автоматического определения языка и перенаправления по настройкам браузера нет.

## 3. Переключатель RU / EN

Компактный переключатель размещён в общей оболочке приложения: на странице входа и внутри приложения. Его копия доступна поверх открытого модального окна, чтобы можно было переключать язык во время заполнения формы. Кнопки имеют `aria-pressed` и локализованное название группы.

Переключение использует поддерживаемый Next.js Native History API: сохраняет текущую страницу, query и fragment, меняя только префикс. После обновления URL provider обновляет серверные данные через `router.refresh()`, сохраняя смонтированные формы. Зависимости эффектов заполнения форм приведены к значениям полей, чтобы новый объект Server Component props не сбрасывал черновик. Back/Forward также обновляют язык серверных заголовков и клиентских элементов.

Cookie `mk_locale` хранит только валидированную локаль и нужна для общего OAuth callback. Она не заменяет URL и не участвует в принятии решения о доступе. Переключатель не вызывает sign-out и не создаёт новую сессию.

## 4. Переведённые страницы и элементы

Переведены главная страница, вход и callback, навигация и хлебные крошки, список и карточка обслуживания, вкладки истории и расчёта, добавление и редактирование элемента, настройки периодичности, запись замены, добавление/редактирование/удаление пробега, история пробега, подтверждения, подсказки статусов, сообщения об успехе и ошибках, состояния загрузки и пустые состояния, действия восстановления сессии, доступные пользователю инструменты тестового времени, общая страница ошибки и 404.

Локализованы placeholder, aria-label, title и системные подписи. Встроенные статусы переведены; введённые пользователем названия, комментарии, заметки и записи истории остаются без изменений.

Даты и числа используют `ru-RU` / `en-US`; английский ввод пробега принимает группировку запятыми. Даты показываются в часовом поясе браузера; стабильный placeholder до hydration предотвращает несоответствие серверного и клиентского времени. Значения, километры, пороги, периодичность, прогнозы и правила расчётов сохранены.

## 5. Язык при Google-входе и безопасность

До открытия Google сохраняется исходная локаль в sessionStorage текущей вкладки и locale cookie. `redirectTo` остался `${window.location.origin}/auth/callback`; Google provider, параметры OAuth и конфигурация Supabase не менялись. После прежнего завершения входа и подтверждённой синхронизации cookies callback выбирает только одну из двух констант: `/` или `/en`. Произвольный URL возврата не принимается, поэтому новый механизм не создаёт open redirect.

Сохранены проверки Origin, серверная валидация токенов, параметры auth cookies, очередь синхронизации, refresh и обработка одноразового OAuth code. Класс `BrowserSession` не изменён; обновлены только локализованные назначения `authRedirect`. Rotation cookies в middleware передаётся и в запрос страницы, и браузеру также при английском rewrite.

В браузерной production-проверке обнаружено, что анонимный prefetch нижней навигации может заранее закешировать редирект на вход и вернуть его после успешного callback. Prefetch выключен на login/callback, остальные страницы сохранили прежнее поведение. Проверки авторизации не ослаблялись.

`src/app/api/*`, серверные session-sync/logout/refresh/validation функции, RLS, SQL, миграции, бизнес-расчёты, security-документы этапов 1/2 и lockfile не изменены. Production Supabase, данные пользователей и настройки Google не изменялись. Миграции, deployment, push и merge не выполнялись.

## 6. Изменённые файлы

Полный перечень приведён в конце отчёта. Основные группы: новый `src/lib/i18n/`, общий переключатель и provider, локализация существующих страниц/компонентов, locale-aware middleware и адреса входа, локализованный manifest, тесты и локальная browser fixture. Старый `src/app/manifest.ts` заменён общим Route Handler с тем же публичным URL `/manifest.webmanifest`.

CSS дополнен только стилями переключателя и его расположения в модальном окне. Существующий дизайн не перерабатывался. Генерируемые `next-env.d.ts` и `tsconfig.tsbuildinfo` не входят в изменения.

## 7. Количество переводов и PWA

Добавлено **295 уникальных пар RU / EN**. Они покрывают все **211 вложенных ключей** исходного русского словаря, которые используют 172 уникальные фразы, и ещё 123 системные фразы/шаблона из компонентов и расчётного вывода. Проверяются одинаковая структура словарей, непустые переводы и сохранение interpolation tokens.

Одна PWA использует единый manifest endpoint: `/manifest.webmanifest` для RU и `/manifest.webmanifest?lang=en` для EN. У обоих одинаковые `id: '/'`, `scope: '/'`, иконки и цвета. Отличаются локализованные name/description/lang и start_url (`/` или `/en`); добавлены shortcuts на обе локали. Provider обновляет manifest link, HTML lang, title и description при переключении.

Английские страницы, login и общий callback входят в существующий scope. Исключение manifest и ресурсов из middleware сохранено. В исходном проекте нет service worker; новый service worker не добавлялся. Возможности offline не расширялись.

## 8. Проверки и результаты

| Проверка | Результат |
| --- | --- |
| Исходный `npm test` | 330 тестов, 24 файла: PASS |
| Итоговый `npm test` | **393 теста, 27 файлов: PASS**; добавлено 63 теста |
| `npm run test:i18n` | **112 тестов, 5 файлов: PASS**, включая существующие auth-тесты |
| `npx tsc --noEmit` | Те же **14 исходных ошибок**, новых **0**; вывод полностью совпадает с baseline |
| `npm run build` | PASS; заключительная обычная production-сборка с исходной `.env.local` также успешна |
| `npm run lint` | Прежний сбой `next lint`: `Invalid project directory provided ... /Mile_keeper/lint` |
| Browser smoke на локальной production-сборке | 11 групп сценариев: PASS |
| AST-поиск жёстко заданных русских текстов | PASS; нет необёрнутых системных строк в TSX приложения |
| `git diff --check` | PASS |

Все 14 ошибок TypeScript находятся в прежних тестах расчётов: `calcServiceStatus.regression.test.ts`, `calcServiceStatus.test.ts`, `compareServiceUrgency.test.ts`, `mileageAndForecastToBe.test.ts`, `odometerForecast.test.ts`. Это отсутствующие обязательные `user_id` в fixtures и отсутствующий экспорт `ServiceStatusResult`. Эти файлы не менялись. В build остаётся исходное предупреждение Next.js о будущем переходе middleware на proxy; настройка проверки типов не ослаблялась.

Новые тесты проверяют полноту ключей, числовые/календарные статусы настоящего расчётного движка, неизменность личных данных, маршруты и query/fragment, защиту от произвольных callback destinations, перенаправления login/logout, общий Google redirect URI, сохранение сессии при переключении, передачу rotated cookies через rewrite, временные auth-ошибки и восстановление после retry.

Browser smoke использует Chrome/Playwright, Next.js и **локальный mock Supabase/OAuth** с синтетическими записями; внешние запросы браузера запрещены. Он проверяет `/en` → английский вход → общий callback → `/en`, повторный вход и logout, RU/reload, сохранение сессии и черновиков модальных форм, Back/Forward, серверный текст после переключения, английские items/details/calculation/history, формат чисел и manifest. Страницы проверены на 320, 390 и 1280 px: нет горизонтального переполнения и русского системного текста; русские личные записи сохранены. Часовой пояс теста — America/Los_Angeles, браузерных page errors нет.

Для повторения unit-проверок: `npm test`, `npm run test:i18n`, `npx tsc --noEmit`, `npm run build`. Browser smoke: `npm run test:i18n:browser`; требуется доступный Playwright и Chrome. Если Playwright установлен вне проекта, передать `MILEKEEPER_PLAYWRIGHT_PATH` с абсолютным путём к его модулю; при необходимости `MILEKEEPER_CHROME_PATH` задаёт путь к Chrome. Новых зависимостей проекта для этого не добавлено.

Для повторения именно production browser smoke сначала создать локальную сборку с fixture env:

```sh
NEXT_PUBLIC_DEV_GUEST_MODE=0 \
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54329 \
NEXT_PUBLIC_SUPABASE_ANON_KEY=fixture-anon-key \
SUPABASE_URL=http://127.0.0.1:54329 \
SUPABASE_ANON_KEY=fixture-anon-key npm run build
MILEKEEPER_I18N_PRODUCTION=1 npm run test:i18n:browser
# Затем восстановить обычную локальную сборку:
npm run build
```

Порты 3101 и 54329 должны быть свободны. Runner запускает и останавливает собственные Next.js и mock-серверы, выводит путь к временным логам и screenshot. Во время этой реализации заключительная обычная сборка уже восстановлена.

## 9. Непереведённые элементы и границы проверки

Известных непереведённых системных элементов в проверенных страницах и состояниях нет. Русские фразы в ключах словаря, комментариях разработчиков и сравнениях legacy-контрактов намеренно сохранены; они не являются английским UI. Личные русские названия и заметки остаются видимыми именно как данные пользователя.

Реальный Google consent и поведение **установленной PWA на физическом устройстве** автоматически не проверены. Mock проверяет приложение и его callback/session flow, но не внешний Google и особенности конкретной OS. Перед публикацией нужны ручной RU/EN Google-вход и цикл installed PWA: EN-ссылка, переключение, обновление, закрытие/повторное открытие, сохранение сессии, выход и повторный вход. Установка из EN manifest задаёт EN start_url; сохранение выбранной локали при обычном refresh подтверждено. Изменение start_url уже установленной PWA зависит от обновления manifest браузером и требует этой ручной проверки.

## 10. Готовность и остановка

Реализация готова к тестовому запуску и code review в отдельной локальной ветке. Автотесты и сборка успешны; исходные проблемы TypeScript/lint отдельно зафиксированы. Для реальной публикации остаются указанные ручные проверки Google и установленной PWA. Production deployment не выполнялся; ветка не отправлялась на remote, main не изменён. Работа остановлена для проверки пользователем.

При выборе механизма использованы официальные документы: [Next.js Native History API](https://nextjs.org/docs/app/getting-started/linking-and-navigating#native-history-api), [Next.js useRouter / refresh](https://nextjs.org/docs/app/api-reference/functions/use-router), [Supabase Google OAuth](https://supabase.com/docs/guides/auth/social-login/auth-google).

## Полный перечень файлов

- `docs/i18n-implementation-report.md`
- `package.json`
- `scripts/fixtures/i18n-supabase.cjs`
- `scripts/test-i18n-browser.cjs`
- `src/app/auth/callback/page.tsx`
- `src/app/auth/callback/pageClient.tsx`
- `src/app/components/AddMileageForm.tsx`
- `src/app/components/AddServiceEventForm.tsx`
- `src/app/components/AddServiceItemForm.tsx`
- `src/app/components/AuthGate.tsx`
- `src/app/components/BottomNav.tsx`
- `src/app/components/DeleteLatestMileage.tsx`
- `src/app/components/DevToolsPanel.tsx`
- `src/app/components/EditLatestMileage.tsx`
- `src/app/components/HomeNeedsFirstReplacementBlock.tsx`
- `src/app/components/HomeSoonMaintenanceBlock.tsx`
- `src/app/components/ItemDetailsSheet.tsx`
- `src/app/components/LanguageSwitcher.tsx`
- `src/app/components/LocalDateTime.tsx`
- `src/app/components/MarkReplacementButton.tsx`
- `src/app/components/ModalSheet.tsx`
- `src/app/components/OdometerPreview.tsx`
- `src/app/components/StatusInfoTooltip.tsx`
- `src/app/components/StatusRow.tsx`
- `src/app/components/StatusRowCompact.tsx`
- `src/app/components/StatusRowDetail.tsx`
- `src/app/components/TopBreadcrumbsBar.tsx`
- `src/app/components/WheelPicker.tsx`
- `src/app/components/__tests__/authFlows.test.tsx`
- `src/app/components/__tests__/localeSwitch.test.tsx`
- `src/app/error.tsx`
- `src/app/globals.css`
- `src/app/history/components/DeleteLatestMileageButton.tsx`
- `src/app/history/components/EditLatestMileageButton.tsx`
- `src/app/history/loading.tsx`
- `src/app/history/page.tsx`
- `src/app/items/ItemsPageClient.tsx`
- `src/app/items/[id]/ItemDetailsPageClient.tsx`
- `src/app/items/[id]/loading.tsx`
- `src/app/items/loading.tsx`
- `src/app/layout.tsx`
- `src/app/loading.tsx`
- `src/app/login/pageClient.tsx`
- `src/app/manifest.ts` — удалён, заменён Route Handler и manifest factory
- `src/app/manifest.webmanifest/route.ts`
- `src/app/not-found.tsx`
- `src/app/page.tsx`
- `src/lib/auth/__tests__/middleware.test.ts`
- `src/lib/auth/browserSession.ts`
- `src/lib/i18n/__tests__/copy.test.ts`
- `src/lib/i18n/__tests__/sourceCopy.test.ts`
- `src/lib/i18n/client.tsx`
- `src/lib/i18n/copy.ts`
- `src/lib/i18n/en.ts`
- `src/lib/i18n/manifest.ts`
- `src/lib/i18n/routing.ts`
- `src/lib/i18n/server.ts`
- `src/middleware.ts`
