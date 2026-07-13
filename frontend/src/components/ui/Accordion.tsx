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
  children: ReactNode;
}

/** Generic collapsible Card, generalized from the Plan page's InProgressCellsReview
 * toggle pattern (useState + caret + Card/CardHeader/CardBody). */
export function Accordion({ title, badge, defaultOpen = false, children }: AccordionProps) {
  const [expanded, setExpanded] = useState(defaultOpen);

  return (
    <Card>
      <CardHeader badge={badge}>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={expanded}
          onClick={() => setExpanded((e) => !e)}
        >
          <span className={styles.caret}>{expanded ? "▼" : "▶"}</span>
          {title}
        </button>
      </CardHeader>
      {expanded && <CardBody>{children}</CardBody>}
    </Card>
  );
}
