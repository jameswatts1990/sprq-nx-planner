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
