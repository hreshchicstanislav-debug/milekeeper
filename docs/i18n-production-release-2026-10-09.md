# MileKeeper: публикация RU/EN

09.10.2026, около 03:00 Алматы / 08.10.2026 22:00 UTC. Promotion выполнен по явному разрешению пользователя. Подготовка и предыдущие проверки описаны в [отчёте готовности](i18n-production-readiness-2026-10-09.md).

## Опубликованная версия

- Основной сайт: [milekeeper.vercel.app](https://milekeeper.vercel.app).
- Deployment: `dpl_5L2NaPNMtPGpG7QnRkH79FzqQFPp`, `production`, `READY`.
- Project: `milekeeper`, `prj_PYHA3h9zvVk1fFAvRnuwRo2vHcGA`.
- Team: `stanislavs-projects-b731a3ea`, `team_ZN6exgwzH7ryYe3obiWWfFXQ`.
- Source commit: `b35e200c16bf91f7c94e4f0d5f55e3349fd9e41f`; локализация приложения из `e0de9eb`.
- Выполнено `vercel promote dpl_5L2NaPNMtPGpG7QnRkH79FzqQFPp --scope stanislavs-projects-b731a3ea --yes --timeout 60s`.

Новая сборка не запускалась. ID, source commit, createdAt и ready timestamp deployment до и после promotion совпадают. `vercel inspect milekeeper.vercel.app` и `project.targets.production.id` подтвердили новый ID.

## Финальные проверки основного домена

18 HTTP-проверок прошли без Vercel bypass, на публичном основном домене:

- `/login` и `/en/login`: HTTP 200, русский/английский HTML lang и UI.
- `/`, `/items`, `/history`, `/items/[id]` без сессии: HTTP 307 на `/login`.
- `/en`, `/en/items`, `/en/history`, `/en/items/[id]` без сессии: HTTP 307 на `/en/login`.
- Оба manifest: HTTP 200; общий id/scope, соответствующие lang и start_url.
- sync без Origin / с чужим Origin: 403; с правильным Origin без токенов: 400.
- logout с чужим Origin: 403; с правильным Origin в отдельном анонимном клиенте: 200.
- service-events без сессии: 401, личные записи не запрашивались.

Chrome подтвердил `/` → русский вход и `/en` → английский вход, переключение RU/EN с сохранением query, refresh, английское сообщение об ошибке, общий callback при отказе Google и возврат на английский login. Вёрстка login проверена на 390 px; русского системного текста в английском login и browser page errors нет. Приватные экраны с настоящей Session не проверялись — их проверит пользователь после Google-входа.

Vercel logs в окне последних 5 минут: HTTP 500 отсутствуют; единственная error-запись — ожидаемый `Not authenticated` / HTTP 401 от контрольного анонимного service-events запроса. Критических ошибок в проверенном окне не обнаружено.

## Ручная приёмка и rollback

**Google OAuth E2E не считается проверенным до подтверждения пользователя.** Пользователь самостоятельно проверит EN Google-вход, возврат в EN, refresh, переключение, logout/повторный вход и русскую версию. Работа остановлена для этой проверки.

Предыдущий рабочий deployment `dpl_6FVMye9i5uypGZJAyk91grWPoZUh` перед promotion проверен: тот же project, `production`, `READY`. Он не удалён и сохранён для rollback. По сообщению пользователя о серьёзной проблеме авторизации разрешён немедленный откат:

```sh
vercel rollback dpl_6FVMye9i5uypGZJAyk91grWPoZUh --scope stanislavs-projects-b731a3ea --yes
```

Rollback сейчас не выполнялся. Supabase, Google provider, миграции, пользовательские данные, env и бизнес-логика не изменялись. Merge и push не выполнялись. Main / origin/main остаются на `fdf532f44f7298101f1f7d7e0cf387c1b2da0730`; синхронизация с опубликованной версией ожидает отдельного подтверждения после ручной приёмки.

Этот документ добавлен локально после promotion и не изменяет опубликованную сборку. Логи и screenshots сохранены в `/Users/stanislav/Documents/ChatGPT/MileKeeper/artifacts/i18n-readiness/`.
