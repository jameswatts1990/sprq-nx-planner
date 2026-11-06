import { Link } from "react-router-dom";

import { ActivityIcon } from "@/components/shared/icons";

import { type ActivityScopeKind, activityHref } from "./activityView";

/** A detail page's header link to its Activity: every change to this run / sample / cell and to
 * what's been placed on it. Styled as a ghost button, like the header's other links. */
export function ViewActivityLink({ kind, id, label }: { kind: ActivityScopeKind; id: number; label: string }) {
  return (
    <Link className="btn ghost" to={activityHref(kind, id, label)} title={`Who changed this ${kind}, and when`}>
      <ActivityIcon /> View activity
    </Link>
  );
}
