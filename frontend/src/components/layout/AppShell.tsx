import { useLayoutEffect, useRef, type ReactNode } from "react";
import { NavLink } from "react-router-dom";

import styles from "./AppShell.module.css";

// Render the commit ISO timestamp as a compact, locale-friendly date + time.
function formatCommitDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const NAV_ITEMS = [
  { to: "/import", label: "Import" },
  { to: "/backlog", label: "Backlog" },
  { to: "/schedule", label: "Schedule" },
  { to: "/cells", label: "Cells" },
  { to: "/instruments", label: "Instruments" },
  { to: "/history/runs", label: "History" },
  { to: "/stats", label: "Stats" },
  { to: "/admin", label: "Admin" },
  { to: "/help", label: "Help" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const topbarRef = useRef<HTMLElement>(null);

  // Exposed as a CSS var so other sticky elements (e.g. the schedule page's date-picker
  // toolbar) can position themselves directly beneath the nav instead of guessing its
  // height - the nav can wrap onto a second line on narrow viewports.
  useLayoutEffect(() => {
    const el = topbarRef.current;
    if (!el) return;
    const setHeight = () => document.documentElement.style.setProperty("--topbar-h", `${el.offsetHeight}px`);
    setHeight();
    const observer = new ResizeObserver(setHeight);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <header className={styles.topbar} ref={topbarRef}>
        <div className={styles.topbarStrip} />
        <div className={styles.topbarInner}>
          <NavLink to="/schedule" className={styles.brand}>
            Run<span className={styles.brandAccent}>Nx</span>
            <span className={styles.dot} />
          </NavLink>
          <nav className={styles.nav}>
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => (isActive ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink)}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <a
            className={styles.version}
            href="https://github.com/jameswatts1990/sprq-nx-planner/commits/main"
            target="_blank"
            rel="noreferrer"
            title="View changelog on GitHub"
          >
            <span className={styles.versionNumber}>v{__APP_VERSION__}</span>
            {__COMMIT_DATE__ && <span className={styles.versionDate}>{formatCommitDate(__COMMIT_DATE__)}</span>}
          </a>
        </div>
      </header>
      <div className="wrap">{children}</div>
    </>
  );
}
