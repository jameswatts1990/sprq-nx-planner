import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

import styles from "./ViewOptionsMenu.module.css";

export type GridDensity = "comfortable" | "compact";

export interface ViewOptionsMenuProps {
  /** Whether barcode chips are currently shown on the grid's sample cards. */
  showBarcodes: boolean;
  onChangeShowBarcodes: (show: boolean) => void;
  /** Whether the note marker shows on sample cards that carry a note. */
  showNotes: boolean;
  onChangeShowNotes: (show: boolean) => void;
  /** Whether the big use-number watermark shows behind each filled card's sample id. */
  showUseNumber: boolean;
  onChangeShowUseNumber: (show: boolean) => void;
  /** Grid card density - comfortable (default) or compact (trims spacing to fit more). */
  density: GridDensity;
  onChangeDensity: (density: GridDensity) => void;
}

/**
 * The Schedule toolbar's far-right "View options" button: a small drop-down of grid
 * display toggles that don't change the plan, only how it's drawn - barcodes, note markers,
 * the use-number watermark, and card density. It's a menu (not a lone button) so further
 * display toggles can slot in beside these without re-cluttering the toolbar.
 *
 * Closes on an outside click or Esc, the same lightweight pattern the page's other
 * dismissable overlays use.
 */
export function ViewOptionsMenu({
  showBarcodes,
  onChangeShowBarcodes,
  showNotes,
  onChangeShowNotes,
  showUseNumber,
  onChangeShowUseNumber,
  density,
  onChangeDensity,
}: ViewOptionsMenuProps) {
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

          <div className={styles.row}>
            <span className={styles.label}>Notes</span>
            <SegmentedControl
              ariaLabel="Show or hide the note marker on sample cards"
              value={showNotes ? "show" : "hide"}
              onChange={(v) => onChangeShowNotes(v === "show")}
              options={[
                { value: "show", label: "Show" },
                { value: "hide", label: "Hide" },
              ]}
            />
          </div>
          <p className={styles.hint}>Show a small ✎ marker on cards that carry a note — hover it to read the note.</p>

          <div className={styles.row}>
            <span className={styles.label}>Cell use number</span>
            <SegmentedControl
              ariaLabel="Show or hide the use-number watermark on sample cards"
              value={showUseNumber ? "show" : "hide"}
              onChange={(v) => onChangeShowUseNumber(v === "show")}
              options={[
                { value: "show", label: "Show" },
                { value: "hide", label: "Hide" },
              ]}
            />
          </div>
          <p className={styles.hint}>Show which use of the cell each placement is (1, 2 or 3) as a large faint number behind the sample id.</p>

          <div className={styles.row}>
            <span className={styles.label}>Density</span>
            <SegmentedControl
              ariaLabel="Choose comfortable or compact card density"
              value={density}
              onChange={(v) => onChangeDensity(v as GridDensity)}
              options={[
                { value: "comfortable", label: "Comfortable" },
                { value: "compact", label: "Compact" },
              ]}
            />
          </div>
          <p className={styles.hint}>Compact trims card spacing so more of the week fits without scrolling.</p>
        </div>
      )}
    </div>
  );
}
