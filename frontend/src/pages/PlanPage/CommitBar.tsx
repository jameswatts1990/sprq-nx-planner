import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { ApiError } from "@/api/client";
import { scheduleApi } from "@/api/schedule";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import type { PreviewResponse, RunDesignSettings } from "@/types/schedule";

import styles from "./CommitBar.module.css";

export interface CommitBarProps {
  settings: RunDesignSettings;
  excludedCellIds: number[];
  preview: PreviewResponse | undefined;
  previewIsFetching: boolean;
  previewIsError: boolean;
}

/** "Commit schedule" primary action - disabled while there are unplaced samples or
 * the preview is still catching up with the latest settings (fetching/erroring),
 * since committing needs a fresh, matching backlog_hash. */
export function CommitBar({ settings, excludedCellIds, preview, previewIsFetching, previewIsError }: CommitBarProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => {
      if (!preview) throw new Error("Preview not ready yet.");
      return scheduleApi.commit({
        settings,
        expected_backlog_hash: preview.backlog_hash,
        excluded_cell_ids: excludedCellIds,
      });
    },
    onSuccess: (schedule) => {
      void queryClient.invalidateQueries({ queryKey: ["samples"] });
      void queryClient.invalidateQueries({ queryKey: ["cells"] });
      void queryClient.invalidateQueries({ queryKey: ["schedules"] });
      navigate(`/history/runs/${schedule.id}`);
    },
  });

  const unplacedCount = preview?.notes.unplaced_sample_ids.length ?? 0;
  const hasUnplaced = unplacedCount > 0;
  const disabled = !preview || hasUnplaced || previewIsFetching || previewIsError || mutation.isPending;

  return (
    <Card>
      <CardBody className={styles.body}>
        <Button variant="primary" onClick={() => mutation.mutate()} disabled={disabled}>
          {mutation.isPending ? "Committing…" : "Commit schedule"}
        </Button>
        <div className={styles.status}>
          {hasUnplaced && <span className={styles.warn}>Resolve {unplacedCount} unplaced sample(s) before committing.</span>}
          {previewIsError && <span className={styles.warn}>Preview failed - fix run design settings before committing.</span>}
          {previewIsFetching && !previewIsError && <span>Recalculating preview…</span>}
          {mutation.isError && (
            <span className={styles.warn}>
              {mutation.error instanceof ApiError ? mutation.error.message : "Commit failed."}
            </span>
          )}
          {mutation.isSuccess && <span className={styles.ok}>Schedule committed - redirecting…</span>}
        </div>
      </CardBody>
    </Card>
  );
}
