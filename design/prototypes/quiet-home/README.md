# Quieter NuttyFin prototypes

Open `index.html` and use the A / B / C controls to compare three Home layouts:

- Cinema: the last watched title as a static cinematic hero, then Continue Watching and Coming Soon.
- Quiet shelf: a smaller split Resume card, portrait Continue Watching shelf, and Coming Soon.
- Watch queue: a compact last-watched row and a list of unfinished titles, with Coming Soon reduced to text.

Every layout shares Movies, Shows, Explore, and one Requests destination. Movies and Shows have horizontal Recently Added shelves. Explore retains the 15 / 45 / 90 minute picker and weekly calendar. NutBot is available through its toolbar button.

This is an isolated, self-contained HTML prototype using embedded existing library artwork and local fonts. Watch progress, calendar entries and request states are explicitly sample data. Search, navigation, shelf scrolling, sorting and local preview dialogs work; playback, chat and server writes are not connected. No application source, live deployment, or approved layout rules changed.

Direction: warm near-black surfaces, existing Atkinson/DotGothic type and orange Resume action. Static movie artwork is the main visual; resting panels have no shadows or hover glow. The main question is “How do I resume what I was watching?” Inventory: last watched movie, remaining runtime, unfinished episodes, new movies, new shows, pending downloads, short-watch recommendations, upcoming episodes, and the optional assistant. There are no dashboard metrics or duplicate Requests links.

Verified all three Home layouts and the four secondary destinations at 1440, 728 and 390 px with no horizontal page overflow or browser runtime errors. Checked navigation, sorting, library search, title dialogs, local NutBot reply, duration picker, Resume preview and Escape dismissal. Inspected desktop, phone, and Movies screenshots. App tests, live accounts, real playback, and production deployment were not exercised for this isolated visual prototype.
