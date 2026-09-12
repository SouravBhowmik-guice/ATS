import { GoogleGenerativeAI, type GenerationConfig } from "@google/generative-ai";
import { cfg } from "../config.js";

const genAI = new GoogleGenerativeAI(cfg.geminiApiKey);

/**
 * Get a configured Gemini model instance.
 * Shared by scorer and answer-generator to avoid duplicate initialization.
 */
export function getGeminiModel(overrides?: GenerationConfig) {
  return genAI.getGenerativeModel({
    model: cfg.geminiModel,
    generationConfig: {
      temperature: cfg.geminiTemp,
      responseMimeType: "application/json",
      ...overrides,
    },
  });
}
