# PROJECT_STATE

## Обязательный контракт Professional

- Единственный владелец Professional application: `co-va/professional`.
- Рабочая ветка исполнителя только `staging`. `main` не менять в рамках этой карты. Новые рабочие ветки не создавать.
- `co-va/core` не является frontend/runtime/build dependency Professional. Из Professional в Core не переносятся и в Core не изменяются файлы в ходе этой работы.
- Core остаётся владельцем backend/API/server logic/Prisma/PostgreSQL и общих серверных контрактов.
- Любая необходимость изменить Core фиксируется только как `CORE HANDOFF` и выполняется позднее отдельным единым этапом вне этой карты.
- Professional работает с сервером только через утверждённый API-контракт. Прямого доступа браузера к БД/Prisma/серверным внутренностям быть не должно.
- Локальная папка `core/**` внутри `co-va/professional` — клиентский доменный слой; она не означает зависимость от репозитория `co-va/core`.
- Замена выполняется вместо старой реализации, а не поверх неё. Legacy/compat/bridge/fallback/duplicate UI после замены удаляются.
- Утверждённый Shared UI в `co-va/user` является эталоном общего UI-контракта. Professional не создаёт второй UI-мир.
- Shared внутренние события в Professional не получают маркер конкретного приложения; для общего UI используется нейтральный namespace.
- Public Booking остаётся отдельной guest surface и не смешивается с Professional App Runtime.
- Постоянный CI не должен управлять незавершённой очисткой. Сначала архитектура и runtime доводятся до правильного состояния, затем подтверждается работа, и только после этого ставятся финальные guards/CI.
- Инфраструктурное подключение Amvera/доменов выполняется только после архитектурной очистки Professional.

## Цель

Сделать `co-va/professional` полностью самостоятельным Professional-приложением по тому же принципу чистоты, что и `co-va/user`:
- Professional frontend/runtime/UI живут только здесь;
- User/Admin/Landing и чужие runtime-контуры отсутствуют;
- общий UI не дублируется;
- Professional не зависит от frontend/runtime `co-va/core`;
- Core остаётся API/DB/server владельцем;
- после доказанной самостоятельности отдельным будущим этапом из Core удаляется оставшийся Professional frontend/runtime.

## Порядок работы

Следующий исполнитель продолжает с первого незавершённого этапа. Этапы выполняются последовательно; соседний contour не исправляется «заодно».

### Этап 1 — baseline и карта фактического runtime — DONE

- Entry points: `index.html` → `professional.js`, `booking.html` → guest Booking, `invite/index.html`, `reset-password.html`, `verify-email.html`, `service-worker.js`.
- Docker/runtime собирается только из Professional repository.
- `/api/` проксируется во внешний Core API `https://api.va-tools.ru`.
- User/Admin/Landing/server runtime отсутствует.
- Исходный аудит видел 281 runtime code files / 288 reachable runtime/assets и один оборванный Booking Draft import.
- Старый внешний Booking Draft storage удалён; guest draft принадлежит текущему `history.state` flow.

### Этап 2 — CI reset перед очисткой — DONE

Старый `Check Professional` удалён из `staging` по указанию владельца: он содержал прежние/неверные архитектурные предположения.

Во время очистки:
- постоянных workflow/CI в `.github/workflows` быть не должно;
- CI не используется как источник архитектурной истины;
- временные технические исполнители допустимы только для атомарной операции и обязаны удалить себя после выполнения;
- финальный CI ставится только после реального runtime proof.

### Этап 3 — Shared UI convergence — DONE

- Shared Header выровнен с User contract.
- Horizontal rail использует фактический overflow и единый Shared cue.
- Z/Q layout выровнен; локальный `padding-top:0` override удалён.
- Shared V2 context producer/consumers переведены без bridge на `va-tools:v2-context-changed`.
- MiniCard, Calendar, modal lifecycle и общий V2 List Entry выровнены с User.
- Professional-specific Journal/Time extensions сохранены только как feature extensions, а не второй Shared owner.
- Portal-aware Q/V fix Professional сохранён, потому что он исправляет реальную portal geometry и не создаёт альтернативный owner.

### Этап 4 — entry/bootstrap Professional — DONE

- `professional.js` загружает только Professional App Runtime.
- Первый workspace не зависит от User/Admin/Landing/App-mode runtime.
- Profile/Journal/Operational/minimal Finance получают slices одного `journal-bootstrap`; full Profile/Finance остаются lazy.
- Shared V2 listener в entry переведён на нейтральный namespace.
- Public Booking не загружает `professional.js`.

### Этап 5 — auth/account/network boundary — DONE

- Auth/API transport имеет одного владельца: `core/auth.js` + `apiRequest`.
- Retired auth-token migration удалена; используется один технический ключ `va-tools.auth.token`.
- Business mutations идут через единую in-memory queue `core/business-persistence.js` → Core API.
- App-wide server sync вынесен из `online-booking/` в `core/runtime/server-sync.js`; старый файл удалён без wrapper/alias.
- Browser storage не является владельцем бизнес-данных.
- Guest Public Booking использует свой unauthenticated HTTP boundary и не импортирует Professional auth/session.

