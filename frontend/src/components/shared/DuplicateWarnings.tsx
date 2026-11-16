import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { creditApi } from "@/api/credit";
import { cyclesApi } from "@/api/cycles";
import { Note } from "@/components/ui/Note";
import { formatDateUTC, parseDateOnly } from "@/utils/calendarDates";
import { useDebouncedValue } from "@/utils/useDebouncedValue";

import styles from "./DuplicateWarnings.module.css";

/** Look a typed value up once typing pauses. Results show only while they belong to what's in the
 * box now, so a match for an earlier value never lingers under a changed one. */
function useSettledMatches<T>(kind: string, value: string, scope: unknown, fetch: (v: string) => Promise<T[]>): T[] {
  const typed = value.trim();
  const settled = useDebouncedValue(typed, 300);
  const { data } = useQuery({
    queryKey: ["duplicate-check", kind, settled, scope],
    queryFn: () => fetch(settled),
    enabled: settled !== "",
    staleTime: 0,
  });
  return settled !== "" && settled === typed ? (data ?? []) : [];
}

/** Warns, never blocks, when another run already carries the Traction run name being typed. */
export function RunNameWarning({ name, runId }: { name: string; runId?: number }) {
  const matches = useSettledMatches("run-name", name, runId, (v) => cyclesApi.runNameCheck(v, runId));
  if (matches.length === 0) return null;
  return (
    <div className={styles.warning}>
      <Note tone="warn" icon="!" size="sm">
        Already used by{" "}
        {matches.map((m, i) => (
          <span key={m.run_id}>
            {i > 0 && ", "}
            <Link className="link" to={`/history/runs/${m.run_id}`}>
              {m.instrument_name || `Revio ${m.instrument_serial}`}, {formatDateUTC(parseDateOnly(m.load_date))}
            </Link>
          </span>
        ))}
        . Check the name; you can still save.
      </Note>
    </div>
  );
}

/** Warns, never blocks, when another credit case already carries the PacBio case number being typed.
 * Pass the case's own cell or case id so it isn't reported against itself. */
export function CaseNumberWarning({ number, cellId, caseId }: { number: string; cellId?: number; caseId?: number }) {
  const matches = useSettledMatches("case-number", number, [cellId, caseId], (v) =>
    creditApi.caseNumberCheck(v, { cellId, caseId }),
  );
  if (matches.length === 0) return null;
  return (
    <div className={styles.warning}>
      <Note tone="warn" icon="!" size="sm">
        Already on{" "}
        {matches.map((m, i) => (
          <span key={`${m.kind}-${m.id}`}>
            {i > 0 && ", "}
            {m.kind === "cell" ? (
              <Link className="link" to={`/cells/${m.id}`}>
                cell {m.label}
              </Link>
            ) : (
              <>the case “{m.label}”</>
            )}
          </span>
        ))}
        . Check the number; you can still save.
      </Note>
    </div>
  );
}
