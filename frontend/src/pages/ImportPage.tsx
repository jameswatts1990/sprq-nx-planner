import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "@/api/client";
import { importsApi, importTemplateUrl } from "@/api/imports";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Note } from "@/components/ui/Note";
import { StatTile, StatTiles } from "@/components/shared/StatTile";
import type { ImportField, ImportPreviewResult, ImportResult } from "@/types/importing";

import styles from "./ImportPage.module.css";

const EXAMPLE_CSV = `Container,Parent Sample,Sanger Sample IDs,Parent Sample ID,Barcodes,Volume to Load,Actual OPLC,Task ID,Task Status,Lookup Status
BNCH-1597,TRAC-2-25402,"[""DTOL16756088"",""AEGISDNA16711039""]",TRAC-2-25402,"bc2021, bc2066",24.0,268.0,LR-SEQ-LD42-T1,Planned,Found
BNCH-1598,TRAC-2-25403,"[""DTOL16756088"",""AEGISDNA16711039""]",TRAC-2-25403,"bc2029, bc2030, bc2040, bc2057",13.19,300.0,LR-SEQ-LD42-T2,Planned,Found
BNCH-1599,TRAC-2-22911,AEGISDNA16711029,TRAC-2-22911,bc2011,17.82,300.0,LR-SEQ-LD43-T1,Planned,Found`;

function downloadTemplate() {
  const a = document.createElement("a");
  a.href = importTemplateUrl();
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function ImportPage() {
  const [text, setText] = useState("");
  const [filename, setFilename] = useState("");
  const [hasHeader, setHasHeader] = useState(true);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [columnMap, setColumnMap] = useState<Record<string, number>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const fieldsQuery = useQuery({ queryKey: ["import-fields"], queryFn: () => importsApi.fields() });
  const fields = useMemo<ImportField[]>(() => fieldsQuery.data ?? [], [fieldsQuery.data]);

  const previewMutation = useMutation({
    mutationFn: () => importsApi.preview({ raw_text: text, has_header: hasHeader }),
    onSuccess: (data) => {
      setPreview(data);
      setColumnMap(data.suggested_map);
    },
  });

  const importMutation = useMutation({
    mutationFn: () =>
      importsApi.create({
        raw_text: text,
        filename: filename || null,
        has_header: hasHeader,
        column_map: columnMap,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["samples"] });
    },
  });

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setText(String(reader.result ?? ""));
      setFilename(file.name);
    };
    reader.readAsText(file);
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
    if (fileInputRef.current) fileInputRef.current.value = "";
    resetToInput();
  }

  if (importMutation.isSuccess) {
    return (
      <div className={styles.page}>
        <ImportResultPanel result={importMutation.data} />
        <div className={styles.actions}>
          <Button
            variant="ghost"
            onClick={() => {
              handleClear();
            }}
          >
            Import another file
          </Button>
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
                ‹ Back
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

  return (
    <div className={styles.page}>
      <Card>
        <CardHeader badge="paste or upload CSV">
          <h2>Samples &amp; barcodes</h2>
        </CardHeader>
        <CardBody>
          <textarea
            spellCheck={false}
            placeholder={
              "Paste CSV here — any columns. You'll match them to fields on the next step.\n" +
              "Container,Parent Sample,Sanger Sample IDs,Barcodes,Actual OPLC,...\n" +
              'BNCH-1597,TRAC-2-25402,...,"bc2021, bc2066",268.0,...\n\n' +
              "…or a simple two-column list (untick “First row is a header”):\n" +
              "TRAC-2-25402, bc2021 bc2066"
            }
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className={styles.inputRow}>
            <label className="btn sm" style={{ cursor: "pointer" }}>
              Upload CSV
              <input ref={fileInputRef} type="file" accept=".csv,.tsv,.txt" hidden onChange={handleFileChange} />
            </label>
            <Button size="sm" variant="ghost" onClick={() => setText(EXAMPLE_CSV)}>
              Load example data
            </Button>
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
          </div>
          <div className={styles.parseStatus}>
            {text.length === 0 ? (
              <span>No samples loaded yet.</span>
            ) : (
              <span>
                <b>{lineCount}</b> line{lineCount === 1 ? "" : "s"} — you&apos;ll review the column mapping next.
              </span>
            )}
          </div>

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
              onClick={() => previewMutation.mutate()}
              disabled={text.trim().length === 0 || previewMutation.isPending || fieldsQuery.isLoading}
            >
              {previewMutation.isPending ? "Reading…" : "Continue to mapping →"}
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
                  <th>External ID</th>
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
            View backlog →
          </Link>
        </div>
      </CardBody>
    </Card>
  );
}
