# MileKeeper: RU/EN, проверка и staged production deployment

Обновление: по последующему разрешению пользователя этот deployment опубликован на основном домене без новой сборки. [Отчёт promotion и финальной проверки](i18n-production-release-2026-10-09.md). Ниже сохранены результаты предварительной подготовки.

09.10.2026, Алматы. Проверка продолжает реализацию из `e0de9eb` и [отчёт локализации](i18n-implementation-report.md).

## Git и сохранность приложения

- Репозиторий: `/Users/stanislav/Mile_keeper`, ветка `codex/english-localization`.
- До проверки рабочее дерево было чистым; `e0de9eb55ee11c24d6f6c8cedecf79008756a711` сохранён.
- После `git fetch origin main` локальный main и origin/main совпадают: `fdf532f44f7298101f1f7d7e0cf387c1b2da0730`. Ветка содержит этот main; новых upstream commits и конфликтов нет.
- Код приложения, зависимости, lockfile, SQL, миграции, бизнес-расчёты и auth endpoints после `e0de9eb` не изменены. Исходный русский словарь побайтово соответствует main. Исправления безопасности этапов 1/2 сохранены.
- Подготовительный локальный commit: `b35e200c16bf91f7c94e4f0d5f55e3349fd9e41f`. Он добавляет только `.vercelignore` и расширяет browser runner. Этот commit загружен CLI как исходник deployment; push не выполнялся.

## Локальные проверки RU и EN

Production-сборка проверена в Chrome/Playwright с локальным read-only mock Supabase/OAuth и синтетическими записями. Внешние запросы браузера запрещены. Это проверка приложения, **не реальный Google OAuth E2E**.

Подтверждены:

- Главная, items, карточка обслуживания с вкладками history/calculation, odometer history, нижняя навигация и прямые URL обеих локалей.
- Переключение RU/EN с сохранением страницы, query/fragment, сессии и черновиков, обновление страницы, Back/Forward и обновление серверного текста.
- Добавление/редактирование пробега, добавление элемента, настройки элемента, запись замены; ошибки невалидного пробега/интервала, запрет пустого названия.
- Диалоги удаления и выхода; удаления записей не выполнялись. Формы отправлялись только с невалидными данными, которые отклоняются до server write.
- Локализованная ошибка API, отказ Google в общем callback, возврат на вход с правильной локалью, logout и повторный mock-вход RU/EN.
- `/en` и остальные проверенные английские экраны: нет русского системного текста в видимом содержимом и доступных aria-label/title/placeholder/alt. Русские личные названия, заметки и комментарии сохранены.
- Ширины 320, 390 и 1280 px: нет горизонтального переполнения. Скриншоты ошибок форм на 320 px просмотрены визуально; элементы и действия доступны.
- Английские и русские anonymous URL ведут на соответствующий login; общий callback URI остаётся `/auth/callback`, не `/en/auth/callback`.

Browser runner теперь действительно собирает `pageerror`: в исходном runner массив ошибок не имел обработчика. Расширенный прогон завершился успешно, **15 групп сценариев**, page errors отсутствуют.

## Тесты и сборки

| Проверка | Результат |
| --- | --- |
| `npm test` | PASS: 393 теста, 27 файлов |
| `npm run test:i18n` | PASS: 112 тестов, 5 файлов |
| `npx tsc --noEmit` | 14 прежних ошибок; вывод полностью совпадает с исходным baseline, новых 0 |
| `npm run lint` | Прежняя проблема `next lint`: `Invalid project directory provided ... /Mile_keeper/lint` |
| Production build для local fixture | PASS |
| Расширенный browser runner на production-сборке | PASS: RU/EN, 15 групп сценариев |
| Заключительный обычный `npm run build` | PASS; mock env не оставлен в локальной сборке |
| Удалённая production-сборка Vercel | PASS, READY |
| `git diff --check` | PASS |

Все ошибки TypeScript находятся в прежних fixtures тестов расчётов. Типы и проверки сборки не ослаблялись. Сохраняется предупреждение Next.js о middleware → proxy. Vercel также вывел предупреждение npm об install scripts esbuild/sharp; сборка успешно завершилась, зависимости не менялись.

## Обнаруженные проблемы

До загрузки выполнен `vercel deploy --dry --json`. Выяснилось, что CLI включал локальный `.env.vercel.production`, хотя он исключён из Git. Это исправлено явным `.vercelignore`: локальные env/credentials и generated output исключены, примеры env сохранены. Повторный dry-run подтвердил **0 локальных секретных env-файлов** в составе загрузки. До исправления deployment не выполнялся; значения секретов не выводились.

Коннектор Vercel вернул 403 доступа к team. Проверки и deployment успешно выполнены существующей авторизацией CLI в явно указанном team/project. Защита Vercel не отключалась и настройки доступа не менялись.

Новых дефектов самого приложения в выполненных сценариях не обнаружено. Исходные tsc/lint проблемы остаются техническим долгом.

## Подготовленный deployment

