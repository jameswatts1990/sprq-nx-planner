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

export const settingsApi = {
  getSampleDefaults: () => api.get<SampleDefaults>("/api/settings/sample-defaults"),
  updateSampleDefaults: (body: SampleDefaultsUpdate) =>
    api.put<SampleDefaults>("/api/settings/sample-defaults", body),
};
