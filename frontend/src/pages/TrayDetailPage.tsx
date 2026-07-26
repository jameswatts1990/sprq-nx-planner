import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { cellsApi } from "@/api/cells";
import { TraySiblingList } from "@/components/cells/TraySiblingList";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Note } from "@/components/ui/Note";
import { invalidateScheduleRelated } from "@/lib/invalidateScheduleRelated";
import { soonestTrayExpiry } from "@/utils/openTrays";
import { FADE_MIN_HOURS } from "@/utils/windowFade";

import styles from "./TrayDetailPage.module.css";

function expiryText(hours: number): string {
  return hours <= 1 ? "<1h" : `${Math.ceil(hours)}h`;
}

/** One physical SPRQ-Nx SMRT Cell tray (4 cells) and its cells, reached by clicking a tray id
 * anywhere in the app (a cell page/popover, the grid's tray map, the Open trays list). Reuses
 * the same cached ["cells", { tray_id }] query those places already populate, so navigating
 * here is instant, and renders the shared TraySiblingList so every cell links straight back to
 * its own detail page - closing the tray <-> cell navigation loop. Discard-only: rotating a
 * tray is day-anchored and stays on the weekly grid. */
export function TrayDetailPage() {
  const { trayId } = useParams<{ trayId: string }>();
  const id = Number(trayId);
  const idIsValid = Number.isFinite(id);
  const queryClient = useQueryClient();
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const trayQuery = useQuery({
    queryKey: ["cells", { tray_id: id }],
    queryFn: () => cellsApi.list({ tray_id: id, page_size: 10 }),
    enabled: idIsValid,
  });

  const discardMutation = useMutation({
    mutationFn: () => cellsApi.discardTray({ tray_id: id }),
    onSuccess: () => {
      invalidateScheduleRelated(queryClient);
      setConfirmDiscard(false);
    },
  });

  if (!idIsValid) {
    return <div className={styles.status}>Invalid tray id.</div>;
  }
  if (trayQuery.isLoading) {
    return <div className={styles.status}>Loading tray…</div>;
  }
  if (trayQuery.isError) {
    return (
      <div className={styles.page}>
        <Note tone="bad" icon="!">
          {trayQuery.error instanceof ApiError ? trayQuery.error.message : "Failed to load tray."}
        </Note>
      </div>
    );
  }

  const cells = trayQuery.data?.items ?? [];
  if (cells.length === 0) {
    return (
      <div className={styles.page}>
        <Link to="/cells" className={styles.backLink}>
          ◂ Back to Cells &amp; Instruments
        </Link>
        <Note tone="info" icon="i">
          No cells found for tray {id} — it may have been fully cleared.
        </Note>
      </div>
    );
  }

  const traySize = cells[0]?.tray_size ?? cells.length;
  const instrument = cells.find((c) => c.current_instrument_serial)?.current_instrument_serial ?? null;
  const soonestExpiry = soonestTrayExpiry(cells);
  const urgent = soonestExpiry !== null && soonestExpiry <= FADE_MIN_HOURS;
  const anyOpen = cells.some((c) => c.status === "open");

  return (
    <div className={styles.page}>
      <Link to="/cells" className={styles.backLink}>
        ◂ Back to Cells &amp; Instruments
      </Link>
      <Card>
        <CardHeader
          badge={
            soonestExpiry !== null ? (
              <Badge tone={urgent ? "danger" : "default"}>
                {urgent ? "Expires soon — " : "Next expiry: "}
                {expiryText(soonestExpiry)}
              </Badge>
            ) : undefined
          }
        >
          <h2>Tray {id}</h2>
        </CardHeader>
        <CardBody>
          <p className={styles.helper}>
            The {traySize} physical SPRQ-Nx SMRT cells of this tray. They share the tray id{" "}
            <span className={styles.mono}>T{id}</span> — their codes run <span className={styles.mono}>C01-T{id}</span> …{" "}
            <span className={styles.mono}>
              C0{traySize}-T{id}
            </span>
            . Each links to its own cell below.
          </p>
          <div className={styles.headerGrid}>
            <div>
              <span className={styles.label}>Instrument</span>
              {instrument ? (
                <Link
                  to={`/cells?instrument=${encodeURIComponent(instrument)}&status=all`}
                  className={styles.value}
                >
                  {instrument}
                </Link>
              ) : (
                <span className={styles.value}>—</span>
              )}
            </div>
            <div>
              <span className={styles.label}>Cells</span>
              <span className={styles.value}>
                {cells.length}/{traySize}
              </span>
            </div>
            <div>
              <span className={styles.label}>Soonest expiry</span>
              <span className={styles.value}>{soonestExpiry === null ? "—" : expiryText(soonestExpiry)}</span>
            </div>
          </div>

          <TraySiblingList cells={cells} />

          {anyOpen && (
            <div className={styles.actions}>
              <Button variant="ghost" onClick={() => setConfirmDiscard(true)}>
                Discard all cells
              </Button>
            </div>
          )}
        </CardBody>
      </Card>

      {confirmDiscard && (
        <ConfirmModal
          title="Discard all cells in this tray?"
          confirmLabel="Discard cells"
          pendingLabel="Discarding…"
          pending={discardMutation.isPending}
          error={
            discardMutation.isError
              ? discardMutation.error instanceof ApiError
                ? discardMutation.error.message
                : "Failed to discard tray."
              : null
          }
          onCancel={() => setConfirmDiscard(false)}
          onConfirm={() => discardMutation.mutate()}
        >
          <p>
            This marks every cell physically in this tray as exhausted, regardless of how many uses it has left. Any
            not-yet-run placements for these cells are cancelled and their samples return to the backlog. This cannot be
            undone.
          </p>
        </ConfirmModal>
      )}
    </div>
  );
}
