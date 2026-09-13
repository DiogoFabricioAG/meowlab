import type { WhatsAppClient } from "../../whatsapp/contracts";
import { MetaWhatsAppClient } from "./meta-client";

type WhatsAppLogger = (
  event: string,
  details?: Record<string, unknown>,
) => void;

export function createWhatsAppClient(
  accessToken: string | undefined,
  graphApiVersion: string | undefined,
  log: WhatsAppLogger,
): WhatsAppClient {
  return new MetaWhatsAppClient({ accessToken, graphApiVersion }, log);
}
