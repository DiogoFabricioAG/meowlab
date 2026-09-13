import type {
  WhatsAppClient,
  WhatsAppDownloadedMedia,
  WhatsAppMediaMetadata,
  WhatsAppReplyButton,
  WhatsAppListSection,
  WhatsAppSendResult,
} from "../../whatsapp/contracts";

const GRAPH_API_BASE_URL = "https://graph.facebook.com";
const MAX_MEDIA_BYTES = 16 * 1024 * 1024;
const MAX_IMAGE_CAPTION_LENGTH = 1_024;
const MAX_BUTTONS = 3;
const MAX_BUTTON_ID_LENGTH = 256;
const MAX_BUTTON_TITLE_LENGTH = 20;
const MAX_LIST_SECTIONS = 10;
const MAX_LIST_ROWS = 10;
const MAX_LIST_BUTTON_LENGTH = 20;
const MAX_LIST_ROW_TITLE_LENGTH = 24;
const MAX_LIST_ROW_DESCRIPTION_LENGTH = 72;
const DEFAULT_MEDIA_MIME_TYPE = "audio/ogg";

type WhatsAppLogger = (
  event: string,
  details?: Record<string, unknown>,
) => void;

type MetaClientConfig = {
  accessToken?: string;
  graphApiVersion?: string;
};

