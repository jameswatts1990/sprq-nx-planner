import { useLocation } from "react-router-dom";

/** Where the sample detail page's Back link should return to, and what to call it. */
export interface SampleBackNav {
  /** Path (including any query string) to return to. */
  to: string;
  /** Label for the back link: the destination's name, e.g. "Backlog" (shown as "◂ Backlog"). */
  label: string;
}

/** react-router `location.state` shape carried into the sample detail page so its Back
 * link returns to wherever the sample was opened from (Backlog, Schedule, a cell, …). */
export interface SampleDetailLocationState {
  backNav?: SampleBackNav;
}

/** Fallback when a sample is reached directly (a shared/bookmarked link, a refresh that
 * drops navigation state): the Samples history list is the durable home for any sample. */
const DEFAULT_BACK_NAV: SampleBackNav = { to: "/history/samples", label: "Samples" };

/** Human label for the screen a sample was opened from, keyed off the source pathname so
 * every call site gets a consistent name without repeating the string. */
function labelForPath(pathname: string): string {
  if (pathname.startsWith("/backlog")) return "Backlog";
  if (pathname.startsWith("/schedule")) return "Schedule";
  if (pathname.startsWith("/cells/")) return "Cell";
  if (pathname.startsWith("/cells")) return "Cells";
  if (pathname.startsWith("/history/runs")) return "Run";
  if (pathname.startsWith("/history/samples")) return "Samples";
  return "Back";
}

/** Build the `location.state` to attach to any Link/navigate that opens a sample's detail
 * page, so its Back link returns to the current screen (path + query preserved) with a
 * name that matches where the user came from. */
export function useSampleBackNav(): SampleDetailLocationState {
  const location = useLocation();
  return { backNav: { to: location.pathname + location.search, label: labelForPath(location.pathname) } };
}

/** Resolve the Back target on the sample detail page from its `location.state`, falling
 * back to the Samples history list for direct links / refreshes. */
export function resolveSampleBackNav(state: unknown): SampleBackNav {
  return (state as SampleDetailLocationState | null)?.backNav ?? DEFAULT_BACK_NAV;
}