| Поле | Значение |
| --- | --- |
| ID | `dpl_5L2NaPNMtPGpG7QnRkH79FzqQFPp` |
| URL | [milekeeper-2xjoyceze-stanislavs-projects-b731a3ea.vercel.app](https://milekeeper-2xjoyceze-stanislavs-projects-b731a3ea.vercel.app) |
| Target / status | `production` / `READY` |
| Project | `milekeeper`, `prj_PYHA3h9zvVk1fFAvRnuwRo2vHcGA` |
| Team | `stanislavs-projects-b731a3ea`, `team_ZN6exgwzH7ryYe3obiWWfFXQ` |
| Source commit | `b35e200c16bf91f7c94e4f0d5f55e3349fd9e41f` |
| Implementation commit | `e0de9eb55ee11c24d6f6c8cedecf79008756a711` |
| Framework / Node.js | Next.js 16.1.1 / Node.js 24.x |
| Remote build duration | Около 25 секунд |

Создан через `vercel deploy --prod --skip-domain` в существующем проекте, с metadata releaseCommit/releaseBranch/i18nImplementationCommit. Production env взяты из существующих настроек Vercel, локальная fixture и её env не использовались для удалённой сборки. Env, cron, Supabase, пользовательские данные и Google provider не изменены.

`--skip-domain` сохранил основной домен. До и после deployment `milekeeper.vercel.app` указывает на **`dpl_6FVMye9i5uypGZJAyk91grWPoZUh`**; `project.targets.production.id` также остался этим ID. CLI назначил новой сборке служебный automatic alias `milekeeper-stanislavs-projects-b731a3ea.vercel.app`; основной сайт не переключён. Promotion, push и merge не выполнялись.

Уникальный URL защищён Vercel Authentication; это ожидаемая настройка существующего проекта. Для HTTP и браузерных запросов проверки используется `vercel curl` с существующей авторизацией CLI, строго для этого deployment. Ни долгоживущий secret, ни auth state в репозиторий не сохранялись.

## Проверки подготовленного deployment

**PASS: 18 HTTP-проверок и браузерные сценарии RU/EN.**

| Проверка | Результат |
| --- | --- |
| `/login`, `/en/login` | 200; соответствующие HTML lang и локализованный UI |
| `/`, `/items`, `/history`, `/items/[id]` без сессии | 307 → `/login`, `no-store` |
| `/en`, `/en/items`, `/en/history`, `/en/items/[id]` без сессии | 307 → `/en/login`, `no-store` |
| RU/EN manifest | 200; общий id/scope, правильные lang/start_url |
| sync без Origin и с чужим Origin | 403 |
| sync с правильным Origin, но без токенов | 400 |
| logout с чужим Origin | 403 |
| logout с правильным Origin без пользовательской сессии | 200; очищение cookies только проверочного клиента |
| service-events без сессии | 401 |

В Chrome на самом deployment проверены RU/EN login и ошибки входа, переключение с сохранением query, refresh, отсутствие русского системного текста в английском login, общий callback с `error=access_denied`, локализованная ссылка возврата и вёрстка 320 px. Скриншоты просмотрены визуально. Page errors отсутствуют.

Нажатие Google-кнопки в обеих локалях создаёт запрос с `provider=google` и `redirect_to=https://milekeeper-2xjoyceze-stanislavs-projects-b731a3ea.vercel.app/auth/callback`; locale cookie и sessionStorage сохраняют соответствующее `ru`/`en`. Навигация на внешний OAuth endpoint перехвачена до отправки запроса. Это **проверка параметров приложения**, не вход в Google.

Браузерные запросы на защищённый origin передавались через CLI с существующей Vercel-авторизацией; защита не отключалась. Playwright не перехватывает всю native redirect chain, поэтому защищённые редиректы проверены отдельными HTTP-запросами, а browser smoke открывает login напрямую.

Приватные страницы на этом deployment **не проверены с настоящей Session**: здесь проверены их anonymous guards, а authenticated UI/формы — локально с fixture. Доступность данных реального пользователя и реальный OAuth не заявляются как подтверждённые.

Runtime error scan содержит одну ожидаемую запись `[API /service-events] ... Not authenticated` с HTTP 401 от контрольного анонимного запроса. Неожиданных 5xx и runtime errors в проверенном окне не обнаружено. Это прежнее логирование auth denial, auth endpoint не изменялся.

Логи и скриншоты сохранены в `/Users/stanislav/Documents/ChatGPT/MileKeeper/artifacts/i18n-readiness/`. Для HTTP-повторения используется `vercel curl <path> --deployment <unique-url> --scope stanislavs-projects-b731a3ea`; auth-state/секреты в артефакты не включены.

## Готовность к promotion

Реальный вход в Google не выполнялся. Mock и перехват OAuth navigation подтверждают параметры и маршрутизацию, но не проверяют Google consent, разрешение staged callback URL в Supabase, выдачу настоящей Session и успешную синхронизацию этой Session. Поведение установленной PWA на физическом устройстве также остаётся ручной проверкой.

Перед promotion нужна ручная приёмка на подготовленном URL: вход из RU и EN, возврат в исходную локаль, refresh, переключение, logout и повторный вход; отдельно запуск/refresh/возобновление установленной PWA. Если существующий redirect allowlist не допускает staged callback, не менять настройки автоматически: согласовать безопасный способ ручной проверки с пользователем.

Deployment подготовлен для этой приёмки. Публикация основного сайта ожидает отдельного разрешения пользователя. Непроверенный OAuth E2E не считается пройденным.

После проверки работа остановлена. Этот отчёт добавлен отдельным локальным commit после deployment и не меняет загруженную сборку `b35e200`.

Механизм staged deployment подтверждён [документацией Vercel CLI deploy](https://vercel.com/docs/cli/deploy); общий callback соответствует [Supabase Google OAuth](https://supabase.com/docs/guides/auth/social-login/auth-google).
