# PROJECT_STATE

## Обязательный контракт Professional

- Единственный владелец Professional application: `co-va/professional`.
- Рабочая ветка исполнителя только `staging`. `main` не менять в рамках этой карты. Новые рабочие ветки не создавать.
- `co-va/core` не является frontend/runtime/build dependency Professional. Из Professional в Core не переносятся и в Core не изменяются файлы в ходе этой работы.
- Core остаётся владельцем backend/API/server logic/Prisma/PostgreSQL и общих серверных контрактов.
- Любая необходимость изменить Core фиксируется только как `CORE HANDOFF` и выполняется позднее отдельным единым этапом вне этой карты.
- Professional работает с сервером только через утверждённый API-контракт. Прямого доступа браузера к БД/Prisma/серверным внутренностям быть не должно.
- Локальная папка `core/**` внутри `co-va/professional` допустима как клиентский доменный слой, как и в `co-va/user`; она не означает зависимость от репозитория `co-va/core`.
- Замена выполняется вместо старой реализации, а не поверх неё. Legacy/compat/bridge/fallback/duplicate UI после замены удаляются.
- Утверждённый Shared UI в `co-va/user` является эталоном общего UI-контракта. Professional не создаёт второй UI-мир.
- Shared внутренние события в Professional не получают `User`/`Book`-маркер; для общего UI используется нейтральный namespace.
- Public Booking остаётся отдельной guest surface и не смешивается с Professional App Runtime.
- Инфраструктурное подключение Amvera/доменов выполняется только после архитектурной и runtime-очистки Professional.

## Цель

Сделать `co-va/professional` полностью самостоятельным Professional-приложением по тому же принципу чистоты, что и `co-va/user`:

- Professional frontend/runtime/UI живут только здесь;
- User/Admin/Landing и чужие runtime-контуры отсутствуют;
- общий UI не дублируется;
- Professional не зависит от frontend/runtime `co-va/core`;
- Core остаётся API/DB/server владельцем;
- после доказанной самостоятельности отдельным будущим этапом из Core можно удалить оставшийся Professional frontend/runtime без риска для Professional.

## Порядок работы

Следующий исполнитель не создаёт новый план. Он читает этот файл и продолжает с первого незавершённого этапа. Этапы выполняются последовательно; соседний контур не исправляется «заодно».

### Этап 1 — baseline и карта фактического runtime — DONE

Установлено:
- реальные entry points: `index.html` → `professional.js`, `booking.html` → guest Booking, `invite/index.html`, `reset-password.html`, `verify-email.html`, `service-worker.js`;
- Professional Docker/runtime собирается только из этого репозитория;
- `/api/` проксируется во внешний Core API `https://api.va-tools.ru`;
- User/Admin/Landing/server runtime в Professional отсутствует;
- старый аудит до отключения CI видел 281 runtime code files / 288 reachable runtime/assets и один оборванный импорт старого Booking Draft;
- старый внешний Booking Draft storage удалён: текущий Public Booking хранит свой draft в собственном `history.state`-контракте;
- подтверждена классификация: Professional domains = KEEP, общий UI = SHARED, legacy/duplicate/dead = DELETE, серверные изменения = CORE HANDOFF.

### Этап 2 — CI reset перед очисткой — DONE

По прямому указанию владельца старый `Check Professional` полностью удалён из `staging`, потому что содержал прежние/неверные архитектурные предположения и мешал очистке.

- до окончания архитектурной очистки новый постоянный CI не ставить;
- Repository/Shared UI/runtime guards собрать заново на этапе 9 по фактическому очищенному состоянию;
- отсутствие CI на промежуточных этапах не считается доказательством работоспособности.

### Этап 3 — Shared UI convergence — ACTIVE

- Сверить Professional `ui/**` с утверждённым Shared UI User.
- Оставить один общий контракт H/A/B/C/D/F/E/Z, Q/X/S, CardDeck, cards, lists, Calendar/Time и modal geometry.
- Удалить Professional-local копии, локальный CSS и альтернативные владельцы уже существующего Shared UI.
- Уже выровнены: Shared Header, horizontal rail behavior/cue, Z/Q layout; удалён Z `padding-top:0` override.
- V2 context event заменён без bridge на нейтральный `va-tools:v2-context-changed` у producer/consumers.
- Совпадающие с User Shared owners не переписывать без причины.

