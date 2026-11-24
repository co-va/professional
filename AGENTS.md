# AGENTS — вход в Professional

**До любого изменения кода или UI:**

1. Прочитай `PROJECT_STATE.md` в **текущем репозитории**.
2. Прочитай **единый UI-контракт**: [co-va/core/staging/UI_ALPHABET.md](https://github.com/co-va/core/blob/staging/UI_ALPHABET.md). Это **единственный** нормативный источник идентификаторов, владельцев и межрепозиторных правил UI. Не создавай локальную копию или вторую карту.
3. Для F/E/режимов/capabilities и владельцев данных прочитай [co-va/core/staging/BUSINESS_ARCHITECTURE.md](https://github.com/co-va/core/blob/staging/BUSINESS_ARCHITECTURE.md). Для тарифных прав отдельно читай [COMMERCIAL_TARIFF_CONTRACT.md](https://github.com/co-va/core/blob/staging/COMMERCIAL_TARIFF_CONTRACT.md); не путай статус готовности инструмента с приёмкой визуального UI.
4. Для технической приёмки Professional обязательно прочитай его [RELEASE_CLOSURE_MAP.md](https://github.com/co-va/professional/blob/staging/RELEASE_CLOSURE_MAP.md) и [RELEASE_CLOSURE_REGISTRY.json](https://github.com/co-va/professional/blob/staging/RELEASE_CLOSURE_REGISTRY.json). Не объявляй их статусы статусами User или Admin.
5. Перед изменением общего компонента установи его ID из UI_ALPHABET, **реального владельца исходника**, места использования в остальных приложениях и утверждённую форму. Если источники недоступны — явно укажи ограничение; ничего не угадывай.
6. **Scope:** Professional UI resides here; preserve the existing release acceptance map and registry. Do not change Core or User. Изменяй только разрешённый репозиторий и `staging`. Не трогай `main`, чужой код, защитные тесты и утверждённый UI без явного разрешения. Не создавай новый план вместо продолжения существующего.

**Эталон общего UI:** читать `co-va/core/staging/UI_ALPHABET.md`, затем фактический `co-va/user/main` (после User PR #21, merge `bfb8b539b74a3cb03454712d2d3f1e024d3b0130`). `user/staging` — разработка, не эталон. Вносить только адресные изменения в свой `professional/staging`, не копировать чужую бизнес-логику.

**Завершение:** сообщи точно, что изменено, что проверено, что не проверено, SHA/PR и статус реальной приёмки. Нельзя называть компонент «утверждённым» по одному зелёному тесту.

`AGENTS.md` — точка входа для исполнителя, **не** автоматическая блокировка GitHub. Защиту обеспечивают отдельные реальные проверки и настройки репозиториев.

**Исключение по решению владельца, 13.11.2026:** кнопки «+» в User признаны неверным образцом. Не переносить их в Professional. Сохранять текущий Professional compactAddButton и геометрию «+» до отдельного решения владельца. MiniCard 290×200 уже утверждена и реализована в professional/staging и user/staging; старую форму 238×144 из user/main не возвращать.

**Compact UI — решения владельца 13.11.2026:** в Professional одна публичная фабрика `ui/buttons/index.js::compactButton({kind})` и **один размер 28 × 28 px**, заданный `--ui-compact-size` в `ui/buttons/buttons.css`. Варианты: `add` (чёрный +), `remove` (красный ×), `info` (i), `copy`, `settings` (прежняя шестерёнка на сером квадрате), `repeat` (прежний знак ↻ на чёрном квадрате), `card` (иная угловая кнопка мини-карты), `previous` и `next` (←/→ дат). В мини-картах и календарной навигации также используется **только Compact**: нельзя возвращать отдельные кнопки 30/36/44 px и локальные правила их размеров. Габариты самой мини-карты 290 × 200 px и сетка расположения текста/слотов 44 px остаются, но **размер кликабельных кнопок внутри слотов — строго 28 × 28 px**. `compactAddButton`, `compactRemoveButton`, `smallActionButton`, `copyIconButton` — лишь совместимые вызовы общей фабрики. Обычная полноразмерная кнопка 48 px — отдельный тип, не уменьшать её CSS. Внешний вид «+» Professional сохранять, «+» User не копировать. Новые маленькие кнопки создаются вариантами `Compact`, а не копированием HTML/CSS. Любые изменения — только Professional/staging до приёмки.
