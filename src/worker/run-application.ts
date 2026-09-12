import { existsSync } from "node:fs";
import { scrapeJobPosting, getApplicationFormUrl } from "../evaluator/job-scraper.js";
import { parseResume } from "../evaluator/resume-parser.js";
import { evaluateJobFit } from "../evaluator/scorer.js";
import { analyzeFormFields, waitForForm } from "../explorer/form-analyzer.js";
import { draftAnswers } from "../drafter/answer-generator.js";
import { WebcmdSession } from "../filler/webcmd-session.js";
import { fillForm, pauseBeforeSubmit } from "../filler/form-filler.js";
import { saveApplication, updateApplicationStatus, initDB } from "../tracker/database.js";
import type { DraftedAnswer, FormAnalysis, JobEvaluation, JobPosting, ResumeData } from "../types/index.js";
import { applyRuntimeSettings } from "../config.js";
import { resetLLMProvider } from "../llm/provider.js";

export type ApplicationStage =
  | "validating"
  | "extracting"
  | "evaluating"
  | "exploring"
  | "drafting"
  | "prefilling"
  | "review"
  | "failed";

export interface ApplicationProgress {
  stage: ApplicationStage;
  message: string;
  job?: JobPosting;
  resume?: ResumeData;
  evaluation?: JobEvaluation;
  formAnalysis?: FormAnalysis;
  draftedAnswers?: DraftedAnswer[];
  filled?: number;
  skipped?: number;
  failed?: number;
  error?: string;
}

export interface ApplicationPayload {
  jobUrl: string;
  resumePath: string;
  mockLLM?: boolean;
  slowMo?: number;
  geminiApiKey?: string;
  anthropicApiKey?: string;
  llmProvider?: string;
  onProgress?: (progress: ApplicationProgress) => void | Promise<void>;
}

export interface ApplicationResult {
  status: "review";
  job: JobPosting;
  resume: ResumeData;
  evaluation: JobEvaluation;
  formAnalysis: FormAnalysis;
  draftedAnswers: DraftedAnswer[];
  filled: number;
  skipped: number;
  failed: number;
}

function report(payload: ApplicationPayload, progress: ApplicationProgress): void | Promise<void> {
  console.log(`  [${progress.stage}] ${progress.message}`);
  return payload.onProgress?.(progress);
}

export async function runApplication(payload: ApplicationPayload): Promise<ApplicationResult> {
  if (!payload.jobUrl) throw new Error("Job URL is required.");
  if (!existsSync(payload.resumePath)) throw new Error(`Resume not found: ${payload.resumePath}`);

  applyRuntimeSettings(payload);
  resetLLMProvider();
  initDB();
  const session = new WebcmdSession();
  let applicationId: number | undefined;
  let keepSessionOpen = false;

  try {
    await report(payload, { stage: "validating", message: "Validating job URL and preparing the application run." });

    await report(payload, { stage: "extracting", message: "Scraping the job posting and extracting resume data." });
    const job = await scrapeJobPosting(payload.jobUrl);
    const resume = parseResume(payload.resumePath);

    await report(payload, { stage: "evaluating", message: "Evaluating resume fit against the job posting." });
    const evaluation = await evaluateJobFit(job, resume);
    applicationId = saveApplication({
      jobUrl: payload.jobUrl,
      company: job.company,
      title: job.title,
      score: evaluation.score,
      status: "evaluated",
      answers: [],
    });

    await report(payload, { stage: "exploring", message: "Launching the visible browser and mapping application fields." });
    await session.launch();
    await session.navigate(await getApplicationFormUrl(job));
    if (!(await waitForForm(session))) throw new Error("No application form was detected.");
    const formAnalysis = await analyzeFormFields(session);
    updateApplicationStatus(applicationId, "explored");

    await report(payload, { stage: "drafting", message: "Drafting tailored answers for custom screening questions." });
    const draftedAnswers = await draftAnswers(formAnalysis.customQuestions, job, resume);
    updateApplicationStatus(applicationId, "drafted");

    await report(payload, { stage: "prefilling", message: "Filling standard fields and attaching the resume PDF." });
    const fillSummary = await fillForm(session, formAnalysis, resume, draftedAnswers, payload.resumePath);
    updateApplicationStatus(applicationId, "prefilled");

    await pauseBeforeSubmit(session, formAnalysis.submitButtonSelector);
    keepSessionOpen = true;
    const result: ApplicationResult = {
      status: "review",
      job,
      resume,
      evaluation,
      formAnalysis,
      draftedAnswers,
      ...fillSummary,
    };
    await report(payload, {
      stage: "review",
      message: "Safe-stop reached. Review the populated application before submitting.",
      ...result,
    });
    return result;
  } catch (error) {
    if (applicationId) updateApplicationStatus(applicationId, "skipped");
    const message = error instanceof Error ? error.message : String(error);
    await report(payload, { stage: "failed", message, error: message });
    throw error;
  } finally {
    if (!keepSessionOpen) await session.close();
  }
}
