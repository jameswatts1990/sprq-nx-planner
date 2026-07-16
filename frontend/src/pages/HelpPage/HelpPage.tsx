import { Accordion } from "@/components/ui/Accordion";

import styles from "./HelpPage.module.css";
import { AdminSection } from "./sections/AdminSection";
import { BacklogSection } from "./sections/BacklogSection";
import { CellsSection } from "./sections/CellsSection";
import { GettingStartedSection } from "./sections/GettingStartedSection";
import { HistorySection } from "./sections/HistorySection";
import { ImportSection } from "./sections/ImportSection";
import { LegendSection } from "./sections/LegendSection";
import { ScheduleSection } from "./sections/ScheduleSection";

/** Living documentation of every screen in the app, for non-technical lab users.
 * See CLAUDE.md's "Help Tab Maintenance" section - whenever a user-facing feature,
 * interaction, alert, or colour meaning changes, the matching section file here
 * must be updated in the same change. */
export function HelpPage() {
  return (
    <div className={styles.page}>
      <p className={styles.intro}>
        A guide to every tab, control, alert, and colour in RunNx Planner.
      </p>

      <Accordion title="Getting started" defaultOpen>
        <GettingStartedSection />
      </Accordion>
      <Accordion title="Import">
        <ImportSection />
      </Accordion>
      <Accordion title="Backlog">
        <BacklogSection />
      </Accordion>
      <Accordion title="Schedule">
        <ScheduleSection />
      </Accordion>
      <Accordion title="Cells & Instruments">
        <CellsSection />
      </Accordion>
      <Accordion title="History">
        <HistorySection />
      </Accordion>
      <Accordion title="Admin">
        <AdminSection />
      </Accordion>
      <Accordion title="Colour & Status Legend">
        <LegendSection />
      </Accordion>
    </div>
  );
}
