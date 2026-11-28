# Core handoff — ручные доходы и расходы ДДС (28.11.2026)

Решение владельца: в текущей итерации меняется только Professional/staging. Один кошелёк на ручную операцию. Пока две оплаты оформляются отдельно: например, молоко и кефир наличными; сметана и хлеб картой.

Следующая согласованная доработка Core (не выполнена):
- Атомарное сохранение одного набора позиций с несколькими кошельками, проверкой равенства суммы распределения итогу до копейки, без частичного успеха и повторной записи.
- По одному платёжному документу на кошелёк; общая связь с исходным набором позиций. В ДДС строки по позициям/кошелькам, суммы касс, ДДС и документов согласованы.
- Явное сохранение канонической статьи отдельно от необязательного значения: сейчас системный механизм без собственного raw articleId должен использовать доступное значение для маршрутизации.
- Корректировка и отмена связанных документов; обратная совместимость истории. До приёмки не менять API, Core, User, main или проценты готовности.

## 28.11 — Core PR #950
Core #950 merged at `353b1cbe1dce426e33374109bb338ba9949eb583`, required checks passed. Professional candidate connects the new fields only when the live Core finance catalogue advertises `services-prepayment`. Existing single-wallet flows remain available on the older contract. Split document correction requires the complete group; changing document count requires cancellation/re-entry. Prepayment is partial, wallet-funded service payment; full advance, product advance and conditional deposit overlap are not supported by this Core version. Journal Z-report keeps existing totals/averages, adds net prepayment and verified wallet amounts in the existing status group. No claim of browser acceptance or live deployment.
