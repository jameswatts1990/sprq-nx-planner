import { useState } from "react";
import type { ReactNode } from "react";

import { Card, CardBody, CardHeader } from "./Card";
import styles from "./Accordion.module.css";

export interface AccordionProps {
  /** Header label (left of the caret toggle). */
  title: ReactNode;
  /** Right-aligned badge in the card header (e.g. a count). */
  badge?: ReactNode;
  /** Collapsed by default. */
  defaultOpen?: boolean;
  /** Controlled open state - when provided (with `onToggle`), overrides internal state.
   * Omit both for the normal uncontrolled behavior. */
  open?: boolean;
  onToggle?: (open: boolean) => void;
  /** Optional content pinned immediately after the title (before the right-aligned badge),
   * e.g. a header action button. Rendered outside the toggle so it isn't a nested button
   * and its own clicks don't toggle the accordion; the toggle shrinks to its title width
   * when present so this sits right beside the title rather than at the far edge. */
  titleAfter?: ReactNode;
  /** Keep children mounted (hidden via the native `hidden` attribute) even while
   * collapsed, instead of unmounting them - e.g. so a parent can read their rendered
   * text for search. Default false (unchanged unmount-on-collapse behavior). */
  alwaysMounted?: boolean;
  children: ReactNode;
}

/** Generic collapsible Card, generalized from the Plan page's InProgressCellsReview
 * toggle pattern (useState + caret + Card/CardHeader/CardBody). */
export function Accordion({
  title,
  badge,
  defaultOpen = false,
  open: controlledOpen,
  onToggle,
  alwaysMounted = false,
  titleAfter,
  children,
}: AccordionProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const expanded = controlledOpen ?? internalOpen;

  function toggle() {
    if (onToggle) onToggle(!expanded);
    else setInternalOpen((e) => !e);
  }

  return (
    <Card>
      <CardHeader badge={badge}>
        <button
          type="button"
          className={titleAfter ? `${styles.toggle} ${styles.toggleFit}` : styles.toggle}
          aria-expanded={expanded}
          onClick={toggle}
        >
          <span className={styles.caret}>{expanded ? "▼" : "▶"}</span>
          {title}
        </button>
        {titleAfter}
      </CardHeader>
      {alwaysMounted ? <CardBody hidden={!expanded}>{children}</CardBody> : expanded && <CardBody>{children}</CardBody>}
    </Card>
  );
}
