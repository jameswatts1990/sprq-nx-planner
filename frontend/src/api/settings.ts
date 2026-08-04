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

/** Global scheduling parameters (not per-sample), editable from the Admin "Scheduling" panel.
 * Currently just the insert-size reuse threshold: a library whose insert_size_bp is at/below
 * this is kept on a cell's first use by Auto Schedule and flagged if placed on a reuse. */
export interface SchedulingSettings {
  insert_size_reuse_threshold_bp: number;
}

export type SchedulingSettingsUpdate = Partial<SchedulingSettings>;

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
};
