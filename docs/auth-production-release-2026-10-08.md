# Production deployment этапов 1 и 2

**Актуальный статус 09.10.2026:** этот выпуск откатан из-за HTTP 400 на sync
реальной SDK Session. На основном сайте снова `dpl_6YuVrfWqNToSyhqRRVn4HKhSNfWM`.
Исправление подготовлено в Git без повторного deployment;
[отчёт инцидента](auth-sync-incident-2026-10-09.md). Ниже сохранён исходный отчёт
публикации 08.10, а не описание текущего production.

08.10.2026; post-deploy проверка примерно 18:10 UTC / 23:10 Алматы.
Выполнено по отдельному разрешению пользователя. Другие этапы аудита не запускались.

## Версия и сохранность изменений

- Сайт: https://milekeeper.vercel.app
- Vercel project: `milekeeper`, `prj_PYHA3h9zvVk1fFAvRnuwRo2vHcGA`.
- Team: `stanislavs-projects-b731a3ea`, `team_ZN6exgwzH7ryYe3obiWWfFXQ`.
- Опубликован исходный коммит `950b6bf3cb0ed143a129a7572fc3db71be077ad0`
  ветки `codex/auth-security-stage-2`.
- Deployment: `dpl_9M6xLttVHnwgZmp5zEWY4QCgduTH`, production, `READY`.
- URL сборки: https://milekeeper-elbu73z16-stanislavs-projects-b731a3ea.vercel.app
- Metadata deployment содержит полный `releaseCommit` и `releaseBranch`.

В опубликованную версию входят checkpoint этапа 2 `c550a4c` и этап 1 `7705929`.
Миграции, отчёт этапа 1 и его SQL-test runner сохранены без изменений. Перед
выпуском рабочее дерево было чистым. Этот отчёт добавлен после выпуска и не
меняет опубликованный код. Push и merge в main не выполнялись.

Production branch интеграции Vercel остаётся `main`, с прежним кодом. Следующий
автоматический deployment старого main может перезаписать ручной выпуск.
Перед следующей публикацией нужно согласовать Git с опубликованной версией;
настройки веток и автоматизация сейчас не изменялись.

## Проверки и production-конфигурация

| Проверка | Результат |
| --- | --- |
| `npm test` | 328 тестов, 24 файла — успешно |
| `npm run test:db-security` | Успешно; изолированный временный локальный PostgreSQL |
| `npm run build` | Успешно |
| `npx tsc --noEmit --incremental false` | Те же 14 ошибок; вывод совпадает с baseline этапа 2 |
| `npm run lint` | Прежняя ошибка `next lint`; lint фактически не выполнен |
| Vercel remote build | Успешно, production env, Node.js 24.x, Next.js 16.1.1 |

Серверный и браузерный URL указывают на `Mile_Keeper`, ref
`nsmdouxbxajiyjqxgqml`; публичные ключи совпадают. Production использует современные
publishable/secret keys; серверный secret не используется как публичный ключ.
Dev guest mode выключен. Read-only `/auth/v1/health` отвечает 200 с публичным
и серверным ключами; `/auth/v1/settings` — 200, Google включён.

`CRON_SECRET` присутствует как sensitive env; его значение нельзя скачать.
Секрет не заменялся placeholder. Env не менялись; значения не выводились и не
попадали в Git. Временный секретный файл после проверки удалён.

Deployment выполнен из временного Git archive конкретного коммита. Dry-run
подтвердил Next.js и отсутствие локальных env в upload. Production-переменные
предоставлял Vercel при удалённой сборке; локальный prebuilt не использовался.
Сначала `--prod --skip-domain`, проверки отдельного URL через авторизацию CLI,
затем promotion конкретного ID. API Vercel подтвердил новый `targets.production`.
Deployment Protection не отключалась.

## Проверки опубликованного сайта

Запросы без пользовательских cookies, без создания записей в Supabase.

| Проверка | Результат |
| --- | --- |
| `/login` | 200, Google-кнопка доступна |
| `/` и `/items` без сессии | Редирект на `/login`, без цикла |
| API service-events с itemId, без сессии | 401, `Not authenticated` |
| POST sync, чужой Origin | 403 |
| POST sync, правильный Origin, `text/plain` | 415 |
| POST sync, правильный Origin, JSON без токенов | 400 |
| POST logout, чужой Origin | 403 |
| Keep-alive без авторизации | 401; серверный вызов с записью не выполнялся |
| Manifest и три указанные в нём PNG-иконки | 200, правильные MIME/signature, без редиректа на login |
| Настоящий Chrome, страница login | Отображается, ошибок console на момент проверки нет |
| Vercel logs нового deployment | За короткое окно наблюдения ответов 5xx не найдено |

В error logs есть две ожидаемые записи `Not authenticated` от собственных
негативных проверок service-events до/после promotion. Endpoint логирует отказ
через console.error, но возвращает 401. Неожиданных серверных ошибок в
просмотренном окне нет; это не гарантия отсутствия ошибок под будущей нагрузкой.

## Google OAuth и ручные проверки

Успешный первый Google-вход на **предыдущей** production-версии подтверждён
пользователем. Он не засчитывается как OAuth E2E новой версии. После публикации
в Chrome открыта страница входа нового сайта и запрошено участие пользователя.
На момент отчёта фактический Google-вход после обновления **не подтверждён**.

Нужно проверить вход → главная → reload, две вкладки, выход → reload → повторный
вход и те же действия в установленной PWA. Пароли, коды, cookies и токены
присылать не нужно. Network outage, 429, частичный сбой logout и изоляция двух
пользователей покрыты автоматическими проверками в соответствующей части,
но не подтверждены production browser E2E. Не провоцировать 429 нагрузкой и не
создавать тестовые бизнес-записи в production ради прогона.

## Быстрый откат

Предыдущий работающий deployment сохранён; повторный inspect подтверждает READY:

- ID: `dpl_6YuVrfWqNToSyhqRRVn4HKhSNfWM`.
- URL: https://milekeeper-6r6aj1sdi-stanislavs-projects-b731a3ea.vercel.app
- Commit: `446ab00c19332f6d5c66803fd11ef22b55b61970`.

Из каталога проекта с существующей CLI-авторизацией:

```sh
vercel rollback dpl_6YuVrfWqNToSyhqRRVn4HKhSNfWM --scope stanislavs-projects-b731a3ea --yes
```

Откат не выполнялся: серьёзных проблем не обнаружено. Он возвращает приложение,
а ограничения БД этапа 1 сохраняет. Старый deployment не удалять до окончания
ручного OAuth/PWA прогона. После rollback автоматическое назначение production
domains выключается до следующей promotion.
[Правила Vercel rollback](https://vercel.com/docs/cli/rollback).

Известных новых блокирующих проблем нет. Остаются ручной OAuth/PWA прогон,
старые tsc/lint ошибки, технический долг source этапа 1 и несогласованный main.
Новые проекты, тестовая инфраструктура и миграции не создавались. Supabase/RLS,
OAuth provider, env и бизнес-данные пользователей этим выпуском не менялись.
