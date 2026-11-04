import { useEffect, useId, useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";

import {
  CalendarIcon,
  CellTrayIcon,
  ChartIcon,
  ChevronDownIcon,
  HelpIcon,
  HistoryIcon,
  InboxIcon,
  InstrumentIcon,
  RunIcon,
  SampleIcon,
  SettingsIcon,
  ShieldCheckIcon,
  UploadIcon,
} from "@/components/shared/icons";
import { formatDateTime } from "@/utils/calendarDates";

import styles from "./AppShell.module.css";

// Render the commit ISO timestamp in the app's date + time format (blank if it won't parse).
function formatCommitDate(iso: string): string {
  return Number.isNaN(new Date(iso).getTime()) ? "" : formatDateTime(iso);
}

interface NavItem {
  to: string;
  label: string;
  Icon: ComponentType;
}

// The working pages, left to right in the order a week flows through them; History follows as a
// drop-down (HISTORY_ITEMS).
const NAV_ITEMS: NavItem[] = [
  { to: "/import", label: "Import", Icon: UploadIcon },
  { to: "/backlog", label: "Backlog", Icon: InboxIcon },
  { to: "/schedule", label: "Schedule", Icon: CalendarIcon },
  { to: "/qc", label: "QC", Icon: ShieldCheckIcon },
  { to: "/instruments", label: "Instruments", Icon: InstrumentIcon },
];

// The History drop-down's record pages, each with a one-line hint so they can be told apart
// before clicking.
const HISTORY_ITEMS: (NavItem & { hint: string })[] = [
  { to: "/cells", label: "Cells", Icon: CellTrayIcon, hint: "Every cell tray, its uses and time left" },
  { to: "/history/runs", label: "Runs", Icon: RunIcon, hint: "Every run, past, active and planned" },
  { to: "/history/samples", label: "Samples", Icon: SampleIcon, hint: "Every sample, wherever it is now" },
];
// Routes that light the History trigger: its pages plus their detail pages (/cells/:id,
// /trays/:id, /history/runs/:id, /samples/:id).
const HISTORY_ROUTES = ["/cells", "/trays", "/history", "/samples"];

// Reference pages: icon-only, in the bordered group at the far right beside the build version.
const UTILITY_ITEMS: (NavItem & { title: string })[] = [
  { to: "/stats", label: "Stats", Icon: ChartIcon, title: "Stats - charts of throughput, cell reuse, failures and credits" },
  { to: "/settings", label: "Settings", Icon: SettingsIcon, title: "Settings - scheduling and sample defaults" },
  { to: "/help", label: "Help", Icon: HelpIcon, title: "Help - how every screen works" },
];

/** The nav's History drop-down: a disclosure button (not an ARIA menu - its items are plain
 * links) that opens on click and closes on an item click, an outside click or Esc, the same
 * lightweight pattern as the Schedule's View options menu. */
function HistoryMenu() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const { pathname } = useLocation();
  const active = HISTORY_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.menuWrap} ref={wrapRef}>
      <button
        type="button"
        ref={triggerRef}
        className={`${styles.navLink} ${styles.menuTrigger}${active ? ` ${styles.navLinkActive}` : ""}`}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        <HistoryIcon />
        History
        <span className={styles.chevron}>
          <ChevronDownIcon />
        </span>
      </button>
      {open && (
        <div id={menuId} className={styles.menu}>
          {HISTORY_ITEMS.map(({ to, label, Icon, hint }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => (isActive ? `${styles.menuItem} ${styles.menuItemActive}` : styles.menuItem)}
              onClick={() => setOpen(false)}
            >
              <span className={styles.menuIcon}>
                <Icon />
              </span>
              <span className={styles.menuText}>
                <span className={styles.menuLabel}>{label}</span>
                <span className={styles.menuHint}>{hint}</span>
              </span>
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const topbarRef = useRef<HTMLElement>(null);
  // The Schedule page's fixed-width weekly grid is starved by the 1720px .wrap cap on wide
  // screens, so it opts out of the cap and spans the full viewport (see .wrap-full in base.css).
  const fullBleed = useLocation().pathname.startsWith("/schedule");

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
            {NAV_ITEMS.map(({ to, label, Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) => (isActive ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink)}
              >
                <Icon />
                {label}
              </NavLink>
            ))}
            <HistoryMenu />
          </nav>
          <div className={styles.utility}>
            {UTILITY_ITEMS.map(({ to, label, Icon, title }) => (
              <NavLink
                key={to}
                to={to}
                aria-label={label}
                title={title}
                className={({ isActive }) =>
                  isActive ? `${styles.utilityLink} ${styles.utilityLinkActive}` : styles.utilityLink
                }
              >
                <Icon />
              </NavLink>
            ))}
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
        </div>
      </header>
      <div className={fullBleed ? "wrap wrap-full" : "wrap"}>{children}</div>
    </>
  );
}
