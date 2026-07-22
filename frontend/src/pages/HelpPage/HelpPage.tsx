import { useEffect, useMemo, useRef, useState } from "react";

import { Accordion } from "@/components/ui/Accordion";
import { useDebouncedValue } from "@/utils/useDebouncedValue";

import styles from "./HelpPage.module.css";
import { AdminSection } from "./sections/AdminSection";
import { BacklogSection } from "./sections/BacklogSection";
import { CellsSection } from "./sections/CellsSection";
import { GettingStartedSection } from "./sections/GettingStartedSection";
import { HistorySection } from "./sections/HistorySection";
import { ImportSection } from "./sections/ImportSection";
import { LegendSection } from "./sections/LegendSection";
import { ScheduleSection } from "./sections/ScheduleSection";
import { StatsSection } from "./sections/StatsSection";

const SECTIONS = [
  { key: "gettingStarted", title: "Getting started", Component: GettingStartedSection },
  { key: "import", title: "Import", Component: ImportSection },
  { key: "backlog", title: "Backlog", Component: BacklogSection },
  { key: "schedule", title: "Schedule", Component: ScheduleSection },
  { key: "cells", title: "Cells & Instruments", Component: CellsSection },
  { key: "history", title: "History", Component: HistorySection },
  { key: "stats", title: "Stats", Component: StatsSection },
  { key: "admin", title: "Admin", Component: AdminSection },
  { key: "legend", title: "Colour & Status Legend", Component: LegendSection },
] as const;

/** Living documentation of every screen in the app, for non-technical lab users.
 * See CLAUDE.md's "Help Tab Maintenance" section - whenever a user-facing feature,
 * interaction, alert, or colour meaning changes, the matching section file here
 * must be updated in the same change.
 *
 * Search matches each section's actual rendered text (via a ref), not a hand-maintained
 * keyword list - a separate index would just be one more thing to keep in sync as
 * sections change. This requires every section to stay mounted (via Accordion's
 * `alwaysMounted`) even while collapsed, so its text is always readable. */
export function HelpPage() {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 250);
  const [manualOpen, setManualOpen] = useState<Record<string, boolean>>({ gettingStarted: true });
  const [matches, setMatches] = useState<Record<string, boolean>>({});
  const refs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) {
      setMatches({});
      return;
    }
    const next: Record<string, boolean> = {};
    for (const s of SECTIONS) {
      const haystack = `${s.title} ${refs.current[s.key]?.textContent ?? ""}`.toLowerCase();
      next[s.key] = haystack.includes(q);
    }
    setMatches(next);
  }, [debouncedQuery]);

  const searching = debouncedQuery.trim().length > 0;
  const anyMatch = useMemo(() => SECTIONS.some((s) => matches[s.key]), [matches]);

  return (
    <div className={styles.page}>
      <p className={styles.intro}>
        A guide to every tab, control, alert, and colour in RunNx Planner.
      </p>

      <input
        type="search"
        className={styles.search}
        placeholder="Search the help tab…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search help"
      />

      {searching && !anyMatch && <div className={styles.empty}>No sections match &quot;{debouncedQuery}&quot;.</div>}

      {SECTIONS.map(({ key, title, Component }) => (
        <div key={key} style={{ display: !searching || matches[key] ? undefined : "none" }}>
          <Accordion
            title={title}
            open={searching ? !!matches[key] : !!manualOpen[key]}
            onToggle={searching ? undefined : () => setManualOpen((m) => ({ ...m, [key]: !m[key] }))}
            alwaysMounted
          >
            <div ref={(el) => { refs.current[key] = el; }}>
              <Component />
            </div>
          </Accordion>
        </div>
      ))}
    </div>
  );
}
