import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { adminApi } from "@/api/admin";
import { errorMessage } from "@/api/client";
import { Button } from "@/components/ui/Button";
import { Note } from "@/components/ui/Note";
import type { MlwhProbeRequest, MlwhProbeResult } from "@/types/admin";
import {
  readRememberedMlwhConnection,
  rememberMlwhConnection,
  type MlwhConnectionDetails,
} from "@/utils/rememberedMlwhConnection";

import styles from "./SettingsPage.module.css";

type LightState = "idle" | "checking" | "ok" | "warn" | "bad";

const LIGHT_LABEL: Record<LightState, string> = {
  idle: "Not tested",
  checking: "Checking…",
  ok: "Connected",
  warn: "No tables visible",
  bad: "Can't connect",
};

const FIELDS: { key: keyof MlwhConnectionDetails; label: string; placeholder: string; className?: string }[] = [
  { key: "host", label: "Host", placeholder: "db-host.example.org", className: styles.probeFieldWide },
  { key: "port", label: "Port", placeholder: "3306", className: styles.probeFieldNarrow },
  { key: "user", label: "User", placeholder: "read-only user" },
  { key: "database", label: "Database", placeholder: "database name" },
];

function lightState(pending: boolean, requestFailed: boolean, result: MlwhProbeResult | undefined): LightState {
  if (pending) return "checking";
  if (requestFailed) return "bad";
  if (!result) return "idle";
  if (!result.ok) return "bad";
  return result.tables.length === 0 ? "warn" : "ok";
}

/** Dev-tools check that the *server* (not this browser) can reach Sanger's Multi-LIMS Warehouse:
 * connection details are typed in rather than configured, since UAT has no env/SSH access, and
 * the tables the login can see are listed as proof. Read-only; the password is never stored. */
export function MlwhProbeCard() {
  const [details, setDetails] = useState(readRememberedMlwhConnection);
  const [password, setPassword] = useState("");

  const probe = useMutation({
    mutationFn: (req: MlwhProbeRequest) => adminApi.probeMlwh(req),
    onSuccess: (result, req) => {
      if (result.ok) rememberMlwhConnection({ ...req, port: String(req.port) });
    },
  });

  const port = Number(details.port);
  const canTest =
    details.host.trim() !== "" &&
    details.user.trim() !== "" &&
    details.database.trim() !== "" &&
    Number.isInteger(port) &&
    port >= 1 &&
    port <= 65535;
  const result = probe.data;
  const state = lightState(probe.isPending, probe.isError, result);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canTest || probe.isPending) return;
    probe.mutate({
      host: details.host.trim(),
      port,
      user: details.user.trim(),
      database: details.database.trim(),
      password,
    });
  }

  return (
    <div className={styles.probe}>
      <div className={styles.probeHead}>
        <div className={styles.actionText}>
          <h2 className={styles.actionTitle}>MLWH connection</h2>
          <p className={styles.actionHelper}>
            Tests whether this server can reach the Multi-LIMS Warehouse, and lists the tables the login can see.
            Read-only; the password isn&apos;t saved.
          </p>
        </div>
        <span className={styles.statusLight} data-state={state} role="status" aria-live="polite">
          <span className={styles.statusDot} aria-hidden="true" />
          {LIGHT_LABEL[state]}
        </span>
      </div>

      <form className={styles.probeForm} onSubmit={handleSubmit}>
        {FIELDS.map((f) => (
          <label key={f.key} className={[styles.probeField, f.className].filter(Boolean).join(" ")}>
            <span className="fieldLabel">{f.label}</span>
            <input
              value={details[f.key]}
              onChange={(e) => setDetails((d) => ({ ...d, [f.key]: e.target.value }))}
              placeholder={f.placeholder}
              inputMode={f.key === "port" ? "numeric" : undefined}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        ))}
        <label className={styles.probeField}>
          <span className="fieldLabel">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
          />
        </label>
        {/* Fixed label: a shorter "Testing…" would reflow the fields; the light shows progress. */}
        <Button type="submit" variant="tonal" disabled={!canTest || probe.isPending}>
          Test connection
        </Button>
      </form>

      {probe.isError && (
        <Note tone="bad" icon="!">
          {errorMessage(probe.error, "Couldn't run the MLWH check.")}
        </Note>
      )}
      {result && !result.ok && (
        <Note tone="bad" icon="!">
          Couldn&apos;t connect to <b>{result.target}</b>: {result.error}
        </Note>
      )}
      {result?.ok && result.tables.length === 0 && (
        <Note tone="warn" icon="!">
          Connected to <b>{result.target}</b>, but this login can&apos;t see any tables in that database — it
          probably lacks read access.
        </Note>
      )}
      {result?.ok && result.tables.length > 0 && (
        <>
          <p className={styles.probeSummary}>
            {result.target} · MySQL {result.server_version} · {result.elapsed_ms} ms · {result.tables.length} table
            {result.tables.length === 1 ? "" : "s"}
          </p>
          <ul className={styles.probeTables}>
            {result.tables.map((t) => (
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
