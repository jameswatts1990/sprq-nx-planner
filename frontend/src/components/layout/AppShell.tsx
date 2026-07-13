import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

import styles from "./AppShell.module.css";

const NAV_ITEMS = [
  { to: "/import", label: "Import" },
  { to: "/backlog", label: "Backlog" },
  { to: "/schedule", label: "Schedule" },
  { to: "/cells", label: "Cells & Instruments" },
  { to: "/history/runs", label: "History" },
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <>
      <header className={styles.topbar}>
        <div className={styles.topbarStrip} />
        <div className={styles.topbarInner}>
          <NavLink to="/schedule" className={styles.brand}>
            Revio<span className={styles.brandAccent}>Nx</span>
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
        </div>
      </header>
      <div className="wrap">{children}</div>
    </>
  );
}
