import { api } from "./client";

/** The default loading options applied to newly created/imported samples, editable from
 * the Admin panel and used to pre-fill the add-sample form. Values are canonical strings
 * ("True"/"False" for the booleans, a canonical priority label like "Standard (3)"). */
export interface SampleDefaults {
  adaptive_loading: string;
  full_resolution_base_q: string;
  base_kinetics: string;
  priority: string;
}

export type SampleDefaultsUpdate = Partial<SampleDefaults>;

/** The editable PacBio credit-email template (the only email the app sends). subject/body
 * may embed <angle-bracket> variables filled from the failing cell — see utils/creditEmail. */
export interface CreditEmailTemplate {
  to: string;
  cc: string;
  subject: string;
  body: string;
}

export type CreditEmailUpdate = Partial<CreditEmailTemplate>;

/** Global scheduling parameters (not per-sample), editable from the Settings > Scheduling and
 * Movie scheduling panels. `movie_cell_position` maps a movie length to the carousel cell
 * position (within_tray_pos 0-3) it's confined to under Auto Schedule; `null` = any cell. JSON
 * object keys are strings on the wire, so the map is keyed by the movie length as a string. */
export interface SchedulingSettings {
  insert_size_reuse_threshold_bp: number;
  day_start_hour: number;
  default_movie_hours: number;
  movie_cell_position: Record<string, number | null>;
}

export type SchedulingSettingsUpdate = Partial<SchedulingSettings>;

/** Read-only instrument/scheduling facts: the vendor-locked or physical constants the app
 * enforces (108h window, 3-use cap, tray-of-4, deck wells, movie-length values, timing ladder).
 * Surfaced in the Settings "Instrument & scheduling facts" card - never editable. */
export interface SchedulingFacts {
  cell_lifetime_h: number;
  cell_max_uses: number;
  cells_per_tray: number;
  wells: string[];
  movie_hours_choices: number[];
  timing: {
    prep_h: number;
    reuse_prep_h: number;
    stagger_h: number;
    ppa_h: number;
    seq_lanes: number;
    ppa_lanes: number;
    lock_buffer_h: number;
  };
}

export const settingsApi = {
  getSampleDefaults: () => api.get<SampleDefaults>("/api/settings/sample-defaults"),
  updateSampleDefaults: (body: SampleDefaultsUpdate) =>
    api.put<SampleDefaults>("/api/settings/sample-defaults", body),
  getCreditEmail: () => api.get<CreditEmailTemplate>("/api/settings/credit-email"),
  updateCreditEmail: (body: CreditEmailUpdate) =>
    api.put<CreditEmailTemplate>("/api/settings/credit-email", body),
  getScheduling: () => api.get<SchedulingSettings>("/api/settings/scheduling"),
  updateScheduling: (body: SchedulingSettingsUpdate) =>
    api.put<SchedulingSettings>("/api/settings/scheduling", body),
  getFacts: () => api.get<SchedulingFacts>("/api/settings/facts"),
};
