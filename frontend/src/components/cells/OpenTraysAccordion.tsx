import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError } from "@/api/client";
import { cellsApi } from "@/api/cells";
import { Accordion } from "@/components/ui/Accordion";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Note } from "@/components/ui/Note";
import { countOpenTrays, groupOpenTrayIdsByInstrument, soonestTrayExpiry } from "@/utils/openTrays";
import { FADE_MIN_HOURS } from "@/utils/windowFade";

import { TraySiblingList } from "./TraySiblingList";
import styles from "./OpenTraysAccordion.module.css";

/**
 * Every physical SPRQ-Nx SMRT Cell tray that currently has at least one open (usable)
 * cell, grouped by the instrument it's sitting on - lets a lab user see, at a glance
 * across every instrument, which trays still have spare capacity waiting to be picked up,
 * without drilling into one cell's detail page first (CellDetailPage's "Cell tray" card
 * shows the same per-cell data, but only for one already-known tray at a time). Each
 * tray's siblings keep their own individual status badges - never a single merged
 * tray-level status, since a tray's own cells can genuinely diverge (one exhausted, one
 * still open, one never used - see docs/pacbio-sprq-nx-scheduling-reference.md's
 * "Tray-of-4 eager population").
 *
 * Collapsed by default, matching BacklogAccordion/RunDesignAccordion - the header badge
 * already surfaces the open tray count at a glance, so an open cell/instrument list isn't
 * needed until the user actually wants to act on one. The outer query still runs
 * regardless of collapsed state (same BacklogAccordion convention) so the header count
 * stays live either way.
 */
export function OpenTraysAccordion() {
  const queryClient = useQueryClient();
  const [discardTrayId, setDiscardTrayId] = useState<number | null>(null);
  const discardMutation = useMutation({
    mutationFn: (trayId: number) => cellsApi.discardTray({ tray_id: trayId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cells"] });
      setDiscardTrayId(null);
    },
  });

  const openCellsQuery = useQuery({
    queryKey: ["cells", "open-trays"],
    queryFn: () => cellsApi.listAll({ status: "open" }),
  });

  const grouped = groupOpenTrayIdsByInstrument(openCellsQuery.data ?? []);
  const trayCount = countOpenTrays(grouped);
  const instrumentEntries = [...grouped.entries()].sort((a, b) =>
    a[0].localeCompare(b[0], undefined, { numeric: true }),
  );
  const allTrayIds = instrumentEntries.flatMap(([, trayIds]) => trayIds);

  // One request per distinct open tray (see CellDetailPage.tsx's identical queryKey
  // shape for the same data) - bounded by how many trays are currently open lab-wide,
  // not total cell count, and shares React Query's cache with a cell detail page the
  // user may have already visited this session.
  const trayQueries = useQueries({
    queries: allTrayIds.map((trayId) => ({
      queryKey: ["cells", { tray_id: trayId }],
      queryFn: () => cellsApi.list({ tray_id: trayId, page_size: 10 }),
    })),
  });
  const trayQueryById = new Map(allTrayIds.map((trayId, i) => [trayId, trayQueries[i]]));

  return (
    <Accordion title="Open trays" badge={`${trayCount} tray${trayCount === 1 ? "" : "s"}`}>
      {openCellsQuery.isLoading && <div className={styles.status}>Loading open trays…</div>}
      {openCellsQuery.isError && (
        <Note tone="bad" icon="!">
          {openCellsQuery.error instanceof ApiError ? openCellsQuery.error.message : "Failed to load open trays."}
        </Note>
      )}
      {!openCellsQuery.isLoading && !openCellsQuery.isError && trayCount === 0 && (
        <div className={styles.status}>No trays are currently open.</div>
      )}

      {instrumentEntries.map(([instrumentSerial, trayIds]) => (
        <div key={instrumentSerial} className={styles.instrumentGroup}>
          <div className={styles.instrumentLabel}>{instrumentSerial}</div>
          {trayIds.map((trayId) => {
            const trayQuery = trayQueryById.get(trayId);
            const soonestExpiry = trayQuery?.data ? soonestTrayExpiry(trayQuery.data.items) : null;
            const urgent = soonestExpiry !== null && soonestExpiry <= FADE_MIN_HOURS;
            return (
              <div key={trayId} className={styles.trayBlock}>
                <div className={styles.trayHeader}>
                  <span className={styles.trayId}>Tray {trayId}</span>
                  {soonestExpiry !== null && (
                    <span className={urgent ? styles.trayExpiryUrgent : styles.trayExpiry}>
                      {urgent ? "Expires soon — " : "Next expiry: "}
                      {soonestExpiry <= 1 ? "<1h" : `${Math.ceil(soonestExpiry)}h`}
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className={styles.discardBtn}
                    onClick={() => setDiscardTrayId(trayId)}
                  >
                    Discard all cells
                  </Button>
                </div>
                {trayQuery?.isLoading && <div className={styles.status}>Loading tray…</div>}
                {trayQuery?.isError && (
                  <Note tone="bad" icon="!">
                    Failed to load this tray.
                  </Note>
                )}
                {trayQuery?.data && <TraySiblingList cells={trayQuery.data.items} />}
              </div>
            );
          })}
        </div>
      ))}

      {discardTrayId != null && (
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
          onCancel={() => setDiscardTrayId(null)}
          onConfirm={() => discardMutation.mutate(discardTrayId)}
        >
          <p>
            This marks every cell physically in this tray as exhausted, regardless of how many uses it has left. Any
            not-yet-run placements for these cells are cancelled and their samples return to the backlog. This cannot
            be undone.
          </p>
        </ConfirmModal>
      )}
    </Accordion>
  );
}
