/** Automatic discovery alerts only. Conversational replies are never paced here. */
export const ALERT_INTERVAL_MS = 30 * 60_000;
const DAY = 86_400_000;
const PERU_OFFSET = 5 * 3_600_000;

/** Peru uses UTC-5 throughout the year. The permitted interval is [08:00,20:00). */
export function nextAlertTime(time: number): number {
  const start = Math.floor((time - PERU_OFFSET) / DAY) * DAY + PERU_OFFSET;
  const opening = start + 8 * 3_600_000;
  const closing = start + 20 * 3_600_000;
  return time < opening ? opening : time >= closing ? opening + DAY : time;
}
