export type WhatsAppSendResult = {
  status: "sent" | "failed" | "skipped";
  metaMessageId: string | null;
};

export type WhatsAppMediaMetadata = {
  url: string;
  mimeType: string;
  fileSize: number | null;
};

export type WhatsAppDownloadedMedia = {
  bytes: Uint8Array;
  mimeType: string;
};

export type WhatsAppReplyButton = {
  id: string;
  title: string;
};

export type WhatsAppListRow = {
  id: string;
  title: string;
  description?: string;
};

export type WhatsAppListSection = {
  title?: string;
  rows: readonly WhatsAppListRow[];
};

export interface WhatsAppMediaClient {
  getMediaMetadata(
    mediaId: string,
    phoneNumberId: string,
  ): Promise<WhatsAppMediaMetadata | null>;
  downloadMedia(
    metadata: WhatsAppMediaMetadata,
  ): Promise<WhatsAppDownloadedMedia | null>;
}

export interface WhatsAppClient extends WhatsAppMediaClient {
  sendTypingIndicator(
    messageId: string,
    phoneNumberId: string,
  ): Promise<boolean>;
  sendText(
    to: string,
    body: string,
    phoneNumberId: string,
  ): Promise<WhatsAppSendResult>;
  sendImage(
    to: string,
    imageUrl: string,
    caption: string,
    phoneNumberId: string,
  ): Promise<WhatsAppSendResult>;
  sendButtons(
    to: string,
    body: string,
    buttons: readonly WhatsAppReplyButton[],
    phoneNumberId: string,
  ): Promise<WhatsAppSendResult>;
  sendList(
    to: string,
    body: string,
    buttonText: string,
    sections: readonly WhatsAppListSection[],
    phoneNumberId: string,
  ): Promise<WhatsAppSendResult>;
  sendDocument(
    to: string,
    pdf: Blob,
    filename: string,
    caption: string,
    phoneNumberId: string,
  ): Promise<WhatsAppSendResult>;
}
