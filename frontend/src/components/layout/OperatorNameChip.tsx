import { type FormEvent, useState } from "react";

import { UserIcon } from "@/components/shared/icons";
import { Button } from "@/components/ui/Button";
import { Modal, ModalActions } from "@/components/ui/Modal";
import { OPERATOR_NAME_MAX, setOperatorName, useOperatorName } from "@/utils/operatorName";

import styles from "./AppShell.module.css";

/** The nav's "who am I" chip: the operator name every change is signed with (utils/operatorName),
 * or an amber "Set your name" until one is set. Click to set or change it. */
export function OperatorNameChip() {
  const name = useOperatorName();
  const [editing, setEditing] = useState(false);

  return (
    <>
      <button
        type="button"
        className={name ? styles.operator : `${styles.operator} ${styles.operatorUnset}`}
        onClick={() => setEditing(true)}
        title={
          name
            ? `Your changes are signed “${name}” in History → Activity. Click to change.`
            : "Set your name so History → Activity shows who made each change."
        }
      >
        <UserIcon />
        <span className={styles.operatorName}>{name || "Set your name"}</span>
      </button>
      {editing && <OperatorNameModal current={name} onClose={() => setEditing(false)} />}
    </>
  );
}

function OperatorNameModal({ current, onClose }: { current: string; onClose: () => void }) {
  const [draft, setDraft] = useState(current);

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
          <b>Your name</b> when you confirm a run loaded, and the owner of a new credit case. It's remembered in
          this browser only.
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
          <Button type="submit" variant="primary">
            Save
          </Button>
        </ModalActions>
      </form>
    </Modal>
  );
}
