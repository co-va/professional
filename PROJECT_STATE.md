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

### Public Booking lightweight replacement

- Публичная ссылка сначала показывает только два действия: `Записаться` / `Открыть приложение`; route API, Booking runtime и тяжёлые UI-модули до `Записаться` не загружаются.
- Booking начинается с `Кого записать?`, затем собирает данные оформляющего; только после имени/телефона выполняется проверка PDN-маркера и загрузка операционного контекста.
- Клиент больше не разбирает список consent/documentId как состояние человека: используется только boolean `legalState.pdnActive` существующего server endpoint; при `true` шага согласий нет.
- Переход в User после выхода/успеха — только обычная навигация на `USER_ORIGIN`; User runtime внутрь Booking не загружается.
- CORE HANDOFF: заменить guest `booking-state` на status-only контракт (`personExists`, `pdnActive`, `bookingAllowed`) и разделить текущий тяжёлый `/context`: операционные данные отдельно, актуальные PDN/marketing документы только по требованию при `pdnActive=false`, занятость — по нужному диапазону/дате. До этого handoff серверный `/context` после ввода данных всё ещё возвращает documents и широкую occupancy; клиентского fallback/второго consent-owner не добавлять.

### Этап 8 — dead code / duplicate / retired cleanup — DONE

- Dead runtime, exact runtime duplicates, User/Admin/Landing contours и legacy/compat/bridge paths отсутствуют по фактической карте.
- Внутренние Professional events используют `professional:*`; Shared V2 events используют нейтральный `va-tools:*`.
- Retired product-name namespace, browser keys, access fallback, document source marker и неиспользуемые shadow-поля удалены, а не сохранены через alias/migration/bridge.
- Мёртвый экспорт загрузки RKN PDF удалён целиком; новый дублёр ему не создавался.
- Document source имеет только актуальные значения `PLATFORM` / `CUSTOM`; неизвестные persisted-поля отбрасываются нормализацией и не становятся вторым контрактом.
- Изменения сделаны вместо старой реализации. Параллельных owners и compatibility aliases не добавлено.
- Постоянный CI отсутствует. Следующий этап — техническая проверка очищенного Professional без постоянного CI.

### Этап 9 — проверка очищенного Professional без постоянного CI — DONE

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

### Этап 10 — Amvera и домен Professional — ACTIVE

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

## Миграция Графика в Журнал — 2026-11-05

- Единственная точка календаря Professional: Журнал → Месяц, режим «Просмотр» / «График». F-карточка «График» и прежний render-entry удалены.
- Shared Calendar монтируется в одном host Журнала; в режиме просмотра нажатие открывает день, в режиме «График» действует множественный выбор.
- Все изменения рабочих дней, проверка пересечений и сохранение по-прежнему делегируются `timetable/day-editor.js` и `core/day/*`. Журнал владеет навигацией и режимами, но не создаёт отдельную доменную логику расписания.
- Внутренний контроллер режима `journal/график.js` заменил старый F-экран `timetable/timetable.js`. Новый F или bridge не допускается.
- `timetable.access` остаётся отдельным entitlement для режима Журнала и не образует F.
- В платформенной карте инструментов режим «График» вложен в Журнал. Стабильные readiness/product/capability keys не переименовывать без миграции существующих данных.
- Проверить: одну точку календаря, переход по дню, множественный выбор, конфликт интервалов, блокировку выходного при occupancy, корректность прав и отсутствие старого F.
## Уточнение выбора рабочих пространств в Журнале → Месяц — 2026-11-05

- Просмотр месяца и режим «График» используют один Journal-owned селектор рабочих пространств, без второго Shared UI.
- «Общий график» показывает количество уникальных рабочих дат выбранного месяца и сумму минут/часов всех рабочих пространств. У каждого пространства свои рабочие даты и часы из существующего `core/workplace-time.js`.
- В месячном списке показываются только пространства с рабочими днями в выбранном месяце и явно добавленные для настройки; неработавшие пространства доступны через «+ Рабочее пространство».
- Добавление без назначения дней — временный UI draft с 0 дней / 0 часов; он не создаёт фиктивную запись WorkPlan Day и не сохраняется как бизнес-факт. После назначения график сохраняется через существующий Timetable/Day owner.
- Дневной селектор и создание/удаление рабочих дней не менялись. Проверены синтаксис JS, расчёт уникальных дней/суммы часов, нулевые значения, скрытие неактивных и появление явно добавленного пространства. Проверка на развернутом iPhone остаётся отдельным runtime proof.

## Рабочее время до выбора дат в режиме График — 2026-11-05

