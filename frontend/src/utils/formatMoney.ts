/** Formats a USD amount as e.g. "$1,234" (rounded to the nearest dollar). */
export function formatMoney(amount: number): string {
  return `$${Math.round(amount).toLocaleString("en-US")}`;
}
