/** Renders a label such as "Target OPLC (pM)" so its trailing "(unit)" keeps its real case
 * inside an uppercase label (.fieldLabel, table headers): uppercased, "pM" would read "PM" and
 * "uL" "UL" - a different unit, not just a style. Text without a trailing "(…)" renders as is. */
export function UnitLabel({ text }: { text: string }) {
  const match = /^(.*?)(\s*\([^()]+\))$/.exec(text);
  if (!match) return <>{text}</>;
  return (
    <>
      {match[1]}
      <span className="unit">{match[2]}</span>
    </>
  );
}