- «Журнал → Месяц → График → Рабочее время» доступно до выделения дат. При общем графике сначала выбирается конкретное рабочее пространство.
- Начальный интервал берётся из рабочего пространства, пользователь может временно заменить его для выбранного пространства и месяца (например, 12:00–21:00 на 12:00–20:00). Изменение самого Профиля/пространства не происходит.
- После выбора дат действие «Применить время» через существующий Timetable-owned `applyTimetableTimeCorrection` с опцией `createMissing` меняет часы существующих рабочих дней и создаёт недостающие рабочие дни одним проверенным сохранением. Дни не переводятся в выходные.
- Проверки всех выбранных дат (валидность времени, другие пространства, уже существующая занятость) выполняются до изменения фактов; при конфликте вся операция отклоняется, существующий график сохраняется.
- Временное выбранное время — UI-проект настройки, а не новое серверное состояние/глобальный график. Не создаётся второй владелец Day/Time.
- Синтаксис изменённого UI проверен и доменные сценарии массовой корректировки/создания, блокировки по занятости/пересечению и прежнего режима корректировки проверены моделированием. Реальная интерактивная проверка на iPhone ещё требуется.

## Единая семантика B и выбор рабочего пространства в Журнал → Список — 2026-11-05

- B-заголовок в Списке: конкретное пространство → только название пространства, без подзаголовка; общий выбор → «Журнал» / «Общий режим». Слово «Список» не дублируется в B, поскольку уже обозначено активным режимом. День, Месяц и График сохраняют ранее согласованные пары.
- Настройки в режиме «Список» сразу показывают Shared Select «Рабочее пространство» в первом X-окне, без промежуточной кнопки и второго окна настроек. Из селектора доступны общий список и отдельные пространства; создание/добавление рабочего пространства из Списка запрещено.
- Единственный фильтр данных Списка в `journal/список.js`: от начала даты за 30 календарных дней до сегодняшнего дня включительно, сегодня и все будущие даты без верхней границы. Одинаково для режимов «Поток» и «По времени» и для общего/частного просмотра; фильтр не удаляет старые записи из хранилища.
- Число записей в селекторе рассчитывается только по той же доступной выборке Списка. Прочие процессы и данные не меняются.
- Проверены синтаксис изменённых JS, граничная дата 30 дней, прошлое за пределами окна, настоящее, далёкое будущее, фильтр рабочего пространства, 8 комбинаций B-заголовков и выбор общего/частного списка. Отдельная проверка на развернутом устройстве не выполнена.

## Независимые контексты рабочего пространства в Журнале — 2026-11-05

- День, Месяц (просмотр), Месяц (График) и Список — четыре независимых выбранных рабочих пространства/состояния «Общий режим». Смена выбора или включение общего режима в одном не меняет другие.
- Выбор каждого режима сохраняется в существующем `core/workplace-context.js` с отдельным scope: `journal` (День, совместимо с прежним контекстом), `journal:month`, `journal:graph`, `journal:list`. Новый store/владелец не создаётся.
- Специальный `__all__` участвует только в допустимых значениях контекста Журнала; сохраняется при повторном открытии. Общая календарная дата Журнала сохраняется отдельно от выбора рабочего пространства.
- Переключение День/Месяц/График/Список и открытие Дня из месяца восстанавливают выбор целевого режима. Изменение графика по-прежнему относится к одним и тем же фактам Day/Time, без дублей.
- Автотестирование фрагментов фактического кода: независимость четырёх режимов, возврат в них, сохранение после повторного открытия, общая дата, восемь заголовков B — PASS. Проверка на живом iPhone ещё требуется.

## Селектор рабочих пространств прямо в настройках Журнала — 2026-11-05

- В День, Месяц и Месяц → График настройки открывают один Shared X с `journalWorkplaceSelect` непосредственно в теле. Промежуточная action-кнопка «Рабочее пространство» и отдельное X-окно перед селектором удалены.
- «+ Рабочее пространство» находится в том же первом X (только при наличии доступных для добавления пространств), а не внутри второго меню. Нажатие открывает существующий каталог/добавление, не создавая нового владельца рабочего расписания.
- Выходной День и пустой Месяц также показывают селектор и кнопку добавления; действия «График/Месяц», «Рабочее время», «Применить выходной», «Z-Отчёт» остаются отдельными действиями первого X там, где доступны.
- Переиспользуется тот же Journal-owned Shared Select и имеющийся Shared X. Расширение Shared settings только опциональными `content` и `onMount`; старые вызовы с кнопками не меняют поведения. Для экрана без других action-кнопок пустой блок действий не рисуется.
- Внутренние тесты: синтаксис JS, выбор рабочего пространства и закрытие окна, кнопка добавления, отсутствие второго действия, пустой День/Месяц, комбинация селектора и действий — PASS. Проверка интерфейса на iPhone пока не проводилась.
