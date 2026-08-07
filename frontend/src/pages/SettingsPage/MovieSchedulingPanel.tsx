import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { ApiError } from "@/api/client";
import { settingsApi } from "@/api/settings";
import type { SchedulingSettings, SchedulingSettingsUpdate } from "@/api/settings";
import { Button } from "@/components/ui/Button";
import { Note } from "@/components/ui/Note";

import styles from "./SampleDefaultsPanel.module.css";
import movieStyles from "./MovieSchedulingPanel.module.css";

/** The cell-position options offered per movie length. `null` = unrestricted ("Any cell"); a
 * number is a within_tray_pos index (0 = cell 1 .. 3 = cell 4), matching the backend rule. */
const CELL_OPTION_ANY = "any";

/** Settings > Movie scheduling: the lab-configurable movie-time rules. The three movie-length
 * VALUES (12/24/30 h) are fixed instrument facts (see the Instrument & scheduling facts card);
 * what's editable here is which length is the default (used when a sample's own is missing) and,
 * per length, which carousel cell Auto Schedule confines it to. Manual drag-and-drop always
 * places a sample wherever it's dropped - these rules only steer Auto Schedule. */
export function MovieSchedulingPanel() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["scheduling-settings"], queryFn: () => settingsApi.getScheduling() });

  const [defaultHours, setDefaultHours] = useState<number | null>(null);
  const [positions, setPositions] = useState<Record<string, number | null>>({});
  useEffect(() => {
    if (query.data) {
      setDefaultHours(query.data.default_movie_hours);
      setPositions(query.data.movie_cell_position);
    }
  }, [query.data]);

  const mutation = useMutation({
    mutationFn: (body: SchedulingSettingsUpdate) => settingsApi.updateScheduling(body),
    onSuccess: (data: SchedulingSettings) => {
      setDefaultHours(data.default_movie_hours);
      setPositions(data.movie_cell_position);
      queryClient.setQueryData(["scheduling-settings"], data);
    },
  });

  // The movie lengths themselves are fixed; derive them from the stored rule map, ascending.
  const movieLengths = Object.keys(query.data?.movie_cell_position ?? {})
    .map(Number)
    .sort((a, b) => a - b);
  const cellsPerTray = movieLengths.length ? 4 : 0; // rendered options 1..4; kept simple (tray of 4)

  const dirty =
    query.data != null &&
    (defaultHours !== query.data.default_movie_hours ||
      movieLengths.some((h) => (positions[String(h)] ?? null) !== (query.data!.movie_cell_position[String(h)] ?? null)));

  const save = () => {
    if (!query.data || defaultHours == null) return;
    mutation.mutate({ default_movie_hours: defaultHours, movie_cell_position: positions });
  };

  const setPosition = (hours: number, raw: string) => {
    setPositions((p) => ({ ...p, [String(hours)]: raw === CELL_OPTION_ANY ? null : Number(raw) }));
  };

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h2 className={styles.title}>Movie scheduling</h2>
        <p className={styles.helper}>
          The available movie lengths ({movieLengths.join(" / ") || "—"} h) are fixed. Choose which one is the default
          for samples with no movie time set, and which carousel cell Auto Schedule confines each length to. These steer
          Auto Schedule only — a manual drag-and-drop always places a sample wherever you drop it.
        </p>
      </div>

      {query.isError && (
        <Note tone="bad" icon="!">
          {query.error instanceof ApiError ? query.error.message : "Failed to load movie settings."}
        </Note>
      )}

      {query.data && (
        <>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Movie length</th>
                <th className={movieStyles.centerCol}>Default</th>
                <th>Cell rule (Auto Schedule)</th>
              </tr>
            </thead>
            <tbody>
              {movieLengths.map((h) => {
                const pos = positions[String(h)] ?? null;
                return (
                  <tr key={h}>
                    <td>
                      <span className={styles.fieldLabel}>{h} h</span>
                    </td>
                    <td className={movieStyles.centerCol}>
                      <input
                        type="radio"
                        name="default-movie-hours"
                        checked={defaultHours === h}
                        onChange={() => setDefaultHours(h)}
                        aria-label={`Make ${h} h the default movie length`}
                      />
                    </td>
                    <td>
                      <select
                        className={styles.select}
                        value={pos === null ? CELL_OPTION_ANY : String(pos)}
                        onChange={(e) => setPosition(h, e.target.value)}
                        aria-label={`Cell rule for ${h} h samples`}
                      >
                        <option value={CELL_OPTION_ANY}>Any cell</option>
                        {Array.from({ length: cellsPerTray }, (_, i) => (
                          <option key={i} value={i}>
                            Cell {i + 1} only
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {mutation.isError && (
            <Note tone="bad" icon="!">
              {mutation.error instanceof ApiError ? mutation.error.message : "Failed to save movie settings."}
            </Note>
          )}

          <div className={styles.actions}>
            {!dirty && !mutation.isPending && <span className={styles.savedNote}>All changes saved</span>}
            <Button variant="primary" size="sm" disabled={!dirty || mutation.isPending} onClick={save}>
              {mutation.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
