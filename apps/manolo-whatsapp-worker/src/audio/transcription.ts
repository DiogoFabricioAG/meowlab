import type { AudioTranscriber } from "../ai/contracts";
import type { RoleLog } from "../roles/contracts";
import type { WhatsAppMediaClient } from "../whatsapp/contracts";

const MAX_TRANSCRIPT_LENGTH = 4_000;
const DEFAULT_AUDIO_MIME_TYPE = "audio/ogg";

function filenameForMimeType(mimeType: string): string {
  const normalized = mimeType.toLocaleLowerCase("en");
  if (normalized.includes("mpeg")) {
    return "voice.mp3";
  }
  if (normalized.includes("mp4") || normalized.includes("m4a")) {
    return "voice.m4a";
  }
  if (normalized.includes("webm")) {
    return "voice.webm";
  }
  if (normalized.includes("wav")) {
    return "voice.wav";
  }
  if (normalized.includes("amr")) {
    return "voice.amr";
  }
  return "voice.ogg";
}

export async function transcribeWhatsAppAudio(
  mediaId: string | null,
  mimeType: string | null,
  phoneNumberId: string,
  mediaClient: WhatsAppMediaClient | null,
  transcriber: AudioTranscriber | null,
  transcriptionModel: string,
  log: RoleLog,
): Promise<string | null> {
  if (!mediaClient || !transcriber || !transcriptionModel.trim()) {
    log("whatsapp_audio_transcription_failed", {
      reason: "missing_transcription_configuration",
    });
    return null;
  }

  if (!mediaId?.trim()) {
    log("whatsapp_audio_transcription_failed", {
      reason: "missing_media_id",
    });
    return null;
  }

  const metadata = await mediaClient.getMediaMetadata(mediaId, phoneNumberId);
  if (!metadata) {
    return null;
  }

  const audio = await mediaClient.downloadMedia(metadata);
  if (!audio) {
    return null;
  }

  const audioMimeType = mimeType?.trim() || audio.mimeType || DEFAULT_AUDIO_MIME_TYPE;
  const audioBuffer = new ArrayBuffer(audio.bytes.byteLength);
  new Uint8Array(audioBuffer).set(audio.bytes);
  const transcript = await transcriber.transcribe(
    {
      model: transcriptionModel,
      audio: new Blob([audioBuffer], { type: audioMimeType }),
      fileName: filenameForMimeType(audioMimeType),
      mimeType: audioMimeType,
      language: "es",
      prompt:
        "Transcribe en español. Conserva nombres, números, soles, DNI, RUC y términos de cotizaciones o comprobantes.",
    },
    log,
  );
  if (!transcript) {
    log("whatsapp_audio_transcription_failed", {
      reason: "provider_error",
    });
    return null;
  }

  log("whatsapp_audio_transcribed", { status: "success" });
  return transcript.slice(0, MAX_TRANSCRIPT_LENGTH);
}
