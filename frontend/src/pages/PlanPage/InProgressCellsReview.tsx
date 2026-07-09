import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError } from "@/api/client";
import { cellsApi } from "@/api/cells";
import { BarcodeChips } from "@/components/shared/BarcodeChips";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Note } from "@/components/ui/Note";

import styles from "./InProgressCellsReview.module.css";

export interface InProgressCellsReviewProps {
  excludedCellIds: number[];
  onChange: (next: number[]) => void;
}

/** Lists real open cells so the user can exclude any of them from this preview
 * (feeds excluded_cell_ids) - replaces the prototype's free-text "already burned"
 * barcode entry, since burned barcodes now come from real cell records. */
export function InProgressCellsReview({ excludedCellIds, onChange }: InProgressCellsReviewProps) {
  const [expanded, setExpanded] = useState(false);

  const query = useQuery({
    queryKey: ["cells", { status: "open", page_size: 200 }],
    queryFn: () => cellsApi.list({ status: "open", page_size: 200 }),
  });

  const cells = query.data?.items ?? [];

  function toggle(id: number) {
    if (excludedCellIds.includes(id)) {
      onChange(excludedCellIds.filter((x) => x !== id));
    } else {
      onChange([...excludedCellIds, id]);
    }
  }

  return (
    <Card>
      <CardHeader badge={excludedCellIds.length > 0 ? `${excludedCellIds.length} excluded` : undefined}>
        <button type="button" className={styles.toggle} aria-expanded={expanded} onClick={() => setExpanded((e) => !e)}>
          <span className={styles.caret}>{expanded ? "▼" : "▶"}</span>
          In-progress cells already on an instrument
        </button>
      </CardHeader>
      {expanded && (
        <CardBody>
          <p className={styles.note}>
            A cell that&apos;s partway through its uses has already burned barcodes. Uncheck a cell to exclude it
            from this preview - e.g. if it&apos;s already fully committed elsewhere.
          </p>

          {query.isLoading && <div className={styles.status}>Loading open cells…</div>}
          {query.isError && (
            <Note tone="bad" icon="!">
              {query.error instanceof ApiError ? query.error.message : "Failed to load open cells."}
            </Note>
          )}
          {!query.isLoading && !query.isError && cells.length === 0 && (
            <div className={styles.empty}>No in-progress cells on an instrument.</div>
          )}

          {cells.length > 0 && (
            <div className={styles.list}>
              {cells.map((cell) => (
                <label key={cell.id} className={styles.item}>
                  <input type="checkbox" checked={!excludedCellIds.includes(cell.id)} onChange={() => toggle(cell.id)} />
                  <span className={styles.code}>{cell.code}</span>
                  <span className={styles.meta}>
                    {cell.uses_consumed}/{cell.max_uses} uses
                    {cell.current_instrument_serial ? ` · ${cell.current_instrument_serial}` : ""}
                  </span>
                  <BarcodeChips barcodes={cell.burned_barcodes} variant="u2" />
                </label>
              ))}
            </div>
          )}
        </CardBody>
      )}
    </Card>
  );
}
