/** Chart colours are read straight from the token custom properties in styles/tokens.css
 * at runtime, so they can never drift from the app palette (change a token, the charts
 * follow). Computed once per call against :root; call inside a component render.
 *
 * Semantics are deliberate, not decorative (per the dataviz method - colour follows the
 * entity/meaning, not rank): green = good/completed, red = waste/failure, magenta/blue/teal
 * = the Use 1/2/3 swatch order shared with SectionHeading's UseLegend. */

export interface ChartPalette {
  magenta: string;
  blue: string;
  teal: string;
  purple: string;
  green: string;
  red: string;
  orange: string;
  amber: string;
  grey: string;
  faint: string;
  line: string;
  ink: string;
  card: string;
}

function v(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function chartPalette(): ChartPalette {
  return {
    magenta: v("--magenta"),
    blue: v("--blue"),
    teal: v("--teal"),
    purple: v("--purple"),
    green: v("--green"),
    red: v("--red"),
    orange: v("--orange"),
    amber: v("--amber"),
    grey: v("--grey"),
    faint: v("--faint"),
    line: v("--line"),
    ink: v("--ink"),
    card: v("--card"),
  };
}

/** Cell-lifecycle status -> a distinct hue. Semantically aligned with the app's tone map
 * (open = good/green, window_expired = waste/red) but kept distinguishable, since the
 * shared tone map collapses several terminal states onto one "danger" red that a chart
 * legend couldn't tell apart. */
export function cellStatusColor(p: ChartPalette): Record<string, string> {
  return {
    open: p.green,
    exhausted: p.faint,
    window_expired: p.red,
    retired: p.purple,
    stopped: p.orange,
  };
}

/** CellUse verdict -> hue: completed good, failed bad, aborted (instrument, not cell) a warning. */
export function outcomeColor(p: ChartPalette): Record<string, string> {
  return { completed: p.green, failed: p.red, aborted: p.amber };
}

/** The Use 1/2/3 swatch order, matching SectionHeading's UseLegend exactly. */
export function useDepthColor(p: ChartPalette): string[] {
  return [p.magenta, p.blue, p.teal];
}
