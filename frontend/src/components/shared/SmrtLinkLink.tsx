/** "Open in SMRT Link ↗" - the run's own page in SMRT Link, the instrument software. The URL comes
 * from MLWH (which SMRT Link server holds the run, and SMRT Link's run uuid - not Traction's), so
 * it exists only once MLWH has the run; with no URL this renders nothing rather than a dead link.
 * An anchor, so middle-click / open-in-new-tab work: `button` is styled like the page header's
 * ghost buttons (the "View on Traction ↗" pattern), `inline` like any other text link. */
export function SmrtLinkLink({
  url,
  variant = "inline",
  label = "Open in SMRT Link",
}: {
  url: string | null | undefined;
  variant?: "button" | "inline";
  label?: string;
}) {
  if (!url) return null;
  return (
    <a
      className={variant === "button" ? "btn ghost" : "link"}
      href={url}
      target="_blank"
      rel="noreferrer"
      title="The run in SMRT Link, the instrument software (opens in a new tab)"
    >
      {label} ↗
    </a>
  );
}