type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number | null {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function isSafeMediaUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

async function readBytesWithLimit(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const contentLength = Number.parseInt(
    response.headers.get("Content-Length") ?? "",
    10,
  );
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return null;
  }

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.byteLength <= maxBytes ? bytes : null;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }

      totalBytes += result.value.byteLength;
      if (totalBytes > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // The response is already being discarded.
        }
        return null;
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export class MetaWhatsAppClient implements WhatsAppClient {
  constructor(
    private readonly config: MetaClientConfig,
    private readonly log: WhatsAppLogger,
  ) {}

  private isConfigured(phoneNumberId?: string): boolean {
    return Boolean(
      this.config.accessToken?.trim() &&
        this.config.graphApiVersion?.trim() &&
        phoneNumberId?.trim(),
    );
  }

  private endpoint(phoneNumberId: string, resource: string): string {
    return `${GRAPH_API_BASE_URL}/${encodeURIComponent(this.config.graphApiVersion ?? "")}/${encodeURIComponent(phoneNumberId)}/${resource}`;
  }

  async sendTypingIndicator(
    messageId: string,
    phoneNumberId: string,
  ): Promise<boolean> {
    if (!this.isConfigured(phoneNumberId) || !messageId.trim()) {
      this.log("whatsapp_typing_indicator_skipped", {
        reason: "missing_configuration_or_message_id",
      });
      return false;
    }

    try {
      const response = await fetch(this.endpoint(phoneNumberId, "messages"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          status: "read",
          message_id: messageId,
          typing_indicator: { type: "text" },
        }),
      });

      if (!response.ok) {
        this.log("whatsapp_typing_indicator_failed", {
          reason: "graph_api_error",
          status: response.status,
        });
        return false;
      }

      this.log("whatsapp_typing_indicator_sent", { status: response.status });
      return true;
    } catch {
      this.log("whatsapp_typing_indicator_failed", {
        reason: "graph_api_request_error",
      });
      return false;
    }
  }

  async sendText(
    to: string,
    body: string,
    phoneNumberId: string,
  ): Promise<WhatsAppSendResult> {
    if (!this.isConfigured(phoneNumberId)) {
      this.log("whatsapp_reply_skipped", {
        reason: "missing_outbound_configuration",
      });
      return { status: "skipped", metaMessageId: null };
    }

    try {
      const response = await fetch(this.endpoint(phoneNumberId, "messages"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { preview_url: false, body },
        }),
      });
      if (!response.ok) {
        this.log("whatsapp_reply_failed", {
          reason: "graph_api_error",
          status: response.status,
        });
        return { status: "failed", metaMessageId: null };
      }

      const metaMessageId = await this.extractMessageId(response);
      this.log("whatsapp_reply_sent", { status: response.status });
      return { status: "sent", metaMessageId };
    } catch {
      this.log("whatsapp_reply_failed", { reason: "graph_api_request_error" });
      return { status: "failed", metaMessageId: null };
    }
  }

  async sendImage(
    to: string,
    imageUrl: string,
    caption: string,
    phoneNumberId: string,
  ): Promise<WhatsAppSendResult> {
    if (!this.isConfigured(phoneNumberId)) {
      this.log("whatsapp_image_send_skipped", {
        reason: "missing_outbound_configuration",
      });
      return { status: "skipped", metaMessageId: null };
    }

    if (!isSafeMediaUrl(imageUrl)) {
      this.log("whatsapp_image_send_failed", {
        reason: "invalid_image_url",
      });
      return { status: "failed", metaMessageId: null };
    }

    try {
      const response = await fetch(this.endpoint(phoneNumberId, "messages"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "image",
          image: {
            link: imageUrl,
            caption: caption.slice(0, MAX_IMAGE_CAPTION_LENGTH),
          },
        }),
      });
      if (!response.ok) {
        this.log("whatsapp_image_send_failed", {
          reason: "graph_api_error",
          status: response.status,
        });
        return { status: "failed", metaMessageId: null };
      }

      const metaMessageId = await this.extractMessageId(response);
      this.log("whatsapp_image_sent", { status: response.status });
      return { status: "sent", metaMessageId };
    } catch {
      this.log("whatsapp_image_send_failed", {
        reason: "graph_api_request_error",
      });
      return { status: "failed", metaMessageId: null };
    }
  }

  async sendButtons(
    to: string,
    body: string,
    buttons: readonly WhatsAppReplyButton[],
    phoneNumberId: string,
  ): Promise<WhatsAppSendResult> {
    if (!this.isConfigured(phoneNumberId)) {
      this.log("whatsapp_buttons_send_skipped", {
        reason: "missing_outbound_configuration",
      });
      return { status: "skipped", metaMessageId: null };
    }

    const validButtons = buttons
      .slice(0, MAX_BUTTONS)
      .filter(
        (button) =>
          button.id.trim().length > 0 &&
          button.title.trim().length > 0,
      );
    if (validButtons.length === 0) {
      this.log("whatsapp_buttons_send_failed", {
        reason: "invalid_buttons",
      });
      return { status: "failed", metaMessageId: null };
    }

    try {
      const response = await fetch(this.endpoint(phoneNumberId, "messages"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "interactive",
          interactive: {
            type: "button",
            body: { text: body.slice(0, 1_024) },
            action: {
              buttons: validButtons.map((button) => ({
                type: "reply",
                reply: {
                  id: button.id.slice(0, MAX_BUTTON_ID_LENGTH),
                  title: button.title.slice(0, MAX_BUTTON_TITLE_LENGTH),
                },
              })),
            },
          },
        }),
      });
      if (!response.ok) {
        this.log("whatsapp_buttons_send_failed", {
          reason: "graph_api_error",
          status: response.status,
          ...(await this.graphErrorDetails(response)),
        });
        return { status: "failed", metaMessageId: null };
      }

      const metaMessageId = await this.extractMessageId(response);
      this.log("whatsapp_buttons_sent", {
        status: response.status,
        buttonCount: validButtons.length,
      });
      return { status: "sent", metaMessageId };
    } catch {
      this.log("whatsapp_buttons_send_failed", {
        reason: "graph_api_request_error",
      });
      return { status: "failed", metaMessageId: null };
    }
  }

  async sendList(
    to: string,
    body: string,
    buttonText: string,
    sections: readonly WhatsAppListSection[],
    phoneNumberId: string,
  ): Promise<WhatsAppSendResult> {
    if (!this.isConfigured(phoneNumberId)) {
      this.log("whatsapp_list_send_skipped", {
        reason: "missing_outbound_configuration",
      });
      return { status: "skipped", metaMessageId: null };
    }

    const rows = sections
      .slice(0, MAX_LIST_SECTIONS)
      .flatMap((section) => section.rows.slice(0, MAX_LIST_ROWS))
      .slice(0, MAX_LIST_ROWS)
      .filter((row) => row.id.trim().length > 0 && row.title.trim().length > 0);
    if (rows.length === 0 || buttonText.trim().length === 0) {
      this.log("whatsapp_list_send_failed", { reason: "invalid_list" });
      return { status: "failed", metaMessageId: null };
    }

    const validSections = sections
      .slice(0, MAX_LIST_SECTIONS)
      .map((section) => ({
        ...(section.title?.trim()
          ? { title: section.title.slice(0, MAX_LIST_ROW_TITLE_LENGTH) }
          : {}),
        rows: section.rows
          .slice(0, MAX_LIST_ROWS)
          .filter((row) => row.id.trim().length > 0 && row.title.trim().length > 0)
          .map((row) => ({
            id: row.id.slice(0, MAX_BUTTON_ID_LENGTH),
            title: row.title.slice(0, MAX_LIST_ROW_TITLE_LENGTH),
            ...(row.description?.trim()
              ? { description: row.description.slice(0, MAX_LIST_ROW_DESCRIPTION_LENGTH) }
              : {}),
          })),
      }))
      .filter((section) => section.rows.length > 0);

    try {
      const response = await fetch(this.endpoint(phoneNumberId, "messages"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "interactive",
          interactive: {
            type: "list",
            body: { text: body.slice(0, 1_024) },
            action: {
              button: buttonText.slice(0, MAX_LIST_BUTTON_LENGTH),
              sections: validSections,
            },
          },
        }),
      });
      if (!response.ok) {
        this.log("whatsapp_list_send_failed", {
          reason: "graph_api_error",
          status: response.status,
        });
        return { status: "failed", metaMessageId: null };
      }

      const metaMessageId = await this.extractMessageId(response);
      this.log("whatsapp_list_sent", {
        status: response.status,
        rowCount: rows.length,
      });
      return { status: "sent", metaMessageId };
    } catch {
      this.log("whatsapp_list_send_failed", {
        reason: "graph_api_request_error",
      });
      return { status: "failed", metaMessageId: null };
    }
  }

  async sendDocument(
    to: string,
    pdf: Blob,
    filename: string,
    caption: string,
    phoneNumberId: string,
  ): Promise<WhatsAppSendResult> {
    const mediaId = await this.uploadMedia(pdf, filename, phoneNumberId);
    if (!mediaId) {
      return { status: "failed", metaMessageId: null };
    }

    if (!this.isConfigured(phoneNumberId)) {
      return { status: "skipped", metaMessageId: null };
    }

    try {
      const response = await fetch(this.endpoint(phoneNumberId, "messages"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "document",
          document: { id: mediaId, caption, filename },
        }),
      });
      if (!response.ok) {
        this.log("whatsapp_document_send_failed", {
          reason: "graph_api_error",
          status: response.status,
        });
        return { status: "failed", metaMessageId: null };
      }

      const metaMessageId = await this.extractMessageId(response);
      this.log("whatsapp_document_sent", { status: response.status });
      return { status: "sent", metaMessageId };
    } catch {
      this.log("whatsapp_document_send_failed", {
        reason: "graph_api_request_error",
      });
      return { status: "failed", metaMessageId: null };
    }
  }

  async getMediaMetadata(
    mediaId: string,
    phoneNumberId: string,
  ): Promise<WhatsAppMediaMetadata | null> {
    if (!this.isConfigured(phoneNumberId)) {
      this.log("whatsapp_media_metadata_failed", {
        reason: "missing_media_configuration",
      });
      return null;
    }

    const endpoint = new URL(
      `${GRAPH_API_BASE_URL}/${encodeURIComponent(this.config.graphApiVersion ?? "")}/${encodeURIComponent(mediaId)}`,
    );
    endpoint.searchParams.set("phone_number_id", phoneNumberId);

    try {
      const response = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${this.config.accessToken}` },
      });
      if (!response.ok) {
        this.log("whatsapp_media_metadata_failed", {
          reason: "media_metadata_api_error",
          status: response.status,
        });
        return null;
      }

      const data: unknown = await response.json();
      const url = isRecord(data) ? stringValue(data.url) : "";
      if (!isSafeMediaUrl(url)) {
        this.log("whatsapp_media_metadata_failed", {
          reason: "invalid_media_url",
        });
        return null;
      }

      const mimeType = isRecord(data)
        ? stringValue(data.mime_type) || DEFAULT_MEDIA_MIME_TYPE
        : DEFAULT_MEDIA_MIME_TYPE;
      const fileSize = isRecord(data) ? numberValue(data.file_size) : null;
      if (fileSize !== null && fileSize > MAX_MEDIA_BYTES) {
        this.log("whatsapp_media_metadata_failed", {
          reason: "audio_too_large",
        });
        return null;
      }

      return { url, mimeType, fileSize };
    } catch {
      this.log("whatsapp_media_metadata_failed", {
        reason: "media_metadata_request_error",
      });
      return null;
    }
  }

  async downloadMedia(
    metadata: WhatsAppMediaMetadata,
  ): Promise<WhatsAppDownloadedMedia | null> {
    try {
      const response = await fetch(metadata.url, {
        headers: { Authorization: `Bearer ${this.config.accessToken}` },
      });
      if (!response.ok) {
        this.log("whatsapp_media_download_failed", {
          reason: "media_download_api_error",
          status: response.status,
        });
        return null;
      }

      const bytes = await readBytesWithLimit(response, MAX_MEDIA_BYTES);
      if (!bytes) {
        this.log("whatsapp_media_download_failed", {
          reason: "audio_too_large",
        });
        return null;
      }

      return {
        bytes,
        mimeType: metadata.mimeType || DEFAULT_MEDIA_MIME_TYPE,
      };
    } catch {
      this.log("whatsapp_media_download_failed", {
        reason: "media_download_request_error",
      });
      return null;
    }
  }

  private async uploadMedia(
    pdf: Blob,
    filename: string,
    phoneNumberId: string,
  ): Promise<string | null> {
    if (!this.isConfigured(phoneNumberId)) {
      this.log("whatsapp_document_upload_failed", {
        reason: "missing_outbound_configuration",
      });
      return null;
    }

    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("file", pdf, filename);

    try {
      const response = await fetch(this.endpoint(phoneNumberId, "media"), {
        method: "POST",
        headers: { Authorization: `Bearer ${this.config.accessToken}` },
        body: form,
      });
      if (!response.ok) {
        this.log("whatsapp_document_upload_failed", {
          reason: "graph_api_error",
          status: response.status,
        });
        return null;
      }

      const data: unknown = await response.json();
      const mediaId = isRecord(data) && typeof data.id === "string"
        ? data.id
        : null;
      if (!mediaId) {
        this.log("whatsapp_document_upload_failed", {
          reason: "invalid_graph_api_response",
        });
      }
      return mediaId;
    } catch {
      this.log("whatsapp_document_upload_failed", {
        reason: "graph_api_request_error",
      });
      return null;
    }
  }

  private async extractMessageId(response: Response): Promise<string | null> {
    const data: unknown = await response.json();
    const messages = isRecord(data) && Array.isArray(data.messages)
      ? data.messages
      : [];
    const firstMessage = messages[0];
    return isRecord(firstMessage) && typeof firstMessage.id === "string"
      ? firstMessage.id
      : null;
  }

  private async graphErrorDetails(
    response: Response,
  ): Promise<Record<string, unknown>> {
    try {
      const data: unknown = await response.json();
      const error = isRecord(data) && isRecord(data.error) ? data.error : null;
      if (!error) return {};
      return {
        ...(typeof error.code === "number" ? { graphCode: error.code } : {}),
        ...(typeof error.error_subcode === "number"
          ? { graphSubcode: error.error_subcode }
          : {}),
        ...(typeof error.type === "string" ? { graphType: error.type.slice(0, 120) } : {}),
        ...(typeof error.message === "string"
          ? { graphMessage: error.message.slice(0, 300) }
          : {}),
        ...(typeof error.fbtrace_id === "string"
          ? { fbtraceId: error.fbtrace_id.slice(0, 120) }
          : {}),
      };
    } catch {
      return {};
    }
  }
}
