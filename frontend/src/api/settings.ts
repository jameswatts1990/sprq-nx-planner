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
  /** Total cleaned complex (µL) made per sample, and the leftover (µL) at/above which a repeat
   * straight from complex is "safe" — drive the Cell QC modal's repeat-from-complex readout. */
  repeat_total_complex_ul: number;
  repeat_safe_min_ul: number;
}

export type SchedulingSettingsUpdate = Partial<SchedulingSettings>;

/** Read-only instrument/scheduling facts: the vendor-locked or physical constants the app
 * enforces (108h window, 3-use cap, tray-of-4, deck wells, movie-length values, timing ladder).
 * Surfaced in the Settings "Instrument & scheduling facts" card - never editable. */
export interface SchedulingFacts {
  cell_lifetime_h: number;
  cell_max_uses: number; // a multi-use SPRQ-Nx cell
  sprq_max_uses: number; // a single-use SPRQ cell
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

/** The lab-specific values the issue report fills in ("" = not set; that column is left blank).
 * team fills "Team who identified the issue" and "Issue Owner"; manager the notify column. */
export interface IssueReportSettings {
  team: string;
  equipment_owner: string;
  manager: string;
}

export type IssueReportSettingsUpdate = Partial<IssueReportSettings>;

/** QC & credits settings. An open credit case waiting longer than overdue_days at its current
 * stage is flagged overdue; the QC Review queue reads MLWH back review_lookback_days. */
export interface QcSettings {
  overdue_days: number;
  review_lookback_days: number;
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
  getIssueReport: () => api.get<IssueReportSettings>("/api/settings/issue-report"),
  updateIssueReport: (body: IssueReportSettingsUpdate) =>
    api.put<IssueReportSettings>("/api/settings/issue-report", body),
  getQc: () => api.get<QcSettings>("/api/settings/qc"),
  updateQc: (body: Partial<QcSettings>) => api.put<QcSettings>("/api/settings/qc", body),
  getFacts: () => api.get<SchedulingFacts>("/api/settings/facts"),
};
