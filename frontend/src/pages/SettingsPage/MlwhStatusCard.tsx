import { useQuery } from "@tanstack/react-query";

import { adminApi } from "@/api/admin";
import { errorMessage } from "@/api/client";
import { Button } from "@/components/ui/Button";
import { Note } from "@/components/ui/Note";
import type { MlwhStatus } from "@/types/admin";

import styles from "./SettingsPage.module.css";

type LightState = "off" | "checking" | "ok" | "warn" | "bad";

const LIGHT_LABEL: Record<LightState, string> = {
  off: "Not configured",
  checking: "Checking…",
  ok: "Connected",
  warn: "No tables visible",
  bad: "Can't connect",
};

// Connection details used to be typed in here and remembered in this browser; they now come from
// the deployment's configuration. Drop the old copy (host, port, user, database - never a password).
try {
  localStorage.removeItem("runnx.mlwh.connection");
} catch {
  /* ignore - storage blocked */
}

function lightState(fetching: boolean, requestFailed: boolean, status: MlwhStatus | undefined): LightState {
  if (fetching) return "checking";
  if (requestFailed) return "bad";
  if (!status || !status.configured) return "off";
  if (!status.ok) return "bad";
  return status.tables.length === 0 ? "warn" : "ok";
}

/** Dev-tools check that the *server* can reach Sanger's Multi-LIMS Warehouse with the connection
 * set by whoever deploys RunNx (MLWH_DATABASE_URL etc. - backend/app/services/mlwh.py). Checks
 * once when shown and on "Check again"; lists the tables the login can see as proof. Read-only,
 * no inputs: nothing about the connection is sent from the browser. */
export function MlwhStatusCard() {
  const query = useQuery({
    queryKey: ["admin", "mlwh-status"],
    queryFn: () => adminApi.mlwhStatus(),
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const status = query.data;
  const state = lightState(query.isFetching, query.isError, status);

  return (
    <div className={styles.probe}>
      <div className={styles.probeHead}>
        <div className={styles.actionText}>
          <h2 className={styles.actionTitle}>MLWH connection</h2>
          <p className={styles.actionHelper}>
            Whether this server can reach the Multi-LIMS Warehouse with the connection set by whoever deploys RunNx,
            and the tables that login can see. Read-only.
          </p>
        </div>
        <div className={styles.probeActions}>
          <span className={styles.statusLight} data-state={state} role="status" aria-live="polite">
            <span className={styles.statusDot} aria-hidden="true" />
            {LIGHT_LABEL[state]}
          </span>
          {/* Fixed label: the light shows progress. */}
          <Button variant="tonal" onClick={() => void query.refetch()} disabled={query.isFetching}>
            Check again
          </Button>
        </div>
      </div>

      {query.isError && (
        <Note tone="bad" icon="!">
          {errorMessage(query.error, "Couldn't run the MLWH check.")}
        </Note>
      )}
      {status && !status.configured && (
        <Note tone="info" icon="i">
          No MLWH connection is configured for this deployment, so nothing in RunNx reads from MLWH. Whoever deploys
          RunNx can set one (<code>MLWH_DATABASE_URL</code> and <code>MLWH_PASSWORD</code>).
        </Note>
      )}
      {status?.configured && !status.ok && (
        <Note tone="bad" icon="!">
          Couldn&apos;t connect{status.target ? <> to <b>{status.target}</b></> : null}: {status.error}
        </Note>
      )}
      {status?.ok && status.tables.length === 0 && (
        <Note tone="warn" icon="!">
          Connected to <b>{status.target}</b>, but this login can&apos;t see any tables in that database — it
          probably lacks read access.
        </Note>
      )}
      {status?.ok && status.tables.length > 0 && (
        <>
          <p className={styles.probeSummary}>
            {status.target} · MySQL {status.server_version} · {status.elapsed_ms} ms · {status.tables.length} table
            {status.tables.length === 1 ? "" : "s"}
          </p>
          <ul className={styles.probeTables}>
            {status.tables.map((t) => (
              <li key={t.name}>
                <span className={styles.probeTableName} title={t.name}>
                  {t.name}
                </span>
                {t.approx_rows !== null && (
                  <span className={styles.probeTableRows}>~{t.approx_rows.toLocaleString()} rows</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
