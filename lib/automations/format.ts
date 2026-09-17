/**
 * Display strings for facts.
 *
 * Dates are formatted by hand, in UTC. The record is fixed demo data, so a
 * reply that reads differently depending on the tester's clock or locale is
 * only confusing. "17 Sep 2026" is the same sentence everywhere.
 */

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "1 Oct 2026" */
export function day(iso: string): string {
  const at = new Date(iso);
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}`;
}

/** "17 Sep 2026 at 19:31 UTC" */
export function moment(iso: string): string {
  const at = new Date(iso);
  const hours = String(at.getUTCHours()).padStart(2, "0");
  const minutes = String(at.getUTCMinutes()).padStart(2, "0");
  return `${day(iso)} at ${hours}:${minutes} UTC`;
}

/** "$180" for dollars, "180 EUR" for anything else. */
export function money(amount: number, currency: string): string {
  const rounded = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  return currency === "USD" ? `$${rounded}` : `${rounded} ${currency}`;
}

/** True when `iso` is still in the future. */
export function stillValid(iso: string, now = Date.now()): boolean {
  return new Date(iso).getTime() > now;
}

/** "a, b and c" */
export function list(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * A field name or an enum value, as words a customer can read.
 * `too_many_failed_attempts` and `productUpdates` both come out as prose.
 */
export function words(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .toLowerCase();
}

/** An ISO timestamp this many hours from now. */
export function hoursFromNow(hours: number, now = Date.now()): string {
  return new Date(now + hours * 3_600_000).toISOString();
}
