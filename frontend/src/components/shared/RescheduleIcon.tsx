/** Monochrome "move to another day" mark: a calendar with an arrow leaving it. Stroke style
 * matches the app's other inline icons (no icon library); currentColor lets the host tint it. */
export function RescheduleIcon() {
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
      style={{ verticalAlign: "-0.125em" }}
    >
      <path d="M21 11V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7" />
      <path d="M16 2v4M8 2v4M3 10h18" />
      <path d="M15 18h7M19 15l3 3-3 3" />
    </svg>
  );
}
