import type { CreditEmailTemplate } from "@/api/settings";
import type { CellDetailOut } from "@/types/cell";
import { expectedReimbursement, triggeringUse } from "@/utils/creditCase";
import { plateWellFromPlate } from "@/utils/plateWell";
import { runLabel } from "@/utils/runLabel";

/** The one email the app sends — the PacBio SMRT-cell credit request — is template-driven:
 * its to/cc/subject/body live in an editable AppSetting and may embed <angle-bracket>
 * variables that are filled from the failing cell's triggering use when the email is built.
 *
 * This module is the single source of truth for that variable set, so the admin "Email
 * template" panel (which previews the tokens against example values) and the real email
 * builder in CreditCaseActions can never disagree about which tokens exist or what they mean. */

function formatDateTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "—";
}

/** The values a template's tokens resolve against — either a real failing cell or the
 * example values shown in the admin preview. */
export interface CreditEmailContext {
  sampleName: string;
  run: string;
  instrument: string;
  runDate: string;
  reimbursement: string;
  caseNumber: string;
  well: string;
  cellCode: string;
}

interface CreditEmailToken {
  /** The literal token as typed into the template, e.g. "<sample name>". */
  token: string;
  /** Plain-language name for the admin panel's variable list. */
  label: string;
  /** Which context value fills this token. */
  field: keyof CreditEmailContext;
}

/** Every variable a lab user can drop into the subject/body. Order = display order in the
 * admin panel. `<well>`/`<cell code>` are internal identifiers PacBio's support desk won't
 * recognise, so they're offered but left out of the default template (the Help tab explains
 * this). */
export const CREDIT_EMAIL_TOKENS: readonly CreditEmailToken[] = [
  { token: "<sample name>", label: "Sample name", field: "sampleName" },
  { token: "<run>", label: "Run", field: "run" },
  { token: "<instrument>", label: "Instrument serial", field: "instrument" },
  { token: "<run date>", label: "Run date", field: "runDate" },
  { token: "<reimbursement>", label: "Expected acquisitions to credit", field: "reimbursement" },
  { token: "<case number>", label: "PacBio case number", field: "caseNumber" },
  { token: "<well>", label: "Tray well (internal)", field: "well" },
  { token: "<cell code>", label: "Cell code (internal)", field: "cellCode" },
];

/** Example values for the admin preview — chosen to look like real lab data so the user can
 * confirm each token resolves to the field they expect before saving. */
export const EXAMPLE_CONTEXT: CreditEmailContext = {
  sampleName: "HG01234",
  run: "TRACTION-RUN-1234",
  instrument: "R-84021",
  runDate: "24/07/2026, 14:32",
  reimbursement: "2",
  caseNumber: "CS-000123",
  well: "P1_C01",
  cellCode: "C-000045",
};

/** Built-in template used until the lab edits it, and as a fallback while the stored
 * template is still loading so the "Generate email…" button always works. Kept in step with
 * the backend's CREDIT_EMAIL_FALLBACKS (settings_service.py). */
export const DEFAULT_CREDIT_EMAIL: CreditEmailTemplate = {
  to: "Pacific Biosciences <support@pacificbiosciences.com>",
  cc: "revio-updates@sanger.ac.uk",
  subject: "SMRT Cell issue – <run>",
  body: [
    "Cell issue on sample <sample name>, run <run>, <instrument>, <run date>.",
    "",
    "Please advise on how to proceed. If the cell will be credited, please can you confirm the number of acquisitions that are being credited.",
    "",
    "Based on the failure, we expect <reimbursement> acquisition(s) to be credited (the failed acquisition plus the cell's remaining acquisitions).",
    "",
    "Sample ID: <sample name>",
  ].join("\n"),
};

/** Build the fill-in values for the credit email from the failing cell's triggering use.
 * PacBio's support desk doesn't know our internal tray/well/cell codes, so the customer
 * sample and vendor-visible fields (run, serial, date) are the ones the default template
 * uses — the internal codes are only available for labs that want them. */
export function buildCreditEmailContext(cell: CellDetailOut): CreditEmailContext {
  const use = triggeringUse(cell.use_history);
  const reimbursement = expectedReimbursement(cell);
  return {
    sampleName: use?.sample_external_id || "—",
    run: use ? runLabel({ run_id: use.run_batch_id, run_name: use.run_name }) : "—",
    instrument: use?.instrument_serial ?? "—",
    runDate: use ? formatDateTime(use.started_at ?? use.completed_at) : "—",
    reimbursement: reimbursement == null ? "—" : String(reimbursement),
    caseNumber: cell.pacbio_case_number ?? "—",
    well: use ? plateWellFromPlate(use.plate_index, use.well, { qualified: true }) : "—",
    cellCode: cell.code,
  };
}

/** Replace every known <token> in a string with its context value. Literal replacement of a
 * fixed token set — unknown angle-bracket text is left untouched so ordinary "<" in prose
 * survives. */
function fill(text: string, ctx: CreditEmailContext): string {
  let out = text;
  for (const { token, field } of CREDIT_EMAIL_TOKENS) {
    out = out.split(token).join(ctx[field]);
  }
  return out;
}

/** Render a stored template against a context into the four ready-to-send email parts. */
export function renderCreditEmail(
  template: CreditEmailTemplate,
  ctx: CreditEmailContext,
): CreditEmailTemplate {
  return {
    to: fill(template.to, ctx),
    cc: fill(template.cc, ctx),
    subject: fill(template.subject, ctx),
    body: fill(template.body, ctx),
  };
}

/** A mailto: href for the rendered email. Body line breaks are sent as CRLF: Outlook
 * (classic + new) drops or truncates a mailto body whose breaks are %0A rather than %0D%0A. */
export function creditEmailMailto(email: CreditEmailTemplate): string {
  const body = email.body.replace(/\r?\n/g, "\r\n");
  return (
    `mailto:${encodeURIComponent(email.to)}` +
    `?cc=${encodeURIComponent(email.cc)}` +
    `&subject=${encodeURIComponent(email.subject)}` +
    `&body=${encodeURIComponent(body)}`
  );
}
