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
        <button type="button" className={styles.toggle} aria-expanded={expanded} onClick={toggle}>
          <span className={styles.caret}>{expanded ? "▼" : "▶"}</span>
          {title}
        </button>
      </CardHeader>
      {alwaysMounted ? <CardBody hidden={!expanded}>{children}</CardBody> : expanded && <CardBody>{children}</CardBody>}
    </Card>
  );
}
