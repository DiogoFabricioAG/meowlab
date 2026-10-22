export const BURST_IDLE_MS = 3e3;
export const BURST_MAX_WAIT_MS = 1e4;
export const BURST_MAX_MESSAGES = 20;
export const BURST_MAX_CHARS = 8e3;
export function burstKey(tenantId, message) {
  return JSON.stringify([tenantId, message.phoneNumberId, message.to]);
}
export function isBurstText(message) {
  return message.inputType === "text" && !message.interactionId;
}
export function planBurst(entries, now) {
  if (!entries.length) return null;
  const first = entries[0];
  if (!isBurstText(first.message)) return { entries: [first], due: now };
  const batch = [];
  let chars = 0;
  for (const entry of entries) {
    if (!isBurstText(entry.message) || batch.length === BURST_MAX_MESSAGES || batch.length > 0 && (entry.received > batch.at(-1).received + BURST_IDLE_MS || entry.received > first.received + BURST_MAX_WAIT_MS) || chars + entry.message.text.length + (batch.length ? 1 : 0) > BURST_MAX_CHARS) break;
    batch.push(entry);
    chars += entry.message.text.length + (batch.length > 1 ? 1 : 0);
  }
  const boundary = batch.length < entries.length || batch.length === BURST_MAX_MESSAGES;
  return { entries: batch, due: boundary ? now : Math.min(first.received + BURST_MAX_WAIT_MS, batch.at(-1).received + BURST_IDLE_MS) };
}
