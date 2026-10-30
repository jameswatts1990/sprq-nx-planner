import { useState, type ReactNode } from "react";

import type { SampleDefaults } from "@/api/settings";
import { CellTypeBadge } from "@/components/cells/CellTypeBadge";
import { MovieTimeFlag } from "@/components/shared/MovieTimeFlag";
import { Badge } from "@/components/ui/Badge";
import { CopyValue } from "@/components/ui/CopyValue";
import { Note } from "@/components/ui/Note";
import { useMovieRules } from "@/hooks/useMovieRules";
import type { BatchSheetPlateOut, BatchSheetRunOut, BatchSheetWellOut } from "@/types/batchSheet";
import { tractionWellFromSlot } from "@/utils/plateWell";
import { runLabel } from "@/utils/runLabel";

import { formatFullDate, plateHeading } from "./PrintedRun";
import { platePositions, runAdaptiveLoading, runReminders, wellSettingDiffs } from "./tractionEntry";
import styles from "./TractionRun.module.css";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className={styles.fieldLabel}>{label}</dt>
      <dd className={styles.fieldValue}>{children}</dd>
    </>
  );
}

/** Traction's Well Defaults, in its order. Use Adaptive Loading is this run's own value, since
 * Traction applies it to the whole run; the others are the configured defaults, which match
 * Traction's presets out of the box. */
function WellDefaults({ run, defaults, defaultHours }: { run: BatchSheetRunOut; defaults?: SampleDefaults; defaultHours: number }) {
  const adaptive = runAdaptiveLoading(run);
  let adaptiveValue: ReactNode = defaults?.adaptive_loading ?? "—";
  if (adaptive.kind === "mixed") {
    adaptiveValue = <span className={styles.mixed}>Wells disagree, see above</span>;
  } else if (adaptive.kind === "uniform") {
    adaptiveValue =
      defaults && adaptive.value !== defaults.adaptive_loading ? (
        <span title={`Differs from the default (${defaults.adaptive_loading})`}>
          <Badge tone="ink">{adaptive.value}</Badge>
        </span>
      ) : (
        adaptive.value
      );
  }

  return (
    <dl className={styles.fields}>
      <Field label="Movie Acquisition Time (hrs)">{defaultHours.toFixed(1)}</Field>
      <Field label="Include Base Kinetics">{defaults?.base_kinetics ?? "—"}</Field>
      <Field label="Use Adaptive Loading">
        {adaptiveValue} <span className={styles.muted}>(whole run)</span>
      </Field>
      <Field label="Full Resolution Base Qual">{defaults?.full_resolution_base_q ?? "—"}</Field>
    </dl>
  );
}

function WellCard({
  well,
  defaults,
  defaultHours,
  copied,
  onCopied,
}: {
  well: BatchSheetWellOut;
  defaults?: SampleDefaults;
  defaultHours: number;
  copied: boolean;
  onCopied: () => void;
}) {
  const diffs = wellSettingDiffs(well, defaults);
  const allDefault = well.run_time_hours === defaultHours && diffs.length === 0;

  return (
    <div className={styles.well} data-copied={copied}>
      <div className={styles.wellHead}>
        <span className={styles.wellLabel}>{tractionWellFromSlot(well.slot_index)}</span>
        <span className={styles.muted}>
          {well.cell_ref} ·{" "}
          {well.cell_type === "sprq" ? "SPRQ single use" : `Use ${well.use_number} of ${well.cell_max_uses}`}
        </span>
        {well.window_breached && <span className={styles.expired}>⚠ 108h window expired</span>}
        {copied && (
          <span className={styles.done} title="You've copied this well's barcode">
            ✓ copied
          </span>
        )}
      </div>
      <dl className={styles.wellFields}>
        <Field label="Barcode">
          {well.sample_pool_id ? <CopyValue value={well.sample_pool_id} label="Pool ID" onCopied={onCopied} /> : "—"}
        </Field>
        <Field label="Library Concentration (pM)">
          {well.actual_oplc != null ? (
            <CopyValue value={String(well.actual_oplc)} label="library concentration" />
          ) : (
            <span className={styles.muted}>Not recorded. Enter it in Traction</span>
          )}
        </Field>
        <Field label="Settings">
          {allDefault ? (
            <span className={styles.muted}>Defaults</span>
          ) : (
            <span className={styles.chips}>
              <MovieTimeFlag hours={well.run_time_hours} />
              {diffs.map((d) => (
                <span key={d.field} title={`${d.field}: ${d.value} (the default is ${d.defaultValue})`}>
                  <Badge tone="ink">
                    {d.short} {d.value}
                  </Badge>
                </span>
              ))}
            </span>
          )}
        </Field>
      </dl>
      {well.notes && <div className={styles.notes}>{well.notes}</div>}
    </div>
  );
}

