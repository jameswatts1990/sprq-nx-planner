import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

import styles from "./ViewOptionsMenu.module.css";

export interface ViewOptionsMenuProps {
  /** Whether barcode chips are currently shown on the grid's sample cards. */
  showBarcodes: boolean;
  onChangeShowBarcodes: (show: boolean) => void;
}

/**
 * The Schedule toolbar's far-right "View options" button: a small drop-down of grid
 * display toggles that don't change the plan, only how it's drawn. Today that's just
 * Show/Hide barcodes on the sample cards; it's a menu (not a lone button) so further
 * display toggles can slot in beside it without re-cluttering the toolbar.
 *
 * Closes on an outside click or Esc, the same lightweight pattern the page's other
 * dismissable overlays use.
 */
export function ViewOptionsMenu({ showBarcodes, onChangeShowBarcodes }: ViewOptionsMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        title="Choose what's shown on the grid"
      >
        View options ▾
      </Button>
      {open && (
        <div className={styles.panel} role="menu">
          <div className={styles.row}>
            <span className={styles.label}>Barcodes</span>
            <SegmentedControl
              ariaLabel="Show or hide barcodes on sample cards"
              value={showBarcodes ? "show" : "hide"}
              onChange={(v) => onChangeShowBarcodes(v === "show")}
              options={[
                { value: "show", label: "Show" },
                { value: "hide", label: "Hide" },
              ]}
            />
          </div>
          <p className={styles.hint}>Show or hide the barcode chips on each sample card in the grid.</p>
        </div>
      )}
    </div>
  );
}
