import { createContext } from "react";

/**
 * The slotKey (see gridKeys.slotKey) of the one grid placement the Schedule page's unified
 * search is currently focused on, or null when nothing is focused. Read directly by the
 * filled-slot leaf components (SchedulerSlot's Draggable/Clickable slots) rather than
 * threaded through the memoized Grid/Row/DayCell layers - so cycling the search to a new
 * match repaints only the handful of filled slots that consume it, the same lightweight
 * context pattern useCellLinkHighlight uses. Defaults to null so any grid rendered outside
 * the Schedule page's provider (e.g. RunDetailPage) simply never shows a search highlight.
 */
export const SearchHighlightContext = createContext<string | null>(null);