### Этап 6 — Professional-owned domains — DONE

Проверены по фактическим owners/persistence:
- Profile / Workplace;
- People;
- Journal / Record / Event / Note;
- Timetable / Time;
- Service;
- Finance;
- Inventory;
- Loyalty;
- Settings;
- Notifications;
- Chat;
- Online Booking settings/link management.

Результат:
- данные живут как in-memory projections/caches и сохраняются через Core API;
- Record имеет один public contract `core/record/index.js`;
- Time имеет один public contract `core/time/index.js`;
- Finance browser state — read cache, сервер остаётся владельцем Settlement/Operation/Ledger;
- второго persistence owner или Core frontend/runtime dependency не найдено.

### Этап 7 — Public Booking isolation — DONE

- `online-booking/` содержит только `booking-entry.js`, `access.js`, `model.js`.
- Guest Booking не импортирует Professional workspace/auth.
- Guest HTTP owner обращается только к `/online-booking/...` API.
- Confirm создаёт запись через серверный guest endpoint; второго клиентского Record owner нет.
- App-wide sync удалён из guest contour.

### Этап 8 — dead code / duplicate / retired cleanup — DONE

- Dead runtime, exact runtime duplicates, User/Admin/Landing contours и legacy/compat/bridge paths отсутствуют по фактической карте.
- Внутренние Professional events используют `professional:*`; Shared V2 events используют нейтральный `va-tools:*`.
- Retired product-name namespace, browser keys, access fallback, document source marker и неиспользуемые shadow-поля удалены, а не сохранены через alias/migration/bridge.
- Мёртвый экспорт загрузки RKN PDF удалён целиком; новый дублёр ему не создавался.
- Document source имеет только актуальные значения `PLATFORM` / `CUSTOM`; неизвестные persisted-поля отбрасываются нормализацией и не становятся вторым контрактом.
- Изменения сделаны вместо старой реализации. Параллельных owners и compatibility aliases не добавлено.
- Постоянный CI отсутствует. Следующий этап — техническая проверка очищенного Professional без постоянного CI.

### Этап 9 — проверка очищенного Professional без постоянного CI — ACTIVE

До подключения финальных guards проверить само приложение, не подгоняя код под CI:
- entry/bootstrap;
- auth/session boundary;
- Professional workspace;
- Journal / Profile / People / Time / Service / Finance / Inventory / Loyalty / Settings;
- F/E/Z и Q/X/S;
- Record create/view/edit;
- Notifications/Chat;
- Public Booking guest surface;
- manifest/service worker/PWA root;
- отсутствие зависимости от frontend/runtime Core.

Постоянные workflow на этом этапе не ставить.

### Этап 10 — Amvera и домен Professional — TODO

После проверки очищенной структуры:
- подключить Amvera напрямую к `co-va/professional/staging`;
- `main` не использовать;
- проверить staging deployment;
- назначить/перенести Professional-домен;
- проверить API origin, manifest/service worker и deep links.

### Этап 11 — реальный runtime proof на развернутом Professional — TODO

На фактически развернутом приложении проверить:
- login/session;
- Professional workspace;
- Journal;
- F/E/Z и Q/X/S;
- Profile/Workplace;
- Record create/view/edit;
- Settings;
- Notifications/Chat;
- отдельный Public Booking guest flow;
- service worker/PWA root;
- отсутствие обращения к старому Professional frontend/runtime в Core.

Только после этого этапа разрешено ставить финальный CI.

### Этап 12 — финальные guards/CI и самостоятельность Professional — TODO

После доказанного рабочего runtime поставить только актуальные проверки:
- Repository guard;
- Shared UI guard;
- runtime smoke;
- дополнительные feature checks только если они защищают реальный сегодняшний контракт.

Professional отделён только если одновременно доказано:
- приложение работает из `co-va/professional/staging`;
- Core frontend/runtime не требуется;
- данные/операции идут через Core API;
- User/Admin/Landing runtime отсутствуют;
- Shared UI не имеет второго Professional-варианта;
- Public Booking изолирован;
- staging deployment и домен работают из Professional repository;
- финальные guards защищают уже проверенную архитектуру, а не формируют её.

## CORE HANDOFF — выполнять только после завершения Professional

Доказанные хвосты, которые не исправляются внутри Professional:

1. После этапа 12 составить в `co-va/core` карту оставшегося Professional frontend/runtime и удалить его, сохранив API/server/Prisma/PostgreSQL.
2. Поставить в Core guard, запрещающий возврат Professional frontend/runtime.
3. Проверить, что `co-va/professional` продолжает работать через Core API.
4. Отдельно нормализовать оставшееся legacy server/API naming в Core; Professional не создаёт compatibility alias и не меняет Core на этом этапе.

До отдельного явного перехода к этому handoff `co-va/core` не изменять.
