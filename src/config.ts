import { config } from "dotenv";
import { resolve } from "path";
import { existsSync, mkdirSync } from "fs";

config();

function optional(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

/**
 * Ensure required data directories exist.
 * Called once at startup from main().
 */
export function ensureDirectories(): void {
  const dataDir = resolve(process.cwd(), "data");
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

  const resumesDir = resolve(dataDir, "resumes");
  if (!existsSync(resumesDir)) mkdirSync(resumesDir, { recursive: true });
}

export const cfg = {
  // Gemini key is optional in MOCK_LLM mode (browser pipeline can run without it).
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  mockLLM: process.env.MOCK_LLM === "true",
  resumePath: resolve(optional("RESUME_PATH", "./data/resumes/placeholder.txt")),
  headless: process.env.HEADLESS === "true",
  slowMo: parseInt(process.env.SLOW_MO || "100", 10),
  dbPath: resolve(optional("DB_PATH", "./data/applyflow.db")),

  // webcmd browser layer
  // Empty string → auto-resolve (project-local webcmd/ or globally installed `webcmd`).
  webcmdBinary: optional("WEBCMD_PATH", ""),
  webcmdProfile: optional("WEBCMD_PROFILE", "applyflow"),

  // LLM settings
  geminiModel: process.env.GEMINI_MODEL || "gemini-3.6-flash",
  geminiTemp: 0.7,

  // ATS selectors (semantic-based)
  greenhouse: {
    formSelector: ".application-form",
    submitSelector: 'button[type="submit"], input[type="submit"]',
    resumeSelector: 'input[type="file"][name*="resume"], input[type="file"][name*="resume"]',
  },
  lever: {
    formSelector: ".postings-form",
    submitSelector: 'button[data-qa="btn-submit"], button[type="submit"]',
    resumeSelector: 'input[type="file"]',
  },
} as const;
