# Мобильная авторизация и Keep Alive — 12 октября 2026

Исправление подготовлено в `/Users/stanislav/Mile_keeper`, ветка
`codex/mobile-auth-recovery`. До изменений локальный код и действующий production
соответствовали `664da09360585267c4ea0dfd4d47f8bd61bc8db1`, deployment
`dpl_331JSB9NvYozWnsuAwfcF7E4EfjN`. Production не переключался.

## Дополнение 13 октября: прямое открытие `/` и ручной `/login`

Новое наблюдение с реального телефона: корневой адрес показывал точный текст
ошибки refresh, но ручное открытие `/login` позволило успешно авторизоваться.
Это согласуется с подтверждённой разницей маршрутов в production-коде `664da09`:
`/login` и `/en/login` публичны и проходят middleware до проверки cookies;
`/` и `/en` защищены и раньше выполняли refresh при просроченном AT.
При неопределённом результате обмена этот refresh выдавал text/plain 503/429
вместо интерфейса. На `/login` пользователь мог начать новую Google-сессию,
минуя серверный обмен старого RT. Наблюдение подтверждает различие путей входа,
но не определяет исходную внутреннюю причину сетевого/неизвестного отказа.

**Что уже было исправлено 12 октября:** текстовый ответ middleware удалён;
действительные cookies ведут непосредственно в приложение, неполная/просроченная
cookie-пара ведёт на recovery; SDK-сессия может восстановить потерянные cookies;
недействительный RT даёт Google-вход; временный отказ не удаляет cookies.
Повторно менять middleware или добавлять второй механизм восстановления не понадобилось.

**Потребовались дополнительные исправления по уточнённым требованиям и production-проверке:**

1. Cookie recovery различает отсутствие RT (`missing_session`) и отказ существующего
   RT. Только после проверки, что браузерная сессия тоже отсутствует, recovery
   направляет на `/login` либо `/en/login`. Раньше отсутствие обоих хранилищ
   показывалось как отклонённая сессия. Наличие SDK-сессии без cookies по-прежнему
   восстанавливается автоматически. Отказ 429/503 не означает отсутствие сессии.
2. На самой странице login ошибки AuthGate и Retry показываются встроенно,
   чтобы не перекрывать Google-кнопку модальным диалогом. В приватном приложении
   диалог сохранён: он не размонтирует открытую форму и не стирает черновик.
   Признак отсутствия сессии не вызывает автоматический переход из открытой формы.
3. На `/auth/recover` отключён prefetch меню, как уже было сделано для login/callback.
   Это существенный дефект предыдущей подготовки: в production BottomNav успевал
   предварительно запросить защищённую страницу до записи свежих cookies. Next.js
   сохранял перенаправление обратно на recovery в клиентском Router Cache. Даже
   после sync 200, принятой SDK пары и согласованных свежих cookies пользователь
   оставался на recovery. Dev-прогон не выявлял это, поскольку prefetch ведёт себя
   иначе вне production. Отключение prefetch одной строкой устранило этот отказ
   на `next start`; HTTP no-store сам по себе не очистил клиентский Router Cache.
4. Переход из recovery учитывает новое подтверждение cookies и завершение общей
   синхронизации, даже если подписка подключилась уже после её публикации.
   Исходный snapshot authed не разрешает переход до проверки. Принудительная
   проверка может разделить выполняющийся реальный sync, но не подменяется
   подтверждением из памяти. При отказе нового sync прежнее подтверждение
   сбрасывается. Дополнительные регрессии проверяют эти гонки и предотвращение
   ложного возврата на корневой маршрут с устаревшими cookies.

| Состояние при прямом открытии | Проверенное поведение |
| --- | --- |
| Действительная cookie/SDK-сессия | `/` или `/en`, без посещения login/recover |
| Нет SDK-сессии и cookie RT | Проверка recovery → `/login` или `/en/login` |
| Есть действительная SDK-сессия, cookies устарели | Автоматический sync → приложение |
| Есть только действительная cookie-сессия | Recovery принимает новую пару в SDK → приложение |
| RT окончательно отклонён | Recovery с Retry и Google-входом, без автоматического цикла |
| Сеть/сервис временно недоступны | Recovery с Retry; cookies сохраняются |
| Ручной `/login` после временного отказа на `/` | Google-кнопка доступна; повторный вход проходит |