### Этап 4 — entry/bootstrap Professional — TODO

- Professional entry загружает только Professional App Runtime.
- Первой рабочей поверхностью является утверждённый Professional workspace, без User/App-mode/legacy bootstrap.
- Удалить старые host/mode переключатели и скрытые fallback-входы, если они существуют.
- Public Booking не загружает Professional workspace и остаётся отдельной guest surface.

### Этап 5 — auth/account/network boundary — TODO

- Один владелец Professional auth/session/API transport.
- Убрать параллельные network bridges и дублирующие fetch-owners.
- Production/staging origin и API boundary задаются единообразно.
- Browser storage не владеет бизнес-данными.
- Core API остаётся внешним серверным контрактом; серверный код в Professional не копируется.

### Этап 6 — Professional-owned domains — TODO

По фактической достижимости пройти только Professional-контуры:
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

Для каждого: один owner, один публичный клиентский контракт, отсутствие дублей/bridge, сохранение через Core API и отсутствие зависимости от Core frontend/runtime.

### Этап 7 — Public Booking isolation — TODO

- Guest Booking остаётся Booking, а не входом в Professional App.
- Удалить legacy Online Booking runtime и оставить только фактически используемый guest flow.
- Record создаётся через канонический серверный API/owner; не создавать второй Record-мир.
- Professional workspace не должен быть обязательной зависимостью Public Booking.

### Этап 8 — dead code / duplicate / retired cleanup — TODO

- Удалить недостижимый runtime.
- Удалить exact/semantic duplicates после проверки потребителей.
- Удалить retired Book/User/Account-mode/legacy/compat/bridge маркеры, которые больше не являются текущим контрактом.
- Не оставлять aliases/wrappers ради старых имён.

### Этап 9 — новый contour CI — TODO

После очистки, а не раньше:
- собрать `Repository` + `Shared UI` + runtime smoke;
- добавить только реально нужные feature-checks по владельцам;
- feature-check защищает только свой контур и не переопределяет соседние продуктовые правила;
- собрать единый Professional Gate для текущего `staging`.

### Этап 10 — runtime proof на staging — TODO

Проверить фактическую работу, а не только наличие файлов/tests:
- login/session;
- загрузка Professional workspace;
- Journal;
- основные переходы F/E/Z и Q/X/S;
- Profile/Workplace;
- Record create/view/edit;
- Settings;
- Notifications/Chat по доступному текущему контракту;
- отдельный Public Booking guest flow;
- service worker/PWA root.

### Этап 11 — Amvera и домен Professional — TODO

Только после зелёной архитектуры и runtime proof:
- подключить Amvera к `co-va/professional/staging`;
- проверить staging deployment;
- перенести/назначить Professional-домен;
- проверить API origin, PWA manifest/service worker и прямые deep links;
- не использовать `main` для этой операции.

### Этап 12 — финальная самостоятельность Professional — TODO

Professional считается отделённым только если одновременно доказано:
- приложение работает из `co-va/professional/staging`;
- Core frontend/runtime не требуется для запуска;
- данные/операции идут через Core API;
- User/Admin/Landing runtime отсутствуют;
- Shared UI не имеет второго Professional-варианта;
- Public Booking изолирован от App Runtime;
- Repository/Shared UI/runtime gates зелёные;
- staging deployment и домен работают на Professional repository.

## CORE HANDOFF — выполнять только после завершения Professional

Сюда добавляются только доказанные серверные/репозиторные хвосты, которые невозможно исправить внутри Professional.

После завершения этапа 12 отдельной задачей в `co-va/core`:
1. составить фактическую карту оставшегося Professional frontend/runtime в Core;
2. удалить его из Core без удаления API/server/Prisma/PostgreSQL, нужных Professional;
3. поставить guard, запрещающий возврат Professional frontend/runtime в Core;
4. проверить, что `co-va/professional` продолжает работать через Core API.

До отдельного явного перехода к этому handoff `co-va/core` не изменять.
