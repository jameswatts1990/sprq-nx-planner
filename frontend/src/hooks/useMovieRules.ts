import { useQuery } from "@tanstack/react-query";

import { settingsApi } from "@/api/settings";

/** Built-in fallback mirroring the backend's DEFAULT_MOVIE_HOURS - used until the configured
 * default loads (and if the query ever fails). */
export const DEFAULT_MOVIE_HOURS = 24;

export interface MovieRules {
  /** The configured default movie time (Settings > Movie scheduling). */
  defaultHours: number;
  /** Movie length (as a string key) -> the carousel cell position (0-3) Auto Schedule confines
   * it to, null = any cell. Empty until the settings load. */
  cellPosition: Record<string, number | null>;
}

/** The lab-configured movie-time rules, from the same cached "scheduling-settings" query as
 * useInsertSizeThreshold, so a page full of cards issues a single request. */
export function useMovieRules(): MovieRules {
  const { data } = useQuery({
    queryKey: ["scheduling-settings"],
    queryFn: () => settingsApi.getScheduling(),
    staleTime: 5 * 60_000,
  });
  return {
    defaultHours: data?.default_movie_hours ?? DEFAULT_MOVIE_HOURS,
    cellPosition: data?.movie_cell_position ?? {},
  };
}