Регрессии до дополнительных правок: пять отказов различения отсутствующей сессии
и маршрута login, затем отдельный отказ теста модального перекрытия login и
отказ теста перехода после последующей успешной синхронизации.
После правок они проходят. Артефакты этого продолжения сохранены отдельно:
`artifacts/mobile-auth-recovery/root-entry-2026-10-13/`.

Проверка Service Worker/кэша: регистрации worker, worker-файлов и PWA caching
плагина в текущем приложении нет. В чистых браузерных контекстах registrations — 0.
Документы `/`, `/en`, login, recovery и их перенаправления имеют no-store;
manifest остаётся публичным с кэшем 1 час, start_url `/` и `/en`, scope `/`.
Ни manifest, ни версия статических Next chunks не содержат самостоятельного
механизма авторизации. Очистка storage/cookies/cache реального телефона не выполнялась.
Отдельно проверен клиентский Router Cache Next.js: описанный выше устаревший
prefetch redirect воспроизведён и устранён. Существующие `.env`, storage и
пользовательские данные для этого не очищались. [Официальное описание Link
prefetch и клиентской навигации](https://nextjs.org/docs/app/api-reference/functions/use-router).
Неизвестное состояние старого браузерного контекста на самом телефоне по-прежнему
недоступно; новый код попадёт туда после развёртывания и новой загрузки документа.

Итоговая проверка 13 октября:

- Полный Vitest: **496 тестов, 33 файла**, успешно (`tests.txt`).
- Production-сборка для браузерной проверки с локальной fixture: успешно.
- Production-сборка с обычной конфигурацией проекта: успешно (`build.txt`).
- Отдельный TypeScript-check: прежние 14 ошибок; отличие от baseline пустое
  (`tsc-diff.txt`). Новых ошибок нет. `git diff --check` проходит.
- Browser matrix на `next start`: **33 из 33 сценариев проходят**, browser runtime
  errors — **0** (`browser-results.json`).
  Матрица покрывает RU/EN × valid/absent/invalid × direct/reload/new-tab/manifest
  start_url, публичное demo и ручной обход `/login`; предыдущие сценарии
  восстановления, сети и сохранения черновика также включены.
- Для reload смена синтетического состояния выполняется после завершения
  исходного sync. Иначе в метрику проверяемого refresh попадал ещё выполняющийся
  refresh подготовки сценария. Ограничения числа запросов не ослаблялись.
- При проверке EN два теста сначала ожидали неверные тексты кнопок: реальные
  кнопки называются `Continue with Google` и `Try again`. Снимки показали корректный
  login/recovery; исправлены только соответствующие тестовые selectors.
- Реальные Google OAuth, Safari/iOS и запуск установленной PWA не автоматизированы.
  Проверка manifest start_url не равна испытанию установки на физическом телефоне.

Ветка предназначена для **единого** production-развёртывания всех auth-изменений.
Развёртывание, push, миграции, изменение Google/Supabase настроек и пользовательских
данных в этом продолжении не выполнялись. Предыдущий список ручной приёмки остаётся
обязательным; дополнительно открыть корневой адрес из закладки, сделать reload и
запустить PWA без сессии, с действительной и с недействительной сессией.

## Причина и границы доказательств

Источник точного английского текста — перевод в `src/lib/i18n/en.ts`.
До исправления его отправлял `src/middleware.ts`, когда cookies содержали пару
AT/RT, AT был просрочен или близок к истечению, а `refreshAccessToken()` возвращал
`status: error`. Ответ был text/plain с 429 для rate-limit и 503 для остальных
ошибок. JavaScript приложения, AuthGate и кнопки восстановления не загружались.
Это установленная причина тупикового экрана.

`refreshAccessToken()` различает окончательный отказ и неопределённый результат:
сеть/таймаут, HTTP 408/5xx, 429, неизвестный код 4xx, повреждённый JSON или неполную
успешную пару. Известные `refresh_token_not_found` и
`refresh_token_already_used` относятся к invalid и **не** вызывают это сообщение:
раньше они очищали cookies и перенаправляли на login.

Read-only Supabase проверка подтвердила ACTIVE_HEALTHY. В доступных последних
24 часах найдены 14 отказов `refresh_token_not_found` (400). Они не содержат
достаточной связи с конкретным устройством/ответом middleware. Поэтому невозможно
по этим журналам установить, был ли исходный телефонный сбой вызван сетью,
расхождением копий токенов или ранее отозванной сессией. Проверка не извлекала
refresh tokens, access tokens, cookies или bodies реальных пользователей.

Найдены два подтверждённых дефекта жизненного цикла сессии:

1. Middleware независимо вращал серверную копию RT и не передавал новую пару в
   SDK storage. Браузерный SDK также выполнял refresh, а endpoint sync выполнял
   дополнительный проверочный exchange. Параллельные RSC/prefetch запросы не были
   согласованы с браузерной очередью. Даже успешный серверный refresh оставлял
   браузерную копию другой генерации; серверный setSession при истечении AT тоже
   мог вращать RT без сохранения. Это риск повторного использования RT.
2. `BrowserSession.logout()` вызывал `signOut()` без scope. В JavaScript SDK
   default — global, который отзывает RT других устройств. Действующий аудит
   `docs/auth-security-stage-2.md` явно сохранил этот scope; он противоречит
   требованию независимых сессий устройств.

История: `a6d01e5` перенёс refresh в middleware, `c550a4c` добавил строгую
валидацию sync и управление ошибками, `47a18ee` исправил отправку полной SDK Session
вместо двух полей. Последнее исправление остаётся действующим; серверные проверки
Origin, JSON, размера, getUser, user_id/session_id не ослаблены.

## Изменения

- Middleware перестал выполнять refresh. Просроченные/неполные cookies направляют
  на публичный `/auth/recover?next=…` без удаления cookies. Эта страница не читает
  пользовательские данные; маршрут возврата ограничен allowlist app routes.
- Страница выполняет один согласованный recovery flight. Действительная SDK
  session обновляется при необходимости и проходит существующий строгий sync;
  возвращённая пара принимается SDK до перехода на защищённую страницу.
- Новый POST `/api/auth/recover` восстанавливает cookie-only session, если SDK
  storage отсутствует или окончательно отклонён. Он требует same-origin Origin,
  JSON и пустой объект, проверяет RT обменом через Supabase Auth, возвращает только
  новую пару с no-store и пишет ту же пару в HttpOnly/Secure/SameSite=Lax cookies.
  Исходные cookies без проверки клиенту не возвращаются.
- Временные ошибки сохраняют сессию и дают кнопку «Повторить». Транспорт имеет
  максимум один автоматический повтор сети/5xx; 401 и 429 автоматически не повторяются.
  Повторные SDK события не повторяют отказавший cookie recovery бесконечно.
- Окончательный отказ даёт Google-вход. `?reauth=1` на странице login позволяет
  начать вход, даже если SDK ещё хранит отвергнутую сервером сессию. Callback и
  защиту одноразового OAuth code сохранили. Переход из recovery ждёт результата
  текущей синхронизации, а не прежнего состояния authed.
- SDK SIGNED_OUT от отказа refresh больше не очищает cookies и не перенаправляет
  открытые формы. Recovery dialog появляется поверх существующей modal sheet;
  Google-вход открывается в новой вкладке. Возврат в исходную вкладку и повтор
  синхронизируют сессию без сброса введённых значений. Сохранение записи пользователем
  не повторяется автоматически: нет риска продублировать неизвестный результат записи.
- Явный выход использует `signOut({ scope: 'local' })`. Другие устройства не отзываются.
- Серверные чтения/действия используют `getUser(accessToken)` и тот же Authorization
  JWT для PostgREST/RLS, без refresh внутри setSession. Клиент request-scoped;
  служебный ключ не используется для пользовательских операций.
- После pageshow/возврата видимости/online действительная сессия сверяется с SDK.
  Ошибку эти события не запускают по кругу. Межвкладочный lock имеет таймаут
  ожидания 10 секунд; его отказ отображается с возможностью повторить. RU/EN
  recovery сохраняет язык URL.

Браузерный клиент — singleton, supabase-js/auth-js 2.90.1 по lockfile. SDK defaults:
persistSession/autoRefreshToken/detectSessionInUrl включены, flowType — implicit.
Google redirectTo остаётся `${window.location.origin}/auth/callback`. Код callback
также поддерживает code exchange. Настройки Google/Supabase и redirect allowlist
не менялись. В предыдущем отчёте staged OAuth возвращался на production; поэтому
реальный вход на произвольном preview не является доказанной проверкой этого выпуска.

Service Worker не регистрируется и не входит в текущую реализацию PWA. Manifest и
icons публичны; документы/auth ответы no-store, статические Next chunks имеют
версионные имена. Причина в Service Worker не установлена; состояние старой
установки на телефоне недоступно. Браузерное хранилище пользователя не очищалось.

## Проверки

История и baseline: 455 тестов проходили до изменений; отдельный tsc имел 14 ошибок
в старых тестах расчётного движка. Исходные выводы сохранены в
`artifacts/mobile-auth-recovery/`.

- Полный Vitest: 482 теста, 33 файла, все проходят (`tests-after.txt`).
- Production build проходит (`build.txt`).
- TypeScript: вывод до/после сравнивается побайтно; новых ошибок нет.
- `npm run lint` не выполняет lint: текущий `next lint` не поддержан Next 16,
  команда завершается `Invalid project directory …/lint`. Конфигурация не менялась.
- `git diff --check` проходит.
- Семь браузерных сценариев на локальном синтетическом провайдере: expired restore,
  stale cookies + valid SDK, cookie-only restore, 503 + manual retry, network failure
  + retry, invalid RT + Google re-login, invalidation при редактировании + re-login
  в другой вкладке с сохранением введённого пробега. `browser-results.json` и PNG
  фиксируют результаты. Все 7 сценариев проходят, browser runtime errors — 0;
  запросы данных проверены на передачу в PostgREST валидированного user JWT.
  Обращения за пределы localhost блокировались, реальные
  записи не создавались. Тестовый провайдер вращает синтетические RT.
- Браузер: Chromium, 390×844, touch/mobile и iPhone user agent. Это не настоящий
  Safari/iOS. Доступный runtime ожидает WebKit binary, которого нет; реальный
  iPhone и установленная PWA не проверялись. Google заменён локальной fixture;
  реальный OAuth требует ручной приёмки после развёртывания.

В серверных dev-логах остаётся прежняя ошибка синхронного `cookies().get` в
неизменённом `appCookieBridge.ts` (app mode/time fallback) и диагностический
вывод тестовых данных. Она не относится к Auth; успешный browser flow не означает,
что все существующие серверные диагностические сообщения устранены.

При повторном браузерном прогоне один шаг Google-входа не выполнился: тест нажимал
серверно отрисованную кнопку до завершения загрузки страницы. Тест теперь ждёт
networkidle после перехода на login и открытия новой вкладки. Окончательный
прогон всех семи сценариев прошёл после этого изменения.

Запуск: `npm test`, `npm run build`, `npx tsc --noEmit --incremental false`,
`npm run test:auth-recovery:browser` (нужны Playwright и Chrome; можно передать
`MILEKEEPER_PLAYWRIGHT_PATH`, не устанавливая production-зависимости).

Сохранность черновика подтверждена для открытой вкладки и формы. Приложение уже
хранит формы в React state; полноценной offline очереди или стойкого draft store
нет. Эта правка не гарантирует сохранение черновика при принудительном закрытии
вкладки/удалении данных браузера/выгрузке приложения самой iOS. При ручной приёмке
нужно проверить, что PWA и Safari делят либо корректно восстанавливают свой контекст
сессии: новая вкладка может оказаться отдельным Safari storage context.

## Keep Alive

Read-only SQL: 31 запись, RLS включён; за 28 сентября — 11 октября включительно
по одной записи ежедневно. Последний ping: 2026-10-11 12:34:56.920 UTC
(17:34:56.920 Алматы). Данные совпадают с отправной точкой пользователя.

Живой Vercel CLI/API: cron enabled, undeployed/modified пусты; `/api/keep-alive`,
`0 12 * * *`, deployment `dpl_331JSB9NvYozWnsuAwfcF7E4EfjN`. `live-cron.json`
содержит фактическое расписание. План Vercel Hobby; ежедневный запуск имеет окно
12:00–12:59 UTC (17:00–17:59 Алматы), поэтому успешные пинги в 12:34 нормальны.

Handler проверяет CRON_SECRET, вставляет запись через серверный admin client и
удаляет только старые pings старше 30 дней. Ошибка insert даёт 500. Handler не
использует пользовательский refresh token. Keep Alive не продлевает Auth session.
Таблица, RLS, реализация и расписание не менялись; ручной ping не запускался.

План организации Supabase подтверждён read-only как Free. Актуальный отдельный
документ Project Pausing уточняет: обычно нескольких пользовательских запросов к
БД каждый день за предыдущую неделю достаточно, чтобы избежать паузы. Точного
численного порога и гарантии для одного запроса в день нет. Текущий **один cron
запуск** делает **два запроса к БД** (insert и delete); он не равен одному запросу.
Данные доказывают, что этот механизм работает, проект здоров, а пинги регулярны.
Поэтому код и расписание сохранены. При желании добавить запас от временных
отказов можно запускать тот же endpoint 3 раза в день, сохранив таблицу и handler;
это не является гарантией на Free. Для одного cron на Vercel Hobby выражение
`0 */8 * * *` недопустимо; понадобится подходящий внешний scheduler либо Vercel Pro.
Supabase исключает паузу по inactivity для платных проектов.

Источники, проверенные 12 октября 2026:

- [Supabase Project Pausing](https://supabase.com/docs/guides/platform/free-project-pausing)
- [Supabase production checklist](https://supabase.com/docs/guides/deployment/going-into-prod)
- [Supabase sessions и RT rotation](https://supabase.com/docs/guides/auth/sessions)
- [Supabase signout scopes](https://supabase.com/docs/guides/auth/signout)
- [Google OAuth](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Vercel cron limits и точность Hobby](https://vercel.com/docs/cron-jobs/usage-and-pricing)

## Развёртывание и ручная приёмка

Нужно развернуть весь изменённый Next.js frontend/backend/middleware одним выпуском
на существующем Vercel project. Новый route должен выйти одновременно с recovery UI.
Миграций, новых env, таблиц, изменений RLS или Google OAuth настроек нет.
На момент завершения диагностики код ещё не отправлялся в GitHub; основной домен не переключался.

После сборки и smoke проверок staged deployment принять выпуск реальным Google
login на согласованном домене. Сохранить rollback deployment ID выше; при отказе
реального входа вернуть прежний deployment. Не объявлять проблему телефона
закрытой до его проверки.

На телефоне, отдельно в Safari и установленной PWA:

1. Открыть приложение с существующей сессией, затем reload и возврат после фонового
   режима. При valid session должны появиться свои данные без тупикового текста.
2. При временной проблеме сети повторить восстановление после её возврата.
3. При недействительной сессии войти через Google; проверить возврат на свой язык
   и данные. Убедиться, что старый вход не отправляет по кругу login/home/recover.
4. Открыть форму, ввести несохранённый пробег/заметку; пройти восстановление,
   вернуться в исходную вкладку и проверить введённые значения до ручного сохранения.
5. Выйти на телефоне и убедиться после очередного refresh, что iMac остаётся
   авторизован. Повторить вход на телефоне.
6. Сверить отсутствие новых серий refresh ошибок и продолжение ежедневного Keep Alive.

## Подготовка контролируемого релиза — 13 октября 2026

После `git fetch` исходная ветка `codex/mobile-auth-recovery` основана на
`664da09360585267c4ea0dfd4d47f8bd61bc8db1`, совпадающем с `origin/main`
и действующим production. Выпускается полный комплект: middleware, cookie recovery
API, browser coordinator, recovery UI, сохранение форм, локальный signout, RLS client,
RU/EN и регрессионные тесты. Зависимости и lockfile не менялись.

Локальные `artifacts/` содержат результаты проверок и не включаются в commit.
Для загрузки на Vercel используется чистый `git archive` выбранного commit;
локальные env, credentials, сборка и тестовые артефакты не загружаются.
Связь с существующим project передаётся только через его projectId/orgId.

Подтверждён существующий project `milekeeper` (`prj_PYHA3h9zvVk1fFAvRnuwRo2vHcGA`),
team `stanislavs-projects-b731a3ea`, production branch `main`, Node.js 24.x.
На Vercel присутствуют все шесть прежних production env: SUPABASE_URL,
SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL,
NEXT_PUBLIC_SUPABASE_ANON_KEY и CRON_SECRET. Значения не изменяются.
Read-only запрос Supabase Auth settings подтвердил, что Google provider включён
в прежнем проекте. `signInWithOAuth` и callback не менялись: redirect остаётся
`${window.location.origin}/auth/callback`. Новые OAuth allowlist/client settings
не требуются для основного домена. Полный live allowlist не перечитывался;
настоящий Google OAuth на новой версии подтверждается ручной приёмкой после выпуска.

План выпуска: push только feature branch → production build через
`vercel deploy --prod --skip-domain` → smoke отдельного deployment → окончательное
подтверждение пользователя → promotion того же build. В `main` до подтверждения
ничего не отправляется. Keep Alive, схема БД и пользовательские данные не меняются.

Rollback deployment проверен как READY:
`dpl_331JSB9NvYozWnsuAwfcF7E4EfjN`,
`https://milekeeper-cqqtvbf2g-stanislavs-projects-b731a3ea.vercel.app`.
Основной домен `https://milekeeper.vercel.app` пока указывает на него.
Команда немедленного отката после promotion:
`vercel rollback dpl_331JSB9NvYozWnsuAwfcF7E4EfjN --scope stanislavs-projects-b731a3ea --yes`.

До финального подтверждения production не переключается. Реальный Google login,
Safari/iOS и установленная мобильная PWA остаются обязательной ручной приёмкой.

### Staged build готов к окончательному подтверждению

Полный комплект исправлений сохранён и отправлен в GitHub:
`02ee4d0ba8df1de461c8ff53f1b03108451cdc74` в `codex/mobile-auth-recovery`.
Tracked working tree после commit чист; untracked `artifacts/` остаются локальными
и не входят ни в commit, ни в загрузку. Проверка секретов охватила все новые/изменённые
файлы и весь исходный архив: совпадений для private keys, real JWT literals,
Supabase secret keys, GitHub/Google/Vercel tokens нет. Это проверка известных
шаблонов и просмотр diff, а не абсолютная гарантия отсутствия любого вида секрета.

Vercel Git integration успешно создала preview этой ветки; production-сборка
отдельно создана штатным CLI через `--prod --skip-domain`, с неизменными
production env и metadata, указывающей полный SHA исходного commit.
251 загружаемый файл сверён с SHA-256 manifest чистого архива. Зависимости
установлены из прежнего lockfile, remote `next build` прошёл на Node.js 24.x.

- Staged deployment: `dpl_3914nXp5RTh2MiyCox25ocFN5fEQ`, **READY**, target production.
- URL: `https://milekeeper-rj9kowzaw-stanislavs-projects-b731a3ea.vercel.app`.
- Source commit: `02ee4d0ba8df1de461c8ff53f1b03108451cdc74`.
- Production: `https://milekeeper.vercel.app`, пока прежний
  `dpl_331JSB9NvYozWnsuAwfcF7E4EfjN`; оба production aliases не изменены.
- Promotion этого production build не требует повторной сборки.

Предварительные проверки через authenticated `vercel curl`: **13/13 passed**.
Без credentials `/` и `/en` отвечают 307 на `/auth/recover` с правильным `next`;
RU/EN login и recovery HTML отвечают 200 и содержат локализованный интерфейс.
Оба demo отвечают 200. Оба manifests имеют правильные start_url и scope.
Recovery API без cookies даёт 401 `missing_session`, с чужим Origin — 403,
с неожиданным JSON — 400. Ответы auth не меняют cookies и имеют no-store.
Не запускались реальные RT exchanges, запись данных или Keep Alive endpoint.

В 16 опубликованных client chunks подтверждён прежний Supabase project URL;
локального fixture URL и Supabase secret key strings нет.
Журнал staged deployment за окно smoke-проверок: **0 error entries**.
Это ограниченная read-only проверка HTTP и серверных журналов, не проверка
настоящего Google входа или установленной iOS PWA. Локальные 496 тестов и
33 browser scenarios с synthetic provider относятся к тому же коду релиза.
Прежние ограничения tsc/lint, описанные выше, сохраняются.

Последняя проверка Vercel подтвердила прежние production target, aliases и
cron deployment, а GitHub `main` остался на `664da09`. Rollback deployment READY.
Перед promotion требуется окончательное подтверждение пользователя.
После подтверждения проверить основной домен и журналы, затем вручную принять
Google OAuth и мобильную PWA. Изменение этого раздела отчёта отдельным docs commit
не меняет исполняемый код staged build.

## Production promotion выполнен — 13 октября 2026

Пользователь явно подтвердил promotion именно
`dpl_3914nXp5RTh2MiyCox25ocFN5fEQ` на `milekeeper.vercel.app`.
13 октября около **03:04 UTC** штатная команда
`vercel promote dpl_3914nXp5RTh2MiyCox25ocFN5fEQ --scope stanislavs-projects-b731a3ea --yes`
завершилась успешно. Основной production URL: **https://milekeeper.vercel.app**.
Исполняемый код — source commit `02ee4d0ba8df1de461c8ff53f1b03108451cdc74`.

Promotion выполнен без новой сборки: deployment ID, createdAt, buildingAt и ready
совпали с проверенным staged build. Vercel project production target и отдельный
API `/v4/aliases/milekeeper.vercel.app` подтвердили назначение нового deployment.
Поле `alias` в исходном deployment record не использовалось как единственное
доказательство назначения: после promotion оно сохраняло старый список.
Новые deployments для выпуска не создавались; `main`, настройки env/OAuth,
код Keep Alive, схема БД и пользовательские данные не менялись.

Проверки на основном production-домене:

- **13/13 HTTP smoke passed**: `/`, `/en`, RU/EN login, RU/EN recovery,
  RU/EN demo, оба manifests и безопасные recovery API проверки.
- **14/14 browser smoke passed** в изолированных анонимных Chrome contexts с
  мобильным viewport: прямое открытие, reload, новая вкладка из закладки,
  manifest start_url, отдельный login/recovery и demo для RU/EN.
  `/` без сессии завершает цепочку на `/login`, `/en` — на `/en/login`.
  Проверены доступность Google-кнопок, завершение навигации и ограниченное число
  запросов. Циклических редиректов, client runtime errors и ответов 5xx нет.
- Vercel logs нового deployment с 03:04 UTC за окно smoke: **0 error entries,
  0 server 5xx**. Отдельные 400/401/403 recovery API были ожидаемыми отрицательными
  проверками без credentials, а не ошибками восстановления реальной сессии.
- Supabase Auth за **03:03:50–03:07:14 UTC**: 19 событий,
  **0 Invalid Refresh Token**, **0 error/fatal level events**.
  Результат относится к короткому окну наблюдения и не заменяет настоящий вход.

Keep Alive проверен read-only: Supabase project ACTIVE_HEALTHY, 31 ping,
два за последние 48 часов; последний успешный ping —
**2026-10-12 12:34:56.905 UTC**. Vercel cron enabled, undeployed/modified пусты,
тот же endpoint `/api/keep-alive` и schedule `0 12 * * *`; scheduler теперь
назначен новому production deployment. Следующее обычное окно —
**13 октября 12:00–12:59 UTC / 17:00–17:59 Алматы**. Первый плановый ping после
этого promotion ещё не наступил на момент проверки; вручную endpoint не вызывался.
Работа последнего планового запуска и сохранение активного расписания подтверждены.

Rollback `dpl_331JSB9NvYozWnsuAwfcF7E4EfjN` сохранён и повторно проверен READY.
Команда отката из раздела выше остаётся действительной. Критическая проблема
не подтверждена; откат не выполнялся. Реальный Google OAuth, Safari/iOS и
установленная мобильная PWA остаются на отдельную ручную приёмку пользователя.

Результаты сохранены локально в `artifacts/mobile-auth-recovery/release-2026-10-13/`:
`production-release.json`, `production-smoke.json`, `production-browser.json`,
`production-log-summary.json`, `production-supabase-summary.json`.
Этот итоговый раздел обновлён локально без push, чтобы не запускать дополнительную
Git preview-сборку. Исполняемый production build не изменён.
