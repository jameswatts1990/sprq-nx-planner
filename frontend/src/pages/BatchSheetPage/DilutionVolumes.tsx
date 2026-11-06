import type { BatchSheetWellOut } from "@/types/batchSheet";

import { liquidLevel } from "./tractionEntry";
import styles from "./DilutionVolumes.module.css";

type Kind = "complex" | "buffer";

const VOLUMES: Record<Kind, { name: string; fullName: string }> = {
  complex: { name: "Complex", fullName: "Cleaned complex volume for desired OPLC" },
  buffer: { name: "Buffer", fullName: "Loading buffer volume" },
};

/* Both vessels share a 44x58 viewBox. Liquid is drawn as the vessel's own interior up to `top`,
   so it needs no clip path (and no per-instance ids). */

/** The cleaned complex: a round-bottomed test tube with a lip. Interior x 14-30, y 7-53. */
function Tube({ level }: { level: number | null }) {
  const top = level == null ? null : (53 - level * 44).toFixed(1);
  return (
    <svg className={styles.vessel} viewBox="0 0 44 58" data-empty={level == null} aria-hidden="true">
      {top != null && <path className={styles.complexLiquid} d={`M14 ${top}H30V45A8 8 0 0 1 14 45Z`} />}
      <path className={styles.outline} d="M14 7V45A8 8 0 0 0 30 45V7" />
      <rect className={styles.outline} x="11" y="3.5" width="22" height="3.5" rx="1.5" />
    </svg>
  );
}

/** The loading buffer: a wide, flat-bottomed screw-cap vial. Straight body x 6-38, y 23-55. */
function Vial({ level }: { level: number | null }) {
  const top = level == null ? null : (55 - level * 31).toFixed(1);
  return (
    <svg className={styles.vessel} viewBox="0 0 44 58" data-empty={level == null} aria-hidden="true">
      {top != null && <path className={styles.bufferLiquid} d={`M6 ${top}H38V51Q38 55 34 55H10Q6 55 6 51Z`} />}
      <path
        className={styles.outline}
        d="M16 11V14C16 18 6 18 6 23V51Q6 55 10 55H34Q38 55 38 51V23C38 18 28 18 28 14V11Z"
      />
      <rect className={styles.outline} x="13" y="2" width="18" height="9" rx="2" />
    </svg>
  );
}

function VolumeTile({ kind, value, other }: { kind: Kind; value: number | null; other: number | null }) {
  const { name, fullName } = VOLUMES[kind];
  const Vessel = kind === "complex" ? Tube : Vial;
  const title =
    value == null
      ? `${fullName} isn't recorded for this sample. Add it by editing the sample, or work it out at the ` +
        `bench: the printed sheet leaves a box to write it in.`
      : `${fullName}: ${value} µL`;

  return (
    <div className={styles.tile} data-missing={value == null} title={title}>
      <span className={styles.name}>{name}</span>
      <Vessel level={value == null ? null : liquidLevel(value, other)} />
      {value == null ? (
        <span className={styles.missing}>
          Not
          <br />
          recorded
        </span>
      ) : (
        <span className={styles.value}>
          {value}
          <span className={styles.unit}>µL</span>
        </span>
      )}
    </div>
  );
}

/** A well's SOP 7.3 loading-dilution volumes, drawn as the vessels they're pipetted from: the
 * cleaned complex in a tube (light magenta, as it's the sample) and the loading buffer in a vial
 * (grey). Bench values, not Traction fields, so they're shown, never copied. Complex comes first,
 * matching the printed worksheet's column order. */
export function DilutionVolumes({ well }: { well: BatchSheetWellOut }) {
  const { cleaned_complex_volume: complex, loading_buffer_volume: buffer } = well;
  return (
    <div className={styles.volumes}>
      <VolumeTile kind="complex" value={complex} other={buffer} />
      <VolumeTile kind="buffer" value={buffer} other={complex} />
    </div>
  );
}
