import styles from "./ChipMultiSelect.module.css";

export interface ChipMultiSelectProps {
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Minimum number of selections that must remain active; default 1. */
  min?: number;
}

export function ChipMultiSelect({ options, selected, onChange, min = 1 }: ChipMultiSelectProps) {
  function toggle(option: string) {
    const isOn = selected.includes(option);
    if (isOn) {
      if (selected.length <= min) return;
      onChange(selected.filter((o) => o !== option));
    } else {
      onChange([...selected, option]);
    }
  }

  return (
    <div className={styles.chips}>
      {options.map((option) => {
        const isOn = selected.includes(option);
        return (
          <button
            key={option}
            type="button"
            className={styles.chip}
            aria-pressed={isOn}
            disabled={isOn && selected.length <= min}
            onClick={() => toggle(option)}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}
