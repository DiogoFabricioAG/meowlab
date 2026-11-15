import type { CollectionsSettings, ReminderTone } from "./bridge-contracts";

/**
 * When Collections Cat reminds, how firm it sounds and when a debt goes to the owner
 * (ADR-0015, points 5, 6, 8 and 18). Dates are Lima calendar dates (YYYY-MM-DD).
 */
const LIMA_OFFSET_MS = 5 * 3_600_000;
const DAY_MS = 86_400_000;

export const limaDate = (instant: Date) => new Date(instant.getTime() - LIMA_OFFSET_MS).toISOString().slice(0, 10);
export const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

export type ScheduleDebt = { dueOn: string; remindersSent: number; lastReminderOn: string | null };
type Rules = Pick<CollectionsSettings, "remindBeforeDays" | "remindEveryDays" | "maxReminders">;

/** The day the next reminder is due: before the due date, on it, then every few days. */
export function nextReminderOn(debt: ScheduleDebt, rules: Rules): string | null {
  if (debt.remindersSent >= rules.maxReminders) return null;
  if (!debt.lastReminderOn) return addDays(debt.dueOn, -rules.remindBeforeDays);
  if (debt.lastReminderOn < debt.dueOn) return debt.dueOn;
  return addDays(debt.lastReminderOn, rules.remindEveryDays);
}

export function dueForReminder(debt: ScheduleDebt, rules: Rules, today: string, doNotContact: boolean): boolean {
  const next = nextReminderOn(debt, rules);
  return !doNotContact && next !== null && next <= today;
}

/** Friendly until it is due, firm after, a last notice for the final reminder or a month late. */
export function toneFor(daysLate: number, remindersSent: number, maxReminders: number): ReminderTone {
  if (daysLate <= 0) return "friendly";
  if (remindersSent >= maxReminders - 1 || daysLate > 30) return "final";
  return "firm";
}

/**
 * The cat cannot do more: a late debt that used up its reminders, had time to answer the last
 * one and got no payment since, or whose customer asked not to be written to.
 */
export function needsOwner(
  debt: ScheduleDebt & { lastPaymentOn: string | null },
  rules: Rules,
  today: string,
  doNotContact: boolean,
): boolean {
  if (debt.dueOn >= today) return false;
  if (doNotContact) return true;
  if (debt.remindersSent < rules.maxReminders || !debt.lastReminderOn) return false;
  if (debt.lastPaymentOn && debt.lastPaymentOn >= debt.lastReminderOn) return false;
  return addDays(debt.lastReminderOn, rules.remindEveryDays) <= today;
}

export type AgingBucket = "current" | "d1_30" | "d31_60" | "d61";
export function agingBucket(daysLate: number): AgingBucket {
  return daysLate <= 0 ? "current" : daysLate <= 30 ? "d1_30" : daysLate <= 60 ? "d31_60" : "d61";
}

/** Inside the company's hours and not on a Sunday when it skips them (Lima time). */
export function insideWindow(now: Date, rules: Pick<CollectionsSettings, "windowStartHour" | "windowEndHour" | "skipSundays">): boolean {
  const lima = new Date(now.getTime() - LIMA_OFFSET_MS);
  if (rules.skipSundays && lima.getUTCDay() === 0) return false;
  const hour = lima.getUTCHours();
  return hour >= rules.windowStartHour && hour < rules.windowEndHour;
}
