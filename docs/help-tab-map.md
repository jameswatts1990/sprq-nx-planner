# Help tab maintenance map (RunNx)

The frontend has a user-facing **Help** tab (`frontend/src/pages/HelpPage/`) that documents every screen for non-technical lab users. It is backfilled from the actual UI, so it silently goes stale unless it's updated alongside UI changes. Treat it as part of the definition of done for any user-facing change: when you change a user-facing feature, interaction, alert/Note message, tooltip, or colour/badge meaning, update the matching Help section in the same change.

## Page → Help section map

| If you touch… | Update this Help section file |
| --- | --- |
| `pages/ImportPage.tsx` | `sections/ImportSection.tsx` |
| `pages/BacklogPage.tsx` | `sections/BacklogSection.tsx` |
| `pages/SchedulePage/*` (grid, Run design, drag/drop, locking, clear, cell picker, slot detail) | `sections/ScheduleSection.tsx` |
| `pages/CellsPage.tsx`, `pages/CellDetailPage.tsx`, `components/cells/*` | `sections/CellsSection.tsx` |
| `pages/HistoryRunsPage.tsx`, `pages/RunDetailPage.tsx`, `pages/HistorySamplesPage.tsx` | `sections/HistorySection.tsx` |
| `pages/SettingsPage/*` (sample defaults, scheduling, movie scheduling, email template, instrument facts, dev tools) | `sections/SettingsSection.tsx` |
| A `Badge`/`Note` tone, a status→tone map (`utils/cellStatus.ts`, `utils/cycleStatus.ts`, `utils/useStatusTone.ts`), or the Use 1/2/3 swatches (`components/shared/SectionHeading.tsx`) | `sections/LegendSection.tsx` — but note the legend renders live components from the shared tone maps, so a tone change usually needs only a wording tweak, never a colour re-description |
| Add/rename/remove a tab (`components/layout/AppShell.tsx` `NAV_ITEMS`) | `sections/GettingStartedSection.tsx` (the workflow overview) and add/remove the section in `HelpPage.tsx` |

## Rules

- The Colour & Status Legend must always render the real `Badge`/`Note`/`UseLegend` components sourced from the shared tone maps — never fork or hard-code tone values into the Help tab.
- If you add a new status value, alert message, or tooltip, add its plain-language meaning to the relevant section; don't leave users to guess.
- Help copy is for lab users, not developers: describe what a control does and what a message means, not how it's implemented.
