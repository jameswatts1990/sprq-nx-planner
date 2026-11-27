import { Fragment, useState } from "react";
import { Link } from "react-router-dom";

import { errorMessage } from "@/api/client";
import { sequencingApi } from "@/api/sequencing";
import { MlwhErrorNote } from "@/components/shared/MlwhErrorNote";
import { SmrtLinkLink } from "@/components/shared/SmrtLinkLink";
import { StatTile, StatTiles } from "@/components/shared/StatTile";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Note } from "@/components/ui/Note";
import { useMlwhRefresh, useSequencingHistory } from "@/hooks/useSequencing";
import type { SequencingLoading, SequencingSummary } from "@/types/sequencing";
import { formatDateUTC, formatShortDateUTC, parseDateOnly } from "@/utils/calendarDates";
import {
  formatGb,
  formatMovie,
  formatPct,
  formatPm,
  langQcLabel,
  langQcTone,
  lastLoadingLine,
  summaryChipText,
  summaryTitle,
} from "@/utils/sequencing";

import styles from "./SequencingHistory.module.css";

/** A list row's sequencing highlight: "2 cells · 48 Gb · last 210 pM", the whole last loading in
 * its tooltip, and a ▸ that drops the full history open in a row below (the note chip's pattern).
 * Quiet otherwise: "…" while the page's highlights load, "—" for a sample never sequenced, "?"
 * (with MLWH's reason on hover) when MLWH couldn't be read. */
export function SequencingSummaryChip({
  summary,
  state,
  error,
  open,
  onToggle,
}: {
  summary: SequencingSummary | undefined;
  state: "loading" | "ok" | "error";
  error?: string | null;
  open: boolean;
  onToggle: () => void;
}) {
  if (state === "loading") return <span className={styles.quiet}>…</span>;
  if (state === "error") {
    return (
      <span className={styles.quiet} title={`Couldn't read MLWH${error ? `: ${error}` : ""}`}>
        ?
      </span>
    );
  }
  if (!summary) {
    return (
      <span className={styles.quiet} title="MLWH has no loadings for this Pool ID or its Sanger IDs">
        —
      </span>
    );
  }
  return (
    <button
      type="button"
      className={styles.chip}
      aria-expanded={open}
      title={open ? "Hide the sequencing history" : summaryTitle(summary)}
      onClick={onToggle}
    >
      <span className={open ? "disclosure open" : "disclosure"} aria-hidden="true">
        ▸
      </span>
      <span className={styles.chipText}>{summaryChipText(summary)}</span>
    </button>
  );
}

/** How a pooled loading's yield split between its members: each member's Gb and share of the cell,
 * against an even share (the tick). A member under 85% of even reads in the warning tone. */
function PoolSplit({ loading }: { loading: SequencingLoading }) {
  const shares = loading.members.map((m) => m.pct_of_cell ?? 0);
  const max = Math.max(...shares, 0.0001);
  const even = loading.pct_of_cell != null && loading.plex > 0 ? loading.pct_of_cell / loading.plex : null;
  return (
    <div className={styles.split}>
      <div className={styles.splitHead}>
        Pool split · {loading.plex} samples
        {even != null && ` · even share ${formatPct(even)} of the cell`}
      </div>
      {loading.members.map((m, i) => (
        <div
          key={`${m.sanger_sample_id ?? "?"}-${i}`}
          className={`${styles.member} ${m.below_even ? styles.below : ""}`}
          title={m.below_even ? "Under 85% of an even share of this pool" : undefined}
        >
          {/* In another tube's pool, the sample's own members stand out; in its own pool they all are. */}
          <span className={m.mine && loading.via_other_tube ? styles.mine : undefined}>{m.sanger_sample_id ?? "—"}</span>
          <span className={styles.track}>
            {even != null && <span className={styles.evenMark} style={{ left: `${(even / max) * 100}%` }} />}
            <span className={styles.bar} style={{ width: `${Math.max(1, ((m.pct_of_cell ?? 0) / max) * 100)}%` }} />
          </span>
          <span className={styles.memberFigures}>
            {formatGb(m.hifi_gb) ?? "—"} · {formatPct(m.pct_of_cell) ?? "—"}
          </span>
        </div>
      ))}
    </div>
  );
}

