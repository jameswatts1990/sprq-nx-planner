import type { ListAuditParams } from "@/api/audit";
import { ACTION_GROUPS } from "@/utils/auditLabels";
import { type ListView, type ListViewSpec, oneOf, positiveInt, readListFields } from "@/utils/listView";

/** The Activity page's view - search, what / who filters, a date range, an optional "about this
 * run / sample / cell" scope (from a detail page's "View activity") and the page - kept in the
 * URL (see utils/listView). Always newest first, so `sort` has the one value. */

export type ActivityScopeKind = "run" | "sample" | "cell";

export interface ActivityView extends ListView<"at"> {
  /** An ACTION_GROUPS value; "" = every action. */
  group: string;
  /** An actor name; "" = anyone. */
  who: string;
  /** Change date range, YYYY-MM-DD; "" = open-ended. */
  from: string;
  to: string;
  /** The run / sample / cell the list is scoped to, and its name for the scope chip. */
  scopeKind: ActivityScopeKind | "";
  scopeId: number;
  scopeLabel: string;
}

export const DEFAULT_ACTIVITY_VIEW: ActivityView = {
  group: "",
  who: "",
  from: "",
  to: "",
  scopeKind: "",
  scopeId: 0,
  scopeLabel: "",
  q: "",
  sort: "at",
  dir: "desc",
  page: 1,
  pageSize: 50,
};

const isoDate = (raw: string | null) => (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "");

export const ACTIVITY_VIEW: ListViewSpec<ActivityView> = {
  defaults: DEFAULT_ACTIVITY_VIEW,
  keys: {
    group: "what",
    who: "who",
    from: "from",
    to: "to",
    scopeKind: "for",
    scopeId: "id",
    scopeLabel: "name",
    q: "q",
    sort: "sort",
    dir: "dir",
    page: "page",
    pageSize: "size",
  },
  sortDefaultDir: { at: "desc" },
  read: (params) => {
    const d = DEFAULT_ACTIVITY_VIEW;
    const scopeKind = oneOf(params.get("for"), ["run", "sample", "cell"] as const, d.scopeKind);
    const scopeId = positiveInt(params.get("id"));
    const scoped = scopeKind !== "" && scopeId !== null;
    return {
      ...readListFields(params, ACTIVITY_VIEW),
      group: oneOf(
        params.get("what"),
        ACTION_GROUPS.map((g) => g.value),
        d.group,
      ),
      who: params.get("who") ?? d.who,
      from: isoDate(params.get("from")),
      to: isoDate(params.get("to")),
      scopeKind: scoped ? scopeKind : d.scopeKind,
      scopeId: scoped ? scopeId : d.scopeId,
      scopeLabel: scoped ? (params.get("name") ?? d.scopeLabel) : d.scopeLabel,
    };
  },
};

/** The audit-log request for a view. */
export function activityParams(view: ActivityView): ListAuditParams {
  const scope = view.scopeKind ? { [`${view.scopeKind}_id`]: view.scopeId } : {};
  return {
    ...scope,
    action: ACTION_GROUPS.find((g) => g.value === view.group)?.actions.join(","),
    actor: view.who || undefined,
    q: view.q || undefined,
    date_from: view.from || undefined,
    date_to: view.to || undefined,
    page: view.page,
    page_size: view.pageSize,
  };
}

/** A detail page's "View activity" link: the Activity list scoped to that run / sample / cell. */
export function activityHref(kind: ActivityScopeKind, id: number, label: string): string {
  return `/history/activity?${new URLSearchParams({ for: kind, id: String(id), name: label })}`;
}
