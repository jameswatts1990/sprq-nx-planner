import type { ReactNode } from "react";

/** Shared frame for the app's inline stroke icons (no icon library): a 24-unit viewBox drawn
 * at 1em in currentColor, so an icon sizes with the host's font-size and takes its text colour.
 * Decorative only - the host button carries the accessible name (aria-label / visible text). */
function StrokeIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flex: "none" }}
    >
      {children}
    </svg>
  );
}

export function ChevronLeftIcon() {
  return (
    <StrokeIcon>
      <path d="M15 18l-6-6 6-6" />
    </StrokeIcon>
  );
}

export function ChevronRightIcon() {
  return (
    <StrokeIcon>
      <path d="M9 18l6-6-6-6" />
    </StrokeIcon>
  );
}

export function CalendarIcon() {
  return (
    <StrokeIcon>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </StrokeIcon>
  );
}

export function SearchIcon() {
  return (
    <StrokeIcon>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35" />
    </StrokeIcon>
  );
}

/** Tray with a down arrow - "download a file" (the schedule CSV export). */
export function DownloadIcon() {
  return (
    <StrokeIcon>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5M12 15V3" />
    </StrokeIcon>
  );
}

/** "What's shown" - the Schedule grid's View options. */
export function EyeIcon() {
  return (
    <StrokeIcon>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </StrokeIcon>
  );
}

/** Clipboard with list lines - the Batch Sheet (a day's runs laid out to copy / print). */
export function ClipboardListIcon() {
  return (
    <StrokeIcon>
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="M9 12h6M9 16h6" />
    </StrokeIcon>
  );
}

export function ChevronDownIcon() {
  return (
    <StrokeIcon>
      <path d="M6 9l6 6 6-6" />
    </StrokeIcon>
  );
}

// Main-nav icons (AppShell): one per page, in the same 24-unit stroke style.

/** Tray with an up arrow - Import (bring samples in); the mirror of DownloadIcon's Export. */
export function UploadIcon() {
  return (
    <StrokeIcon>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M17 8l-5-5-5 5M12 3v12" />
    </StrokeIcon>
  );
}

/** Inbox tray - the Backlog of imported samples waiting to be scheduled. */
export function InboxIcon() {
  return (
    <StrokeIcon>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </StrokeIcon>
  );
}

/** Shield with a tick - QC (credit cases for failed or stopped cells). */
export function ShieldCheckIcon() {
  return (
    <StrokeIcon>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </StrokeIcon>
  );
}

/** Two stacked units with status lights - the Revio Instruments. */
export function InstrumentIcon() {
  return (
    <StrokeIcon>
      <rect x="3" y="3" width="18" height="8" rx="2" />
      <rect x="3" y="13" width="18" height="8" rx="2" />
      <path d="M7 7h.01M7 17h.01" />
    </StrokeIcon>
  );
}

/** Clock with a rewind arrow - History (cells, runs and samples on record). */
export function HistoryIcon() {
  return (
    <StrokeIcon>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5M12 7v5l4 2" />
    </StrokeIcon>
  );
}

/** A tray of four round cells - Cells (SMRT cell trays). */
export function CellTrayIcon() {
  return (
    <StrokeIcon>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="8.5" cy="8.5" r="2" />
      <circle cx="15.5" cy="8.5" r="2" />
      <circle cx="8.5" cy="15.5" r="2" />
      <circle cx="15.5" cy="15.5" r="2" />
    </StrokeIcon>
  );
}

/** Play button - Runs (every sequencing run, past, active and planned). */
export function RunIcon() {
  return (
    <StrokeIcon>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 8.5v7l5.5-3.5z" />
    </StrokeIcon>
  );
}

/** Conical flask - Samples. */
export function SampleIcon() {
  return (
    <StrokeIcon>
      <path d="M10 2v7.53a2 2 0 0 1-.21.9L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.07-10.13a2 2 0 0 1-.21-.9V2" />
      <path d="M8.5 2h7M7 16h10" />
    </StrokeIcon>
  );
}

/** Bar chart - Stats. */
export function ChartIcon() {
  return (
    <StrokeIcon>
      <path d="M3 3v18h18M18 17V9M13 17V5M8 17v-3" />
    </StrokeIcon>
  );
}

/** Cog - Settings. */
export function SettingsIcon() {
  return (
    <StrokeIcon>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </StrokeIcon>
  );
}

/** Circled question mark - Help. */
export function HelpIcon() {
  return (
    <StrokeIcon>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01" />
    </StrokeIcon>
  );
}
