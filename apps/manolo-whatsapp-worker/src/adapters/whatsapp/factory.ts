import type { WhatsAppClient } from "../../whatsapp/contracts";
import { MetaWhatsAppClient } from "./meta-client";

type WhatsAppLogger = (
  event: string,
  details?: Record<string, unknown>,
) => void;

/** Comma-separated Meta phone_number_ids that are connected through Kapso. */
export function kapsoPhoneNumberIds(value: string | undefined): ReadonlySet<string> {
  return new Set((value ?? "").split(",").map((id) => id.trim()).filter((id) => /^\d{5,32}$/.test(id)));
}

export function createWhatsAppClient(
  accessToken: string | undefined,
  graphApiVersion: string | undefined,
  log: WhatsAppLogger,
  kapso?: { apiKey?: string; phoneNumberIds: ReadonlySet<string> },
): WhatsAppClient {
  return new MetaWhatsAppClient({ accessToken, graphApiVersion, kapso }, log);
}
