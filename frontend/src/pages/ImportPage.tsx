import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Link } from "react-router-dom";

import { importsApi } from "@/api/imports";
import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Note } from "@/components/ui/Note";
import type { ImportResult } from "@/types/importing";

import styles from "./ImportPage.module.css";

const EXAMPLE_CSV = `Container,Parent Sample,Sanger Sample IDs,Parent Sample ID,Barcodes,Volume to Load,Actual OPLC,Task ID,Task Status,Lookup Status
BNCH-1597,TRAC-2-25402,"[""DTOL16756088"",""AEGISDNA16711039""]",TRAC-2-25402,"bc2021, bc2066",24.0,268.0,LR-SEQ-LD42-T1,Planned,Found
BNCH-1598,TRAC-2-25403,"[""DTOL16756088"",""AEGISDNA16711039""]",TRAC-2-25403,"bc2029, bc2030, bc2040, bc2057",13.19,300.0,LR-SEQ-LD42-T2,Planned,Found
BNCH-1599,TRAC-2-22911,AEGISDNA16711029,TRAC-2-22911,bc2011,17.82,300.0,LR-SEQ-LD43-T1,Planned,Found
BNCH-1600,TRAC-2-22913,AEGISDNA16711031,TRAC-2-22913,bc2013,19.94,300.0,LR-SEQ-LD43-T2,Planned,Found
BNCH-1601,TRAC-2-22916,AEGISDNA16711034,TRAC-2-22916,bc2016,15.13,300.0,LR-SEQ-LD43-T3,Planned,Found
BNCH-1602,TRAC-2-22918,AEGISDNA16711036,TRAC-2-22918,bc2018,24.0,208.0,LR-SEQ-LD43-T4,Planned,Found
BNCH-1603,TRAC-2-22918,AEGISDNA16711036,TRAC-2-22918,bc2018,24.0,200.0,LR-SEQ-LD43-T5,Planned,Found
BNCH-1604,TRAC-2-22921,AEGISDNA16711039,TRAC-2-22921,bc2021,24.0,288.0,LR-SEQ-LD43-T6,Planned,Found`;

export function ImportPage() {
  const [text, setText] = useState("");
  const [filename, setFilename] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => importsApi.create({ raw_text: text, filename: filename || null }),
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

  function handleLoadExample() {
    setText(EXAMPLE_CSV);
    setFilename("example.csv");
  }

  function handleClear() {
    setText("");
    setFilename("");
    if (fileInputRef.current) fileInputRef.current.value = "";
    mutation.reset();
  }

  function handleSubmit() {
    mutation.mutate();
  }

  const lineCount = text.trim().length ? text.trim().split(/\r?\n/).length : 0;
  const charCount = text.length;

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
              "Paste CSV here - either your full LIMS export:\n" +
              "Container,Parent Sample,Sanger Sample IDs,Parent Sample ID,Barcodes,Volume to Load,Actual OPLC,...\n" +
              'BNCH-1597,TRAC-2-25402,...,"bc2021, bc2066",24.0,268.0,...\n\n' +
              "...or a simple two-column list:\n" +
              "TRAC-2-25402, bc2021 bc2066\n" +
              "TRAC-2-25403, bc2029 bc2030 bc2040 bc2057"
            }
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className={styles.inputRow}>
            <label className="btn sm" style={{ cursor: "pointer" }}>
              Upload CSV
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.tsv,.txt"
                hidden
                onChange={handleFileChange}
              />
            </label>
            <Button size="sm" variant="ghost" onClick={handleLoadExample}>
              Load example data
            </Button>
            <Button size="sm" variant="ghost" onClick={handleClear}>
              Clear
            </Button>
            <span className={styles.filehint}>Barcodes column may hold one or several codes per row.</span>
          </div>
          <div className={styles.parseStatus}>
            {text.length === 0 ? (
              <span>No samples loaded yet.</span>
            ) : (
              <>
                <span>
                  <b>{lineCount}</b> line{lineCount === 1 ? "" : "s"}
                </span>
                <span>
                  <b>{charCount}</b> characters
                </span>
                <span>Final parsing happens on the server when you import.</span>
              </>
            )}
          </div>
          <div className={styles.actions}>
            <Button variant="primary" onClick={handleSubmit} disabled={text.trim().length === 0 || mutation.isPending}>
              {mutation.isPending ? "Importing…" : "Import samples"}
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
          {mutation.isError && (
            <div className={styles.error}>
              <Note tone="bad" icon="!">
                {mutation.error instanceof ApiError ? mutation.error.message : "Import failed. Please try again."}
              </Note>
            </div>
          )}
        </CardBody>
      </Card>

      {mutation.isSuccess && <ImportResultPanel result={mutation.data} />}
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
          <div className={styles.stat}>
            <div className={styles.statLabel}>Rows read</div>
            <div className={styles.statVal}>{result.row_count}</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statLabel}>Imported</div>
            <div className={styles.statVal}>{result.imported_count}</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statLabel}>Duplicates</div>
            <div className={styles.statVal}>{result.duplicate_count}</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statLabel}>Skipped</div>
            <div className={styles.statVal}>{result.skipped_count}</div>
          </div>
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

        {result.rejected.length > 0 && (
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
        )}

        {result.imported_count === 0 && result.rejected.length === 0 && result.warnings.length === 0 && (
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
