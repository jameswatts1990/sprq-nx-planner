import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import type { CreditEmailTemplate } from "@/api/settings";
import { settingsApi } from "@/api/settings";
import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/Button";
import { Note } from "@/components/ui/Note";
import { CREDIT_EMAIL_TOKENS, EXAMPLE_CONTEXT, renderCreditEmail } from "@/utils/creditEmail";

import styles from "./CreditEmailPanel.module.css";

type FieldKey = keyof CreditEmailTemplate;

const FIELDS: { key: FieldKey; label: string; multiline: boolean }[] = [
  { key: "to", label: "To", multiline: false },
  { key: "cc", label: "Cc", multiline: false },
  { key: "subject", label: "Subject", multiline: false },
  { key: "body", label: "Body", multiline: true },
];

type EditEl = HTMLInputElement | HTMLTextAreaElement;

/** Admin panel: edit the one email the app sends — the PacBio SMRT-cell credit request that
 * the "Generate email…" button on a credit case opens. The subject and body can carry
 * <angle-bracket> variables (e.g. <sample name>) that get filled from the failing cell; the
 * clickable variable chips insert a token at the cursor, and the live preview shows the
 * whole email with those tokens resolved against example values so the lab can confirm the
 * right variables are used before saving. Mirrors SampleDefaultsPanel's save/dirty pattern. */
export function CreditEmailPanel() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["credit-email-template"], queryFn: () => settingsApi.getCreditEmail() });

  const [form, setForm] = useState<CreditEmailTemplate | null>(null);
  useEffect(() => {
    if (query.data) setForm(query.data);
  }, [query.data]);

  // Which field was last focused, so a variable chip inserts at the right cursor position.
  const activeElRef = useRef<EditEl | null>(null);
  const activeKeyRef = useRef<FieldKey>("body");

  const mutation = useMutation({
    mutationFn: (body: CreditEmailTemplate) => settingsApi.updateCreditEmail(body),
    onSuccess: (data) => {
      setForm(data);
      queryClient.setQueryData(["credit-email-template"], data);
    },
  });

  const dirty = form != null && query.data != null && JSON.stringify(form) !== JSON.stringify(query.data);

  function set(key: FieldKey, value: string) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function insertToken(token: string) {
    if (!form) return;
    const key = activeKeyRef.current;
    const el = activeElRef.current;
    const current = form[key];
    // Splice at the caret when we have a live selection; otherwise append to the field.
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    const next = current.slice(0, start) + token + current.slice(end);
    set(key, next);
    // Restore focus + caret just after the inserted token once React has re-rendered.
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  }

  const preview = form ? renderCreditEmail(form, EXAMPLE_CONTEXT) : null;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h2 className={styles.title}>Email template</h2>
        <p className={styles.helper}>
          The email opened by <b>Generate email…</b> on a PacBio credit case. Edit the recipients, subject and body,
          and drop in variables that get filled from the failing cell. The preview shows the email with example values
          so you can check the variables are right.
        </p>
      </div>

      {query.isError && (
        <Note tone="bad" icon="!">
          {query.error instanceof ApiError ? query.error.message : "Failed to load the email template."}
        </Note>
      )}

      {form && preview && (
        <>
          <div className={styles.chipRow}>
            <span className={styles.chipLabel}>Insert variable:</span>
            {CREDIT_EMAIL_TOKENS.map((t) => (
              <button
                key={t.token}
                type="button"
                className={styles.chip}
                // Keep the focused field focused so we insert at its cursor, not lose it.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertToken(t.token)}
                title={`${t.label} — inserts ${t.token}`}
              >
                {t.token}
              </button>
            ))}
          </div>

          <div className={styles.fields}>
            {FIELDS.map((f) => (
              <label key={f.key} className={styles.field}>
                <span className={styles.fieldLabel}>{f.label}</span>
                {f.multiline ? (
                  <textarea
                    className={styles.textarea}
                    value={form[f.key]}
                    rows={7}
                    onFocus={(e) => {
                      activeElRef.current = e.currentTarget;
                      activeKeyRef.current = f.key;
                    }}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                ) : (
                  <input
                    type="text"
                    className={styles.input}
                    value={form[f.key]}
                    onFocus={(e) => {
                      activeElRef.current = e.currentTarget;
                      activeKeyRef.current = f.key;
                    }}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                )}
              </label>
            ))}
          </div>

          <div className={styles.preview}>
            <div className={styles.previewHead}>
              Preview <span className={styles.previewNote}>— variables filled with example values</span>
            </div>
            <dl className={styles.previewMail}>
              <dt>To</dt>
              <dd>{preview.to || "—"}</dd>
              <dt>Cc</dt>
              <dd>{preview.cc || "—"}</dd>
              <dt>Subject</dt>
              <dd>{preview.subject || "—"}</dd>
              <dt>Body</dt>
              <dd className={styles.previewBody}>{preview.body || "—"}</dd>
            </dl>
            <div className={styles.legend}>
              {CREDIT_EMAIL_TOKENS.map((t) => (
                <div key={t.token} className={styles.legendRow}>
                  <code className={styles.legendToken}>{t.token}</code>
                  <span className={styles.legendArrow}>→</span>
                  <span className={styles.legendLabel}>{t.label}:</span>
                  <span className={styles.legendValue}>{EXAMPLE_CONTEXT[t.field]}</span>
                </div>
              ))}
            </div>
          </div>

          {mutation.isError && (
            <Note tone="bad" icon="!">
              {mutation.error instanceof ApiError ? mutation.error.message : "Failed to save the email template."}
            </Note>
          )}

          <div className={styles.actions}>
            {!dirty && !mutation.isPending && <span className={styles.savedNote}>All changes saved</span>}
            <Button
              variant="primary"
              size="sm"
              disabled={!dirty || mutation.isPending}
              onClick={() => form && mutation.mutate(form)}
            >
              {mutation.isPending ? "Saving…" : "Save email template"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
