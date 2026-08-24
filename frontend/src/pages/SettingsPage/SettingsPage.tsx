import { useState, type JSX } from "react";

import { CreditEmailPanel } from "./CreditEmailPanel";
import { DeveloperTools } from "./DeveloperTools";
import { FactsPanel } from "./FactsPanel";
import { MovieSchedulingPanel } from "./MovieSchedulingPanel";
import { SampleDefaultsPanel } from "./SampleDefaultsPanel";
import { SchedulingPanel } from "./SchedulingPanel";
import styles from "./SettingsPage.module.css";

type Section = { key: string; title: string; keywords: string; Component: () => JSX.Element };

/** The everyday, lab-facing settings. Each is a self-contained panel; the sidebar swaps which
 * one is shown. `keywords` (lower-case) back the sidebar search so a term like "reuse" or
 * "movie" surfaces the right section even when it isn't in the title. */
const SECTIONS: Section[] = [
  {
    key: "sample-defaults",
    title: "Sample defaults",
    keywords: "adaptive loading full resolution base q kinetics priority defaults new import",
    Component: SampleDefaultsPanel,
  },
  {
    key: "scheduling",
    title: "Scheduling",
    keywords: "insert size reuse threshold small insert day start hour run load time",
    Component: SchedulingPanel,
  },
  {
    key: "movie",
    title: "Movie scheduling",
    keywords: "movie time length default 12 24 30 cell position rule auto schedule carousel",
    Component: MovieSchedulingPanel,
  },
  {
    key: "email",
    title: "Email template",
    keywords: "credit email pacbio smrt cell to cc subject body",
    Component: CreditEmailPanel,
  },
  {
    key: "facts",
    title: "Instrument & scheduling facts",
    keywords: "108 hour window max uses tray of four wells timing ladder prep ppa lanes vendor read only fixed",
    Component: FactsPanel,
  },
];

/** The raw-database tools, kept off the everyday path behind the sidebar's "Show developer
 * tools" reveal (see CLAUDE.md - un-gated, but out of the way). */
const DEV_SECTION: Section = {
  key: "developer",
  title: "Developer tools",
  keywords: "database tables rows clear backlog delete raw dev",
  Component: DeveloperTools,
};

/** The Settings page: a Help-style sidebar + search beside a single active panel. Groups the
 * lab-configurable settings (sample defaults, scheduling, movie scheduling, email template) and
 * the read-only instrument facts, with the dev-only DB tools tucked behind a reveal. */
export function SettingsPage() {
  const [active, setActive] = useState<string>(SECTIONS[0].key);
  const [query, setQuery] = useState("");
  const [devShown, setDevShown] = useState(false);

  const allSections = devShown ? [...SECTIONS, DEV_SECTION] : SECTIONS;
  // Fall back to the first section if the active one is no longer available (e.g. dev tools were
  // just hidden while being viewed).
  const activeSection = allSections.find((s) => s.key === active) ?? SECTIONS[0];
  const ActiveComponent = activeSection.Component;

  const q = query.trim().toLowerCase();
  const navSections = allSections.filter(
    (s) => !q || s.title.toLowerCase().includes(q) || s.keywords.includes(q),
  );

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <aside className={styles.sidebar}>
          <input
            type="search"
            className={styles.search}
            placeholder="Search settings…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search settings"
          />

          <nav className={styles.nav} aria-label="Settings sections">
            {navSections.length === 0 ? (
              <span className={styles.noMatch}>No settings match “{query}”.</span>
            ) : (
              navSections.map((s) => {
                const isActive = s.key === activeSection.key;
                const isDev = s.key === DEV_SECTION.key;
                return (
                  <button
                    key={s.key}
                    type="button"
                    className={`${styles.navLink} ${isActive ? styles.navLinkActive : ""} ${isDev ? styles.navDev : ""}`}
                    onClick={() => setActive(s.key)}
                    aria-current={isActive ? "true" : undefined}
                  >
                    {s.title}
                  </button>
                );
              })
            )}
          </nav>

          <div className={styles.reveal}>
            <button
              type="button"
              className={styles.revealBtn}
              onClick={() => setDevShown((v) => !v)}
              aria-expanded={devShown}
            >
              {devShown ? "Hide developer tools" : "Show developer tools"}
            </button>
          </div>
        </aside>

        <div className={styles.content}>
          <header className={styles.contentHead}>
            <h1 className={styles.title}>Settings</h1>
            <p className={styles.intro}>Configure how this instance schedules runs, defaults new samples, and more.</p>
          </header>

          <ActiveComponent />
        </div>
      </div>
    </div>
  );
}