function LoadingRow({ loading, open, onToggle }: { loading: SequencingLoading; open: boolean; onToggle: () => void }) {
  const pooled = loading.members.length > 0;
  return (
    <>
      <tr className={open ? styles.openRow : undefined}>
        <td className={styles.nowrap}>{loading.run_date ? formatDateUTC(parseDateOnly(loading.run_date)) : "—"}</td>
        <td>
          {loading.run_id != null ? (
            <Link to={`/history/runs/${loading.run_id}`} className="link">
              {loading.run_name}
            </Link>
          ) : (
            loading.run_name
          )}
          {loading.via_other_tube && (
            <span className={styles.sub} title="Found through one of this sample's Sanger IDs, loaded in another tube">
              as part of {loading.tube}
            </span>
          )}
        </td>
        <td className={styles.nowrap}>
          Plate {loading.plate_number} · {loading.well_label}
        </td>
        <td className={styles.nowrap}>{formatPm(loading.loading_conc) ?? "—"}</td>
        <td className={styles.nowrap}>{formatGb(loading.own_hifi_gb) ?? "—"}</td>
        <td className={styles.nowrap}>{formatPct(loading.own_pct_of_cell) ?? "—"}</td>
        <td className={styles.nowrap}>
          {pooled ? (
            <button type="button" className={styles.splitToggle} aria-expanded={open} onClick={onToggle}>
              <span className={open ? "disclosure open" : "disclosure"} aria-hidden="true">
                ▸
              </span>{" "}
              {loading.plex}
            </button>
          ) : (
            loading.plex
          )}
        </td>
        <td className={styles.nowrap}>
          {loading.hifi_read_length_kb != null ? `${loading.hifi_read_length_kb} kb` : "—"}
        </td>
        <td>
          <Badge tone={langQcTone(loading.qc_state)}>{langQcLabel(loading.qc_state)}</Badge>
        </td>
        <td className={styles.nowrap}>{formatMovie(loading.movie_minutes) ?? "—"}</td>
        <td className={styles.nowrap}>
          <SmrtLinkLink url={loading.smrt_link_url} label="SMRT Link" />
        </td>
      </tr>
      {open && pooled && (
        <tr className={styles.splitRow}>
          <td colSpan={11}>
            <PoolSplit loading={loading} />
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * A sample's sequencing history from MLWH, the pacbio-dashboard's Top Up Helper rebuilt from
 * RunNx's own parts: the highlights (HiFi so far, the last loading and the share of the cell it
 * got), then every SMRT cell the sample's tube - or one of its Sanger IDs, under another tube - was
 * loaded on, oldest first, each opening to its pool split. `variant="popdown"` (a Backlog row) leaves
 * the highlights out (the row's chip already shows them) and links to the sample page instead.
 * See backend services/sequencing_history.py.
 */
export function SequencingHistoryPanel({
  sampleId,
  poolId,
  variant = "card",
}: {
  sampleId: number;
  poolId: string | null;
  variant?: "card" | "popdown";
}) {
  const history = useSequencingHistory(sampleId);
  const refresh = useMlwhRefresh(["sequencing-history", "sample", sampleId], () => sequencingApi.history(sampleId, true));
  const [openSplits, setOpenSplits] = useState<ReadonlySet<string>>(() => new Set());
  const toggleSplit = (key: string) =>
    setOpenSplits((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const data = history.data;
  const s = data?.summary;
  const sampleLink =
    variant === "popdown" ? (
      <Link to={`/samples/${sampleId}`} className="link">
        Full detail on the sample page →
      </Link>
    ) : null;

  if (history.isLoading) return <div className="status sm">Reading the sequencing history from MLWH…</div>;
  if (history.isError) {
    return (
      <Note tone="bad" icon="!">
        {errorMessage(history.error, "Couldn't load the sequencing history.")}
      </Note>
    );
  }
  if (!data) return null;
  if (!data.configured) {
    return (
      <p className={styles.quietLine}>
        Sequencing history isn&apos;t available here: this deployment has no MLWH connection.
      </p>
    );
  }
  if (!data.ok) {
    return (
      <MlwhErrorNote
        what="this sample's sequencing history"
        error={data.error}
        onRetry={() => refresh.mutate()}
        retrying={refresh.isPending}
        size="sm"
      />
    );
  }

  const toolbar = (
    <div className={styles.toolbar}>
      <span className={styles.quiet}>
        From MLWH — found by Pool ID{poolId ? ` ${poolId}` : ""} and the sample&apos;s Sanger IDs
      </span>
      <span className={styles.toolbarEnd}>
        {sampleLink}
        <Button size="sm" variant="ghost" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
          {refresh.isPending ? "Refreshing…" : "Refresh"}
        </Button>
      </span>
    </div>
  );

  if (!s) {
    return (
      <div className={variant === "popdown" ? styles.popdown : undefined}>
        {toolbar}
        <div className="status sm">Never sequenced: MLWH has no loadings for this Pool ID or its Sanger IDs.</div>
      </div>
    );
  }

  return (
    // In a Backlog row the pop-down sits in a cell as wide as the whole (scrolling) table; pinning
    // it to the visible width keeps its own table and toolbar on screen.
    <div className={variant === "popdown" ? `${styles.panel} ${styles.popdown}` : styles.panel}>
      {toolbar}
      {variant === "card" && (
        <StatTiles>
          <StatTile label="HiFi so far" value={formatGb(s.hifi_gb) ?? "—"} hint={`${s.cells} cell${s.cells === 1 ? "" : "s"}`} />
          <StatTile
            label="Last loading"
            value={formatPm(s.last_loading_conc) ?? "—"}
            hint={s.last_run_date ? formatShortDateUTC(parseDateOnly(s.last_run_date)) : undefined}
          />
          <StatTile
            label="Last share of cell"
            value={formatPct(s.last_pct_of_cell) ?? "—"}
            hint={[formatGb(s.last_hifi_gb), s.last_plex && s.last_plex > 1 ? `pool of ${s.last_plex}` : null]
              .filter(Boolean)
              .join(" · ")}
          />
          <StatTile
            label="Latest LangQC"
            value={<Badge tone={langQcTone(s.last_qc_state)}>{langQcLabel(s.last_qc_state)}</Badge>}
          />
        </StatTiles>
      )}
      <div className={styles.tableWrap}>
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Run</th>
              <th>Well</th>
              <th>Loading</th>
              <th>HiFi yield</th>
              <th title="This sample's share of the cell's HiFi yield">Share of cell</th>
              <th title="Samples in the tube - click to see how the cell split between them">Plex</th>
              <th>Read length</th>
              <th>LangQC</th>
              <th>Movie</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.loadings.map((loading) => (
              <Fragment key={loading.key}>
                <LoadingRow
                  loading={loading}
                  open={openSplits.has(loading.key)}
                  onToggle={() => toggleSplit(loading.key)}
                />
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const RECENT_LOADINGS = 5;

/** The edit dialog's reminder beside Target OPLC: the last loading's concentration, date, yield
 * and share of the cell, and the last few loadings on demand - inline, because leaving the dialog
 * to look would lose unsaved edits. Nothing at all when MLWH is absent, down, or has no loadings:
 * the dialog stays exactly as it was. */
export function LastLoading({ sampleId }: { sampleId: number }) {
  const [open, setOpen] = useState(false);
  const { data } = useSequencingHistory(sampleId);
  const s = data?.ok ? data.summary : null;
  if (!s) return null;
  const recent = [...data!.loadings].reverse().slice(0, RECENT_LOADINGS);
  return (
    <div className={styles.lastLoading}>
      <span title={summaryTitle(s)}>{lastLoadingLine(s)}</span>
      <button type="button" className={styles.splitToggle} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className={open ? "disclosure open" : "disclosure"} aria-hidden="true">
          ▸
        </span>{" "}
        Previous loadings
      </button>
      {open && (
        <ul className={styles.recent}>
          {recent.map((ld) => (
            <li key={ld.key}>
              {ld.run_date ? formatShortDateUTC(parseDateOnly(ld.run_date)) : "—"} · {ld.run_name} ·{" "}
              {formatPm(ld.loading_conc) ?? "—"} · {formatGb(ld.own_hifi_gb) ?? "—"}
              {ld.own_pct_of_cell != null && ` (${formatPct(ld.own_pct_of_cell)} of the cell)`}
              {ld.via_other_tube && ` · as part of ${ld.tube}`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
