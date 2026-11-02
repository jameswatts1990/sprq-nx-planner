import { useEffect, useRef, useState } from "react";

import { EyeIcon } from "@/components/shared/icons";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

import styles from "./ViewOptionsMenu.module.css";

export type GridDensity = "comfortable" | "compact";
/** Where the Backlog tray sits relative to the grid: pinned across the top (default), or a
 * docked one-card-wide side drawer on the left / right that pushes the grid aside. */
export type BacklogPosition = "top" | "left" | "right";
/** Instrument column width: full (name, serial, cell map) or slim (just the sideways Revio
 * number + Recalculate, giving the day columns the width). */
export type InstrumentColumn = "full" | "slim";

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
  /** Where the Backlog tray sits - top (default), left, or right. */
  backlogPosition: BacklogPosition;
  onChangeBacklogPosition: (position: BacklogPosition) => void;
  /** Instrument column - full (default) or slim. */
  instrumentColumn: InstrumentColumn;
  onChangeInstrumentColumn: (column: InstrumentColumn) => void;
}

/**
 * The Schedule toolbar's far-right "View options" eye button: a small drop-down of grid
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
  backlogPosition,
  onChangeBacklogPosition,
  instrumentColumn,
  onChangeInstrumentColumn,
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

  // Detail the grid is currently hiding - named in the eye's tooltip, since an icon-only trigger
  // otherwise gives no hint why barcodes or note markers have gone missing.
  const hidden = [!showBarcodes && "barcodes", !showNotes && "sample notes"].filter(Boolean).join(" and ");
  const label = hidden ? `View options (${hidden} hidden)` : "View options";

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <Button
        variant="ghost"
        icon
        className={styles.trigger}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={label}
        title={hidden ? `${label} - choose what's shown on the grid` : "View options - choose what's shown on the grid"}
      >
        <EyeIcon />
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
          <p className={styles.hint}>Show or hide the barcode chips on each sample card in the grid and the backlog.</p>

          <div className={styles.row}>
            <span className={styles.label}>Sample notes</span>
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
          <p className={styles.hint}>
            Show a small note icon on cards that carry a note — hover it to read the note. Day-note banners always show.
          </p>

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

          <div className={styles.row}>
            <span className={styles.label}>Backlog</span>
            <SegmentedControl
              ariaLabel="Choose where the backlog sits"
              value={backlogPosition}
              onChange={(v) => onChangeBacklogPosition(v as BacklogPosition)}
              options={[
                { value: "top", label: "Top" },
                { value: "left", label: "Left" },
                { value: "right", label: "Right" },
              ]}
            />
          </div>
          <p className={styles.hint}>
            Pin the backlog across the top, or dock it as a one-card-wide panel on the left or right that pushes the
            grid aside. The side panel collapses with its ‹ / › toggle.
          </p>

          <div className={styles.row}>
            <span className={styles.label}>Instrument column</span>
            <SegmentedControl
              ariaLabel="Choose a full or slim instrument column"
              value={instrumentColumn}
              onChange={(v) => onChangeInstrumentColumn(v as InstrumentColumn)}
              options={[
                { value: "full", label: "Full" },
                { value: "slim", label: "Slim" },
              ]}
            />
          </div>
          <p className={styles.hint}>
            Slim shrinks the instrument column to just the Revio number (turned sideways) and its ↻ Recalculate button,
            hiding the cell map so the days get more width.
          </p>
        </div>
      )}
    </div>
  );
}
