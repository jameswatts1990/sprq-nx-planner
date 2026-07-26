import styles from "./SegmentedControl.module.css";

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: string;
  hint?: string;
}

export interface SegmentedControlProps<T extends string | number> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
  /** Stretch to fill the container, with each option sharing the width equally, instead
   * of sizing to its content. */
  fullWidth?: boolean;
}

export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
  fullWidth = false,
}: SegmentedControlProps<T>) {
  return (
    <div className={fullWidth ? `${styles.seg} ${styles.segFull}` : styles.seg} role="group" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={String(opt.value)}
          type="button"
          className={styles.segOpt}
          aria-pressed={opt.value === value}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
          {opt.hint && <small>{opt.hint}</small>}
        </button>
      ))}
    </div>
  );
}
