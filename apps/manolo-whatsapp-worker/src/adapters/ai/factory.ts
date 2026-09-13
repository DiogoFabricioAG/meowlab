import type { AiProvider, AudioTranscriber } from "../../ai/contracts";
import { GroqAdapter } from "./groq-adapter";
import { OpenAiCompatibleAdapter } from "./openai-compatible-adapter";

export type AiProviderSecrets = {
  groqApiKey?: string;
  openAiApiKey?: string;
  openAiBaseUrl?: string;
};

function normalizeProviderKey(providerKey: string): string {
  return providerKey.trim().toLocaleLowerCase("en");
}

export function createAiProvider(
  providerKey: string,
  secrets: AiProviderSecrets,
): AiProvider | null {
  if (normalizeProviderKey(providerKey) === "groq") {
    return new GroqAdapter(secrets.groqApiKey);
  }

  if (["openai", "openai-compatible"].includes(normalizeProviderKey(providerKey))) {
    return new OpenAiCompatibleAdapter({
      apiKey: secrets.openAiApiKey,
      baseUrl: secrets.openAiBaseUrl,
    });
  }

  return null;
}

export function createAudioTranscriber(
  providerKey: string,
  secrets: AiProviderSecrets,
): AudioTranscriber | null {
  if (normalizeProviderKey(providerKey) === "groq") {
    return new GroqAdapter(secrets.groqApiKey);
  }

  return null;
}
