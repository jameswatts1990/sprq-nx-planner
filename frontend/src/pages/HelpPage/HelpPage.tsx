import { useEffect, useRef, useState } from "react";

import { useDebouncedValue } from "@/utils/useDebouncedValue";

import styles from "./HelpPage.module.css";
import { useHelpSearch } from "./useHelpSearch";
import { AdminSection } from "./sections/AdminSection";
import { BacklogSection } from "./sections/BacklogSection";
import { CellsSection } from "./sections/CellsSection";
import { GettingStartedSection } from "./sections/GettingStartedSection";
import { HistorySection } from "./sections/HistorySection";
import { ImportSection } from "./sections/ImportSection";
import { InstrumentsSection } from "./sections/InstrumentsSection";
import { LegendSection } from "./sections/LegendSection";
import { ScheduleSection } from "./sections/ScheduleSection";
import { StatsSection } from "./sections/StatsSection";

const SECTIONS = [
  { key: "gettingStarted", title: "Getting started", Component: GettingStartedSection },
  { key: "import", title: "Import", Component: ImportSection },
  { key: "backlog", title: "Backlog", Component: BacklogSection },
  { key: "schedule", title: "Schedule", Component: ScheduleSection },
  { key: "cells", title: "Cells", Component: CellsSection },
  { key: "instruments", title: "Instruments", Component: InstrumentsSection },
  { key: "history", title: "History & Samples", Component: HistorySection },
  { key: "stats", title: "Stats", Component: StatsSection },
  { key: "admin", title: "Admin", Component: AdminSection },
  { key: "legend", title: "Colour & Status Legend", Component: LegendSection },
] as const;

/** Living documentation of every screen in the app, for non-technical lab users.
 * See CLAUDE.md's "Help Tab Maintenance" section - whenever a user-facing feature,
 * interaction, alert, or colour meaning changes, the matching section file here
 * must be updated in the same change.
 *
 * Laid out like a docs site: a persistent left table-of-contents (with scroll-spy and,
 * while searching, per-section match tallies) beside one continuous, always-mounted
 * column of sections. Search highlights the term in place via the CSS Custom Highlight
 * API (see useHelpSearch) and steps through the hits - no accordions, so every section's
 * text is always on the page and always searchable. */
export function HelpPage() {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 200);
  const contentRef = useRef<HTMLDivElement>(null);
  const [activeSection, setActiveSection] = useState<string>(SECTIONS[0].key);

  const search = useHelpSearch(contentRef, debouncedQuery);
  const searching = debouncedQuery.trim().length >= 2;

  // Scroll-spy: highlight the table-of-contents entry for whichever section currently
  // sits nearest the top of the viewport (just under the sticky app nav).
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;
    const sections = Array.from(container.querySelectorAll<HTMLElement>("[data-help-section]"));
    if (!sections.length) return;

    const topbarH = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--topbar-h"), 10) || 64;
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const key = (e.target as HTMLElement).dataset.helpSection ?? "";
          if (e.isIntersecting) visible.add(key);
          else visible.delete(key);
        }
        // Pick the first section (in document order) that's within the band. The band's top
        // edge sits below where a clicked section comes to rest (its scroll-margin-top), so
        // the previous section's tangent bottom edge doesn't keep it spuriously active.
        const top = sections.find((s) => visible.has(s.dataset.helpSection ?? ""));
        if (top?.dataset.helpSection) setActiveSection(top.dataset.helpSection);
      },
      { rootMargin: `-${topbarH + 44}px 0px -55% 0px` },
    );
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, []);

  const scrollToSection = (key: string) => {
    contentRef.current
      ?.querySelector(`[data-help-section="${key}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveSection(key);
  };

  return (
    <div className={styles.page}>
      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <div className={styles.searchWrap}>
            <input
              type="search"
              className={styles.search}
              placeholder="Search help…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (e.shiftKey) search.goPrev();
                  else search.goNext();
                }
              }}
              aria-label="Search help"
            />
            {searching && (
              <div className={styles.searchNav}>
                {search.total > 0 ? (
                  <>
                    <span className={styles.searchCount}>
                      {search.position} / {search.total}
                    </span>
                    <div className={styles.searchNavBtns}>
                      <button type="button" className={styles.searchNavBtn} onClick={search.goPrev} aria-label="Previous match">
                        ↑
                      </button>
                      <button type="button" className={styles.searchNavBtn} onClick={search.goNext} aria-label="Next match">
                        ↓
                      </button>
                    </div>
                  </>
                ) : (
                  <span className={styles.searchCount}>No matches</span>
                )}
              </div>
            )}
          </div>

          <nav className={styles.toc} aria-label="Help contents">
            {SECTIONS.map(({ key, title }) => {
              const count = search.perSection[key] ?? 0;
              const active = activeSection === key;
              return (
                <button
                  key={key}
                  type="button"
                  className={`${styles.tocLink} ${active ? styles.tocLinkActive : ""} ${searching && count === 0 ? styles.tocLinkMuted : ""}`}
                  onClick={() => scrollToSection(key)}
                  aria-current={active ? "true" : undefined}
                >
                  <span className={styles.tocLabel}>{title}</span>
                  {searching && count > 0 && <span className={styles.tocCount}>{count}</span>}
                </button>
              );
            })}
          </nav>
        </aside>

        <div className={styles.content} ref={contentRef}>
          <header className={styles.contentHead}>
            <h1 className={styles.title}>Help</h1>
            <p className={styles.intro}>A guide to every tab, control, alert, and colour in RunNx Planner.</p>
          </header>

          {SECTIONS.map(({ key, title, Component }) => (
            <section key={key} className={styles.section} data-help-section={key}>
              <h2 className={styles.sectionTitle}>{title}</h2>
              <Component />
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
