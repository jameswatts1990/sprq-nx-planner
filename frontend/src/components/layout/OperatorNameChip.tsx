import { type FormEvent, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { CheckIcon, ChevronDownIcon, CrossIcon, PlusIcon, SignOutIcon, UserIcon } from "@/components/shared/icons";
import { Button } from "@/components/ui/Button";
import { Modal, ModalActions } from "@/components/ui/Modal";
import { useMenuDismiss } from "@/components/ui/useMenuDismiss";
import {
  forgetOperatorName,
  OPERATOR_NAME_MAX,
  setOperatorName,
  useOperatorName,
  useOperatorNames,
} from "@/utils/operatorName";

import styles from "./AppShell.module.css";

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });

/** The nav's "who am I" chip: the operator name every change is signed with (utils/operatorName),
 * or an amber "Set your name" until one is set. It opens a drop-down of the names used in this
 * browser - just the owner on their own computer, everyone who uses a shared one - to switch
 * person, × a name off the list, add "Someone else…" or sign out. A browser with no names yet
 * goes straight to typing one. The same disclosure pattern as the History menu (plain buttons,
 * not an ARIA menu). */
export function OperatorNameChip() {
  const name = useOperatorName();
  const names = [...useOperatorNames()].sort(byName);
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useMenuDismiss(open, setOpen, wrapRef, triggerRef);
  const hasMenu = names.length > 0;

  function choose(next: string) {
    setOperatorName(next);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function forget(n: string) {
    flushSync(() => forgetOperatorName(n));
    // The × that had focus went with its row: keep keyboard focus in the menu.
    menuRef.current?.querySelector<HTMLElement>("button")?.focus();
  }

  function typeNewName() {
    // Focus the chip first, so the modal hands focus back to it (this item unmounts with the menu).
    triggerRef.current?.focus();
    setOpen(false);
    setTyping(true);
  }

  return (
    <>
      <div className={`${styles.menuWrap} ${styles.operatorWrap}`} ref={wrapRef}>
        <button
          type="button"
          ref={triggerRef}
          className={name ? styles.operator : `${styles.operator} ${styles.operatorUnset}`}
          aria-expanded={hasMenu ? open : undefined}
          aria-controls={hasMenu ? menuId : undefined}
          aria-haspopup={hasMenu ? undefined : "dialog"}
          aria-label={name ? `Your name: ${name}` : "Set your name"}
          onClick={() => (hasMenu ? setOpen((v) => !v) : setTyping(true))}
          title={
            name
              ? `Your changes are signed “${name}” in History → Activity. Click to switch person or sign out.`
              : "Set your name so History → Activity shows who made each change."
          }
        >
          <UserIcon />
          <span className={styles.operatorName}>{name || "Set your name"}</span>
          {hasMenu && (
            <span className={styles.chevron}>
              <ChevronDownIcon />
            </span>
          )}
        </button>
        {open && (
          <div id={menuId} ref={menuRef} className={`${styles.menu} ${styles.operatorMenu}`}>
            {hasMenu && (
              <>
                <p className={styles.operatorCaption}>Who&apos;s using this computer?</p>
                <div className={styles.operatorList}>
                  {names.map((n) => (
                    <div key={n} className={n === name ? `${styles.operatorRow} ${styles.operatorRowActive}` : styles.operatorRow}>
                      <button
                        type="button"
                        className={`${styles.menuButton} ${styles.operatorChoose}`}
                        aria-current={n === name || undefined}
                        onClick={() => choose(n)}
                      >
                        <span className={styles.operatorMark}>{n === name && <CheckIcon />}</span>
                        <span className={`${styles.menuLabel} ${styles.operatorName}`}>{n}</span>
                      </button>
                      <button
                        type="button"
                        className={styles.operatorForget}
                        aria-label={`Remove ${n} from this computer`}
                        title={`Remove “${n}” from this computer's list`}
                        onClick={() => forget(n)}
                      >
                        <CrossIcon />
                      </button>
                    </div>
                  ))}
                </div>
                <div className={styles.menuDivider} />
              </>
            )}
            <button type="button" className={`${styles.menuItem} ${styles.menuButton}`} onClick={typeNewName}>
              <span className={styles.operatorMark}>
                <PlusIcon />
              </span>
              <span className={styles.menuText}>
                <span className={styles.menuLabel}>Someone else…</span>
                <span className={styles.menuHint}>Add a name to this computer&apos;s list</span>
              </span>
            </button>
            {name && (
              <button type="button" className={`${styles.menuItem} ${styles.menuButton}`} onClick={() => choose("")}>
                <span className={styles.operatorMark}>
                  <SignOutIcon />
                </span>
                <span className={styles.menuText}>
                  <span className={styles.menuLabel}>Sign out</span>
                  <span className={styles.menuHint}>Leave this computer unsigned — your name stays listed</span>
                </span>
              </button>
            )}
          </div>
        )}
      </div>
      {typing && <OperatorNameModal onClose={() => setTyping(false)} />}
    </>
  );
}

function OperatorNameModal({ onClose }: { onClose: () => void }) {
  const [draft, setDraft] = useState("");

  function save(e: FormEvent) {
    e.preventDefault();
    setOperatorName(draft);
    onClose();
  }

  return (
    <Modal title="Your name" onClose={onClose} maxWidth={420}>
      <form onSubmit={save}>
        <p className={styles.operatorHelp}>
          Every change you make is signed with this name in <b>History → Activity</b>. It also fills in{" "}
          <b>Your name</b> when you confirm a run loaded, and the owner of a new credit case. It&apos;s remembered on
          this computer only — on a shared one, everyone&apos;s name stays in the name chip&apos;s list, so next time
          you can just pick yours.
        </p>
        <label className="fieldLabel" htmlFor="operator-name">
          Name
        </label>
        <input
          id="operator-name"
          type="text"
          className={styles.operatorInput}
          value={draft}
          maxLength={OPERATOR_NAME_MAX}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. Jo Bloggs"
          autoComplete="name"
          autoFocus
        />
        <ModalActions>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!draft.trim()}>
            Save
          </Button>
        </ModalActions>
      </form>
    </Modal>
  );
}
