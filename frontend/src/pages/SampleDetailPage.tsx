import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { samplesApi } from "@/api/samples";
import { BarcodeChips } from "@/components/shared/BarcodeChips";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Note } from "@/components/ui/Note";
import { plateWellFromPlate } from "@/utils/plateWell";
import { resolveSampleBackNav } from "@/utils/sampleBackNav";
import { runLabel } from "@/utils/runLabel";
import { SAMPLE_STATUS_LABEL, SAMPLE_STATUS_TONE } from "@/utils/sampleStatus";
import { USE_STATUS_TONE } from "@/utils/useStatusTone";

import { SampleModal } from "./SampleModal";
import styles from "./SampleDetailPage.module.css";

function formatDateTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "—";
}

/** Loading/annotation params - the only fields editable once a sample is placed on the grid
 * (its barcodes/identity are frozen at placement). Mirrors the Schedule slot popover's set. */
const PLACED_EDITABLE_KEYS = new Set([
  "target_oplc",
  "volume",
  "adaptive_loading",
  "full_resolution_base_q",
  "priority",
  "ccs_kinetics",
]);

/** Finished samples are history, not a plan - the backend rejects edits to them, so no
 * Edit button is offered (matches update_sample's _LOCKED_EDIT_STATUSES). */
const LOCKED_EDIT_STATUSES = ["completed", "failed", "cancelled"];

/** Full detail for a single sample (container), reached by clicking any container id
 * across the app - a cell card, the cell detail use-history, the Samples history list.
 * Shows the sample's metadata and every cell use it has had, each linking back to the
 * cell and run it ran on, closing the sample <-> cell <-> run navigation loop. Read via
 * samplesApi.get (SampleDetailOut), the same endpoint the Samples history rows expand
 * inline - so this page is the durable, linkable home for a sample of any status, not
 * just the completed/failed ones that history lists. */
export function SampleDetailPage() {
  const { sampleId } = useParams<{ sampleId: string }>();
  const backNav = resolveSampleBackNav(useLocation().state);
  const id = Number(sampleId);
  const idIsValid = Number.isFinite(id);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);

  const query = useQuery({
    queryKey: ["sample", id],
    queryFn: () => samplesApi.get(id),
    enabled: idIsValid,
  });

  if (!idIsValid) {
    return (
      <div className={styles.page}>
        <Note tone="bad" icon="!">
          Invalid sample id.
        </Note>
      </div>
    );
  }

  if (query.isLoading) {
    return <div className={styles.status}>Loading sample…</div>;
  }

  if (query.isError) {
    return (
      <div className={styles.page}>
        <Note tone="bad" icon="!">
          {query.error instanceof ApiError ? query.error.message : "Failed to load sample."}
        </Note>
      </div>
    );
  }

  const sample = query.data;
  if (!sample) {
    return <div className={styles.status}>Sample not found.</div>;
  }

  const canEdit = !LOCKED_EDIT_STATUSES.includes(sample.status);
  // A placed sample (scheduled/in_progress) can only have its loading params tweaked - its
  // barcodes/identity are frozen at placement; a backlog sample is fully editable.
  const isPlaced = sample.status === "scheduled" || sample.status === "in_progress";

  return (
    <div className={styles.page}>
      <Link to={backNav.to} className={styles.backLink}>
        ◂ {backNav.label}
      </Link>

      <Card>
        <CardHeader
          badge={
            <span className={styles.headerActions}>
              <Badge tone={SAMPLE_STATUS_TONE[sample.status]}>{SAMPLE_STATUS_LABEL[sample.status]}</Badge>
              {canEdit && (
                <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                  Edit
                </Button>
              )}
            </span>
          }
        >
          <h2>{sample.external_id}</h2>
        </CardHeader>
        <CardBody>
          <div className={styles.headerGrid}>
            <div>
              <span className={styles.label}>Container ID</span>
              <span className={styles.value}>{sample.external_id}</span>
            </div>
            <div>
              <span className={styles.label}>Parent sample</span>
              <span className={styles.value}>{sample.parent_sample ?? "—"}</span>
            </div>
            <div>
              <span className={styles.label}>Priority</span>
              <span className={styles.value}>{sample.priority ?? "—"}</span>
            </div>
            <div>
              <span className={styles.label}>Target OPLC</span>
              <span className={styles.value}>{sample.target_oplc ?? "—"}</span>
            </div>
            <div>
              <span className={styles.label}>Volume</span>
              <span className={styles.value}>{sample.volume ?? "—"}</span>
            </div>
            <div>
              <span className={styles.label}>Adaptive loading</span>
              <span className={styles.value}>{sample.adaptive_loading ?? "—"}</span>
            </div>
            <div>
              <span className={styles.label}>Full res. base Q</span>
              <span className={styles.value}>{sample.full_resolution_base_q ?? "—"}</span>
            </div>
            <div>
              <span className={styles.label}>Include base kinetics</span>
              <span className={styles.value}>{sample.ccs_kinetics ?? "—"}</span>
            </div>
            <div>
              <span className={styles.label}>Movie time</span>
              <span className={styles.value}>{sample.movie_time_hours ?? 24} h</span>
            </div>
            <div>
              <span className={styles.label}>Created</span>
              <span className={styles.value}>{formatDateTime(sample.created_at)}</span>
            </div>
            <div>
              <span className={styles.label}>Updated</span>
              <span className={styles.value}>{formatDateTime(sample.updated_at)}</span>
            </div>
          </div>

          <div className={styles.chipRows}>
            <div className={styles.chipRow}>
              <span className={styles.label}>Barcodes</span>
              {sample.barcodes.length > 0 ? <BarcodeChips barcodes={sample.barcodes} /> : <span>—</span>}
            </div>
            {sample.sanger_ids.length > 0 && (
              <div className={styles.chipRow}>
                <span className={styles.label}>Sanger IDs</span>
                <BarcodeChips barcodes={sample.sanger_ids} />
              </div>
            )}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2>Cell uses</h2>
        </CardHeader>
        <CardBody>
          {sample.cell_uses.length === 0 ? (
            <div className={styles.status}>This sample has not been placed on any cell yet.</div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Run</th>
                    <th>Plate</th>
                    <th>Cell</th>
                    <th>Well</th>
                    <th>Status</th>
                    <th>Started</th>
                    <th>Completed</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {sample.cell_uses.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <Link to={`/history/runs/${u.run_batch_id}`} className="link">
                          {runLabel({ run_id: u.run_batch_id, run_name: u.run_name })}
                        </Link>
                      </td>
                      <td>{u.plate_number != null ? `Plate ${u.plate_number}` : "—"}</td>
                      <td className={styles.mono}>
                        <Link to={`/cells/${u.cell_id}`} className="link">
                        {u.cell_code}
                      </Link>
                      </td>
                      <td className={styles.mono}>{plateWellFromPlate(u.plate_number, u.well, { qualified: true })}</td>
                      <td>
                        <Badge tone={USE_STATUS_TONE[u.status] ?? "default"}>{u.status}</Badge>
                      </td>
                      <td>{formatDateTime(u.started_at)}</td>
                      <td>{formatDateTime(u.completed_at)}</td>
                      <td>{u.outcome_notes ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {editing && (
        <SampleModal
          sample={sample}
          editableKeys={isPlaced ? PLACED_EDITABLE_KEYS : undefined}
          onClose={() => setEditing(false)}
          onSaved={() => void queryClient.invalidateQueries({ queryKey: ["sample", id] })}
        />
      )}
    </div>
  );
}
