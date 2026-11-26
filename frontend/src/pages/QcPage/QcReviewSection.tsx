import { useMutation, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { errorMessage } from "@/api/client";
import { qcApi } from "@/api/qc";
import { CellQcModal } from "@/components/cells/CellQcModal";
import { MlwhErrorNote } from "@/components/shared/MlwhErrorNote";
import { SectionHeading } from "@/components/shared/SectionHeading";
import { SmrtLinkLink } from "@/components/shared/SmrtLinkLink";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Note } from "@/components/ui/Note";
import { useMlwhRefresh } from "@/hooks/useSequencing";
import type { PacbioCaseOut } from "@/types/pacbioCase";
import type { QcReview, QcReviewWell } from "@/types/qcReview";
import { formatDateTime, formatDateUTC, parseDateOnly } from "@/utils/calendarDates";
import { QC_REVIEW_BADGE } from "@/utils/creditCase";
import { useSampleBackNav } from "@/utils/sampleBackNav";

import { PacbioCaseModal } from "./PacbioCaseModal";
import { mlwhDateLabel, reviewCasePrefill, reviewFailReason, reviewWellLabel, reviewWellMatches } from "./qcReview";
import styles from "./QcPage.module.css";

const invalidateReview = (queryClient: ReturnType<typeof useQueryClient>) =>
  void queryClient.invalidateQueries({ queryKey: ["qc-review"] });

/** The RunNx side of a well: the cell use it was loaded as (with how sure the match is), the run
 * with nothing in that well, or nothing at all. */
function RunnxContext({ well }: { well: QcReviewWell }) {
  const backNav = useSampleBackNav();
  const m = well.match;
  if (!m) {
    return (
      <>
        <Badge
          tone="orange"
          title={`No RunNx run is named ${well.run_name}, and no unnamed RunNx run on ${well.instrument_name ?? "this instrument"} was loaded then`}
        >
          Not in RunNx
        </Badge>
        {well.library_barcodes.length > 0 && <span className={styles.metaText}>{well.library_barcodes.join(", ")}</span>}
      </>
    );
  }
  return (
    <>
      <span className={styles.ctxLabel}>RunNx</span>
      {m.cell_id !== null && m.cell_code ? (
        <>
          <Link to={`/cells/${m.cell_id}`} className={styles.code}>
            {m.cell_code}
          </Link>
          {m.use_number !== null && <span className={styles.metaText}>Use {m.use_number}</span>}
          {m.sample_id !== null && m.pool_id ? (
            <Link to={`/samples/${m.sample_id}`} state={backNav} className="link">
              {m.pool_id}
            </Link>
          ) : (
            <span className={styles.muted}>no sample</span>
          )}
        </>
      ) : (
        <Link to={`/history/runs/${m.run_batch_id}`} className="link">
          {m.run_label}
        </Link>
      )}
      {m.by === "instrument_date" && (
        <Badge
          tone="warning"
          title="This RunNx run has no Traction run name, so it was matched by instrument and load day. Check it's the right run before confirming the fail."
        >
          Matched by instrument &amp; date
        </Badge>
      )}
      {m.pool_matches === false && (
        <Badge
          tone="warning"
          title={`RunNx has ${m.pool_id} in this well, but MLWH loaded ${well.library_barcodes.join(", ")} - check it's the right well.`}
        >
          Pool ID differs
        </Badge>
      )}
    </>
  );
}

/** The MLWH facts behind a well, shown when its row is expanded - enough to look into the failure
 * without leaving RunNx, plus a link to the run in SMRT Link. */
function WellDetails({ well }: { well: QcReviewWell }) {
  const facts: [string, string | null][] = [
    ["LangQC verdict", `${well.qc_state}${well.qc_date ? ` · ${formatDateTime(well.qc_date)}` : ""}`],
    ["Instrument", well.instrument_name],
    ["SMRT cell", [well.smrt_cell_id, well.cell_lot && `lot ${well.cell_lot}`].filter(Boolean).join(" · ") || null],
    [
      "Use of this cell (MLWH)",
      well.cell_use_count == null ? null : `Use ${well.cell_use_count}${well.is_multi_use === false ? " (single-use)" : ""}`,
    ],
    ["Sequencing kit", well.sequencing_kit],
    ["Movie", [well.movie_name, well.movie_minutes != null && `${+(well.movie_minutes / 60).toFixed(1)} h`].filter(Boolean).join(" · ") || null],
    ["Well started", well.well_start && formatDateTime(well.well_start)],
    ["Well finished", well.well_complete && formatDateTime(well.well_complete)],
    ["Loading", well.loading_conc == null ? null : `${+well.loading_conc.toFixed(1)} pM`],
    ["HiFi yield", well.hifi_yield_gb == null ? null : `${well.hifi_yield_gb} Gb`],
    [
      "Library tubes",
      well.library_barcodes.length
        ? `${well.library_barcodes.join(", ")} (${well.sample_count} sample${well.sample_count === 1 ? "" : "s"})`
        : null,
    ],
  ];
  return (
    <div className={styles.caseDetails}>
      <dl className={styles.detailList}>
        {facts.map(([label, value]) => (
          <div key={label} className={styles.detailItem}>
            <dt className="detailLabel">{label}</dt>
            <dd>{value || "—"}</dd>
          </div>
        ))}
      </dl>
      <SmrtLinkLink url={well.smrt_link_url} label="Open this run in SMRT Link" />
    </div>
  );
}

