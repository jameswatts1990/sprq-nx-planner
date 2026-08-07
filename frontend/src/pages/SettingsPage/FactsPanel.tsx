import { useQuery } from "@tanstack/react-query";

import { ApiError } from "@/api/client";
import { settingsApi } from "@/api/settings";
import type { SchedulingFacts } from "@/api/settings";
import { Note } from "@/components/ui/Note";

import styles from "./SampleDefaultsPanel.module.css";
import factStyles from "./FactsPanel.module.css";

/** One labelled read-only fact. */
function Fact({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className={factStyles.fact}>
      <span className={factStyles.factLabel}>{label}</span>
      <span className={factStyles.factValue}>{value}</span>
      {note && <span className={factStyles.factNote}>{note}</span>}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={factStyles.group}>
      <h3 className={factStyles.groupTitle}>{title}</h3>
      <div className={factStyles.grid}>{children}</div>
    </section>
  );
}

/** Settings > Instrument & scheduling facts: a read-only view of the vendor-locked / physical
 * constants the app enforces (the 108h window, 3-use cap, tray-of-4, deck wells, movie-length
 * values, and the per-cell timing ladder). Surfaced from GET /api/settings/facts so the card
 * renders the app's real constants and can never fork them - and deliberately not editable:
 * these are instrument facts, not lab preferences (see the Revio ICS methodology). */
export function FactsPanel() {
  const query = useQuery({ queryKey: ["scheduling-facts"], queryFn: () => settingsApi.getFacts() });

  const round = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ""));
  const hours = (n: number) => `${round(n)} h`;
  const reuseWash = (n: number) => (n < 1 ? `${Math.round(n * 60)} min` : hours(n));

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h2 className={styles.title}>Instrument &amp; scheduling facts</h2>
        <p className={styles.helper}>
          The fixed rules the app enforces, from the PacBio Revio / SPRQ-Nx instrument. These are physical or
          vendor-documented facts, not lab preferences, so they’re shown here for reference but can’t be changed.
        </p>
      </div>

      {query.isError && (
        <Note tone="bad" icon="!">
          {query.error instanceof ApiError ? query.error.message : "Failed to load facts."}
        </Note>
      )}

      {query.data && (
        <FactsBody facts={query.data} hours={hours} reuseWash={reuseWash} />
      )}
    </div>
  );
}

function FactsBody({
  facts,
  hours,
  reuseWash,
}: {
  facts: SchedulingFacts;
  hours: (n: number) => string;
  reuseWash: (n: number) => string;
}) {
  const t = facts.timing;
  return (
    <>
      <Group title="Cell reuse">
        <Fact label="Re-use window" value={hours(facts.cell_lifetime_h)} note="from a cell’s first use — one deadline, never resets" />
        <Fact label="Max uses per cell" value={String(facts.cell_max_uses)} note="acquisitions before a cell is spent" />
        <Fact label="Cells per tray" value={String(facts.cells_per_tray)} note="disposed as one physical unit" />
      </Group>

      <Group title="Instrument deck">
        <Fact label="Loading wells" value={String(facts.wells.length)} note="two plates of 4" />
        <Fact label="Well positions" value={facts.wells.join(", ")} />
        <Fact label="Movie lengths" value={facts.movie_hours_choices.map((h) => `${h} h`).join(" / ")} note="the acquisition times a sample can be set to" />
      </Group>

      <Group title="Per-cell timing ladder">
        <Fact label="Prep before movie" value={hours(t.prep_h)} note="breakout to movie start" />
        <Fact label="Re-use on-board wash" value={reuseWash(t.reuse_prep_h)} note="extra prep on a 2nd/3rd use" />
        <Fact label="Adaptive-loading stagger" value={hours(t.stagger_h)} note="between cells in a load group" />
        <Fact label="Post-primary analysis (PPA)" value={hours(t.ppa_h)} note="per cell after its movie" />
        <Fact label="Sequencing lanes" value={String(t.seq_lanes)} note="cells sequencing at once" />
        <Fact label="PPA lanes" value={String(t.ppa_lanes)} note="cells in PPA at once" />
        <Fact label="Load-lock buffer" value={hours(t.lock_buffer_h)} note="turnaround before the next run can load" />
      </Group>
    </>
  );
}
