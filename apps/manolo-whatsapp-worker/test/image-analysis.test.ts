import { describe, expect, it, vi } from "vitest";
import type { AiProvider } from "../src/ai/contracts";
import { analyzeWhatsAppImage } from "../src/image/analysis";
import type {
  WhatsAppMediaClient,
  WhatsAppMediaMetadata,
} from "../src/whatsapp/contracts";

describe("analyzeWhatsAppImage", () => {
  it("downloads the WhatsApp image and sends it to Luna with its caption", async () => {
    const mediaClient: WhatsAppMediaClient = {
      getMediaMetadata: vi.fn(async (): Promise<WhatsAppMediaMetadata> => ({
        url: "https://media.test/design.png",
        mimeType: "image/png",
        fileSize: 3,
      })),
      downloadMedia: vi.fn(async () => ({
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: "image/png",
      })),
    };
    const complete = vi.fn(async () => "Se observa una tela azul con un precio visible de S/ 40.");
    const provider: AiProvider = {
      key: "openai",
      complete,
    };

    const result = await analyzeWhatsAppImage(
      "image-media-1",
      "image/png",
      "¿Cuánto cuesta?",
      "1266091906580349",
      mediaClient,
      provider,
      "gpt-6-luna",
      () => undefined,
    );

    expect(result).toContain("Texto adjunto del usuario: ¿Cuánto cuesta?");
    expect(result).toContain("[INFORMACIÓN VISUAL — DATOS OBSERVADOS]");
    expect(result).toContain("[FIN DE INFORMACIÓN VISUAL]");
    expect(result).toContain("tela azul");
    expect(mediaClient.getMediaMetadata).toHaveBeenCalledWith(
      "image-media-1",
      "1266091906580349",
    );
    expect(mediaClient.downloadMedia).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-6-luna",
        reasoningEffort: "low",
        maxTokens: 4_000,
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "system" }),
          expect.objectContaining({
            role: "user",
            content: expect.arrayContaining([
              expect.objectContaining({ type: "text" }),
              {
                type: "image_url",
                image_url: {
                  url: "data:image/png;base64,AQID",
                  detail: "high",
                },
              },
            ]),
          }),
        ]),
      }),
      expect.any(Function),
    );
  });

  it("rejects unsupported image formats before downloading them", async () => {
    const mediaClient: WhatsAppMediaClient = {
      getMediaMetadata: vi.fn(async () => ({
        url: "https://media.test/file.gif",
        mimeType: "image/gif",
        fileSize: 3,
      })),
      downloadMedia: vi.fn(),
    };
    const provider: AiProvider = {
      key: "openai",
      complete: vi.fn(),
    };

    const result = await analyzeWhatsAppImage(
      "image-media-2",
      "image/gif",
      "",
      "1266091906580349",
      mediaClient,
      provider,
      "gpt-6-luna",
      () => undefined,
    );

    expect(result).toBeNull();
    expect(mediaClient.downloadMedia).not.toHaveBeenCalled();
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it("fails safely when Luna returns no result without trying a second provider", async () => {
    const mediaClient: WhatsAppMediaClient = {
      getMediaMetadata: vi.fn(async () => ({ url: "https://media.test/photo.png", mimeType: "image/png", fileSize: 3 })),
      downloadMedia: vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" })),
    };
    const provider: AiProvider = { key: "openai", complete: vi.fn(async () => null) };
    const log = vi.fn();
    await expect(analyzeWhatsAppImage("image-id", "image/png", "Cliente de prueba", "phone-id", mediaClient, provider, "gpt-6-luna", log)).resolves.toBeNull();
    expect(provider.complete).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("whatsapp_image_analysis_failed", { reason: "provider_error" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("Cliente de prueba");
    expect(JSON.stringify(log.mock.calls)).not.toContain("base64");
  });

  it("rejects images over 8 MB before calling Luna", async () => {
    const mediaClient: WhatsAppMediaClient = {
      getMediaMetadata: vi.fn(async () => ({ url: "https://media.test/photo.png", mimeType: "image/png", fileSize: 8 * 1024 * 1024 + 1 })),
      downloadMedia: vi.fn(),
    };
    const provider: AiProvider = { key: "openai", complete: vi.fn() };
    await expect(analyzeWhatsAppImage("image-id", "image/png", "", "phone-id", mediaClient, provider, "gpt-6-luna", vi.fn())).resolves.toBeNull();
    expect(mediaClient.downloadMedia).not.toHaveBeenCalled();
    expect(provider.complete).not.toHaveBeenCalled();
  });
});
