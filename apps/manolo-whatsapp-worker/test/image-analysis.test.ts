import { describe, expect, it, vi } from "vitest";
import type { AiProvider } from "../src/ai/contracts";
import { analyzeWhatsAppImage } from "../src/image/analysis";
import type {
  WhatsAppMediaClient,
  WhatsAppMediaMetadata,
} from "../src/whatsapp/contracts";

describe("analyzeWhatsAppImage", () => {
  it("downloads the WhatsApp image and sends it to Groq as a data URL", async () => {
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
      key: "groq",
      complete,
    };

    const result = await analyzeWhatsAppImage(
      "image-media-1",
      "image/png",
      "¿Cuánto cuesta?",
      "1266091906580349",
      mediaClient,
      provider,
      "qwen/qwen3.6-27b",
      () => undefined,
    );

    expect(result).toContain("Texto adjunto del usuario: ¿Cuánto cuesta?");
    expect(result).toContain("[INFORMACIÓN VISUAL — SOLO CONTEXTO]");
    expect(result).toContain("[FIN DE INFORMACIÓN VISUAL]");
    expect(result).toContain("tela azul");
    expect(mediaClient.getMediaMetadata).toHaveBeenCalledWith(
      "image-media-1",
      "1266091906580349",
    );
    expect(mediaClient.downloadMedia).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "qwen/qwen3.6-27b",
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
                  detail: "auto",
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
      key: "groq",
      complete: vi.fn(),
    };

    const result = await analyzeWhatsAppImage(
      "image-media-2",
      "image/gif",
      "",
      "1266091906580349",
      mediaClient,
      provider,
      "qwen/qwen3.6-27b",
      () => undefined,
    );

    expect(result).toBeNull();
    expect(mediaClient.downloadMedia).not.toHaveBeenCalled();
    expect(provider.complete).not.toHaveBeenCalled();
  });
});
