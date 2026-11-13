import type { IncomingMessage } from "../roles/contracts";

export const BURST_IDLE_MS = 3000;
export const BURST_MAX_WAIT_MS = 10000;
export const BURST_MAX_MESSAGES = 20;
export const BURST_MAX_CHARS = 8000;
export const BURST_MAX_IMAGES = 3;
export type BurstEntry = { seq: number; received: number; message: IncomingMessage };

export function burstKey(tenantId: string, message: IncomingMessage): string {
  return JSON.stringify([tenantId, message.phoneNumberId, message.to]);
}

export function isBurstText(message: IncomingMessage): boolean {
  return message.inputType === "text" && !message.interactionId;
}
export function isBurstContent(message: IncomingMessage): boolean {
  return !message.interactionId && (message.inputType === "text" || message.inputType === "image");
}

// Buttons, audio and documents are FIFO barriers. Images join adjacent text.
export function planBurst(entries: readonly BurstEntry[], now: number) {
  if (!entries.length) return null;
  const first = entries[0];
  if (!isBurstContent(first.message)) return { entries: [first], due: now };
  const batch: BurstEntry[] = [];
  let chars = 0;
  let images = 0;
  for (const entry of entries) {
    if (!isBurstContent(entry.message) || batch.length === BURST_MAX_MESSAGES
      || (entry.message.inputType === "image" && images === BURST_MAX_IMAGES)
      || (batch.length > 0 && (entry.received > batch.at(-1)!.received + BURST_IDLE_MS
        || entry.received > first.received + BURST_MAX_WAIT_MS))
      || chars + entry.message.text.length + (batch.length ? 1 : 0) > BURST_MAX_CHARS) break;
    batch.push(entry);
    if (entry.message.inputType === "image") images++;
    chars += entry.message.text.length + (batch.length > 1 ? 1 : 0);
  }
  const boundary = batch.length < entries.length || batch.length === BURST_MAX_MESSAGES;
  return { entries: batch, due: boundary ? now
    : Math.min(first.received + BURST_MAX_WAIT_MS, batch.at(-1)!.received + BURST_IDLE_MS) };
}
