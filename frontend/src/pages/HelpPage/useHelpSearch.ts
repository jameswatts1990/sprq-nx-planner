import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";

/** Names registered in the document's CSS highlight registry (styled in base.css via
 * ::highlight(...)). The active match paints over the rest via a higher priority. */
const HL_ALL = "help-search";
const HL_ACTIVE = "help-search-active";
/** Cap the number of painted ranges so a one-letter-ish query can't build tens of
 * thousands of Ranges across the whole (large) help page. */
const MAX_MATCHES = 400;
/** Below this length a query matches almost everything (every "e", "3", …) - pure noise
 * for a help lookup - so we don't highlight until the user has typed something specific. */
const MIN_QUERY = 2;

/** Feature-detect the CSS Custom Highlight API. When absent (very old engines) we still
 * count matches and scroll between them - only the coloured paint is skipped. */
const CAN_PAINT = typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";

interface HelpMatch {
  range: Range;
  /** data-help-section key of the section this match sits in, for the sidebar tally. */
  section: string;
}

export interface HelpSearch {
  /** Total occurrences of the query across the page. */
  total: number;
  /** 1-based index of the currently focused match (0 when there are none). */
  position: number;
  /** Occurrence count per section key, for the table-of-contents badges. */
  perSection: Record<string, number>;
  goNext: () => void;
  goPrev: () => void;
}

/** Highlights every occurrence of `query` inside `containerRef` and lets the caller step
 * through them (scrolling each into view). Ranges are painted with the CSS Custom Highlight
 * API rather than by injecting <mark> nodes, so React's DOM is never mutated out from under
 * it - the help sections stay exactly as rendered, including their live example components. */
export function useHelpSearch(containerRef: RefObject<HTMLElement>, query: string): HelpSearch {
  const [matches, setMatches] = useState<HelpMatch[]>([]);
  const [active, setActive] = useState(0);

  // Rebuild the match set whenever the query changes.
  useEffect(() => {
    if (CAN_PAINT) {
      CSS.highlights.delete(HL_ALL);
      CSS.highlights.delete(HL_ACTIVE);
    }
    const container = containerRef.current;
    const q = query.trim().toLowerCase();
    if (!container || q.length < MIN_QUERY) {
      setMatches([]);
      setActive(0);
      return;
    }

    const found: HelpMatch[] = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        // Skip SVG <text> - range highlighting inside SVG is unreliable across engines.
        if ((node.parentElement as Element | null)?.closest("svg")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let node = walker.nextNode();
    while (node && found.length < MAX_MATCHES) {
      const lower = (node.nodeValue ?? "").toLowerCase();
      const sectionEl = (node.parentElement as Element | null)?.closest("[data-help-section]");
      const section = sectionEl?.getAttribute("data-help-section") ?? "";
      let idx = lower.indexOf(q);
      while (idx !== -1 && found.length < MAX_MATCHES) {
        const range = new Range();
        range.setStart(node, idx);
        range.setEnd(node, idx + q.length);
        found.push({ range, section });
        idx = lower.indexOf(q, idx + q.length);
      }
      node = walker.nextNode();
    }

    if (CAN_PAINT && found.length) {
      CSS.highlights.set(HL_ALL, new Highlight(...found.map((m) => m.range)));
    }
    setMatches(found);
    setActive(0);
  }, [query, containerRef]);

  // Paint + scroll the focused match.
  useEffect(() => {
    if (CAN_PAINT) CSS.highlights.delete(HL_ACTIVE);
    const match = matches[active];
    if (!match) return;
    if (CAN_PAINT) {
      const hl = new Highlight(match.range);
      hl.priority = 1; // paint over the all-matches highlight where they overlap
      CSS.highlights.set(HL_ACTIVE, hl);
    }
    match.range.startContainer.parentElement?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [active, matches]);

  // Clear the registry when the help page unmounts.
  useEffect(
    () => () => {
      if (!CAN_PAINT) return;
      CSS.highlights.delete(HL_ALL);
      CSS.highlights.delete(HL_ACTIVE);
    },
    [],
  );

  const perSection = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of matches) counts[m.section] = (counts[m.section] ?? 0) + 1;
    return counts;
  }, [matches]);

  const goNext = useCallback(() => {
    setActive((i) => (matches.length ? (i + 1) % matches.length : 0));
  }, [matches.length]);
  const goPrev = useCallback(() => {
    setActive((i) => (matches.length ? (i - 1 + matches.length) % matches.length : 0));
  }, [matches.length]);

  return {
    total: matches.length,
    position: matches.length ? active + 1 : 0,
    perSection,
    goNext,
    goPrev,
  };
}
