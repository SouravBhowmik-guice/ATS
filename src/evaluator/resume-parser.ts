import { readFileSync } from "fs";
import type { ResumeData, Experience, Education } from "../types/index.js";

/**
 * Parse a plain-text resume into structured data.
 * Expects a reasonably formatted resume with sections.
 */
export function parseResume(filePath: string): ResumeData {
  console.log(`  📄 Parsing resume: ${filePath}`);

  const rawText = readFileSync(filePath, "utf-8");
  const lines = rawText.split("\n").map((l) => l.trim());

  // Extract email
  const emailMatch = rawText.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  const email = emailMatch ? emailMatch[0] : "";

  // Extract phone
  const phoneMatch = rawText.match(/[\+]?[(]?\d{3}[)]?[-\s.]?\d{3}[-\s.]?\d{4}/);
  const phone = phoneMatch ? phoneMatch[0] : "";

  // Extract LinkedIn
  const linkedinMatch = rawText.match(/linkedin\.com\/in\/[\w-]+/i);
  const linkedin = linkedinMatch ? linkedinMatch[0] : "";

  // Extract GitHub
  const githubMatch = rawText.match(/github\.com\/[\w-]+/i);
  const github = githubMatch ? githubMatch[0] : "";

  // The first non-empty line is usually the name
  const name = lines.find((l) => l.length > 2 && !l.includes("@") && !l.includes("http")) || "Unknown";

  // Extract sections by detecting headers
  const sections = splitIntoSections(lines);

  const skills = extractSkills(sections.skills || []);
  const experience = extractExperience(sections.experience || sections["work experience"] || []);
  const education = extractEducation(sections.education || []);
  const summary =
    sections.summary?.join(" ") ||
    sections.objective?.join(" ") ||
    sections.profile?.join(" ") ||
    "";

  const resume: ResumeData = {
    name,
    email,
    phone,
    linkedin,
    github,
    summary,
    skills,
    experience,
    education,
    rawText,
  };

  console.log(`  ✅ Parsed resume for: ${name}`);
  console.log(`     📧 ${email} | 📱 ${phone}`);
  console.log(`     🛠️  ${skills.length} skills, ${experience.length} experiences, ${education.length} educations`);

  return resume;
}

/**
 * Split resume lines into named sections.
 */
function splitIntoSections(lines: string[]): Record<string, string[]> {
  const sections: Record<string, string[]> = {};
  let currentSection = "header";
  sections[currentSection] = [];

  const sectionHeaders = [
    "summary",
    "objective",
    "profile",
    "about",
    "experience",
    "work experience",
    "employment",
    "education",
    "skills",
    "technical skills",
    "technologies",
    "projects",
    "certifications",
    "awards",
    "publications",
    "languages",
    "interests",
    "references",
  ];

  for (const line of lines) {
    const lower = line.toLowerCase().replace(/[:\s]+$/, "").trim();

    // Check if this line is a section header
    const isHeader = sectionHeaders.some((h) => lower === h || lower === `${h}:`);
    const looksLikeHeader =
      line.length < 40 &&
      !line.includes("@") &&
      !line.includes("•") &&
      !line.includes("-") &&
      line === line.toUpperCase() &&
      line.length > 2;

    if (isHeader || looksLikeHeader) {
      currentSection = lower.replace(/[:]+$/, "").trim();
      sections[currentSection] = [];
    } else if (line.length > 0) {
      sections[currentSection].push(line);
    }
  }

  return sections;
}

/**
 * Extract skills from the skills section lines.
 */
function extractSkills(lines: string[]): string[] {
  const skills: string[] = [];

  for (const line of lines) {
    // Split by common delimiters
    const parts = line.split(/[,;|•\-\/]/).map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
      if (part.length > 1 && part.length < 50) {
        skills.push(part);
      }
    }
  }

  return [...new Set(skills)];
}

/**
 * Extract work experience from lines.
 */
function extractExperience(lines: string[]): Experience[] {
  const experiences: Experience[] = [];
  let current: Partial<Experience> | null = null;

  for (const line of lines) {
    // Lines with dates often indicate a new experience entry
    const hasDate =
      /\b(20\d{2}|19\d{2})\b/.test(line) ||
      /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\b/i.test(line);

    // Lines with "at" or comma-separated company info
    const hasCompanyIndicator = /\bat\b|\bfor\b/.test(line.toLowerCase()) || line.includes(",");

    if (hasDate || (hasCompanyIndicator && line.length < 80)) {
      if (current && current.title) {
        experiences.push(current as Experience);
      }

      // Try to parse title and company
      const parts = line.split(/[-–—|,]/).map((s) => s.trim());
      current = {
        title: parts[0] || "",
        company: parts[1] || "",
        duration: parts.find((p) => /\d{4}/.test(p)) || "",
        description: "",
      };
    } else if (current) {
      // Accumulate description lines
      const cleaned = line.replace(/^[•\-\*]\s*/, "").trim();
      if (cleaned.length > 5) {
        current.description = (current.description ? current.description + " " : "") + cleaned;
      }
    }
  }

  if (current && current.title) {
    experiences.push(current as Experience);
  }

  return experiences;
}

/**
 * Extract education from lines.
 */
function extractEducation(lines: string[]): Education[] {
  const educations: Education[] = [];
  let current: Partial<Education> | null = null;

  for (const line of lines) {
    const hasYear = /\b(20\d{2}|19\d{2})\b/.test(line);
    const hasDegree = /\b(b\.?s\.?|bachelor|m\.?s\.?|master|ph\.?d|diploma|degree|associate)/i.test(line);

    if (hasDegree || hasYear) {
      if (current && current.degree) {
        educations.push(current as Education);
      }

      const parts = line.split(/[-–—|,]/).map((s) => s.trim());
      current = {
        degree: parts[0] || "",
        school: parts[1] || "",
        year: parts.find((p) => /\d{4}/.test(p)) || "",
      };
    } else if (current && !current.school) {
      current.school = line.trim();
    }
  }

  if (current && current.degree) {
    educations.push(current as Education);
  }

  return educations;
}

/**
 * Build a compact resume summary for LLM prompts.
 */
export function resumeToPromptSummary(resume: ResumeData): string {
  const parts: string[] = [];

  parts.push(`Name: ${resume.name}`);
  parts.push(`Skills: ${resume.skills.join(", ")}`);

  if (resume.experience.length > 0) {
    parts.push("\nExperience:");
    for (const exp of resume.experience.slice(0, 5)) {
      parts.push(`  - ${exp.title}${exp.company ? ` at ${exp.company}` : ""} (${exp.duration})`);
      if (exp.description) {
        parts.push(`    ${exp.description.slice(0, 200)}`);
      }
    }
  }

  if (resume.education.length > 0) {
    parts.push("\nEducation:");
    for (const edu of resume.education) {
      parts.push(`  - ${edu.degree}${edu.school ? ` at ${edu.school}` : ""} (${edu.year})`);
    }
  }

  if (resume.summary) {
    parts.push(`\nSummary: ${resume.summary.slice(0, 300)}`);
  }

  return parts.join("\n");
}