function IgnoreModal({ well, onClose }: { well: QcReviewWell; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const ignore = useMutation({
    mutationFn: () => qcApi.ignoreReviewWell(well.key, reason.trim()),
    onSuccess: () => {
      invalidateReview(queryClient);
      onClose();
    },
  });
  return (
    <ConfirmModal
      title={`Ignore ${reviewWellLabel(well)}?`}
      textarea={{
        label: "Why isn't this a credit case?",
        value: reason,
        onChange: setReason,
        placeholder: "e.g. PacBio declined the credit, or the run predates RunNx",
      }}
      confirmLabel="Ignore well"
      pendingLabel="Ignoring…"
      pending={ignore.isPending}
      confirmDisabled={reason.trim() === ""}
      error={ignore.isError ? errorMessage(ignore.error, "Couldn't ignore this well.") : undefined}
      onCancel={onClose}
      onConfirm={() => ignore.mutate()}
    >
      <p className={styles.helper}>
        It moves to the <b>Ignored</b> list under QC Review, with your reason, and RunNx records nothing against the
        cell. You can restore it from there.
      </p>
    </ConfirmModal>
  );
}

type RowModal = "fail" | "log" | "ignore" | null;

function ReviewRow({ well, onResolved }: { well: QcReviewWell; onResolved: (text: string) => void }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<RowModal>(null);
  const restore = useMutation({
    mutationFn: () => qcApi.restoreReviewWell(well.key),
    onSuccess: () => invalidateReview(queryClient),
  });
  const m = well.match;
  // No RunNx use to fail -> log a case without a cell. A use that just can't be failed *yet* keeps
  // Confirm fail (disabled, with the reason): logging a case for it would duplicate the cell's own.
  const logInstead = !m || m.log_instead || m.cell_id === null;
  const qcDate = mlwhDateLabel(well.qc_date);
  const label = reviewWellLabel(well);

  return (
    <div className={styles.row} data-open={open}>
      <div className={styles.head}>
        <button
          type="button"
          className={styles.expand}
          aria-expanded={open}
          aria-label={open ? "Hide MLWH details" : "Show MLWH details"}
          onClick={() => setOpen((v) => !v)}
        >
          <span className={open ? "disclosure open" : "disclosure"} aria-hidden="true">
            ▸
          </span>
        </button>
        <span className={styles.summary}>{well.run_name}</span>
        <span className={styles.metaText}>
          Plate {well.plate_number} · {well.well_label}
        </span>
        <Badge tone={QC_REVIEW_BADGE.tone} title="The QC team failed this SMRT cell in LangQC (MLWH) - RunNx has no fail on it yet">
          {QC_REVIEW_BADGE.label}
        </Badge>
        <Badge tone="danger" title="LangQC's verdict on this well, from MLWH">
          {well.qc_state}
        </Badge>
        <span className={styles.facts}>
          {well.instrument_name && <span className={styles.metaText}>{well.instrument_name}</span>}
          <span className={styles.date}>{qcDate ? `QC ${qcDate}` : "—"}</span>
        </span>
      </div>

      <div className={styles.ctx}>
        <RunnxContext well={well} />
      </div>

      {well.ignored ? (
        <div className={styles.progress}>
          <span className={styles.ignoredNote}>
            Ignored {formatDateUTC(parseDateOnly(well.ignored.ignored_at.slice(0, 10)))}
            {well.ignored.ignored_by && well.ignored.ignored_by !== "unknown" ? ` by ${well.ignored.ignored_by}` : ""}:{" "}
            {well.ignored.reason}
          </span>
          <Button size="sm" variant="ghost" disabled={restore.isPending} onClick={() => restore.mutate()}>
            {restore.isPending ? "Restoring…" : "Restore"}
          </Button>
          {restore.isError && <span className={styles.blocked}>{errorMessage(restore.error, "Couldn't restore it.")}</span>}
        </div>
      ) : (
        <div className={styles.progress}>
          {logInstead ? (
            <Button size="sm" onClick={() => setModal("log")} title="Log a credit case without a cell, filled in from MLWH">
              Log case…
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={!m.can_fail}
              onClick={() => setModal("fail")}
              title={
                m.can_fail
                  ? "Open Cell QC on this use with the LangQC verdict filled in - the same fail as one started in RunNx"
                  : (m.blocked_reason ?? undefined)
              }
            >
              Confirm fail…
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setModal("ignore")} title="Not a credit case - move it to Ignored, with a reason">
            Ignore…
          </Button>
          {m && !m.can_fail && m.blocked_reason && <span className={styles.blocked}>{m.blocked_reason}</span>}
        </div>
      )}

      {open && (
        <div className={styles.detail}>
          <WellDetails well={well} />
        </div>
      )}

      {modal === "fail" && m?.cell_id != null && m.can_fail && (
        <CellQcModal
          cellId={m.cell_id}
          cellUseId={m.cell_use_id}
          qcReview={{ reason: reviewFailReason(well), summary: `${well.qc_state} on ${label}` }}
          onClose={() => setModal(null)}
          onApplied={() =>
            onResolved(`Recorded the fail on ${m.cell_code ?? "the cell"} in RunNx. Its credit case is in the list below.`)
          }
        />
      )}
      {modal === "log" && (
        <PacbioCaseModal
          prefill={reviewCasePrefill(well)}
          onClose={() => setModal(null)}
          onSaved={(saved: PacbioCaseOut) => {
            setModal(null);
            onResolved(`Logged “${saved.summary}” as a case without a cell. It's under Needs report, labelled ${QC_REVIEW_BADGE.label}.`);
          }}
        />
      )}
      {modal === "ignore" && <IgnoreModal well={well} onClose={() => setModal(null)} />}
    </div>
  );
}

/**
 * QC Review - the QC page's intake from MLWH: SMRT cells the QC team failed in LangQC (a SMRT cell
 * or instrument failure, so a PacBio credit case) that RunNx has no fail on, because the verdict
 * came after the run and outside RunNx. Each well either gets its fail confirmed in RunNx (Cell QC,
 * exactly as if started here), is logged as a case without a cell when RunNx has no cell to fail,
 * or is ignored with a reason. The list is rebuilt from MLWH on every load, so a well also drops
 * out on its own once it's failed in RunNx by any route. See backend services/qc_review.py.
 */
export function QcReviewSection({
  review,
  query,
  onResolved,
}: {
  review: UseQueryResult<QcReview>;
  query: string;
  onResolved: (text: string) => void;
}) {
  const [ignoredOpen, setIgnoredOpen] = useState(false);
  const retry = useMlwhRefresh(["qc-review"], () => qcApi.review({ refresh: true }));
  const data = review.data;
  const searching = query.trim() !== "";
  const pending = (data?.pending ?? []).filter((w) => reviewWellMatches(w, query));
  const ignored = (data?.ignored ?? []).filter((w) => reviewWellMatches(w, query));
  const showIgnored = ignoredOpen || (searching && ignored.length > 0);
  const since = data ? formatDateUTC(parseDateOnly(data.since)) : null;

  return (
    <section className={styles.group} aria-label="QC Review">
      <SectionHeading
        title="QC Review"
        legend={data?.ok ? <Badge tone={QC_REVIEW_BADGE.tone}>{data.pending.length}</Badge> : undefined}
      />

      {review.isLoading && <div className="status">Checking MLWH for SMRT cells the QC team failed…</div>}
      {review.isError && (
        <Note tone="bad" icon="!">
          {errorMessage(review.error, "Couldn't load QC Review.")}
        </Note>
      )}
      {data && !data.configured && (
        <p className={styles.reviewIntro}>
          QC Review isn&apos;t available here: this deployment has no MLWH connection, so RunNx can&apos;t see the QC
          team&apos;s LangQC verdicts.
        </p>
      )}
      {data?.configured && !data.ok && (
        <MlwhErrorNote
          what="the QC team's verdicts"
          error={data.error}
          onRetry={() => retry.mutate()}
          retrying={retry.isPending}
        />
      )}

      {data?.ok && (
        <>
          <p className={styles.reviewIntro}>
            SMRT cells the QC team failed in LangQC (a SMRT cell or instrument failure) since {since} that RunNx
            hasn&apos;t failed. Confirm each fail in RunNx, or ignore it with a reason.
            {data.already_failed + data.already_logged > 0 && (
              <span className={styles.muted}>
                {" "}
                {data.already_failed} already failed in RunNx
                {data.already_logged > 0 ? `, ${data.already_logged} logged as cases` : ""}.
              </span>
            )}
          </p>
          {data.pending.length === 0 ? (
            <div className="status">Nothing to review - every one of those failures is already in RunNx.</div>
          ) : searching && pending.length === 0 ? (
            <div className="status">No QC Review wells match “{query.trim()}”.</div>
          ) : (
            <div className={styles.rows}>
              {pending.map((w) => (
                <ReviewRow key={w.key} well={w} onResolved={onResolved} />
              ))}
            </div>
          )}

          {data.ignored.length > 0 && (
            <>
              <button
                type="button"
                className={styles.receivedToggle}
                aria-expanded={showIgnored}
                onClick={() => setIgnoredOpen((v) => !v)}
              >
                <span className={showIgnored ? "disclosure open" : "disclosure"} aria-hidden="true">
                  ▸
                </span>
                Ignored
                <Badge>{data.ignored.length}</Badge>
              </button>
              {showIgnored && (
                <div className={styles.rows}>
                  {ignored.map((w) => (
                    <ReviewRow key={w.key} well={w} onResolved={onResolved} />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
