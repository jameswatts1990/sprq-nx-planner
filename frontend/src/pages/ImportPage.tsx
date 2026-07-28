import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "@/api/client";
import { importsApi, importTemplateUrl } from "@/api/imports";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Note } from "@/components/ui/Note";
import { StatTile, StatTiles } from "@/components/shared/StatTile";
import type { ImportField, ImportPreviewResult, ImportResult } from "@/types/importing";
import { readSpreadsheetFile } from "@/utils/readSpreadsheetFile";

import styles from "./ImportPage.module.css";

/** Info about a just-completed undo, shown as a one-off confirmation on the input screen. */
interface UndoneInfo {
  count: number;
  filename: string | null;
}

function downloadTemplate() {
  const a = document.createElement("a");
  a.href = importTemplateUrl();
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Backend timestamps are UTC; a tz-naive value (dev SQLite serializes without an offset)
 * must be read as UTC, not the browser's local zone, or "just now" reads as hours ago. */
function parseUtcMs(iso: string): number {
  const hasTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso);
  return new Date(hasTz ? iso : `${iso}Z`).getTime();
}

/** Compact relative age for the "last import" banner (e.g. "just now", "6 min ago"). */
function formatWhen(iso: string): string {
  const then = parseUtcMs(iso);
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(then).toLocaleDateString();
}

