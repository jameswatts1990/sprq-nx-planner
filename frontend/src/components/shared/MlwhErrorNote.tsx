import { Button } from "@/components/ui/Button";
import { Note } from "@/components/ui/Note";

/** MLWH couldn't be read: the one way every MLWH-backed section says so - what couldn't be read,
 * the driver's own message, that nothing else is affected, and a Retry that asks MLWH again
 * (useMlwhRefresh) rather than waiting out RunNx's pause after a failure. */
export function MlwhErrorNote({
  what,
  error,
  onRetry,
  retrying,
  size,
}: {
  /** e.g. "the QC team's verdicts", "this run's results". */
  what: string;
  error: string | null;
  onRetry: () => void;
  retrying: boolean;
  size?: "md" | "sm";
}) {
  return (
    <Note tone="bad" icon="!" size={size}>
      Couldn&apos;t read {what} from MLWH{error ? `: ${error}` : "."} The rest of this page is unaffected.{" "}
      <Button size="sm" variant="ghost" onClick={onRetry} disabled={retrying}>
        {retrying ? "Retrying…" : "Retry"}
      </Button>
    </Note>
  );
}
