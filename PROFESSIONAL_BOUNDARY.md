# Professional boundary

This repository is the standalone Professional application and its owned Public Booking guest surface.

Included:
- Professional Journal and workspace runtime.
- Profile, People, Time/Timetable, Service, Finance, Inventory, Loyalty, Settings, Notifications and Chat.
- Professional Online Booking settings/link management.
- Public Booking guest runtime.
- Shared UI and shared domain modules required by these surfaces.

Explicitly excluded:
- End-user/User Journal runtime and markers.
- User/Account application runtime.
- Admin UI.
- Landing UI.
- Legacy/compat/bridge runtime.
- Dead or unreachable runtime files.
- Migration/extraction tooling from `co-va/core`.

`co-va/professional` is maintained as an independent application repository. `co-va/core` is not a runtime or build dependency.
