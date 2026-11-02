# Professional extraction scope

Source: `co-va/core:main` (read-only).
Target: `co-va/professional:staging`.

## Include
- Professional application runtime and Journal.
- Profile, Service, People, Time/Timetable, Finance, Inventory, Loyalty, Settings, Notifications, Chat.
- Professional Online Booking settings/link management.
- Public Booking guest runtime.
- Shared UI and shared core modules reachable from those entrypoints.

## Exclude
- End-user/User Journal runtime and markers.
- User/Account application runtime.
- Admin UI.
- Landing UI.
- Legacy/dead modules not reachable from Professional or Public Booking entrypoints.

`co-va/core` is never modified during this extraction.
