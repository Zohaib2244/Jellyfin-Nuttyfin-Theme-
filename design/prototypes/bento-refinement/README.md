# Bento refinement prototypes

Two interactive Home concepts that keep NuttyFin's existing bento identity:

- **Focus board:** Resume occupies the largest tile beside the compact In Progress list. NutBot and Coming Soon form the smaller lower row.
- **Stacked board:** a wide Resume tile sits above In Progress, Coming Soon, and NutBot, arranged in unequal columns.

Both use the existing warm palette, Atkinson/DotGothic typography, rounded framed tiles, static library artwork, one filled Resume action, and no hover lift, glow, or moving backdrops. The existing desktop navigation rail becomes a bottom navigation bar on phones. Requests appears once in primary navigation. Recently Added shelves are in Movies and Shows. The duration picker and calendar remain in Explore. The compact NutBot tile is retained.

This is an isolated self-contained HTML prototype. Viewing progress, calendar entries, Saved contents, requests and chat replies use sample data. Navigation, theme switching, search, local dialogs, sorting and shelf controls work without the backend. Nothing is deployed and no app source is changed.

Verified both boards and Movies, Shows, Requests, Saved, Continue Watching and Explore at 1440, 728 and 390 px: no horizontal page overflow or browser runtime errors. Checked light/dark switching, search, title details, mock NutBot response, Explore shortcut, duration picker, Resume preview and Escape dismissal. Inspected desktop, phone, light-theme and secondary-page screenshots. Live playback, real accounts, app test suites and deployment were not exercised for these isolated previews.
