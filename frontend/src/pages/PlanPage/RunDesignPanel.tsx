import { useQuery } from "@tanstack/react-query";

import { instrumentsApi } from "@/api/instruments";
import { ChipMultiSelect } from "@/components/ui/ChipMultiSelect";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Note } from "@/components/ui/Note";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type { MaxUses, Objective, RunDesignSettings, RunTimeHours } from "@/types/schedule";

import styles from "./RunDesignPanel.module.css";

export interface RunDesignPanelProps {
  settings: RunDesignSettings;
  onChange: (next: RunDesignSettings) => void;
}

const MAX_USES_OPTIONS = [
  { value: 1 as MaxUses, label: "1×" },
  { value: 2 as MaxUses, label: "2×" },
  { value: 3 as MaxUses, label: "3×" },
];

const RUN_TIME_OPTIONS = [
  { value: 12 as RunTimeHours, label: "12 h" },
  { value: 24 as RunTimeHours, label: "24 h" },
  { value: 30 as RunTimeHours, label: "30 h" },
];

const OBJECTIVE_OPTIONS = [
  { value: "fewest" as Objective, label: "Fewest cells", hint: "lowest cost" },
  { value: "balance" as Objective, label: "Balance", hint: "cost + speed" },
  { value: "fastest" as Objective, label: "Fastest", hint: "fewest days" },
];

export function RunDesignPanel({ settings, onChange }: RunDesignPanelProps) {
  const instrumentsQuery = useQuery({
    queryKey: ["instruments", true],
    queryFn: () => instrumentsApi.list(true),
  });

  const options = (instrumentsQuery.data ?? []).map((i) => i.serial_number);

  return (
    <Card>
      <CardHeader badge="recalculates live">
        <h2>Run design</h2>
      </CardHeader>
      <CardBody>
        <div className={styles.field}>
          <div className={styles.fieldLabel}>
            Instruments running <span className={styles.hint}>select 1-4</span>
          </div>
          {instrumentsQuery.isLoading && <div className={styles.instrumentsStatus}>Loading instruments…</div>}
          {instrumentsQuery.isError && (
            <Note tone="bad" icon="!">
              Failed to load instruments.
            </Note>
          )}
          {!instrumentsQuery.isLoading && !instrumentsQuery.isError && options.length === 0 && (
            <div className={styles.instrumentsStatus}>No active instruments configured.</div>
          )}
          {options.length > 0 && (
            <ChipMultiSelect
              options={options}
              selected={settings.instrument_ids}
              onChange={(next) => onChange({ ...settings, instrument_ids: next })}
              min={1}
            />
          )}
        </div>

        <div className={styles.field}>
          <div className={styles.fieldLabel}>
            Max uses per cell <span className={styles.hint}>multi-use cap</span>
          </div>
          <SegmentedControl
            ariaLabel="Max uses per cell"
            options={MAX_USES_OPTIONS}
            value={settings.max_uses}
            onChange={(v) => onChange({ ...settings, max_uses: v })}
          />
        </div>

        <div className={styles.field}>
          <div className={styles.fieldLabel}>Movie / run time</div>
          <SegmentedControl
            ariaLabel="Run time"
            options={RUN_TIME_OPTIONS}
            value={settings.run_time_hours}
            onChange={(v) => onChange({ ...settings, run_time_hours: v })}
          />
        </div>

        <div className={styles.field}>
          <div className={styles.fieldLabel}>Start date</div>
          <input
            type="date"
            className={styles.dateInput}
            value={settings.start_date}
            onChange={(e) => onChange({ ...settings, start_date: e.target.value })}
          />
        </div>

        <div className={styles.field}>
          <div className={styles.fieldLabel}>Optimise for</div>
          <SegmentedControl
            ariaLabel="Optimisation objective"
            options={OBJECTIVE_OPTIONS}
            value={settings.objective}
            onChange={(v) => onChange({ ...settings, objective: v })}
          />
        </div>
      </CardBody>
    </Card>
  );
}