function PlateColumn({
  plateNumber,
  plate,
  defaults,
  defaultHours,
  copiedSlots,
  onCopied,
}: {
  plateNumber: 1 | 2;
  plate: BatchSheetPlateOut | undefined;
  defaults?: SampleDefaults;
  defaultHours: number;
  copiedSlots: Set<number>;
  onCopied: (slotIndex: number) => void;
}) {
  if (!plate) {
    return (
      <div className={styles.plate}>
        <div className={styles.plateHeading}>Plate {plateNumber}</div>
        <div className={styles.empty}>No Plate {plateNumber} in this run. Leave it empty in Traction.</div>
      </div>
    );
  }
  return (
    <div className={styles.plate}>
      <div className={styles.plateHeading}>{plateHeading(plate)}</div>
      {platePositions(plate).map((well, i) =>
        well ? (
          <WellCard
            key={well.slot_index}
            well={well}
            defaults={defaults}
            defaultHours={defaultHours}
            copied={copiedSlots.has(well.slot_index)}
            onCopied={() => onCopied(well.slot_index)}
          />
        ) : (
          <div key={`empty-${i}`} className={styles.empty}>
            <span className={styles.wellLabel}>{tractionWellFromSlot(i)}</span> Empty
          </div>
        ),
      )}
    </div>
  );
}

/** One run on the on-screen Batch Sheet, laid out in the order of Traction's run form (Run
 * Details → Well Defaults → Plates 1/2, wells A1-D1) so the user can key it into Traction
 * top to bottom, copying each value with one click. Screen-only: printing uses PrintedRun. */
export function TractionRun({ run, defaults }: { run: BatchSheetRunOut; defaults?: SampleDefaults }) {
  const { defaultHours } = useMovieRules();
  // Wells whose barcode has been copied this session - a lightweight progress marker across the run.
  const [copiedSlots, setCopiedSlots] = useState<Set<number>>(() => new Set());
  const reminders = runReminders(run, defaults, defaultHours);

  function markCopied(slotIndex: number) {
    setCopiedSlots((prev) => (prev.has(slotIndex) ? prev : new Set(prev).add(slotIndex)));
  }

  return (
    <section className={styles.run}>
      <h2 className={styles.title}>
        {run.instrument_name}
        {run.instrument_name !== run.instrument_serial && (
          <span className={styles.muted}> ({run.instrument_serial})</span>
        )}
        <span className={styles.muted}> · Run {runLabel(run)}</span> <CellTypeBadge cellType={run.cell_type} />
      </h2>
      <div className={styles.meta}>
        <span>Load day: {formatFullDate(run.load_date)}</span>
        <span>Status: {run.status}</span>
      </div>

      {reminders.map((r) => (
        <Note key={r.text} tone={r.tone} icon={r.icon}>
          {r.text}
        </Note>
      ))}

      <h3 className={styles.sectionTitle}>Run Details</h3>
      <dl className={styles.fields}>
        <Field label="Run Name">
          {run.run_name ? (
            <CopyValue value={run.run_name} label="run name" />
          ) : (
            <span className={styles.muted}>
              Traction generates it. Note it down: you&apos;ll enter it in RunNx when you confirm this run loaded.
            </span>
          )}
        </Field>
      </dl>

      <h3 className={styles.sectionTitle}>Well Defaults</h3>
      <WellDefaults run={run} defaults={defaults} defaultHours={defaultHours} />

      <h3 className={styles.sectionTitle}>Plates</h3>
      <div className={styles.plates}>
        {([1, 2] as const).map((n) => (
          <PlateColumn
            key={n}
            plateNumber={n}
            plate={run.plates.find((p) => p.plate_number === n)}
            defaults={defaults}
            defaultHours={defaultHours}
            copiedSlots={copiedSlots}
            onCopied={markCopied}
          />
        ))}
      </div>
      <p className={styles.muted}>Volume isn&apos;t tracked in RunNx. Enter each well&apos;s volume in Traction.</p>
    </section>
  );
}