export function ImportPage() {
  const [text, setText] = useState("");
  const [filename, setFilename] = useState("");
  const [hasHeader, setHasHeader] = useState(true);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [columnMap, setColumnMap] = useState<Record<string, number>>({});
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [justUndone, setJustUndone] = useState<UndoneInfo | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const schedulerInputRef = useRef<HTMLInputElement>(null);
  const uploadMenuRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const fieldsQuery = useQuery({ queryKey: ["import-fields"], queryFn: () => importsApi.fields() });
  const fields = useMemo<ImportField[]>(() => fieldsQuery.data ?? [], [fieldsQuery.data]);

  // The most recent import + whether it can still be undone — drives the persistent
  // "Undo last import" banner on the input screen (so undo survives navigating away).
  const latestQuery = useQuery({ queryKey: ["import-latest"], queryFn: () => importsApi.latest() });

  const previewMutation = useMutation({
    // Optional overrides let the scheduler flow preview the just-converted CSV without
    // waiting for the async `text` state update; the paste/upload path passes `{}`.
    mutationFn: (vars: { raw?: string; header?: boolean }) =>
      importsApi.preview({ raw_text: vars.raw ?? text, has_header: vars.header ?? hasHeader }),
    onSuccess: (data) => {
      setPreview(data);
      setColumnMap(data.suggested_map);
    },
  });

  // Convert an uploaded scheduler sheet (already read to CSV text) into the standard import
  // CSV by pooling its rows, then drop straight into the normal mapping-review step.
  const schedulerMutation = useMutation({
    mutationFn: (rawText: string) => importsApi.schedulerConvert({ raw_text: rawText }),
    onSuccess: (data) => {
      setText(data.csv);
      setHasHeader(true);
      previewMutation.mutate({ raw: data.csv, header: true });
    },
  });

  // Close the upload options menu on an outside click or Escape.
  useEffect(() => {
    if (!uploadMenuOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (uploadMenuRef.current && !uploadMenuRef.current.contains(e.target as Node)) setUploadMenuOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setUploadMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [uploadMenuOpen]);

  const importMutation = useMutation({
    mutationFn: () =>
      importsApi.create({
        raw_text: text,
        filename: filename || null,
        has_header: hasHeader,
        column_map: columnMap,
      }),
    onSuccess: () => {
      setJustUndone(null);
      void queryClient.invalidateQueries({ queryKey: ["samples"] });
      void queryClient.invalidateQueries({ queryKey: ["import-latest"] });
    },
  });

  // After an undo: note it for a one-off confirmation and drop back to a clean input screen.
  function handleUndone(info: UndoneInfo) {
    handleClear();
    setJustUndone(info);
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setReadError(null);
    schedulerMutation.reset();
    const reader = new FileReader();
    reader.onload = () => {
      setText(String(reader.result ?? ""));
      setFilename(file.name);
    };
    reader.readAsText(file);
  }

  // "Upload from scheduler": read the file to CSV text (parsing .xlsx in the browser),
  // then pool it server-side into the standard import CSV and advance to mapping review.
  async function handleSchedulerFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadMenuOpen(false);
    setReadError(null);
    setFilename(file.name);
    let csvText: string;
    try {
      csvText = await readSpreadsheetFile(file);
    } catch {
      setReadError("Couldn't read that file. Upload the scheduler sheet as a .csv or .xlsx export.");
      if (schedulerInputRef.current) schedulerInputRef.current.value = "";
      return;
    }
    if (schedulerInputRef.current) schedulerInputRef.current.value = "";
    schedulerMutation.mutate(csvText);
  }

  function resetToInput() {
    setPreview(null);
    setColumnMap({});
    previewMutation.reset();
    importMutation.reset();
  }

  function handleClear() {
    setText("");
    setFilename("");
    setReadError(null);
    setUploadMenuOpen(false);
    schedulerMutation.reset();
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (schedulerInputRef.current) schedulerInputRef.current.value = "";
    resetToInput();
  }

  // Summary + any per-pool notes from a scheduler conversion, shown on both the input and
  // mapping-review steps so the lab sees what pooled, merged, or was skipped before importing.
  const conversion = schedulerMutation.data;
  const schedulerNotes =
    schedulerMutation.isSuccess && conversion ? (
      <div className={styles.notesList}>
        <Note tone="info" icon="i">
          Pooled <b>{conversion.source_row_count}</b> scheduler row{conversion.source_row_count === 1 ? "" : "s"} into{" "}
          <b>{conversion.pool_count}</b> container{conversion.pool_count === 1 ? "" : "s"}.
        </Note>
        {conversion.warnings.map((w, i) => (
          <Note key={i} tone="warn" icon="!">
            {w}
          </Note>
        ))}
      </div>
    ) : null;

  if (importMutation.isSuccess) {
    const result = importMutation.data;
    return (
      <div className={styles.page}>
        <ImportResultPanel result={result} />
        <div className={styles.actions}>
          <Button
            variant="ghost"
            onClick={() => {
              handleClear();
            }}
          >
            Import another file
          </Button>
          {result.imported_count > 0 && (
            <UndoImportControl
              batchId={result.import_batch_id}
              count={result.imported_count}
              filename={filename || null}
              onUndone={handleUndone}
            />
          )}
        </div>
      </div>
    );
  }

  // ---- Phase 2: mapping review ----------------------------------------------------------
  if (preview) {
    const unmatchedRequired = fields.filter((f) => f.required && columnMap[f.key] === undefined);
    const mappedFields = fields.filter((f) => columnMap[f.key] !== undefined);
    const barcodeCol = columnMap["barcodes"];
    const skippedInPreview =
      barcodeCol === undefined
        ? 0
        : preview.sample_rows.filter((r) => !(r[barcodeCol] ?? "").trim()).length;

    function setField(key: string, value: string) {
      setColumnMap((prev) => {
        const next = { ...prev };
        if (value === "") delete next[key];
        else next[key] = Number(value);
        return next;
      });
    }

    return (
      <div className={styles.page}>
        <Card>
          <CardHeader badge={`${preview.row_count} row${preview.row_count === 1 ? "" : "s"}`}>
            <h2>Review columns</h2>
          </CardHeader>
          <CardBody>
            {schedulerNotes}
            <p className={styles.reviewIntro}>
              Match each column of your file to a field. We&apos;ve pre-filled the best guess — correct any that are
              wrong. Required fields are marked <span className={styles.req}>*</span>.
            </p>

            <div className={styles.mapGrid}>
              {fields.map((f) => (
                <div key={f.key} className={styles.mapRow}>
                  <label className={styles.mapLabel} htmlFor={`map-${f.key}`}>
                    {f.label}
                    {f.required && <span className={styles.req}> *</span>}
                  </label>
                  <select
                    id={`map-${f.key}`}
                    className={styles.select}
                    value={columnMap[f.key] ?? ""}
                    onChange={(e) => setField(f.key, e.target.value)}
                  >
                    <option value="">— not imported —</option>
                    {preview.columns.map((c) => (
                      <option key={c.index} value={c.index}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            {unmatchedRequired.length > 0 && (
              <Note tone="warn" icon="!">
                Map a column for: <b>{unmatchedRequired.map((f) => f.label).join(", ")}</b> before importing.
              </Note>
            )}
            {skippedInPreview > 0 && (
              <Note tone="info" icon="i">
                {skippedInPreview} of the first {preview.sample_rows.length} rows have no barcode and will be skipped.
              </Note>
            )}

            {mappedFields.length > 0 && preview.sample_rows.length > 0 && (
              <div className={styles.previewWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      {mappedFields.map((f) => (
                        <th key={f.key}>{f.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sample_rows.map((row, i) => (
                      <tr key={i}>
                        {mappedFields.map((f) => (
                          <td key={f.key}>{row[columnMap[f.key]] ?? ""}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className={styles.filehint}>Showing the first {preview.sample_rows.length} rows.</p>
              </div>
            )}

            {importMutation.isError && (
              <div className={styles.error}>
                <Note tone="bad" icon="!">
                  {importMutation.error instanceof ApiError ? importMutation.error.message : "Import failed."}
                </Note>
              </div>
            )}

            <div className={styles.actions}>
              <Button variant="ghost" onClick={resetToInput} disabled={importMutation.isPending}>
                Back
              </Button>
              <Button
                variant="primary"
                onClick={() => importMutation.mutate()}
                disabled={unmatchedRequired.length > 0 || importMutation.isPending}
              >
                {importMutation.isPending ? "Importing…" : `Import ${preview.row_count} sample${preview.row_count === 1 ? "" : "s"}`}
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  // ---- Phase 1: paste / upload ----------------------------------------------------------
  const lineCount = text.trim().length ? text.trim().split(/\r?\n/).length : 0;
  const latest = latestQuery.data;

  return (
    <div className={styles.page}>
      {justUndone && text.length === 0 && (
        <Note tone="good" icon="✓">
          Import undone — removed <b>{justUndone.count}</b> sample{justUndone.count === 1 ? "" : "s"}
          {justUndone.filename ? (
            <>
              {" "}
              from <b>{justUndone.filename}</b>
            </>
          ) : null}
          .
        </Note>
      )}

      {!justUndone && latest?.undoable && latest.imported_count > 0 && (
        <div className={styles.undoBanner}>
          <span className={styles.undoBannerText}>
            Last import: <b>{latest.imported_count}</b> sample{latest.imported_count === 1 ? "" : "s"}
            {latest.source_filename ? (
              <>
                {" "}
                from <b>{latest.source_filename}</b>
              </>
            ) : null}{" "}
            · {formatWhen(latest.created_at)}
          </span>
          <UndoImportControl
            batchId={latest.id}
            count={latest.imported_count}
            filename={latest.source_filename}
            onUndone={handleUndone}
          />
        </div>
      )}

      <Card>
        <CardHeader badge="paste or upload CSV">
          <h2>Samples &amp; barcodes</h2>
        </CardHeader>
        <CardBody>
          <textarea
            spellCheck={false}
            placeholder={
              "Paste CSV here — any columns. You'll match them to fields on the next step.\n" +
              "Container,Parent Sample,Sanger Sample IDs,Barcodes,Target OPLC,...\n" +
              'BNCH-1597,TRAC-2-25402,...,"bc2021, bc2066",268.0,...\n\n' +
              "…or a simple two-column list (untick “First row is a header”):\n" +
              "TRAC-2-25402, bc2021 bc2066"
            }
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className={styles.inputRow}>
            <div className={styles.splitButton} ref={uploadMenuRef}>
              <label className={`btn sm ${styles.splitMain}`} style={{ cursor: "pointer" }}>
                Upload CSV
                <input ref={fileInputRef} type="file" accept=".csv,.tsv,.txt" hidden onChange={handleFileChange} />
              </label>
              <button
                type="button"
                className={`btn sm ${styles.splitCaret}`}
                aria-haspopup="menu"
                aria-expanded={uploadMenuOpen}
                aria-label="More upload options"
                onClick={() => setUploadMenuOpen((open) => !open)}
              >
                <span aria-hidden>▾</span>
              </button>
              {uploadMenuOpen && (
                <div className={styles.uploadMenu} role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.uploadMenuItem}
                    onClick={() => {
                      setUploadMenuOpen(false);
                      schedulerInputRef.current?.click();
                    }}
                  >
                    <span className={styles.uploadMenuItemTitle}>Upload from scheduler…</span>
                    <span className={styles.uploadMenuItemHint}>
                      Your scheduling sheet (.csv or .xlsx) — rows are pooled into containers automatically
                    </span>
                  </button>
                </div>
              )}
            </div>
            <Button size="sm" variant="ghost" onClick={downloadTemplate}>
              Download template
            </Button>
            <Button size="sm" variant="ghost" onClick={handleClear}>
              Clear
            </Button>
            <label className={styles.headerToggle}>
              <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
              First row is a header
            </label>
            <input
              ref={schedulerInputRef}
              type="file"
              accept=".csv,.tsv,.txt,.xlsx"
              hidden
              onChange={handleSchedulerFile}
            />
          </div>
          <div className={styles.parseStatus}>
            {schedulerMutation.isPending ? (
              <span>Converting scheduler sheet…</span>
            ) : text.length === 0 ? (
              <span>No samples loaded yet.</span>
            ) : (
              <span>
                <b>{lineCount}</b> line{lineCount === 1 ? "" : "s"} — you&apos;ll review the column mapping next.
              </span>
            )}
          </div>

          {schedulerNotes}

          {readError && (
            <div className={styles.error}>
              <Note tone="bad" icon="!">
                {readError}
              </Note>
            </div>
          )}
          {schedulerMutation.isError && (
            <div className={styles.error}>
              <Note tone="bad" icon="!">
                {schedulerMutation.error instanceof ApiError
                  ? schedulerMutation.error.message
                  : "Couldn't convert that scheduler sheet."}
              </Note>
            </div>
          )}
          {previewMutation.isError && (
            <div className={styles.error}>
              <Note tone="bad" icon="!">
                {previewMutation.error instanceof ApiError ? previewMutation.error.message : "Could not read that file."}
              </Note>
            </div>
          )}

          <div className={styles.actions}>
            <Button
              variant="primary"
              onClick={() => previewMutation.mutate({})}
              disabled={
                text.trim().length === 0 ||
                previewMutation.isPending ||
                schedulerMutation.isPending ||
                fieldsQuery.isLoading
              }
            >
              {previewMutation.isPending ? "Reading…" : "Continue to mapping"}
            </Button>
            <label className={styles.filenameField}>
              Filename (optional)
              <input
                type="text"
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                placeholder="e.g. batch-2026-07.csv"
              />
            </label>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

/** The "Undo import" trigger + its confirmation dialog, shared by the post-import result
 * panel and the persistent "last import" banner. Owns its own mutation so a 409 (a sample was
 * scheduled/edited between the status read and the click) surfaces inline in the modal, and
 * refreshes the backlog + latest-import state on settle so the banner self-corrects. */
function UndoImportControl({
  batchId,
  count,
  filename,
  onUndone,
}: {
  batchId: number;
  count: number;
  filename: string | null;
  onUndone: (info: UndoneInfo) => void;
}) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const undoMutation = useMutation({
    mutationFn: () => importsApi.undo(batchId),
    onSuccess: (res) => {
      setOpen(false);
      onUndone({ count: res.removed_count, filename });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["samples"] });
      void queryClient.invalidateQueries({ queryKey: ["import-latest"] });
    },
  });

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Undo import
      </Button>
      {open && (
        <ConfirmModal
          title="Undo this import?"
          confirmLabel="Undo import"
          pendingLabel="Undoing…"
          pending={undoMutation.isPending}
          onCancel={() => {
            undoMutation.reset();
            setOpen(false);
          }}
          onConfirm={() => undoMutation.mutate()}
          error={
            undoMutation.isError
              ? undoMutation.error instanceof ApiError
                ? undoMutation.error.message
                : "Couldn't undo the import."
              : undefined
          }
        >
          <p>
            This removes the <b>{count}</b> sample{count === 1 ? "" : "s"} added by this import
            {filename ? (
              <>
                {" "}
                from <b>{filename}</b>
              </>
            ) : null}
            . It can&apos;t be redone — you&apos;d import the file again to bring them back.
          </p>
          <Note tone="warn" icon="!">
            Only possible while none of these samples have been scheduled or edited.
          </Note>
        </ConfirmModal>
      )}
    </>
  );
}

function ImportResultPanel({ result }: { result: ImportResult }) {
  return (
    <Card>
      <CardHeader badge={`batch #${result.import_batch_id}`}>
        <h2>Import result</h2>
      </CardHeader>
      <CardBody>
        <div className={styles.resultStats}>
          <StatTiles>
            <StatTile label="Rows read" value={result.row_count} />
            <StatTile label="Imported" value={result.imported_count} />
            <StatTile label="Duplicates" value={result.duplicate_count} />
            <StatTile label="Skipped" value={result.skipped_count} />
          </StatTiles>
        </div>

        {result.warnings.length > 0 && (
          <div className={styles.notesList}>
            {result.warnings.map((w, i) => (
              <Note key={i} tone="warn" icon="!">
                {w}
              </Note>
            ))}
          </div>
        )}

        {result.skipped.length > 0 && (
          <>
            <p className={styles.subheading}>Skipped rows (fix and re-import)</p>
            <table className={styles.rejectedTable}>
              <thead>
                <tr>
                  <th>Sample</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {result.skipped.map((s, i) => (
                  <tr key={i}>
                    <td>{s.identifier}</td>
                    <td>{s.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {result.rejected.length > 0 && (
          <>
            <p className={styles.subheading}>Duplicates (already in the system)</p>
            <table className={styles.rejectedTable}>
              <thead>
                <tr>
                  <th>Container ID</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {result.rejected.map((r, i) => (
                  <tr key={i}>
                    <td>{r.external_id}</td>
                    <td>{r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {result.imported_count === 0 && result.rejected.length === 0 && result.skipped.length === 0 && (
          <Note tone="info" icon="i">
            No rows were imported.
          </Note>
        )}

        <div className={styles.footerLink}>
          <Link to="/backlog" className="btn primary">
            View backlog
          </Link>
        </div>
      </CardBody>
    </Card>
  );
}
