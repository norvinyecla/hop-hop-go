import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

/**
 * Builds the chat model from LLM_PROVIDER, LLM_MODEL and LLM_API_KEY.
 * To support another provider, install its @ai-sdk package and add a case.
 */
export function getModel(): LanguageModel {
  const provider = process.env.LLM_PROVIDER ?? "google";
  const model = process.env.LLM_MODEL ?? "gemini-3.1-flash-lite-preview";
  const apiKey = process.env.LLM_API_KEY;

  if (!apiKey) {
    throw new Error("LLM_API_KEY is not set");
  }

  switch (provider) {
    case "google":
      return createGoogle({ apiKey })(model);
    case "anthropic":
      return createAnthropic({ apiKey })(model);
    default:
      throw new Error(`Unsupported LLM_PROVIDER: ${provider}`);
  }
}
